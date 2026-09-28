"use client";

import { useMemo, useState } from "react";
import { CheckCircle, CreditCard, LogOut, ScanLine, Settings, Shield, Users, XCircle, Loader2, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { ChequeDetails } from "@/components/ChequeDetails";
import { chequeDetailsSchema, isChequeTransaction } from "@/lib/cheques";
import { money, initials } from "@/lib/format";
import { normalizeStatus, statusLabel } from "@/lib/transaction-status";

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
  method_key?: string | null;
  cheque_details?: unknown;
  reference?: string | null;
  admin_note?: string | null;
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
  const router = useRouter();
  const [view, setView] = useState("overview");
  const [notice, setNotice] = useState("");
  const [methods, setMethods] = useState(paymentMethods);
  const [selectedCheque, setSelectedCheque] = useState<Transaction | null>(null);
  const [chequeFilter, setChequeFilter] = useState<"all" | "pending" | "deposit" | "withdrawal">("all");
  const [imagesReady, setImagesReady] = useState(false);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [chequeBusy, setChequeBusy] = useState(false);
  const pending = transactions.filter((txn) => txn.status === "pending");
  const cheques = transactions.filter(isChequeTransaction);
  const pendingCheques = cheques.filter((txn) => txn.status === "pending");
  const visibleCheques = cheques.filter((txn) => chequeFilter === "all" || txn.status === chequeFilter || txn.type === chequeFilter);
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
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      // The response is not always JSON (a redirect from an expired session, or a
      // framework error page), so read it as text first. Without this the old code
      // threw on res.json() and the button silently did nothing.
      const text = await res.text();
      let payload: { error?: string; detail?: string } | null = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!res.ok) {
        setNotice(payload?.error || `Action failed (HTTP ${res.status}). Please sign in again and retry.`);
        return false;
      }

      router.refresh();
      return true;
    } catch (error) {
      setNotice(`Action failed: ${error instanceof Error ? error.message : "network error"}`);
      return false;
    }
  }

  function openCheque(transaction: Transaction) {
    setSelectedCheque(transaction);
    setImagesReady(false);
    setReference(transaction.reference || "");
    setReason("");
    setNotice("");
  }

  async function processCheque(action: "approve" | "reject") {
    if (!selectedCheque || chequeBusy) return;
    const details = chequeDetailsSchema.safeParse(selectedCheque.cheque_details);
    if (action === "approve" && (!details.success || details.data.kind !== selectedCheque.type)) {
      setNotice("This cheque is missing required details. Do not approve it.");
      return;
    }
    if (action === "approve" && selectedCheque.type === "deposit" && !imagesReady) {
      setNotice("Load and inspect both cheque images before approving a deposit.");
      return;
    }
    if (action === "approve" && selectedCheque.type === "withdrawal" && !reference.trim()) {
      setNotice("Record a cheque number or dispatch reference before approving a withdrawal.");
      return;
    }
    if (action === "reject" && !reason.trim()) {
      setNotice("Enter a reason to reject this cheque request.");
      return;
    }
    const prompt = action === "approve" && selectedCheque.type === "deposit"
      ? "Have you verified this cheque and confirmed that the funds have cleared? Approving credits the account."
      : action === "approve"
        ? "Have you issued/arranged this cheque? Approving finalizes the debit."
        : "Reject this cheque request? A withdrawal hold will be released.";
    if (!window.confirm(prompt)) return;

    setChequeBusy(true);
    try {
      const success = await post(`/api/admin/transactions/${action}`, {
        transactionId: selectedCheque.id,
        ...(action === "approve" ? { reference: reference.trim() } : { reason: reason.trim() })
      });
      if (success) setSelectedCheque(null);
    } finally {
      setChequeBusy(false);
    }
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

  const chequeReview = selectedCheque ? (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Request from {selectedCheque.users?.full_name || "Unknown user"} · {selectedCheque.users?.account_id}</p>
      <ChequeDetails key={selectedCheque.id} transaction={selectedCheque} onClose={() => setSelectedCheque(null)} onImagesReady={setImagesReady}>
        {selectedCheque.status === "pending" ? (
          <div className="mt-6 space-y-4 border-t border-slate-100 pt-5">
            <p className="text-sm text-slate-600">
              {selectedCheque.type === "deposit"
                ? "Check both images and confirm the funds have cleared before crediting this deposit."
                : "Confirm the payee and mailing address, issue the cheque, then record its number or dispatch reference."}
            </p>
            <div>
              <label className="label" htmlFor="cheque-reference">{selectedCheque.type === "withdrawal" ? "Cheque number / dispatch reference (required)" : "Clearing reference (optional)"}</label>
              <input className="input" id="cheque-reference" maxLength={100} onChange={(e) => setReference(e.target.value)} value={reference} />
            </div>
            <button className="btn-primary disabled:opacity-50" disabled={chequeBusy || (selectedCheque.type === "deposit" && !imagesReady)} onClick={() => processCheque("approve")} type="button">
              {chequeBusy ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Approve cheque {selectedCheque.type}
            </button>
            <div>
              <label className="label" htmlFor="cheque-reason">Rejection reason (required)</label>
              <textarea className="textarea min-h-[80px]" id="cheque-reason" maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this request cannot be processed" value={reason} />
            </div>
            <button className="btn-danger flex items-center gap-2 disabled:opacity-50" disabled={chequeBusy || !reason.trim()} onClick={() => processCheque("reject")} type="button">
              <XCircle size={16} /> Reject cheque request
            </button>
          </div>
        ) : null}
      </ChequeDetails>
    </div>
  ) : null;

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
          ["requests", CreditCard, "Requests"],
          ["cheques", ScanLine, "Cheques"],
          ["methods", Settings, "Payment Methods"]
        ] as Array<[string, LucideIcon, string]>).map(([id, Icon, label]) => (
          <button className={`nav-link w-full ${view === id ? "active" : ""}`} key={String(id)} onClick={() => { setView(String(id)); setSelectedCheque(null); }}>
            <Icon size={18} /> {String(label)}
            {id === "cheques" && pendingCheques.length ? <span className="ml-auto rounded-full bg-gold px-2 text-xs font-bold text-navy">{pendingCheques.length}</span> : null}
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
            <div className="grid gap-5 md:grid-cols-5">
              <Stat label="Users" value={String(profiles.length)} />
              <Stat label="Active users" value={String(activeUsers.length)} />
              <Stat label="Pending requests" value={String(pending.length)} />
              <Stat label="Pending cheques" value={String(pendingCheques.length)} />
              <Stat label="Credited" value={money(credited)} />
            </div>
            {chequeReview}
            <RequestsTable transactions={pending.slice(0, 8)} onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id })} onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id })} onReviewCheque={openCheque} />
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

        {view === "requests" ? (
          <section className="space-y-5">
            {chequeReview}
            <RequestsTable transactions={transactions} onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id })} onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id })} onReviewCheque={openCheque} />
          </section>
        ) : null}

        {view === "cheques" ? (
          <section className="space-y-5">
            <div>
              <h2 className="font-head text-2xl font-bold">Cheque requests</h2>
              <p className="mt-1 text-sm text-grey">Review scans, payees and delivery details. Approve only after verification or fulfilment.</p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Filter cheque requests">
              {([ ["all", "All"], ["pending", "Pending"], ["deposit", "Deposits"], ["withdrawal", "Withdrawals"] ] as const).map(([filter, label]) => (
                <button aria-pressed={chequeFilter === filter} className={chequeFilter === filter ? "btn-primary" : "btn-secondary"} key={filter} onClick={() => { setChequeFilter(filter); setSelectedCheque(null); }} type="button">{label}</button>
              ))}
            </div>
            {chequeReview}
            <RequestsTable transactions={visibleCheques} onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id })} onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id })} onReviewCheque={openCheque} />
          </section>
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

function RequestsTable({
  transactions,
  onApprove,
  onReject,
  onReviewCheque
}: {
  transactions: Transaction[];
  onApprove: (id: string) => Promise<unknown>;
  onReject: (id: string) => Promise<unknown>;
  onReviewCheque: (transaction: Transaction) => void;
}) {
  const [loadingState, setLoadingState] = useState<{ id: string, action: 'approve' | 'reject' } | null>(null);

  const handleApprove = async (id: string) => {
    setLoadingState({ id, action: 'approve' });
    try {
      await onApprove(id);
    } finally {
      setLoadingState(null);
    }
  };

  const handleReject = async (id: string) => {
    setLoadingState({ id, action: 'reject' });
    try {
      await onReject(id);
    } finally {
      setLoadingState(null);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-head text-xl font-bold">Requests</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>User</th><th>Type</th><th>Amount</th><th>Method</th><th>Description</th><th>Status</th><th>Date</th><th>Actions</th></tr>
          </thead>
          <tbody>
            {transactions.length ? transactions.map((txn) => (
              <tr key={txn.id}>
                <td>
                  <p className="font-bold">{txn.users?.full_name || "Unknown user"}</p>
                  <p className="text-xs text-grey">{txn.users?.account_id || ""}</p>
                </td>
                <td className="capitalize">{isChequeTransaction(txn) ? `Cheque ${txn.type}` : txn.type.replaceAll('_', ' ')}</td>
                <td>{money(txn.amount)}</td>
                <td>{txn.method_label}</td>
                <td className="max-w-[300px] break-words">{txn.description}</td>
                <td><span className={`pill ${normalizeStatus(txn.status)}`}>{statusLabel(txn.status)}</span></td>
                <td>{new Date(txn.created_at).toLocaleDateString()}</td>
                <td>
                  {isChequeTransaction(txn) ? (
                    <button className="btn-secondary px-3 py-2 text-xs text-teal2" onClick={() => onReviewCheque(txn)} type="button">
                      <ScanLine size={14} /> Review cheque
                    </button>
                  ) : normalizeStatus(txn.status) === "pending" ? (
                    <div className="flex flex-wrap gap-2">
                      <button 
                        className="btn-secondary px-3 py-2 text-xs text-teal2 disabled:opacity-50" 
                        onClick={() => handleApprove(txn.id)} 
                        disabled={loadingState?.id === txn.id}
                        type="button"
                      >
                        {loadingState?.id === txn.id && loadingState?.action === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Approve
                      </button>
                      <button 
                        className="btn-danger flex items-center gap-1 px-3 py-2 text-xs disabled:opacity-50" 
                        onClick={() => handleReject(txn.id)} 
                        disabled={loadingState?.id === txn.id}
                        type="button"
                      >
                        {loadingState?.id === txn.id && loadingState?.action === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Reject
                      </button>
                    </div>
                  ) : "-"}
                </td>
              </tr>
            )) : (
              <tr><td className="py-8 text-center text-grey" colSpan={8}>No requests found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
