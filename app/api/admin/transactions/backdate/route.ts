import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizeStatus } from "@/lib/transaction-status";
import {
  describeDbError,
  parseTransactionTimestamp,
  updateTransactionDate
} from "@/lib/transactions";

const backdateSchema = z.object({
  transactionId: z.string().uuid("Invalid transaction ID."),
  transactionDate: z.string().trim().min(1, "Select a transaction date and time."),
  adminNote: z.string().trim().max(500).optional()
});

export async function POST(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required. Please sign in again." }, { status: 403 });
  }

  const parsed = backdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body." }, { status: 400 });
  }

  const { transactionId, transactionDate, adminNote } = parsed.data;
  const parsedDate = parseTransactionTimestamp(transactionDate);
  if (!parsedDate.ok) {
    return NextResponse.json({ error: parsedDate.error }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: txn, error: fetchError } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!txn) {
      return NextResponse.json({ error: "Transaction not found." }, { status: 404 });
    }

    const normalized = normalizeStatus(txn.status);
    const fields: {
      created_at: string;
      completed_at?: string | null;
      admin_note?: string | null;
    } = {
      created_at: parsedDate.iso
    };

    if (normalized === "completed" || normalized === "rejected") {
      fields.completed_at = parsedDate.iso;
    }
    if (adminNote !== undefined) {
      fields.admin_note = adminNote || null;
    }

    const { data, error } = await updateTransactionDate(supabase, transactionId, fields);
    if (error || !data) {
      console.error("Backdate transaction failed:", error);
      return NextResponse.json(
        { error: `Could not update transaction date: ${describeDbError(error)}` },
        { status: 400 }
      );
    }

    // Keep linked paper-stock trade history aligned with the ledger timestamp.
    if (txn.method_key === "stocks") {
      try {
        const { error: stockError } = await supabase
          .from("stock_trades")
          .update({ created_at: parsedDate.iso })
          .eq("transaction_id", transactionId);
        if (stockError) {
          console.error("Could not sync stock_trades timestamp:", stockError.message);
        }
      } catch (stockSyncErr) {
        console.error("Stock trade timestamp sync skipped:", stockSyncErr);
      }
    }

    const previousDate = txn.created_at ? String(txn.created_at) : "unknown";
    const { error: logError } = await supabase.from("activity_logs").insert({
      actor_id: adminUser.id,
      user_id: String(txn.user_id),
      action: "transaction_backdated",
      details: `Updated transaction ${transactionId} date from ${previousDate} to ${parsedDate.iso}`
    });
    if (logError) console.error("Could not write activity log:", logError.message);

    return NextResponse.json({ transaction: data });
  } catch (error) {
    console.error("Backdate transaction crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
