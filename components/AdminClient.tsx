"use client";

import { useMemo, useState } from "react";
import { CheckCircle, CreditCard, LogOut, Settings, Shield, Users, XCircle, Loader2, type LucideIcon } from "lucide-react";
import { money, initials } from "@/lib/format";

type Profile = {
  id: string;
  full_name: string;
  email: string;
  account_id: string;
  account_type: string;
  balance: number;
  status: "active" | "suspended";
  role: string;
};

type Transaction = {
  id: string;
  user_id: string;
  amount: number;
  status: "pending" | "completed" | "rejected";
  type: string;
  description: string;
  method_label?: string;
  created_at: string;
  users?: { full_name: string; email: string; account_id: string };
};

type Method = {
  id: string;
  key: string;
  label: string;
  fields: { label: string; value: string }[];
  is_active: boolean;
};

export function AdminClient({
  profiles,
  transactions,
  paymentMethods
}: {
  profiles: Profile[];
  transactions: Transaction[];
  paymentMethods: Method[];
}) {
  const [view, setView] = useState("overview");
  const [notice, setNotice] = useState("");
  const [methods, setMethods] = useState(paymentMethods);
  const pending = transactions.filter((txn) => txn.status === "pending");
  const credited = transactions
    .filter(
      (txn) =>
        txn.status === "completed" &&
        (txn.type === "deposit" || txn.type === "admin_adjustment")
    )
    .reduce((sum, txn) => sum + Number(txn.amount), 0);
  const activeUsers = useMemo(() => profiles.filter((profile) => profile.status !== "suspended"), [profiles]);

  async function post(url: string, body: unknown) {
    setNotice("");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await res.json();
    if (!res.ok) {
      setNotice(payload.error || "Action failed.");
      return false;
    }
    window.location.reload();
    return true;
  }

  async function saveMethod(method: Method) {
    await post("/api/admin/payment-methods", {
      id: method.id,
      label: method.label,
      fields: method.fields,
      isActive: method.is_active
    });
  }

  function updateMethod(id: string, updater: (method: Method) => Method) {
    setMethods((current) => current.map((method) => method.id === id ? updater(method) : method));
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="mb-8 flex items-center gap-3 font-head text-lg font-bold">
          <span className="brand-mark">T</span>
          Admin <span className="text-gold">Panel</span>
        </div>
        {([
          ["overview", Shield, "Overview"],
          ["users", Users, "Users"],
          ["deposits", CreditCard, "Deposits"],
          ["methods", Settings, "Payment Methods"]
        ] as Array<[string, LucideIcon, string]>).map(([id, Icon, label]) => (
          <button className={`nav-link w-full ${view === id ? "active" : ""}`} key={String(id)} onClick={() => setView(String(id))}>
            <Icon size={18} /> {String(label)}
          </button>
        ))}
        <a className="nav-link mt-8" href="/dashboard">Back to dashboard</a>
        <form action="/api/auth/signout" className="mt-4" method="post">
          <button className="btn-danger flex w-full items-center justify-center gap-2" type="submit">
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </aside>
      <main className="main-area">
        <div className="mb-7">
          <p className="text-sm text-grey">paybridge.ks</p>
          <h1 className="font-head text-3xl font-bold">Admin Console</h1>
        </div>
        {notice ? <div className="mb-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-600">{notice}</div> : null}

        {view === "overview" ? (
          <section className="space-y-6">
            <div className="grid gap-5 md:grid-cols-4">
              <Stat label="Users" value={String(profiles.length)} />
              <Stat label="Active users" value={String(activeUsers.length)} />
              <Stat label="Pending deposits" value={String(pending.length)} />
              <Stat label="Credited" value={money(credited)} />
            </div>
            <DepositTable transactions={pending.slice(0, 8)} onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id })} onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id })} />
          </section>
        ) : null}

        {view === "users" ? (
          <section className="card overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <h2 className="font-head text-xl font-bold">Users</h2>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>User</th><th>Account</th><th>Type</th><th>Balance</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-teal/15 font-black text-teal2">{initials(profile.full_name.split(" ")[0], profile.full_name.split(" ").slice(1).join(" "))}</span>
                          <div>
                            <p className="font-bold">{profile.full_name}</p>
                            <p className="text-xs text-grey">{profile.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>{profile.account_id}</td>
                      <td>{profile.account_type}</td>
                      <td>{money(profile.balance)}</td>
                      <td><span className={`pill ${profile.status}`}>{profile.status}</span></td>
                      <td>
                        <button
                          className="btn-secondary px-3 py-2 text-xs"
                          onClick={() => post("/api/admin/users/status", { profileId: profile.id, status: profile.status === "suspended" ? "active" : "suspended" })}
                          type="button"
                        >
                          {profile.status === "suspended" ? "Activate" : "Suspend"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {view === "deposits" ? (
          <DepositTable transactions={transactions} onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id })} onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id })} />
        ) : null}

        {view === "methods" ? (
          <section className="grid gap-5 lg:grid-cols-2">
            {methods.map((method) => (
              <div className="card p-5" key={method.id}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <input className="input font-bold" value={method.label} onChange={(e) => updateMethod(method.id, (m) => ({ ...m, label: e.target.value }))} />
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input checked={method.is_active} type="checkbox" onChange={(e) => updateMethod(method.id, (m) => ({ ...m, is_active: e.target.checked }))} />
                    Active
                  </label>
                </div>
                <div className="space-y-3">
                  {method.fields.map((field, index) => (
                    <div className="grid gap-3 sm:grid-cols-[.7fr_1fr]" key={`${method.id}-${index}`}>
                      <input className="input" value={field.label} onChange={(e) => updateMethod(method.id, (m) => ({ ...m, fields: m.fields.map((f, i) => i === index ? { ...f, label: e.target.value } : f) }))} />
                      <input className="input" value={field.value} onChange={(e) => updateMethod(method.id, (m) => ({ ...m, fields: m.fields.map((f, i) => i === index ? { ...f, value: e.target.value } : f) }))} />
                    </div>
                  ))}
                </div>
                <button className="btn-primary mt-4" onClick={() => saveMethod(method)} type="button">Save method</button>
              </div>
            ))}
          </section>
        ) : null}
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs font-bold uppercase tracking-[.08em] text-grey">{label}</p>
      <p className="mt-2 font-head text-3xl font-bold">{value}</p>
    </div>
  );
}

function DepositTable({
  transactions,
  onApprove,
  onReject
}: {
  transactions: Transaction[];
  onApprove: (id: string) => Promise<unknown>;
  onReject: (id: string) => Promise<unknown>;
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const handleApprove = async (id: string) => {
    setLoadingId(id);
    await onApprove(id);
    setLoadingId(null);
  };

  const handleReject = async (id: string) => {
    setLoadingId(id);
    await onReject(id);
    setLoadingId(null);
  };

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-head text-xl font-bold">Deposit Requests</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>User</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {transactions.length ? transactions.map((txn) => (
              <tr key={txn.id}>
                <td>
                  <p className="font-bold">{txn.users?.full_name || "Unknown user"}</p>
                  <p className="text-xs text-grey">{txn.users?.account_id || ""}</p>
                </td>
                <td>{money(txn.amount)}</td>
                <td>{txn.method_label}</td>
                <td><span className={`pill ${txn.status}`}>{txn.status}</span></td>
                <td>{new Date(txn.created_at).toLocaleDateString()}</td>
                <td>
                  {txn.status === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <button 
                        className="btn-secondary px-3 py-2 text-xs text-teal2 disabled:opacity-50" 
                        onClick={() => handleApprove(txn.id)} 
                        disabled={loadingId === txn.id}
                        type="button"
                      >
                        {loadingId === txn.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Approve
                      </button>
                      <button 
                        className="btn-danger flex items-center gap-1 px-3 py-2 text-xs disabled:opacity-50" 
                        onClick={() => handleReject(txn.id)} 
                        disabled={loadingId === txn.id}
                        type="button"
                      >
                        {loadingId === txn.id ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
                      </button>
                    </div>
                  ) : "-"}
                </td>
              </tr>
            )) : (
              <tr><td className="py-8 text-center text-grey" colSpan={6}>No deposit requests found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
