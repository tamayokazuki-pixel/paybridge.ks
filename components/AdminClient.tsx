"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  CheckCircle,
  CreditCard,
  Loader2,
  LogOut,
  Plus,
  ScanLine,
  Settings,
  Shield,
  Users,
  X,
  XCircle,
  type LucideIcon
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ChequeDetails } from "@/components/ChequeDetails";
import { chequeDetailsSchema, isChequeTransaction } from "@/lib/cheques";
import { initials, money } from "@/lib/format";
import {
  normalizeStatus,
  statusLabel,
  type TransactionStatus
} from "@/lib/transaction-status";
import {
  toLocalDateTimeInputValue,
  type TransactionType
} from "@/lib/transactions";

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
  completed_at?: string | null;
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

const DATE_PRESETS: Array<{ label: string; days?: number; months?: number; years?: number }> = [
  { label: "Now" },
  { label: "1d ago", days: -1 },
  { label: "1w ago", days: -7 },
  { label: "1m ago", months: -1 },
  { label: "3m ago", months: -3 },
  { label: "6m ago", months: -6 },
  { label: "1y ago", years: -1 }
];

function computePresetLocalDateTime(preset: { days?: number; months?: number; years?: number }): string {
  const d = new Date();
  if (preset.days) {
    d.setDate(d.getDate() + preset.days);
  }
  if (preset.months || preset.years) {
    const originalDay = d.getDate();
    const totalMonths = (preset.years || 0) * 12 + (preset.months || 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + totalMonths);
    const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(originalDay, maxDay));
  }
  return toLocalDateTimeInputValue(d);
}

function localInputToIso(localValue: string): string | null {
  const trimmed = localValue.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

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
  const [successNotice, setSuccessNotice] = useState("");
  const [methods, setMethods] = useState(paymentMethods);

  // Requests filtering
  const [requestStatusFilter, setRequestStatusFilter] = useState<"all" | TransactionStatus>("all");
  const [requestSearch, setRequestSearch] = useState("");

  // Cheque review state
  const [selectedCheque, setSelectedCheque] = useState<Transaction | null>(null);
  const [chequeFilter, setChequeFilter] = useState<"all" | "pending" | "deposit" | "withdrawal">("all");
  const [imagesReady, setImagesReady] = useState(false);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [chequeApprovalDate, setChequeApprovalDate] = useState("");
  const [chequeBusy, setChequeBusy] = useState(false);

  // Create / Backdate new transaction modal state
  const [createOpen, setCreateOpen] = useState(false);
  const [createUserId, setCreateUserId] = useState(profiles[0]?.id || "");
  const [createType, setCreateType] = useState<TransactionType>("deposit");
  const [createStatus, setCreateStatus] = useState<TransactionStatus>("completed");
  const [createAmount, setCreateAmount] = useState("100.00");
  const [createDateTime, setCreateDateTime] = useState("");
  const [createMethodKey, setCreateMethodKey] = useState("internal");
  const [createCustomMethodLabel, setCreateCustomMethodLabel] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [createReference, setCreateReference] = useState("");
  const [createAdminNote, setCreateAdminNote] = useState("");
  const [createError, setCreateError] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // Edit / Backdate existing transaction modal state
  const [editingTxn, setEditingTxn] = useState<Transaction | null>(null);
  const [editDateTime, setEditDateTime] = useState("");
  const [editAdminNote, setEditAdminNote] = useState("");
  const [editError, setEditError] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (!createBusy) setCreateOpen(false);
        if (!editBusy) setEditingTxn(null);
      }
    }
    if (createOpen || editingTxn) {
      window.addEventListener("keydown", onKeyDown);
      return () => window.removeEventListener("keydown", onKeyDown);
    }
  }, [createOpen, editingTxn, createBusy, editBusy]);

  const pending = transactions.filter((txn) => txn.status === "pending");
  const cheques = transactions.filter(isChequeTransaction);
  const pendingCheques = cheques.filter((txn) => txn.status === "pending");
  const visibleCheques = cheques.filter(
    (txn) => chequeFilter === "all" || txn.status === chequeFilter || txn.type === chequeFilter
  );
  const filteredRequests = useMemo(() => {
    const query = requestSearch.trim().toLowerCase();
    return transactions.filter((txn) => {
      if (requestStatusFilter !== "all" && normalizeStatus(txn.status) !== requestStatusFilter) {
        return false;
      }
      if (!query) return true;
      const haystack = [
        txn.users?.full_name,
        txn.users?.email,
        txn.users?.account_id,
        txn.description,
        txn.method_label,
        txn.type,
        txn.reference
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [transactions, requestStatusFilter, requestSearch]);

  const credited = transactions
    .filter(
      (txn) =>
        txn.status === "completed" &&
        (txn.type === "deposit" || txn.type === "admin_adjustment")
    )
    .reduce((sum, txn) => sum + Number(txn.amount), 0);
  const activeUsers = useMemo(
    () => profiles.filter((profile) => profile.status !== "suspended"),
    [profiles]
  );

  const selectedCreateProfile = useMemo(
    () => profiles.find((profile) => profile.id === createUserId) || null,
    [profiles, createUserId]
  );

  async function postJson(
    url: string,
    body: unknown
  ): Promise<{ ok: true; data: Record<string, unknown> | null } | { ok: false; error: string }> {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      const text = await res.text();
      let payload: Record<string, unknown> | null = null;
      try {
        payload = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const errorMsg =
          typeof payload?.error === "string"
            ? payload.error
            : `Action failed (HTTP ${res.status}). Please sign in again and retry.`;
        return { ok: false, error: errorMsg };
      }

      router.refresh();
      return { ok: true, data: payload };
    } catch (error) {
      return {
        ok: false,
        error: `Action failed: ${error instanceof Error ? error.message : "network error"}`
      };
    }
  }

  async function post(url: string, body: unknown, onSuccessMessage?: string) {
    setNotice("");
    setSuccessNotice("");
    const result = await postJson(url, body);
    if (!result.ok) {
      setNotice(result.error);
      return false;
    }
    if (onSuccessMessage) {
      setSuccessNotice(onSuccessMessage);
    }
    return true;
  }

  function openCreateModal(preselectedUserId?: string) {
    setNotice("");
    setSuccessNotice("");
    setCreateError("");
    setCreateUserId(preselectedUserId || profiles[0]?.id || "");
    setCreateType("deposit");
    setCreateStatus("completed");
    setCreateAmount("100.00");
    setCreateDateTime(toLocalDateTimeInputValue(new Date()));
    setCreateMethodKey("internal");
    setCreateCustomMethodLabel("");
    setCreateDescription("");
    setCreateReference("");
    setCreateAdminNote("");
    setCreateOpen(true);
  }

  function openBackdateModal(transaction: Transaction) {
    setNotice("");
    setSuccessNotice("");
    setEditError("");
    setEditingTxn(transaction);
    setEditDateTime(toLocalDateTimeInputValue(transaction.created_at));
    setEditAdminNote(transaction.admin_note || "");
  }

  async function submitCreateTransaction(event: React.FormEvent) {
    event.preventDefault();
    if (createBusy) return;
    setCreateError("");

    const numericAmount = Number(createAmount);
    if (!Number.isFinite(numericAmount) || numericAmount < 0.01) {
      setCreateError("Enter a valid amount of at least $0.01.");
      return;
    }

    const isoDate = localInputToIso(createDateTime);
    if (!isoDate) {
      setCreateError("Select a valid transaction date and time.");
      return;
    }

    if (!createDescription.trim()) {
      setCreateError("Enter a description for this transaction.");
      return;
    }

    setCreateBusy(true);
    try {
      const result = await postJson("/api/admin/transactions/create", {
        userId: createUserId,
        type: createType,
        status: createStatus,
        amount: numericAmount,
        description: createDescription.trim(),
        methodKey: createMethodKey,
        methodLabel: createMethodKey === "custom" ? createCustomMethodLabel.trim() || undefined : undefined,
        reference: createReference.trim() || undefined,
        adminNote: createAdminNote.trim() || undefined,
        transactionDate: isoDate
      });

      if (!result.ok) {
        setCreateError(result.error);
        return;
      }

      const targetName = selectedCreateProfile?.full_name || "user";
      const formattedDate = new Date(isoDate).toLocaleString();
      setCreateOpen(false);
      setSuccessNotice(
        `Created ${createStatus} ${createType.replaceAll("_", " ")} (${money(numericAmount)}) for ${targetName} dated ${formattedDate}.`
      );
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitBackdateTransaction(event: React.FormEvent) {
    event.preventDefault();
    if (!editingTxn || editBusy) return;
    setEditError("");

    const isoDate = localInputToIso(editDateTime);
    if (!isoDate) {
      setEditError("Select a valid transaction date and time.");
      return;
    }

    setEditBusy(true);
    try {
      const result = await postJson("/api/admin/transactions/backdate", {
        transactionId: editingTxn.id,
        transactionDate: isoDate,
        adminNote: editAdminNote.trim()
      });

      if (!result.ok) {
        setEditError(result.error);
        return;
      }

      const formattedDate = new Date(isoDate).toLocaleString();
      setEditingTxn(null);
      setSuccessNotice(`Updated transaction date to ${formattedDate}.`);
    } finally {
      setEditBusy(false);
    }
  }

  function openCheque(transaction: Transaction) {
    setSelectedCheque(transaction);
    setImagesReady(false);
    setReference(transaction.reference || "");
    setReason("");
    setChequeApprovalDate("");
    setNotice("");
    setSuccessNotice("");
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

    let optionalIsoDate: string | undefined;
    if (action === "approve" && chequeApprovalDate.trim()) {
      const parsedIso = localInputToIso(chequeApprovalDate);
      if (!parsedIso) {
        setNotice("Enter a valid custom approval date and time, or leave it blank.");
        return;
      }
      optionalIsoDate = parsedIso;
    }

    const prompt =
      action === "approve" && selectedCheque.type === "deposit"
        ? "Have you verified this cheque and confirmed that the funds have cleared? Approving credits the account."
        : action === "approve"
          ? "Have you issued/arranged this cheque? Approving finalizes the debit."
          : "Reject this cheque request? A withdrawal hold will be released.";
    if (!window.confirm(prompt)) return;

    setChequeBusy(true);
    try {
      const success = await post(
        `/api/admin/transactions/${action}`,
        {
          transactionId: selectedCheque.id,
          ...(action === "approve"
            ? {
                reference: reference.trim(),
                ...(optionalIsoDate ? { transactionDate: optionalIsoDate } : {})
              }
            : { reason: reason.trim() })
        },
        action === "approve" ? "Cheque request approved." : "Cheque request rejected."
      );
      if (success) setSelectedCheque(null);
    } finally {
      setChequeBusy(false);
    }
  }

  async function saveMethod(method: Method) {
    await post(
      "/api/admin/payment-methods",
      {
        id: method.id,
        label: method.label,
        fields: method.fields,
        isActive: method.is_active
      },
      `Saved ${method.label}.`
    );
  }

  function updateMethod(id: string, updater: (method: Method) => Method) {
    setMethods((current) => current.map((method) => (method.id === id ? updater(method) : method)));
  }

  const chequeReview = selectedCheque ? (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          Request from {selectedCheque.users?.full_name || "Unknown user"} · {selectedCheque.users?.account_id}
        </p>
        <button
          className="btn-secondary px-3 py-2 text-xs"
          onClick={() => openBackdateModal(selectedCheque)}
          type="button"
        >
          <CalendarClock size={14} /> Edit transaction date
        </button>
      </div>
      <ChequeDetails
        key={selectedCheque.id}
        transaction={selectedCheque}
        onClose={() => setSelectedCheque(null)}
        onImagesReady={setImagesReady}
      >
        {selectedCheque.status === "pending" ? (
          <div className="mt-6 space-y-4 border-t border-slate-100 pt-5">
            <p className="text-sm text-slate-600">
              {selectedCheque.type === "deposit"
                ? "Check both images and confirm the funds have cleared before crediting this deposit."
                : "Confirm the payee and mailing address, issue the cheque, then record its number or dispatch reference."}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="cheque-reference">
                  {selectedCheque.type === "withdrawal"
                    ? "Cheque number / dispatch reference (required)"
                    : "Clearing reference (optional)"}
                </label>
                <input
                  className="input"
                  id="cheque-reference"
                  maxLength={100}
                  onChange={(e) => setReference(e.target.value)}
                  value={reference}
                />
              </div>
              <div>
                <label className="label" htmlFor="cheque-custom-date">
                  Custom transaction date &amp; time (optional)
                </label>
                <input
                  className="input"
                  id="cheque-custom-date"
                  onChange={(e) => setChequeApprovalDate(e.target.value)}
                  type="datetime-local"
                  value={chequeApprovalDate}
                />
              </div>
            </div>
            <button
              className="btn-primary disabled:opacity-50"
              disabled={chequeBusy || (selectedCheque.type === "deposit" && !imagesReady)}
              onClick={() => processCheque("approve")}
              type="button"
            >
              {chequeBusy ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} Approve cheque{" "}
              {selectedCheque.type}
            </button>
            <div>
              <label className="label" htmlFor="cheque-reason">
                Rejection reason (required)
              </label>
              <textarea
                className="textarea min-h-[80px]"
                id="cheque-reason"
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Explain why this request cannot be processed"
                value={reason}
              />
            </div>
            <button
              className="btn-danger flex items-center gap-2 disabled:opacity-50"
              disabled={chequeBusy || !reason.trim()}
              onClick={() => processCheque("reject")}
              type="button"
            >
              <XCircle size={16} /> Reject cheque request
            </button>
          </div>
        ) : null}
      </ChequeDetails>
    </div>
  ) : null;

  const isCreateDebit = createType === "withdrawal" || createType === "transfer";
  const createOverdraft =
    isCreateDebit &&
    (createStatus === "pending" || createStatus === "completed") &&
    selectedCreateProfile !== null &&
    Number(createAmount) > selectedCreateProfile.balance;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="mb-8 flex items-center gap-3 font-head text-lg font-bold">
          <span className="brand-mark">T</span>
          Admin <span className="text-gold">Panel</span>
        </div>
        {(
          [
            ["overview", Shield, "Overview"],
            ["users", Users, "Users"],
            ["requests", CreditCard, "Requests"],
            ["cheques", ScanLine, "Cheques"],
            ["methods", Settings, "Payment Methods"]
          ] as Array<[string, LucideIcon, string]>
        ).map(([id, Icon, label]) => (
          <button
            className={`nav-link w-full ${view === id ? "active" : ""}`}
            key={String(id)}
            onClick={() => {
              setView(String(id));
              setSelectedCheque(null);
            }}
            type="button"
          >
            <Icon size={18} /> {String(label)}
            {id === "cheques" && pendingCheques.length ? (
              <span className="ml-auto rounded-full bg-gold px-2 text-xs font-bold text-navy">
                {pendingCheques.length}
              </span>
            ) : null}
          </button>
        ))}
        <a className="nav-link mt-8" href="/dashboard">
          Back to dashboard
        </a>
        <form action="/api/auth/signout" className="mt-4" method="post">
          <button className="btn-danger flex w-full items-center justify-center gap-2" type="submit">
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </aside>
      <main className="main-area">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm text-grey">paybridge.ks</p>
            <h1 className="font-head text-3xl font-bold">Admin Console</h1>
          </div>
          <button
            className="btn-primary disabled:opacity-50"
            disabled={profiles.length === 0}
            onClick={() => openCreateModal()}
            type="button"
          >
            <Plus size={16} /> Backdate / Add Transaction
          </button>
        </div>

        {notice ? (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">
            <span>{notice}</span>
            <button aria-label="Dismiss error" className="text-red-500 hover:text-red-700" onClick={() => setNotice("")} type="button">
              <X size={16} />
            </button>
          </div>
        ) : null}

        {successNotice ? (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-teal/20 bg-teal/10 p-3 text-sm font-bold text-teal2" role="status">
            <span>{successNotice}</span>
            <button aria-label="Dismiss notice" className="text-teal2 hover:opacity-80" onClick={() => setSuccessNotice("")} type="button">
              <X size={16} />
            </button>
          </div>
        ) : null}

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
            <RequestsTable
              title="Pending Requests"
              transactions={pending.slice(0, 8)}
              onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id }, "Transaction approved.")}
              onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id }, "Transaction rejected.")}
              onReviewCheque={openCheque}
              onBackdate={openBackdateModal}
            />
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
                  <tr>
                    <th>User</th>
                    <th>Account</th>
                    <th>Type</th>
                    <th>Balance</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td>
                        <div className="flex items-center gap-3">
                          <span className="grid h-9 w-9 place-items-center rounded-full bg-teal/15 font-black text-teal2">
                            {initials(
                              profile.full_name.split(" ")[0],
                              profile.full_name.split(" ").slice(1).join(" ")
                            )}
                          </span>
                          <div>
                            <p className="font-bold">{profile.full_name}</p>
                            <p className="text-xs text-grey">{profile.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>{profile.account_id}</td>
                      <td>{profile.account_type}</td>
                      <td>{money(profile.balance)}</td>
                      <td>
                        <span className={`pill ${profile.status}`}>{profile.status}</span>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="btn-secondary px-3 py-2 text-xs text-teal2"
                            onClick={() => openCreateModal(profile.id)}
                            type="button"
                          >
                            <CalendarClock size={14} /> Backdate txn
                          </button>
                          <button
                            className="btn-secondary px-3 py-2 text-xs"
                            onClick={() =>
                              post(
                                "/api/admin/users/status",
                                {
                                  profileId: profile.id,
                                  status: profile.status === "suspended" ? "active" : "suspended"
                                },
                                `Account ${profile.status === "suspended" ? "activated" : "suspended"}.`
                              )
                            }
                            type="button"
                          >
                            {profile.status === "suspended" ? "Activate" : "Suspend"}
                          </button>
                        </div>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2" aria-label="Filter transactions by status">
                {(
                  [
                    ["all", "All"],
                    ["pending", "Pending"],
                    ["completed", "Completed"],
                    ["rejected", "Rejected"]
                  ] as const
                ).map(([filterKey, label]) => (
                  <button
                    aria-pressed={requestStatusFilter === filterKey}
                    className={requestStatusFilter === filterKey ? "btn-primary" : "btn-secondary"}
                    key={filterKey}
                    onClick={() => setRequestStatusFilter(filterKey)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="w-full sm:w-72">
                <input
                  aria-label="Search transactions"
                  className="input py-2.5 text-sm"
                  onChange={(e) => setRequestSearch(e.target.value)}
                  placeholder="Search user, account, description..."
                  type="search"
                  value={requestSearch}
                />
              </div>
            </div>
            {chequeReview}
            <RequestsTable
              title="Transactions & Requests"
              transactions={filteredRequests}
              onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id }, "Transaction approved.")}
              onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id }, "Transaction rejected.")}
              onReviewCheque={openCheque}
              onBackdate={openBackdateModal}
            />
          </section>
        ) : null}

        {view === "cheques" ? (
          <section className="space-y-5">
            <div>
              <h2 className="font-head text-2xl font-bold">Cheque requests</h2>
              <p className="mt-1 text-sm text-grey">
                Review scans, payees and delivery details. Approve only after verification or fulfilment.
              </p>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Filter cheque requests">
              {(
                [
                  ["all", "All"],
                  ["pending", "Pending"],
                  ["deposit", "Deposits"],
                  ["withdrawal", "Withdrawals"]
                ] as const
              ).map(([filter, label]) => (
                <button
                  aria-pressed={chequeFilter === filter}
                  className={chequeFilter === filter ? "btn-primary" : "btn-secondary"}
                  key={filter}
                  onClick={() => {
                    setChequeFilter(filter);
                    setSelectedCheque(null);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            {chequeReview}
            <RequestsTable
              title="Cheque Requests"
              transactions={visibleCheques}
              onApprove={(id) => post("/api/admin/transactions/approve", { transactionId: id }, "Transaction approved.")}
              onReject={(id) => post("/api/admin/transactions/reject", { transactionId: id }, "Transaction rejected.")}
              onReviewCheque={openCheque}
              onBackdate={openBackdateModal}
            />
          </section>
        ) : null}

        {view === "methods" ? (
          <section className="grid gap-5 lg:grid-cols-2">
            {methods.map((method) => (
              <div className="card p-5" key={method.id}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <input
                    className="input font-bold"
                    value={method.label}
                    onChange={(e) => updateMethod(method.id, (m) => ({ ...m, label: e.target.value }))}
                  />
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input
                      checked={method.is_active}
                      type="checkbox"
                      onChange={(e) => updateMethod(method.id, (m) => ({ ...m, is_active: e.target.checked }))}
                    />
                    Active
                  </label>
                </div>
                <div className="space-y-3">
                  {method.fields.map((field, index) => (
                    <div className="grid gap-3 sm:grid-cols-[.7fr_1fr]" key={`${method.id}-${index}`}>
                      <input
                        className="input"
                        value={field.label}
                        onChange={(e) =>
                          updateMethod(method.id, (m) => ({
                            ...m,
                            fields: m.fields.map((f, i) => (i === index ? { ...f, label: e.target.value } : f))
                          }))
                        }
                      />
                      <input
                        className="input"
                        value={field.value}
                        onChange={(e) =>
                          updateMethod(method.id, (m) => ({
                            ...m,
                            fields: m.fields.map((f, i) => (i === index ? { ...f, value: e.target.value } : f))
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <button className="btn-primary mt-4" onClick={() => saveMethod(method)} type="button">
                  Save method
                </button>
              </div>
            ))}
          </section>
        ) : null}
      </main>

      {/* Modal: Create / Backdate New Transaction */}
      {createOpen ? (
        <div
          aria-labelledby="create-backdate-modal-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !createBusy) setCreateOpen(false);
          }}
          role="dialog"
        >
          <div className="card max-h-[92vh] w-full max-w-xl overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-teal2">Admin Ledger Entry</p>
                <h2 className="mt-1 font-head text-2xl font-bold" id="create-backdate-modal-title">
                  Create / Backdate Transaction
                </h2>
                <p className="mt-1 text-sm text-grey">
                  Record a transaction on any customer account with a custom date and time.
                </p>
              </div>
              <button
                aria-label="Close create transaction dialog"
                className="btn-secondary px-3 py-2"
                disabled={createBusy}
                onClick={() => setCreateOpen(false)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            {createError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">
                {createError}
              </div>
            ) : null}

            <form className="mt-5 space-y-4" onSubmit={submitCreateTransaction}>
              <div>
                <label className="label" htmlFor="create-txn-user">
                  Customer account
                </label>
                <select
                  className="select"
                  id="create-txn-user"
                  onChange={(e) => setCreateUserId(e.target.value)}
                  required
                  value={createUserId}
                >
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.full_name} · {profile.account_id} ({money(profile.balance)})
                      {profile.status === "suspended" ? " — Suspended" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="create-txn-type">
                    Transaction type
                  </label>
                  <select
                    className="select"
                    id="create-txn-type"
                    onChange={(e) => setCreateType(e.target.value as TransactionType)}
                    value={createType}
                  >
                    <option value="deposit">Deposit (+ Credit)</option>
                    <option value="admin_adjustment">Admin Adjustment (+ Credit)</option>
                    <option value="withdrawal">Withdrawal (− Debit)</option>
                    <option value="transfer">Transfer (− Debit)</option>
                  </select>
                </div>
                <div>
                  <label className="label" htmlFor="create-txn-status">
                    Status
                  </label>
                  <select
                    className="select"
                    id="create-txn-status"
                    onChange={(e) => setCreateStatus(e.target.value as TransactionStatus)}
                    value={createStatus}
                  >
                    <option value="completed">Completed</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="create-txn-amount">
                    Amount (USD)
                  </label>
                  <input
                    className="input font-bold"
                    id="create-txn-amount"
                    min="0.01"
                    onChange={(e) => setCreateAmount(e.target.value)}
                    required
                    step="0.01"
                    type="number"
                    value={createAmount}
                  />
                  {selectedCreateProfile ? (
                    <p className={`mt-1 text-xs ${createOverdraft ? "font-bold text-red-600" : "text-grey"}`}>
                      Available balance: {money(selectedCreateProfile.balance)}
                      {createOverdraft ? " (insufficient for debit)" : ""}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="label" htmlFor="create-txn-method">
                    Method
                  </label>
                  <select
                    className="select"
                    id="create-txn-method"
                    onChange={(e) => setCreateMethodKey(e.target.value)}
                    value={createMethodKey}
                  >
                    <option value="internal">
                      {createType === "admin_adjustment" ? "Admin Adjustment" : "Internal"}
                    </option>
                    <option value="bank_transfer">Bank Transfer</option>
                    {methods.map((method) => (
                      <option key={method.key} value={method.key}>
                        {method.label}
                      </option>
                    ))}
                    <option value="custom">Custom method label...</option>
                  </select>
                </div>
              </div>

              {createMethodKey === "custom" ? (
                <div>
                  <label className="label" htmlFor="create-txn-custom-method">
                    Custom method label
                  </label>
                  <input
                    className="input"
                    id="create-txn-custom-method"
                    maxLength={100}
                    onChange={(e) => setCreateCustomMethodLabel(e.target.value)}
                    placeholder="e.g. Wire Transfer, Payroll Credit, Merchant Refund"
                    required
                    value={createCustomMethodLabel}
                  />
                </div>
              ) : null}

              <div>
                <label className="label" htmlFor="create-txn-datetime">
                  Transaction date &amp; time
                </label>
                <input
                  className="input"
                  id="create-txn-datetime"
                  onChange={(e) => setCreateDateTime(e.target.value)}
                  required
                  type="datetime-local"
                  value={createDateTime}
                />
                <DatePresetButtons onSelect={setCreateDateTime} />
              </div>

              <div>
                <label className="label" htmlFor="create-txn-description">
                  Description
                </label>
                <input
                  className="input"
                  id="create-txn-description"
                  maxLength={500}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="e.g. Incoming wire transfer from Chase Bank"
                  required
                  value={createDescription}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="create-txn-reference">
                    Reference (optional)
                  </label>
                  <input
                    className="input"
                    id="create-txn-reference"
                    maxLength={100}
                    onChange={(e) => setCreateReference(e.target.value)}
                    placeholder="e.g. WIRE-90241"
                    value={createReference}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="create-txn-note">
                    Admin note (optional)
                  </label>
                  <input
                    className="input"
                    id="create-txn-note"
                    maxLength={500}
                    onChange={(e) => setCreateAdminNote(e.target.value)}
                    placeholder="Optional note visible in details"
                    value={createAdminNote}
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  className="btn-secondary"
                  disabled={createBusy}
                  onClick={() => setCreateOpen(false)}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="btn-primary disabled:opacity-50"
                  disabled={createBusy || createOverdraft}
                  type="submit"
                >
                  {createBusy ? <Loader2 className="animate-spin" size={16} /> : <CalendarClock size={16} />} Save
                  transaction
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {/* Modal: Edit / Backdate Existing Transaction Date */}
      {editingTxn ? (
        <div
          aria-labelledby="edit-backdate-modal-title"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/60 p-4 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget && !editBusy) setEditingTxn(null);
          }}
          role="dialog"
        >
          <div className="card max-h-[92vh] w-full max-w-lg overflow-y-auto p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-teal2">Backdate / Edit Timestamp</p>
                <h2 className="mt-1 font-head text-2xl font-bold" id="edit-backdate-modal-title">
                  Edit Transaction Date
                </h2>
              </div>
              <button
                aria-label="Close edit date dialog"
                className="btn-secondary px-3 py-2"
                disabled={editBusy}
                onClick={() => setEditingTxn(null)}
                type="button"
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-xl bg-off p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-bold">
                  {editingTxn.users?.full_name || "Unknown user"}
                  {editingTxn.users?.account_id ? ` · ${editingTxn.users.account_id}` : ""}
                </p>
                <span className={`pill ${normalizeStatus(editingTxn.status)}`}>
                  {statusLabel(editingTxn.status)}
                </span>
              </div>
              <p className="mt-1 font-semibold">
                <span className="capitalize">{editingTxn.type.replaceAll("_", " ")}</span> · {money(editingTxn.amount)}
              </p>
              <p className="mt-1 break-words text-xs text-grey">{editingTxn.description}</p>
              <p className="mt-2 text-xs text-grey" suppressHydrationWarning>
                Current date: <strong className="text-navy">{new Date(editingTxn.created_at).toLocaleString()}</strong>
              </p>
            </div>

            {editError ? (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-600" role="alert">
                {editError}
              </div>
            ) : null}

            <form className="mt-5 space-y-4" onSubmit={submitBackdateTransaction}>
              <div>
                <label className="label" htmlFor="edit-txn-datetime">
                  New date &amp; time
                </label>
                <input
                  className="input"
                  id="edit-txn-datetime"
                  onChange={(e) => setEditDateTime(e.target.value)}
                  required
                  type="datetime-local"
                  value={editDateTime}
                />
                <DatePresetButtons onSelect={setEditDateTime} />
              </div>

              <div>
                <label className="label" htmlFor="edit-txn-note">
                  Admin note (optional)
                </label>
                <textarea
                  className="textarea min-h-[76px]"
                  id="edit-txn-note"
                  maxLength={500}
                  onChange={(e) => setEditAdminNote(e.target.value)}
                  placeholder="Optional note or reason for adjustment"
                  value={editAdminNote}
                />
              </div>

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4">
                <button
                  className="btn-secondary"
                  disabled={editBusy}
                  onClick={() => setEditingTxn(null)}
                  type="button"
                >
                  Cancel
                </button>
                <button className="btn-primary disabled:opacity-50" disabled={editBusy} type="submit">
                  {editBusy ? <Loader2 className="animate-spin" size={16} /> : <CalendarClock size={16} />} Save date
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DatePresetButtons({ onSelect }: { onSelect: (localDateTime: string) => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Quick date presets">
      <span className="mr-1 text-xs font-semibold text-grey">Quick set:</span>
      {DATE_PRESETS.map((preset) => (
        <button
          className="rounded-md border border-slate-200 bg-off px-2 py-1 text-xs font-bold text-navy transition hover:border-teal hover:bg-teal/10"
          key={preset.label}
          onClick={() => onSelect(computePresetLocalDateTime(preset))}
          type="button"
        >
          {preset.label}
        </button>
      ))}
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
  title = "Requests",
  transactions,
  onApprove,
  onReject,
  onReviewCheque,
  onBackdate
}: {
  title?: string;
  transactions: Transaction[];
  onApprove: (id: string) => Promise<unknown>;
  onReject: (id: string) => Promise<unknown>;
  onReviewCheque: (transaction: Transaction) => void;
  onBackdate: (transaction: Transaction) => void;
}) {
  const [loadingState, setLoadingState] = useState<{ id: string; action: "approve" | "reject" } | null>(null);

  const handleApprove = async (id: string) => {
    setLoadingState({ id, action: "approve" });
    try {
      await onApprove(id);
    } finally {
      setLoadingState(null);
    }
  };

  const handleReject = async (id: string) => {
    setLoadingState({ id, action: "reject" });
    try {
      await onReject(id);
    } finally {
      setLoadingState(null);
    }
  };

  return (
    <section className="card overflow-hidden">
      <div className="border-b border-slate-100 p-5">
        <h2 className="font-head text-xl font-bold">{title}</h2>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Method</th>
              <th>Description</th>
              <th>Status</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {transactions.length ? (
              transactions.map((txn) => {
                const parsedCreatedAt = new Date(txn.created_at);
                const validDate = !Number.isNaN(parsedCreatedAt.getTime());
                return (
                  <tr key={txn.id}>
                    <td>
                      <p className="font-bold">{txn.users?.full_name || "Unknown user"}</p>
                      <p className="text-xs text-grey">{txn.users?.account_id || ""}</p>
                    </td>
                    <td className="capitalize">
                      {isChequeTransaction(txn) ? `Cheque ${txn.type}` : txn.type.replaceAll("_", " ")}
                    </td>
                    <td>{money(txn.amount)}</td>
                    <td>{txn.method_label || "Internal"}</td>
                    <td className="max-w-[300px] break-words">{txn.description}</td>
                    <td>
                      <span className={`pill ${normalizeStatus(txn.status)}`}>{statusLabel(txn.status)}</span>
                    </td>
                    <td suppressHydrationWarning>
                      {validDate ? (
                        <div>
                          <p className="whitespace-nowrap">{parsedCreatedAt.toLocaleDateString()}</p>
                          <p className="whitespace-nowrap text-xs text-grey">
                            {parsedCreatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      ) : (
                        txn.created_at
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        {isChequeTransaction(txn) ? (
                          <button
                            className="btn-secondary px-3 py-2 text-xs text-teal2"
                            onClick={() => onReviewCheque(txn)}
                            type="button"
                          >
                            <ScanLine size={14} /> Review cheque
                          </button>
                        ) : normalizeStatus(txn.status) === "pending" ? (
                          <>
                            <button
                              className="btn-secondary px-3 py-2 text-xs text-teal2 disabled:opacity-50"
                              disabled={loadingState?.id === txn.id}
                              onClick={() => handleApprove(txn.id)}
                              type="button"
                            >
                              {loadingState?.id === txn.id && loadingState?.action === "approve" ? (
                                <Loader2 className="animate-spin" size={14} />
                              ) : (
                                <CheckCircle size={14} />
                              )}{" "}
                              Approve
                            </button>
                            <button
                              className="btn-danger flex items-center gap-1 px-3 py-2 text-xs disabled:opacity-50"
                              disabled={loadingState?.id === txn.id}
                              onClick={() => handleReject(txn.id)}
                              type="button"
                            >
                              {loadingState?.id === txn.id && loadingState?.action === "reject" ? (
                                <Loader2 className="animate-spin" size={14} />
                              ) : (
                                <XCircle size={14} />
                              )}{" "}
                              Reject
                            </button>
                          </>
                        ) : null}
                        <button
                          className="btn-secondary px-3 py-2 text-xs"
                          onClick={() => onBackdate(txn)}
                          type="button"
                        >
                          <CalendarClock size={14} /> Edit date
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="py-8 text-center text-grey" colSpan={8}>
                  No requests found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
