import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  await requireAdmin();
  const supabase = createSupabaseAdminClient();

  const [{ data: users }, { data: transactions }, { data: methods }] = await Promise.all([
    supabase.from("users").select("*").order("created_at", { ascending: false }),
    supabase.from("transactions").select("*, users(full_name,email,account_id)").order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("*").order("label")
  ]);

  return NextResponse.json({
    profiles: users || [],
    transactions: transactions || [],
    paymentMethods: methods || []
  });
}
