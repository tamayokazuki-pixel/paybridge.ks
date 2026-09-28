import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { availableBalance } from "@/lib/balance";
import { CHEQUE_METHOD_KEY, CHEQUE_METHOD_LABEL, chequeWithdrawalSchema } from "@/lib/cheques";
import { chequeInsertError, isActiveAccount, REQUIRED_CHEQUE_COLUMNS } from "@/lib/cheque-server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { insertTransaction } from "@/lib/transactions";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = chequeWithdrawalSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid cheque details." }, { status: 400 });
  }
  const { amount, payeeName, mailingAddress } = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    if (!await isActiveAccount(supabase, user.id)) {
      return NextResponse.json({ error: "An active account is required to withdraw by cheque." }, { status: 403 });
    }

    // Cheque withdrawals reserve funds immediately. Rejected requests release
    // the hold; approved requests remain debited in the shared transaction ledger.
    const { data: ledger, error: ledgerError } = await supabase
      .from("transactions").select("amount,type,status").eq("user_id", user.id);
    if (ledgerError) throw ledgerError;
    if (amount > availableBalance(ledger || [])) {
      return NextResponse.json({ error: "Insufficient available balance." }, { status: 400 });
    }

    const { data, error } = await insertTransaction(supabase, {
      user_id: user.id,
      profile_id: user.id,
      type: "withdrawal",
      status: "pending",
      amount,
      method_key: CHEQUE_METHOD_KEY,
      method_label: CHEQUE_METHOD_LABEL,
      description: `Cheque withdrawal · ${payeeName}`,
      cheque_details: { kind: "withdrawal", payeeName, mailingAddress }
    }, { requiredColumns: REQUIRED_CHEQUE_COLUMNS });

    if (error) {
      console.error("Cheque withdrawal insert failed:", error);
      return NextResponse.json({ error: chequeInsertError(error) }, { status: 400 });
    }
    return NextResponse.json({ transaction: data }, { status: 201 });
  } catch (error) {
    console.error("Cheque withdrawal request failed:", error);
    return NextResponse.json({ error: "Could not submit cheque withdrawal. Please try again." }, { status: 500 });
  }
}
