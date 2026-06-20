"use client";

import { useState } from "react";
import { Chrome, Loader2 } from "lucide-react";
import { accountTypes, currencies } from "@/lib/constants";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

const countries = ["United States", "Nigeria", "United Kingdom", "Ghana", "Kenya", "South Africa", "Canada", "Australia"];

export function RegisterForm() {
  const supabase = createSupabaseBrowserClient();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [needsEmailConfirmation, setNeedsEmailConfirmation] = useState(false);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dob: "",
    country: "",
    username: "",
    password: "",
    accountType: "Personal Checking",
    currency: "USD - US Dollar",
    marketing: false
  });

  function update(key: keyof typeof form, value: string | boolean) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function normalizeMessage(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value && typeof value === "object") {
      if ("message" in value && typeof (value as { message?: unknown }).message === "string") {
        return (value as { message: string }).message.trim();
      }
      if ("error" in value && typeof (value as { error?: unknown }).error === "string") {
        return (value as { error: string }).error.trim();
      }
    }
    return "";
  }

  async function signInWithGoogle() {
    setLoading(true);
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
      }
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setNeedsEmailConfirmation(false);

    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`,
        data: {
          first_name: form.firstName,
          last_name: form.lastName,
          full_name: `${form.firstName} ${form.lastName}`
        }
      }
    });

    if (error) {
      setLoading(false);
      setMessage(normalizeMessage(error) || "Unable to create account right now.");
      return;
    }

    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      setLoading(false);
      setNeedsEmailConfirmation(true);
      setMessage("Account created. Please check your inbox and confirm your email before signing in.");
      return;
    }

    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    });

    setLoading(false);
    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      setMessage(
        normalizeMessage(payload?.error) ||
          normalizeMessage(payload) ||
          "Account created, but profile setup failed."
      );
      return;
    }

    window.location.href = "/dashboard";
  }

  async function resendConfirmation() {
    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.resend({
      type: "signup",
      email: form.email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard`
      }
    });

    setLoading(false);
    setMessage(
      normalizeMessage(error) ||
        "A new confirmation email has been sent. Please check your inbox."
    );
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      {message ? <div className="rounded-lg border border-gold/30 bg-gold/10 p-3 text-sm font-semibold text-navy">{message}</div> : null}
      {needsEmailConfirmation ? (
        <button className="btn-secondary w-full" disabled={loading} onClick={resendConfirmation} type="button">
          Resend confirmation email
        </button>
      ) : null}
      <button className="btn-secondary w-full" disabled={loading} onClick={signInWithGoogle} type="button">
        <Chrome size={18} /> Continue with Google
      </button>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">First name</label>
          <input className="input" required value={form.firstName} onChange={(e) => update("firstName", e.target.value)} />
        </div>
        <div>
          <label className="label">Last name</label>
          <input className="input" required value={form.lastName} onChange={(e) => update("lastName", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Email</label>
          <input className="input" required type="email" value={form.email} onChange={(e) => update("email", e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" required value={form.phone} onChange={(e) => update("phone", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Date of birth</label>
          <input className="input" required type="date" value={form.dob} onChange={(e) => update("dob", e.target.value)} />
        </div>
        <div>
          <label className="label">Country</label>
          <select className="select" required value={form.country} onChange={(e) => update("country", e.target.value)}>
            <option value="">Select country</option>
            {countries.map((country) => <option key={country}>{country}</option>)}
          </select>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Username</label>
          <input className="input" required minLength={5} value={form.username} onChange={(e) => update("username", e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" required minLength={8} type="password" value={form.password} onChange={(e) => update("password", e.target.value)} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label">Account type</label>
          <select className="select" value={form.accountType} onChange={(e) => update("accountType", e.target.value)}>
            {accountTypes.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Currency</label>
          <select className="select" value={form.currency} onChange={(e) => update("currency", e.target.value)}>
            {currencies.map((item) => <option key={item}>{item}</option>)}
          </select>
        </div>
      </div>
      <label className="flex gap-3 text-sm text-slate-600">
        <input required type="checkbox" />
        I agree to the Terms of Service and Privacy Policy.
      </label>
      <button className="btn-primary w-full" disabled={loading} type="submit">
        {loading ? <Loader2 className="animate-spin" size={18} /> : null}
        Create my account
      </button>
    </form>
  );
}
