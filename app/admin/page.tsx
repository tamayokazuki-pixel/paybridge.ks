import { AdminClient } from "@/components/AdminClient";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createSupabaseAdminClient();
  const [{ data: users }, { data: transactionsData }, { data: paymentMethods }] = await Promise.all([
    supabase.from("users").select("*").order("created_at", { ascending: false }),
    supabase.from("transactions").select("*").order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("*").order("label")
  ]);

  const transactions = (transactionsData || []).map((txn) => {
    const user = (users || []).find((u) => u.id === txn.user_id);
    return {
      ...txn,
      users: user ? { full_name: user.full_name, email: user.email, account_id: user.account_id } : undefined
    };
  });

  const usersWithBalance = await Promise.all(
    (users || []).map(async (user) => {
      const { data: ledger } = await supabase
        .from("transactions")
        .select("amount,type,status")
        .eq("user_id", user.id)
        .eq("status", "completed");

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
