import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/DashboardClient";
import { ensureProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizeStatus } from "@/lib/transaction-status";
import { availableBalance } from "@/lib/balance";

export default async function DashboardPage() {
  const profile = await ensureProfile();

  if (profile.role === "admin" && profile.is_verified && profile.status === "active") {
    redirect("/admin");
  }

  const supabase = createSupabaseAdminClient();

  const [{ data: transactions }, { data: paymentMethods }] = await Promise.all([
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("*").eq("is_active", true).order("label")
  ]);

  // Older rows can still carry the legacy status values ('failed', 'approved').
  const ledger = (transactions || []).map((txn) => ({ ...txn, status: normalizeStatus(txn.status) }));

  const ledgerBalance = availableBalance(ledger);

  return (
    <DashboardClient
      profile={{ ...profile, balance: ledgerBalance }}
      transactions={ledger}
      paymentMethods={paymentMethods || []}
    />
  );
}
