"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, CircleAlert, ShieldCheck, TrendingUp } from "lucide-react";
import { aggregateStockTrades, formatShares, type StockQuote, type StockTrade } from "@/lib/stocks";
import { money } from "@/lib/format";

type Feedback = { kind: "success" | "error"; message: string } | null;

export function StocksPanel({
  availableBalance,
  accountActive,
  quotes,
  trades,
  tradingReady
}: {
  availableBalance: number;
  accountActive: boolean;
  quotes: StockQuote[];
  trades: StockTrade[];
  tradingReady: boolean;
}) {
  const router = useRouter();
  const activeQuotes = useMemo(() => quotes.filter((quote) => quote.is_active !== false), [quotes]);
  const [symbol, setSymbol] = useState(activeQuotes[0]?.symbol || "");
  const [sharesInput, setSharesInput] = useState("1");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);

  const selectedQuote = activeQuotes.find((quote) => quote.symbol === symbol) || activeQuotes[0];
  const shares = Number(sharesInput);
  const estimatedTotal = selectedQuote && Number.isFinite(shares) && shares > 0
    ? Math.round(shares * Number(selectedQuote.price_per_share) * 100) / 100
    : 0;
  const holdings = useMemo(() => aggregateStockTrades(trades, quotes), [trades, quotes]);
  const totalInvested = holdings.reduce((total, holding) => total + holding.total_invested, 0);
  const totalReferenceValue = holdings.reduce((total, holding) => total + holding.reference_value, 0);
  const canBuy = tradingReady && accountActive && Boolean(selectedQuote) && !busy &&
    Number.isFinite(shares) && shares >= 0.0001 && shares <= 1_000_000 &&
    Math.abs(shares * 10_000 - Math.round(shares * 10_000)) < 0.00001 &&
    estimatedTotal >= 0.01 && estimatedTotal <= availableBalance;

  async function buyStock(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedQuote || !canBuy) return;

    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch("/api/stocks/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: selectedQuote.symbol, shares })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setFeedback({ kind: "error", message: payload.error || "Could not place this order." });
        return;
      }

      const order = payload.order;
      setFeedback({
        kind: "success",
        message: `Bought ${formatShares(Number(order?.shares ?? shares))} ${selectedQuote.symbol} share${Number(order?.shares ?? shares) === 1 ? "" : "s"} for ${money(Number(order?.total_amount ?? estimatedTotal))}.`
      });
      setSharesInput("1");
      router.refresh();
    } catch {
      setFeedback({ kind: "error", message: "A network error stopped the order. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  if (!tradingReady) {
    return (
      <div className="card p-8">
        <h2 className="font-head text-2xl font-bold">Stocks are not set up yet</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-grey">
          Ask your administrator to apply <code className="rounded bg-off px-1.5 py-1">supabase/add_stock_trading.sql</code> to the project database. No trades have been made.
        </p>
      </div>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-2xl bg-gradient-to-br from-navy to-navy2 p-7 text-white md:flex md:items-center md:justify-between md:gap-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.12em] text-white/50">Available to invest</p>
          <p className="mt-2 font-head text-4xl font-black">{money(availableBalance)}</p>
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">Buy fractional shares using your available cash balance. Purchases are recorded immediately in your account ledger.</p>
        </div>
        <div className="mt-5 flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 md:mt-0">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-teal/15 text-teal"><TrendingUp size={22} /></span>
          <div>
            <p className="font-bold">Paper trading</p>
            <p className="text-xs text-white/50">Demo quotes · simulated only</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="note">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} />
        <p><strong>Demo only:</strong> these are sample reference prices, not live market data. Orders are simulated and are not sent to a broker; this feature does not execute real stock trades.</p>
      </div>

      {accountActive ? null : (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">
          <CircleAlert className="mt-0.5 shrink-0" size={18} /> Stock purchases are disabled while your account is suspended.
        </div>
      )}
      {feedback ? (
        <div className={`rounded-lg border p-3 text-sm font-bold ${feedback.kind === "success" ? "border-teal/20 bg-teal/10 text-teal2" : "border-red-200 bg-red-50 text-red-700"}`} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 p-5">
            <div>
              <h2 className="font-head text-xl font-bold">Market watch</h2>
              <p className="mt-1 text-sm text-grey">Choose a company to prepare a buy order.</p>
            </div>
            <span className="rounded-full bg-off px-3 py-1 text-xs font-bold text-grey">{activeQuotes.length} demo listings</span>
          </div>
          {activeQuotes.length ? (
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              {activeQuotes.map((quote) => {
                const selected = selectedQuote?.symbol === quote.symbol;
                return (
                  <button
                    aria-pressed={selected}
                    className={`rounded-xl border p-4 text-left transition ${selected ? "border-teal bg-teal/5 shadow-sm" : "border-slate-100 hover:border-teal/40 hover:bg-off/60"}`}
                    key={quote.symbol}
                    onClick={() => { setSymbol(quote.symbol); setFeedback(null); }}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className="inline-flex rounded-md bg-navy px-2 py-1 text-xs font-black tracking-wide text-white">{quote.symbol}</span>
                        <p className="mt-3 truncate font-bold">{quote.company_name}</p>
                        <p className="mt-1 text-xs text-grey">{quote.sector}</p>
                      </div>
                      <p className="shrink-0 text-right font-head text-lg font-bold">{money(Number(quote.price_per_share))}<span className="block font-sans text-[10px] font-medium text-grey">per share</span></p>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="p-8 text-center text-sm text-grey">There are no active demo listings.</p>
          )}
        </div>

        <form className="card p-5" onSubmit={buyStock}>
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-teal/10 text-teal2"><TrendingUp size={22} /></span>
            <div>
              <h2 className="font-head text-xl font-bold">Buy shares</h2>
              <p className="text-xs text-grey">Amount is charged to available cash.</p>
            </div>
          </div>
          {selectedQuote ? (
            <>
              <div className="mt-5 rounded-xl bg-off p-4">
                <p className="font-bold">{selectedQuote.company_name} <span className="text-grey">({selectedQuote.symbol})</span></p>
                <p className="mt-1 text-sm text-grey">{money(Number(selectedQuote.price_per_share))} per share · sample quote</p>
              </div>
              <div className="mt-5">
                <label className="label" htmlFor="stock-shares">Number of shares</label>
                <input
                  autoComplete="off"
                  className="input text-xl font-bold"
                  id="stock-shares"
                  max="1000000"
                  min="0.0001"
                  onChange={(event) => setSharesInput(event.target.value)}
                  required
                  step="0.0001"
                  type="number"
                  value={sharesInput}
                />
                <p className="mt-2 text-xs text-grey">Fractional shares supported, up to 4 decimal places.</p>
              </div>
              <div className="mt-5 space-y-3 rounded-xl border border-slate-100 p-4 text-sm">
                <div className="flex justify-between gap-3 text-grey"><span>Estimated order total</span><strong className="text-navy">{money(estimatedTotal)}</strong></div>
                <div className="flex justify-between gap-3 text-grey"><span>Available cash</span><strong className="text-navy">{money(availableBalance)}</strong></div>
                {estimatedTotal > availableBalance ? <p className="text-xs font-semibold text-red-700">This order is above your available balance.</p> : null}
                {estimatedTotal > 0 && estimatedTotal < 0.01 ? <p className="text-xs font-semibold text-red-700">Order total must be at least $0.01.</p> : null}
              </div>
              <button className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50" disabled={!canBuy} type="submit">
                {busy ? "Placing order…" : <>Buy {selectedQuote.symbol} <ArrowRight size={17} /></>}
              </button>
            </>
          ) : (
            <p className="mt-5 rounded-xl bg-off p-4 text-sm text-grey">Select an active demo listing to prepare an order.</p>
          )}
        </form>
      </div>

      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="font-head text-xl font-bold">My portfolio</h2>
            <p className="mt-1 text-sm text-grey">Positions created from your simulated buy orders.</p>
          </div>
          <div className="flex gap-5 text-right text-sm">
            <div><p className="text-xs text-grey">Total invested</p><p className="mt-1 font-bold">{money(totalInvested)}</p></div>
            <div><p className="text-xs text-grey">Value at sample quotes</p><p className="mt-1 font-bold">{money(totalReferenceValue)}</p></div>
          </div>
        </div>
        {holdings.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Shares</th><th>Average cost</th><th>Invested</th><th>Sample value</th></tr></thead>
              <tbody>
                {holdings.map((holding) => (
                  <tr key={holding.symbol}>
                    <td><p className="font-bold">{holding.company_name}</p><p className="mt-1 text-xs text-grey">{holding.symbol}</p></td>
                    <td>{formatShares(holding.shares)}</td>
                    <td>{money(holding.average_cost)}</td>
                    <td>{money(holding.total_invested)}</td>
                    <td>{money(holding.reference_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="font-bold">No shares yet</p>
            <p className="mt-1 text-sm text-grey">Choose a listing above to place your first simulated buy order.</p>
          </div>
        )}
      </div>
    </section>
  );
}
