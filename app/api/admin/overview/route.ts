import { NextResponse } from "next/server";
import { getAdminUser } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required. Please sign in again." }, { status: 403 });
  }

  try {
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
  } catch (error) {
    console.error("Admin overview crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
