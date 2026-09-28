"use client";

import { useState } from "react";
import { Camera, CircleCheck, Mail, ScanLine } from "lucide-react";
import { money } from "@/lib/format";

export function ChequePanel({ availableBalance, accountName, accountActive, onSubmitted }: {
  availableBalance: number;
  accountName: string;
  accountActive: boolean;
  onSubmitted: () => void;
}) {
  const [mode, setMode] = useState<"deposit" | "withdrawal">("deposit");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function submitDeposit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/transactions/cheque/deposit", {
        method: "POST",
        body: new FormData(form)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit cheque deposit.");
      form.reset();
      setMessage({ text: "Cheque deposit submitted for review. Your balance will be credited only after the cheque clears and an admin approves it.", error: false });
      onSubmitted();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not submit cheque deposit.", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawal(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/transactions/cheque/withdraw", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: Number(fields.get("amount")),
          payeeName: fields.get("payeeName"),
          mailingAddress: {
            line1: fields.get("line1"),
            line2: fields.get("line2"),
            city: fields.get("city"),
            region: fields.get("region"),
            postalCode: fields.get("postalCode"),
            country: fields.get("country")
          }
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not submit cheque withdrawal.");
      form.reset();
      setMessage({ text: "Cheque withdrawal submitted. The amount is reserved until an admin reviews and arranges your cheque, or rejects the request.", error: false });
      onSubmitted();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Could not submit cheque withdrawal.", error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-5">
      <div>
        <h2 className="font-head text-2xl font-bold">Cheques</h2>
        <p className="mt-1 text-sm text-grey">Deposit a paper cheque or request a cheque by mail. Both require manual admin review.</p>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Cheque service">
        <button aria-selected={mode === "deposit"} className={mode === "deposit" ? "btn-primary" : "btn-secondary"} onClick={() => { setMode("deposit"); setMessage(null); }} role="tab" type="button">
          <ScanLine size={18} /> Deposit a cheque
        </button>
        <button aria-selected={mode === "withdrawal"} className={mode === "withdrawal" ? "btn-primary" : "btn-secondary"} onClick={() => { setMode("withdrawal"); setMessage(null); }} role="tab" type="button">
          <Mail size={18} /> Withdraw by cheque
        </button>
      </div>
      {message ? (
        <div aria-live="polite" className={`rounded-lg border p-4 text-sm font-semibold ${message.error ? "border-red-200 bg-red-50 text-red-700" : "border-teal/20 bg-teal/10 text-teal2"}`} role={message.error ? "alert" : "status"}>
          {message.text}
        </div>
      ) : null}

      {mode === "deposit" ? (
        <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]" role="tabpanel">
          <form className="card p-6" onSubmit={submitDeposit}>
            <fieldset disabled={busy || !accountActive}>
              <h3 className="font-head text-xl font-bold">Cheque deposit</h3>
              <p className="mt-1 text-sm text-grey">Enter the details printed on the cheque and upload clear images of both sides.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Amount (min $50)" name="amount" min="50" step="0.01" type="number" placeholder="0.00" required />
                <Field label="Cheque number" name="chequeNumber" maxLength={32} required />
                <Field label="Issuing bank" name="bankName" maxLength={100} required />
                <Field label="Payer name (on cheque)" name="payerName" maxLength={100} required />
                <Field label="Cheque date" name="chequeDate" max={new Date().toISOString().slice(0, 10)} type="date" required />
              </div>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="cheque-front">Front image</label>
                  <input accept="image/jpeg,image/png,image/webp" className="input text-sm" id="cheque-front" name="frontImage" required type="file" />
                </div>
                <div>
                  <label className="label" htmlFor="cheque-back">Endorsed back image</label>
                  <input accept="image/jpeg,image/png,image/webp" className="input text-sm" id="cheque-back" name="backImage" required type="file" />
                </div>
              </div>
              <p className="mt-2 text-xs text-grey">JPEG, PNG or WebP. Up to 5 MB per image. Sign the back before photographing it.</p>
              <button className="btn-primary mt-6 w-full disabled:opacity-50" disabled={busy} type="submit">
                <Camera size={18} /> {busy ? "Submitting…" : "Submit cheque for review"}
              </button>
            </fieldset>
          </form>
          <div className="card p-6">
            <h3 className="font-head text-xl font-bold">Before you deposit</h3>
            <div className="mt-5 space-y-4 text-sm leading-6 text-slate-600">
              <p><CircleCheck className="mr-2 inline text-teal2" size={18} /> Photograph the whole cheque, front and signed back, with every corner visible.</p>
              <p><CircleCheck className="mr-2 inline text-teal2" size={18} /> Submit each cheque only once. Keep the original until the deposit has cleared.</p>
              <p><CircleCheck className="mr-2 inline text-teal2" size={18} /> A request is not a cleared deposit. An admin must verify the cheque before your balance is credited.</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[1.4fr_1fr]" role="tabpanel">
          <form className="card p-6" onSubmit={submitWithdrawal}>
            <fieldset disabled={busy || !accountActive || availableBalance < 50}>
              <h3 className="font-head text-xl font-bold">Withdraw by cheque</h3>
              <p className="mt-1 text-sm text-grey">Enter the payee and a complete postal address for delivery.</p>
              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <Field label="Amount (min $50)" name="amount" min="50" max={Math.max(0, availableBalance)} step="0.01" type="number" placeholder="0.00" required />
                <Field label="Payee (name on cheque)" name="payeeName" defaultValue={accountName} maxLength={100} required />
              </div>
              <h4 className="mb-3 mt-6 font-bold">Mailing address</h4>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Street address" name="line1" maxLength={160} required />
                <Field label="Apartment / suite (optional)" name="line2" maxLength={160} />
                <Field label="City" name="city" maxLength={80} required />
                <Field label="State / region" name="region" maxLength={80} required />
                <Field label="Postal code" name="postalCode" maxLength={24} required />
                <Field label="Country" name="country" maxLength={80} required />
              </div>
              <button className="btn-primary mt-6 w-full disabled:opacity-50" disabled={busy || availableBalance < 50} type="submit">
                <Mail size={18} /> {busy ? "Submitting…" : "Request cheque withdrawal"}
              </button>
              {availableBalance < 50 ? <p className="mt-2 text-sm text-red-600">At least $50 in available funds is required.</p> : null}
            </fieldset>
          </form>
          <div className="card p-6">
            <h3 className="font-head text-xl font-bold">Your available balance</h3>
            <p className="mt-3 font-head text-3xl font-bold text-teal2">{money(availableBalance)}</p>
            <p className="mt-4 text-sm leading-6 text-slate-600">The requested amount is held as soon as you submit. If an admin rejects the request, the hold is released. Approval means an admin has arranged your cheque; mailing is not automatic.</p>
          </div>
        </div>
      )}
    </section>
  );
}

function Field({ label, name, ...props }: { label: string; name: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="label" htmlFor={`cheque-${name}`}>{label}</label>
      <input className="input" id={`cheque-${name}`} name={name} {...props} />
    </div>
  );
}
