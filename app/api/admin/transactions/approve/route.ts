import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

const schema = z.object({
  transactionId: z.string().uuid(),
  reference: z.string().optional()
});

export async function POST(request: Request) {
  const adminUser = await requireAdmin();
  const { transactionId, reference } = schema.parse(await request.json());
  const supabase = createSupabaseAdminClient();

  const { data: txn } = await supabase
    .from("transactions")
    .select("*")
    .eq("id", transactionId)
    .eq("status", "pending")
    .single();

  if (!txn) return NextResponse.json({ error: "Pending transaction not found." }, { status: 404 });

  const { data, error } = await supabase
    .from("transactions")
    .update({
      status: "approved",
      reference: reference || null,
      completed_at: new Date().toISOString()
    })
    .eq("id", transactionId)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await supabase.from("activity_logs").insert({
    actor_id: adminUser.id,
    user_id: txn.user_id,
    action: "transaction_approved",
    details: `Approved transaction ${transactionId}`
  });

  return NextResponse.json({ transaction: data });
}
