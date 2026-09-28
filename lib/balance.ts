import { normalizeStatus } from "./transaction-status";

type LedgerEntry = { type: string; status: string; amount: number | string };

/** Pending withdrawals (including cheques) reserve funds; deposits credit only after approval. */
export function availableBalance(transactions: LedgerEntry[]): number {
  const cents = transactions.reduce((total, transaction) => {
    const status = normalizeStatus(transaction.status);
    const amount = Math.round(Number(transaction.amount) * 100);

    if (status === "completed" && (transaction.type === "deposit" || transaction.type === "admin_adjustment")) {
      return total + amount;
    }
    if ((status === "completed" || status === "pending") &&
        ["withdrawal", "withdraw", "transfer"].includes(transaction.type)) {
      return total - amount;
    }
    return total;
  }, 0);

  return cents / 100;
}
