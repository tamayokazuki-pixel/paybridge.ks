import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { availableBalance } from "@/lib/balance";
import { isActiveAccount } from "@/lib/cheque-server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { describeDbError, insertTransaction } from "@/lib/transactions";

const withdrawSchema = z.object({
  amount: z.number().finite().min(50, "Minimum withdrawal amount is $50"),
  paymentMethodKey: z.string().min(1),
  destination: z.string().trim().min(1).max(500)
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
    if (!await isActiveAccount(supabase, user.id)) {
      return NextResponse.json({ error: "An active account is required to withdraw." }, { status: 403 });
    }
    const { data: method, error: methodError } = await supabase
      .from("payment_methods").select("key,label").eq("key", body.paymentMethodKey).eq("is_active", true).maybeSingle();
    if (methodError) throw methodError;
    if (!method) return NextResponse.json({ error: "Payment method is unavailable." }, { status: 404 });

    const { data: ledger, error: ledgerError } = await supabase
      .from("transactions").select("amount,type,status").eq("user_id", user.id);
    if (ledgerError) throw ledgerError;
    if (body.amount > availableBalance(ledger || [])) {
      return NextResponse.json({ error: "Insufficient available balance." }, { status: 400 });
    }

    const { data, error } = await insertTransaction(supabase, {
      user_id: user.id,
      profile_id: user.id,
      type: "withdrawal",
      status: "pending",
      amount: body.amount,
      method_key: method.key,
      method_label: method.label,
      description: `Withdrawal to: ${body.destination}`
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: describeDbError(error) }, { status: 400 });
    }

    return NextResponse.json({ transaction: data });
  } catch (error) {
    console.error("Withdrawal request crashed:", error);
    return NextResponse.json({ error: "Could not submit withdrawal request. Please try again." }, { status: 500 });
  }
}
