import { AdminClient } from "@/components/AdminClient";
import { requireAdmin } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizeStatus, type TransactionStatus } from "@/lib/transaction-status";
import { availableBalance } from "@/lib/balance";

export default async function AdminPage() {
  await requireAdmin();
  const supabase = createSupabaseAdminClient();
  const [{ data: users }, { data: transactionsData }, { data: paymentMethods }] = await Promise.all([
    supabase.from("users").select("*").order("created_at", { ascending: false }),
    supabase.from("transactions").select("*").order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("*").order("label")
  ]);

  // Normalise legacy status values ('failed' -> 'rejected', 'approved' -> 'completed')
  // once, so every table and total below works with the current vocabulary.
  const transactions = (transactionsData || []).map((txn) => {
    const user = (users || []).find((u) => u.id === txn.user_id);
    return {
      ...txn,
      status: normalizeStatus(txn.status) as TransactionStatus,
      users: user ? { full_name: user.full_name, email: user.email, account_id: user.account_id } : undefined
    };
  });

  const balanceFor = (userId: string) => availableBalance(transactions.filter((txn) => txn.user_id === userId));

  const usersWithBalance = (users || []).map((user) => ({ ...user, balance: balanceFor(user.id) }));

  return (
    <AdminClient
      profiles={usersWithBalance}
      transactions={transactions}
      paymentMethods={paymentMethods || []}
    />
  );
}
