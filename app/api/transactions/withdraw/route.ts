import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const withdrawSchema = z.object({
  amount: z.number().min(50, "Minimum withdrawal amount is $50"),
  methodLabel: z.string().min(1),
  destination: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = withdrawSchema.parse(await request.json());
    const supabase = createSupabaseAdminClient();

    // Calculate available balance
    const { data: ledgerBalanceData } = await supabase
      .from("transactions")
      .select("amount,type,status")
      .eq("user_id", user.id)
      .in("status", ["completed", "pending"]);

    const availableBalance = (ledgerBalanceData || []).reduce((sum, txn) => {
      if (txn.status === "completed" && (txn.type === "deposit" || txn.type === "admin_adjustment")) {
        sum += Number(txn.amount);
      } else if (txn.type === "withdrawal" || txn.type === "transfer") {
        if (txn.status === "completed" || txn.status === "pending") {
          sum -= Number(txn.amount);
        }
      }
      return sum;
    }, 0);

    if (body.amount > availableBalance) {
      return NextResponse.json({ error: "Insufficient available balance." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("transactions")
      .insert({
        user_id: user.id,
        profile_id: user.id,
        type: "withdrawal",
        status: "pending",
        amount: body.amount,
        method_label: body.methodLabel,
        description: `Withdrawal to: ${body.destination}`
      })
      .select("*")
      .single();

    if (error) {
      console.error("Supabase insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    
    return NextResponse.json({ transaction: data });
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: err.message || "Unknown error" }, { status: 500 });
  }
}
