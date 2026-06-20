import Link from "next/link";
import { ArrowRight, Landmark, ShieldCheck, WalletCards, type LucideIcon } from "lucide-react";

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
    </main>
  );
}
