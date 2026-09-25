import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { describeDbError, finalizeTransaction, isStatusConstraintError } from "@/lib/transactions";

const schema = z.object({
  transactionId: z.string().uuid(),
  reason: z.string().optional()
});

export async function POST(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required. Please sign in again." }, { status: 403 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body." }, { status: 400 });
  }
  const { transactionId, reason } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: txn } = await supabase
      .from("transactions")
      .select("*")
      .eq("id", transactionId)
      .eq("status", "pending")
      .maybeSingle();

    if (!txn) {
      return NextResponse.json(
        { error: "Pending transaction not found. It may have already been approved or rejected." },
        { status: 404 }
      );
    }

    const { data, error, legacyStatus } = await finalizeTransaction(supabase, transactionId, {
      status: "rejected",
      admin_note: reason?.trim() || null,
      completed_at: new Date().toISOString()
    });

    if (error) {
      console.error("Reject transaction failed:", error);
      const message = isStatusConstraintError(error)
        ? "Your database still uses the old transaction status values, so it refuses to store 'rejected'. Run supabase/fix_transactions_status.sql in the Supabase SQL editor, then try again."
        : `Could not reject this transaction: ${describeDbError(error)}`;
      return NextResponse.json({ error: message, detail: error.message }, { status: 400 });
    }

    // Best effort: the log entry must not fail the rejection itself.
    const { error: logError } = await supabase.from("activity_logs").insert({
      actor_id: adminUser.id,
      user_id: txn.user_id,
      action: "transaction_rejected",
      details: reason?.trim() || `Rejected transaction ${transactionId}`
    });
    if (logError) console.error("Could not write activity log:", logError.message);

    return NextResponse.json({ transaction: data, legacyStatus });
  } catch (error) {
    console.error("Reject transaction crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
