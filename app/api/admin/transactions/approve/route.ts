import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { describeDbError, finalizeTransaction } from "@/lib/transactions";

const schema = z.object({
  transactionId: z.string().uuid(),
  reference: z.string().optional()
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
  const { transactionId, reference } = parsed.data;

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
      status: "completed",
      reference: reference?.trim() || null,
      completed_at: new Date().toISOString()
    });

    if (error) {
      console.error("Approve transaction failed:", error);
      return NextResponse.json(
        { error: `Could not approve this transaction: ${describeDbError(error)}` },
        { status: 400 }
      );
    }

    // Best effort: the log entry must not fail the approval itself.
    const { error: logError } = await supabase.from("activity_logs").insert({
      actor_id: adminUser.id,
      user_id: txn.user_id,
      action: "transaction_approved",
      details: `Approved transaction ${transactionId}`
    });
    if (logError) console.error("Could not write activity log:", logError.message);

    return NextResponse.json({ transaction: data, legacyStatus });
  } catch (error) {
    console.error("Approve transaction crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
