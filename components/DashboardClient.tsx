"use client";

import { useMemo, useState } from "react";
import { Copy, CreditCard, Landmark, LogOut, Send, UserRound, WalletCards, type LucideIcon } from "lucide-react";
import { money, initials } from "@/lib/format";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  account_id: string;
  account_type: string;
  currency: string;
  balance: number;
  phone?: string;
  country?: string;
  username?: string;
  role: string;
};

type Transaction = {
  id: string;
  amount: number;
  status: "pending" | "approved" | "rejected";
  type: string;
  description: string;
  method_label?: string;
  created_at: string;
};

type Method = {
  id: string;
  key: string;
  label: string;
  fields: { label: string; value: string }[];
};

export function DashboardClient({
  profile,
  transactions,
  paymentMethods
}: {
  profile: Profile;
  transactions: Transaction[];
  paymentMethods: Method[];
}) {
  const [view, setView] = useState("overview");
  const [amount, setAmount] = useState("100");
  const [methodKey, setMethodKey] = useState(paymentMethods[0]?.key || "");
  const [notice, setNotice] = useState("");
  const [activeMethod, setActiveMethod] = useState<Method | null>(null);
  const completedDeposits = useMemo(
    () => transactions
      .filter(
        (txn) =>
          txn.status === "approved" &&
          (txn.type === "deposit" || txn.type === "admin_adjustment")
      )
      .reduce((sum, txn) => sum + Number(txn.amount), 0),
    [transactions]
  );
  const pending = transactions.filter((txn) => txn.status === "pending").length;

  async function requestDeposit(e: React.FormEvent) {
    e.preventDefault();
    setNotice("");
    const res = await fetch("/api/transactions/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: Number(amount), paymentMethodKey: methodKey })
    });
    const payload = await res.json();
    if (!res.ok) {
      setNotice(payload.error || "Could not create deposit request.");
      return;
    }
    setActiveMethod(payload.paymentMethod);
    setNotice("Deposit request created. Send the exact amount using the payment details below.");
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setNotice("Copied to clipboard.");
  }

  const fullName = profile.full_name || "Customer";

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="mb-8 flex items-center gap-3 font-head text-lg font-bold">
          <span className="brand-mark">T</span>
          paybridge<span className="text-teal">.ks</span>
        </div>
        <div className="mb-8 flex items-center gap-3 border-y border-white/10 py-5">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-to-br from-teal to-gold font-black text-navy">
            {initials(profile.full_name.split(" ")[0], profile.full_name.split(" ").slice(1).join(" "))}
          </div>
          <div>
            <p className="font-bold">{fullName}</p>
            <p className="text-xs text-white/40">{profile.account_id}</p>
          </div>
        </div>
        {([
          ["overview", WalletCards, "Overview"],
          ["deposit", CreditCard, "Add Money"],
          ["transactions", Send, "Transactions"],
          ["profile", UserRound, "Profile"]
        ] as Array<[string, LucideIcon, string]>).map(([id, Icon, label]) => (
          <button className={`nav-link w-full ${view === id ? "active" : ""}`} key={String(id)} onClick={() => setView(String(id))}>
            <Icon size={18} /> {String(label)}
          </button>
        ))}
        <form action="/api/auth/signout" className="mt-8" method="post">
          <button className="btn-danger flex w-full items-center justify-center gap-2" type="submit">
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </aside>

      <main className="main-area">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-grey">Good day,</p>
            <h1 className="font-head text-3xl font-bold">{fullName}</h1>
          </div>
          {profile.role === "admin" ? (
            <a className="btn-secondary" href="/admin">Admin panel</a>
          ) : null}
        </div>

        {notice ? <div className="mb-5 rounded-lg border border-teal/20 bg-teal/10 p-3 text-sm font-bold text-teal2">{notice}</div> : null}

        {view === "overview" ? (
          <section className="space-y-6">
            <div className="rounded-2xl bg-gradient-to-br from-navy to-navy2 p-8 text-white">
              <p className="text-xs uppercase tracking-[.12em] text-white/40">Available balance</p>
              <p className="mt-2 font-head text-5xl font-black">{money(profile.balance)}</p>
              <p className="mt-2 text-white/45">{profile.currency}</p>
            </div>
            <div className="grid gap-5 md:grid-cols-3">
              <Stat label="Total deposited" value={money(completedDeposits)} icon={<Landmark />} />
              <Stat label="Pending deposits" value={String(pending)} icon={<CreditCard />} />
              <Stat label="Transactions" value={String(transactions.length)} icon={<Send />} />
            </div>
            <TransactionList transactions={transactions.slice(0, 5)} />
          </section>
        ) : null}

        {view === "deposit" ? (
          <section className="grid gap-6 lg:grid-cols-2">
            <form className="card p-6" onSubmit={requestDeposit}>
              <h2 className="font-head text-2xl font-bold">Add money</h2>
              <p className="mt-1 text-sm text-grey">Create a deposit request and pay through one of the configured methods.</p>
              <div className="mt-6">
                <label className="label">Amount</label>
                <input className="input text-2xl font-black" min={10} required type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="mt-4">
                <label className="label">Payment method</label>
                <select className="select" required value={methodKey} onChange={(e) => setMethodKey(e.target.value)}>
                  {paymentMethods.map((method) => <option key={method.key} value={method.key}>{method.label}</option>)}
                </select>
              </div>
              <button className="btn-primary mt-5 w-full" type="submit">Request deposit details</button>
            </form>
            <div className="card p-6">
              <h3 className="font-head text-xl font-bold">Payment details</h3>
              {!activeMethod ? <p className="mt-3 text-sm text-grey">Choose an amount and payment method to reveal the payment instructions.</p> : null}
              {activeMethod ? (
                <div className="mt-5 space-y-4">
                  <p className="font-bold">{activeMethod.label}</p>
                  {activeMethod.fields.map((field) => (
                    <div className="rounded-xl bg-off p-4" key={field.label}>
                      <p className="text-xs font-bold uppercase tracking-[.08em] text-grey">{field.label}</p>
                      <div className="mt-2 flex items-center gap-3">
                        <code className="min-w-0 flex-1 break-all text-sm">{field.value}</code>
                        <button className="btn-secondary px-3 py-2" onClick={() => copy(field.value)} type="button">
                          <Copy size={15} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {view === "transactions" ? <TransactionList transactions={transactions} /> : null}

        {view === "profile" ? (
          <section className="card p-6">
            <h2 className="font-head text-2xl font-bold">Profile</h2>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {[
                ["Full name", fullName],
                ["Email", profile.email],
                ["Username", profile.username || "-"],
                ["Phone", profile.phone || "-"],
                ["Country", profile.country || "-"],
                ["Account ID", profile.account_id],
                ["Account type", profile.account_type],
                ["Currency", profile.currency]
              ].map(([label, value]) => (
                <div className="rounded-xl bg-off p-4" key={label}>
                  <p className="text-xs font-bold uppercase tracking-[.08em] text-grey">{label}</p>
                  <p className="mt-1 font-bold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="card p-5">
      <div className="mb-4 text-teal">{icon}</div>
      <p className="text-xs font-bold uppercase tracking-[.08em] text-grey">{label}</p>
      <p className="mt-2 font-head text-2xl font-bold">{value}</p>
    </div>
  );
}

function TransactionList({ transactions }: { transactions: Transaction[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-head text-xl font-bold">Transactions</h2>
      </div>
      {transactions.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Description</th><th>Method</th><th>Amount</th><th>Status</th><th>Date</th></tr>
            </thead>
            <tbody>
              {transactions.map((txn) => (
                <tr key={txn.id}>
                  <td className="font-bold">{txn.description}</td>
                  <td>{txn.method_label || "Internal"}</td>
                  <td>{money(txn.amount)}</td>
                  <td><span className={`pill ${txn.status}`}>{txn.status}</span></td>
                  <td>{new Date(txn.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-8 text-center text-grey">No transactions yet.</p>
      )}
    </div>
  );
}
