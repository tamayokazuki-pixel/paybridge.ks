import Link from "next/link";
import { ArrowRight, Landmark, ShieldCheck, WalletCards, HelpCircle, type LucideIcon } from "lucide-react";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-navy text-white">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link className="flex items-center gap-3 font-head text-xl font-bold" href="/">
          <span className="brand-mark">T</span>
          paybridge<span className="text-teal">.ks</span>
        </Link>
        <div className="flex items-center gap-3">
          <Link className="text-sm font-semibold text-white/70 hover:text-teal" href="/login">
            Sign in
          </Link>
          <Link className="btn-primary" href="/register">
            Open account
          </Link>
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-16 md:grid-cols-[1.05fr_.95fr]">
        <div>
          <div className="mb-5 inline-flex rounded-full border border-teal/25 bg-teal/10 px-4 py-2 text-xs font-bold uppercase tracking-[.12em] text-teal">
            Digital banking, rebuilt
          </div>
          <h1 className="font-head text-5xl font-black leading-tight md:text-6xl">
            Modern banking for people who move fast.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-white/64">
            paybridge.ks combines secure account access, account funding requests, admin approvals, and real-time transaction records in one Supabase-backed Next.js app.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link className="btn-primary" href="/register">
              Create your account <ArrowRight size={18} />
            </Link>
            <Link className="btn-secondary border-white/20 bg-white/5 text-white hover:border-teal" href="/login">
              Sign in
            </Link>
          </div>
        </div>

        <div className="card border-white/10 bg-white/5 p-7 text-white shadow-none">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[.12em] text-white/40">Total balance</p>
              <p className="font-head text-4xl font-black">$24,850.00</p>
            </div>
            <span className="rounded-full bg-teal/15 px-3 py-1 text-sm font-bold text-teal">Live</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            {([
              ["Secure auth", ShieldCheck],
              ["Funding", WalletCards],
              ["Admin tools", Landmark]
            ] as Array<[string, LucideIcon]>).map(([label, Icon]) => (
              <div className="rounded-xl bg-white/6 p-4" key={String(label)}>
                <Icon className="mb-4 text-teal" size={24} />
                <p className="font-bold">{String(label)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ Section */}
      <section className="mx-auto max-w-4xl px-6 pb-24 pt-10">
        <div className="mb-12 text-center">
          <div className="mx-auto mb-4 inline-flex items-center justify-center rounded-full bg-teal/10 p-3 text-teal">
            <HelpCircle size={28} />
          </div>
          <h2 className="font-head text-3xl font-black md:text-4xl">Frequently Asked Questions</h2>
          <p className="mt-4 text-white/64">Everything you need to know about paybridge.ks.</p>
        </div>
        
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="font-head text-xl font-bold">What is paybridge.ks?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/64">
              paybridge.ks is a modern digital banking demonstration platform that combines real-time transaction tracking with secure, admin-approved deposit funding requests.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="font-head text-xl font-bold">How long do deposits take?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/64">
              Once you submit a deposit request and complete the payment using the provided instructions, our admin team verifies and approves the transaction. Typically, this takes less than 2 hours during business operations.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="font-head text-xl font-bold">Is there a minimum deposit?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/64">
              Yes, the minimum deposit amount is $50. This ensures we can effectively process transactions while keeping administrative overhead low.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
            <h3 className="font-head text-xl font-bold">Is my data secure?</h3>
            <p className="mt-3 text-sm leading-relaxed text-white/64">
              Absolutely. We use Supabase for our backend infrastructure, meaning all data is encrypted at rest and protected by robust Row Level Security (RLS) policies.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
