import { AdminClient } from "@/components/AdminClient";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createSupabaseAdminClient();
  const [{ data: users }, { data: transactions }, { data: paymentMethods }] = await Promise.all([
    supabase.from("users").select("*").order("created_at", { ascending: false }),
    supabase.from("transactions").select("*, users(full_name,email,account_id)").order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("*").order("label")
  ]);

  const usersWithBalance = await Promise.all(
    (users || []).map(async (user) => {
      const { data: ledger } = await supabase
        .from("transactions")
        .select("amount,type,status")
        .eq("user_id", user.id)
        .eq("status", "approved");

      const balance = (ledger || []).reduce((sum, txn) => {
        if (txn.type === "deposit" || txn.type === "admin_adjustment") {
          sum += Number(txn.amount);
        } else if (txn.type === "withdrawal" || txn.type === "transfer") {
          sum -= Number(txn.amount);
        }
        return sum;
      }, 0);

      return { ...user, balance };
    })
  );

  return (
    <AdminClient
      profiles={usersWithBalance}
      transactions={transactions || []}
      paymentMethods={paymentMethods || []}
    />
  );
}
