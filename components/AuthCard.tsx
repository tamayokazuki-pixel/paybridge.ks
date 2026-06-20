import Link from "next/link";

export function AuthCard({
  eyebrow,
  title,
  subtitle,
  switchHref,
  switchLabel,
  children
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  switchHref: string;
  switchLabel: string;
  children: React.ReactNode;
}) {
  return (
    <main className="grid min-h-screen bg-white md:grid-cols-2">
      <section className="hidden bg-navy px-12 py-16 text-white md:flex md:flex-col md:justify-center">
        <Link className="mb-12 flex items-center gap-3 font-head text-xl font-bold" href="/">
          <span className="brand-mark">T</span>
          paybridge<span className="text-teal">.ks</span>
        </Link>
        <span className="mb-6 w-fit rounded-full border border-teal/20 bg-teal/10 px-4 py-2 text-xs font-bold uppercase tracking-[.12em] text-teal">
          {eyebrow}
        </span>
        <h1 className="max-w-md font-head text-5xl font-black leading-tight">
          Banking access that feels polished and stays protected.
        </h1>
        <p className="mt-5 max-w-md leading-8 text-white/55">
          Secure Supabase authentication, Google sign-in, persistent profiles, and protected dashboard access.
        </p>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-lg">
          <Link className="mb-8 flex items-center gap-3 font-head text-xl font-bold md:hidden" href="/">
            <span className="brand-mark">T</span>
            paybridge<span className="text-teal">.ks</span>
          </Link>
          <div className="mb-8">
            <h2 className="font-head text-4xl font-bold">{title}</h2>
            <p className="mt-2 text-sm text-grey">
              {subtitle}{" "}
              <Link className="font-bold text-teal2 hover:underline" href={switchHref}>
                {switchLabel}
              </Link>
            </p>
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
