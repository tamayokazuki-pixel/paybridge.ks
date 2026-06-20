"use client";

import { useState } from "react";
import { Chrome, Loader2 } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";

export function LoginForm() {
  const supabase = createSupabaseBrowserClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otpMode, setOtpMode] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    const origin = window.location.origin;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${origin}/auth/callback?next=/dashboard`
      }
    });
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.location.href = "/dashboard";
  }

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email) {
      setMessage("Enter your email first, then request the code.");
      return;
    }

    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false
      }
    });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    setOtpMode(true);
    setOtpCode("");
    setMessage("Check your email for the one-time code.");
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !otpCode) {
      setMessage("Enter your email and the one-time code.");
      return;
    }

    setLoading(true);
    setMessage("");
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: otpCode,
      type: "email"
    });
    setLoading(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    window.location.href = "/dashboard";
  }

  async function resetPassword() {
    if (!email) {
      setMessage("Enter your email first, then request the reset link.");
      return;
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/login`
    });
    setMessage(error ? error.message : "Password reset email sent.");
  }

  return (
    <form className="space-y-5" onSubmit={otpMode ? verifyOtp : signIn}>
      {message ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-600">{message}</div> : null}
      <button className="btn-secondary w-full" disabled={loading} onClick={signInWithGoogle} type="button">
        <Chrome size={18} /> Continue with Google
      </button>
      <div className="flex items-center gap-3 text-xs uppercase tracking-[.12em] text-grey">
        <span className="h-px flex-1 bg-slate-200" /> or email <span className="h-px flex-1 bg-slate-200" />
      </div>
      <div>
        <label className="label">Email address</label>
        <input className="input" required type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      {otpMode ? (
        <div>
          <label className="label">One-time code</label>
          <input className="input" required value={otpCode} onChange={(e) => setOtpCode(e.target.value)} />
        </div>
      ) : (
        <div>
          <label className="label">Password</label>
          <input className="input" required minLength={8} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <button className="text-sm font-bold text-teal2 hover:underline" onClick={resetPassword} type="button">
          Forgot password?
        </button>
        <button className="text-sm font-bold text-teal2 hover:underline" onClick={() => setOtpMode((value) => !value)} type="button">
          {otpMode ? "Use password" : "Use OTP"}
        </button>
      </div>
      {otpMode ? (
        <button className="btn-primary w-full" disabled={loading} type="submit">
          {loading ? <Loader2 className="animate-spin" size={18} /> : null}
          Verify one-time code
        </button>
      ) : (
        <div className="space-y-3">
          <button className="btn-primary w-full" disabled={loading} type="submit">
            {loading ? <Loader2 className="animate-spin" size={18} /> : null}
            Sign in to my account
          </button>
          <button className="btn-secondary w-full" disabled={loading} onClick={requestOtp} type="button">
            Send one-time code
          </button>
        </div>
      )}
    </form>
  );
}
