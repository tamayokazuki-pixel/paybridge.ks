import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const depositSchema = z.object({
  amount: z.number().min(50, "Minimum deposit amount is $50"),
  paymentMethodKey: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = depositSchema.parse(await request.json());
  const supabase = createSupabaseAdminClient();
  const { data: method } = await supabase
    .from("payment_methods")
    .select("*")
    .eq("key", body.paymentMethodKey)
    .eq("is_active", true)
    .single();

  if (!method) return NextResponse.json({ error: "Payment method is unavailable." }, { status: 404 });

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      user_id: user.id,
      profile_id: user.id,
      type: "deposit",
      status: "pending",
      amount: body.amount,
      method_key: method.key,
      method_label: method.label,
      description: `Deposit via ${method.label}`
    })
    .select("*")
    .single();

  if (error) {
    console.error("Supabase insert error:", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ transaction: data, paymentMethod: method });
}
