import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { describeDbError, insertTransaction } from "@/lib/transactions";

const depositSchema = z.object({
  amount: z.number().min(50, "Minimum deposit amount is $50"),
  paymentMethodKey: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = depositSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body." }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const supabase = createSupabaseAdminClient();
    const { data: method } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("key", body.paymentMethodKey)
      .eq("is_active", true)
      .maybeSingle();

    if (!method) return NextResponse.json({ error: "Payment method is unavailable." }, { status: 404 });

    const { data, error } = await insertTransaction(supabase, {
      user_id: user.id,
      // Kept for databases that still have the legacy profiles foreign key;
      // dropped automatically when the column does not exist.
      profile_id: user.id,
      type: "deposit",
      status: "pending",
      amount: body.amount,
      method_key: method.key,
      method_label: method.label,
      description: `Deposit via ${method.label}`
    });

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: describeDbError(error) }, { status: 400 });
    }
    return NextResponse.json({ transaction: data, paymentMethod: method });
  } catch (error) {
    console.error("Deposit request crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
