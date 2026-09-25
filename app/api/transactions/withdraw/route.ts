import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { describeDbError, insertTransaction } from "@/lib/transactions";
import { normalizeStatus } from "@/lib/transaction-status";

const withdrawSchema = z.object({
  amount: z.number().min(50, "Minimum withdrawal amount is $50"),
  methodLabel: z.string().min(1),
  destination: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = withdrawSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body." }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();

    // Calculate available balance: completed deposits minus everything already
    // committed (pending or completed withdrawals/transfers).
    const { data: ledgerBalanceData } = await supabase
      .from("transactions")
      .select("amount,type,status")
      .eq("user_id", user.id);

    const availableBalance = (ledgerBalanceData || []).reduce((sum, txn) => {
      const status = normalizeStatus(txn.status);
      if (status === "completed" && (txn.type === "deposit" || txn.type === "admin_adjustment")) {
        sum += Number(txn.amount);
      } else if (txn.type === "withdrawal" || txn.type === "transfer" || txn.type === "withdraw") {
        if (status === "completed" || status === "pending") {
          sum -= Number(txn.amount);
        }
      }
      return sum;
    }, 0);

    if (body.amount > availableBalance) {
      return NextResponse.json({ error: "Insufficient available balance." }, { status: 400 });
    }

    const { data, error } = await insertTransaction(supabase, {
      user_id: user.id,
      // Kept for databases that still have the legacy profiles foreign key;
      // dropped automatically when the column does not exist.
      profile_id: user.id,
      type: "withdrawal",
      status: "pending",
      amount: body.amount,
      method_label: body.methodLabel,
      description: `Withdrawal to: ${body.destination}`
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: describeDbError(error) }, { status: 400 });
    }

    return NextResponse.json({ transaction: data });
  } catch (error) {
    console.error("Withdrawal request crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
