"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ArrowRightLeft, CircleAlert, Minus, TrendingDown, TrendingUp, X } from "lucide-react";
import { StockMovementChart } from "@/components/StockMovementChart";
import { aggregateStockTrades, formatShares, type StockHolding, type StockQuote, type StockTrade } from "@/lib/stocks";
import {
  createStockPriceSeries,
  formatStockMovementPercent,
  simulatedStockPrice,
  stockMovementChange,
  STOCK_MOVEMENT_UPDATE_MS
} from "@/lib/stock-movement";
import { money } from "@/lib/format";

type Feedback = { kind: "success" | "error"; message: string } | null;
type MarketQuote = StockQuote & { anchor_price_per_share: number };

function signedMoney(value: number) {
  if (!Number.isFinite(value) || value === 0) return money(0);
  return `${value > 0 ? "+" : "-"}${money(Math.abs(value))}`;
}

function isValidShareQuantity(value: number) {
  return Number.isFinite(value) && value >= 0.0001 && value <= 1_000_000 &&
    Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.00001;
}

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
  const [marketTimestamp, setMarketTimestamp] = useState(() => Date.now());
  const [sellSymbol, setSellSymbol] = useState<string | null>(null);
  const [sellSharesInput, setSellSharesInput] = useState("");
  const [sellFeedback, setSellFeedback] = useState<Feedback>(null);
  const [sellBusy, setSellBusy] = useState(false);

  useEffect(() => {
    if (!activeQuotes.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "hidden") setMarketTimestamp(Date.now());
    }, STOCK_MOVEMENT_UPDATE_MS);

    return () => window.clearInterval(interval);
  }, [activeQuotes.length]);

  const marketQuotes = useMemo<MarketQuote[]>(
    () => activeQuotes.map((quote) => {
      const anchorPrice = Number(quote.price_per_share);
      return {
        ...quote,
        anchor_price_per_share: anchorPrice,
        price_per_share: simulatedStockPrice(anchorPrice, quote.symbol, marketTimestamp)
      };
    }),
    [activeQuotes, marketTimestamp]
  );

  const selectedQuote = marketQuotes.find((quote) => quote.symbol === symbol) || marketQuotes[0];
  const shares = Number(sharesInput);
  const estimatedTotal = selectedQuote && Number.isFinite(shares) && shares > 0
    ? Math.round(shares * Number(selectedQuote.price_per_share) * 100) / 100
    : 0;
  const holdings = useMemo(() => aggregateStockTrades(trades, marketQuotes), [trades, marketQuotes]);
  const totalInvested = holdings.reduce((total, holding) => total + holding.total_invested, 0);
  const totalCurrentValue = holdings.reduce((total, holding) => total + holding.reference_value, 0);
  const totalGainLoss = holdings.reduce((total, holding) => total + holding.unrealized_gain_loss, 0);
  const totalGainLossPercent = totalInvested > 0 ? (totalGainLoss / totalInvested) * 100 : 0;
  const canBuy = tradingReady && accountActive && Boolean(selectedQuote) && !busy && !sellBusy &&
    isValidShareQuantity(shares) && estimatedTotal >= 0.01 && estimatedTotal <= availableBalance;

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

  function openSellForm(holding: StockHolding) {
    if (sellSymbol === holding.symbol) {
      setSellSymbol(null);
      return;
    }
    setSellSymbol(holding.symbol);
    setSellSharesInput(String(holding.shares));
    setSellFeedback(null);
  }

  function setSellFraction(holding: StockHolding, fraction: number) {
    const nextShares = fraction >= 1
      ? holding.shares
      : Math.floor(holding.shares * fraction * 10_000) / 10_000;
    setSellSharesInput(nextShares > 0 ? String(nextShares) : "");
    setSellFeedback(null);
  }

  async function sellStock(event: React.FormEvent<HTMLFormElement>, holding: StockHolding) {
    event.preventDefault();
    const sharesToSell = Number(sellSharesInput);
    if (!accountActive || busy || sellBusy || !isValidShareQuantity(sharesToSell) || sharesToSell > holding.shares) return;

    setSellBusy(true);
    setSellFeedback(null);
    try {
      const response = await fetch("/api/stocks/sell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: holding.symbol, shares: sharesToSell })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSellFeedback({ kind: "error", message: payload.error || "Could not complete this sale." });
        return;
      }

      const order = payload.order;
      const soldShares = Number(order?.shares ?? sharesToSell);
      const proceeds = Number(order?.total_amount ?? sharesToSell * holding.reference_price);
      const remainingShares = Number(order?.remaining_shares);
      setSellFeedback({
        kind: "success",
        message: `Converted ${formatShares(soldShares)} ${holding.symbol} share${soldShares === 1 ? "" : "s"} into ${money(proceeds)} available cash.${Number.isFinite(remainingShares) ? ` Remaining position: ${formatShares(Math.max(0, remainingShares))} shares.` : ""}`
      });
      setSellSymbol(null);
      setSellSharesInput("");
      router.refresh();
    } catch {
      setSellFeedback({ kind: "error", message: "A network error stopped the sale. Please try again." });
    } finally {
      setSellBusy(false);
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
          <p className="mt-2 max-w-xl text-sm leading-6 text-white/60">Buy and sell fractional shares with your available cash. Sale proceeds are converted back into available cash immediately.</p>
        </div>
        <div className="mt-5 flex shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-4 md:mt-0">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-teal/15 text-teal"><TrendingUp size={22} /></span>
          <div>
            <p className="font-bold">Paper trading</p>
            <p className="text-xs text-white/50">Demo quotes · simulated only</p>
          </div>
        </div>
      </div>

      {accountActive ? null : (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">
          <CircleAlert className="mt-0.5 shrink-0" size={18} /> Stock trades are disabled while your account is suspended.
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
              {marketQuotes.map((quote) => {
                const selected = selectedQuote?.symbol === quote.symbol;
                const movementPoints = createStockPriceSeries(quote.anchor_price_per_share, quote.symbol, marketTimestamp);
                const movement = stockMovementChange(movementPoints);
                const MovementIcon = movement.direction === "up"
                  ? TrendingUp
                  : movement.direction === "down"
                    ? TrendingDown
                    : Minus;
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
                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <StockMovementChart points={movementPoints} symbol={quote.symbol} />
                      <div className="mt-2 flex items-center justify-between gap-3 text-[11px]">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-grey">
                          <span className={`h-2 w-2 rounded-full ${movement.direction === "down" ? "bg-rose-500" : movement.direction === "up" ? "bg-teal2" : "bg-slate-400"} animate-pulse motion-reduce:animate-none`} />
                          Session movement
                        </span>
                        <span className={`inline-flex items-center gap-1 font-black ${movement.direction === "down" ? "text-rose-600" : movement.direction === "up" ? "text-teal2" : "text-slate-500"}`}>
                          <MovementIcon aria-hidden="true" size={13} strokeWidth={2.5} />
                          {formatStockMovementPercent(movement.percent)}
                        </span>
                      </div>
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
                <p className="mt-1 text-sm text-grey">{money(Number(selectedQuote.price_per_share))} per share · current paper quote</p>
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
            <p className="mt-1 text-sm text-grey">Values move with the paper market. Sell shares to convert them back into available cash.</p>
          </div>
          <div className="flex flex-wrap gap-5 text-right text-sm">
            <div><p className="text-xs text-grey">Cost basis</p><p className="mt-1 font-bold">{money(totalInvested)}</p></div>
            <div><p className="text-xs text-grey">Current value</p><p className="mt-1 font-bold">{money(totalCurrentValue)}</p></div>
            <div>
              <p className="text-xs text-grey">Gain/loss</p>
              <p className={`mt-1 font-bold ${totalGainLoss > 0 ? "text-teal2" : totalGainLoss < 0 ? "text-rose-600" : "text-navy"}`}>
                {signedMoney(totalGainLoss)}
                <span className="ml-1 text-xs font-black">{formatStockMovementPercent(totalGainLossPercent)}</span>
              </p>
            </div>
          </div>
        </div>
        {sellFeedback ? (
          <div className="border-b border-slate-100 p-5">
            <div className={`rounded-lg border p-3 text-sm font-bold ${sellFeedback.kind === "success" ? "border-teal/20 bg-teal/10 text-teal2" : "border-red-200 bg-red-50 text-red-700"}`} role={sellFeedback.kind === "error" ? "alert" : "status"}>
              {sellFeedback.message}
            </div>
          </div>
        ) : null}
        {holdings.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Company</th><th>Shares</th><th>Average cost</th><th>Current price</th><th>Cost basis</th><th>Current value</th><th>Gain/loss</th><th>Action</th></tr></thead>
              <tbody>
                {holdings.map((holding) => {
                  const isSelling = sellSymbol === holding.symbol;
                  const sharesToSell = isSelling ? Number(sellSharesInput) : 0;
                  const estimatedProceeds = Number.isFinite(sharesToSell) && sharesToSell > 0
                    ? Math.round(sharesToSell * holding.reference_price * 100) / 100
                    : 0;
                  const remainingShares = Number.isFinite(sharesToSell)
                    ? Math.max(0, holding.shares - sharesToSell)
                    : holding.shares;
                  const canSell = accountActive && tradingReady && !busy && !sellBusy &&
                    isValidShareQuantity(sharesToSell) && sharesToSell <= holding.shares && estimatedProceeds >= 0.01;
                  const gainLossColor = holding.unrealized_gain_loss > 0
                    ? "text-teal2"
                    : holding.unrealized_gain_loss < 0
                      ? "text-rose-600"
                      : "text-slate-500";
                  const GainLossIcon = holding.unrealized_gain_loss > 0
                    ? TrendingUp
                    : holding.unrealized_gain_loss < 0
                      ? TrendingDown
                      : Minus;

                  return (
                    <Fragment key={holding.symbol}>
                      <tr>
                        <td><p className="font-bold">{holding.company_name}</p><p className="mt-1 text-xs text-grey">{holding.symbol}</p></td>
                        <td>{formatShares(holding.shares)}</td>
                        <td>{money(holding.average_cost)}</td>
                        <td className="font-semibold">{money(holding.reference_price)}</td>
                        <td>{money(holding.total_invested)}</td>
                        <td className="font-semibold">{money(holding.reference_value)}</td>
                        <td>
                          <p className={`font-bold ${gainLossColor}`}>{signedMoney(holding.unrealized_gain_loss)}</p>
                          <p className={`mt-1 inline-flex items-center gap-1 text-xs font-black ${gainLossColor}`}>
                            <GainLossIcon aria-hidden="true" size={12} strokeWidth={2.5} />
                            {formatStockMovementPercent(holding.unrealized_gain_loss_percent)}
                          </p>
                        </td>
                        <td>
                          <button
                            aria-expanded={isSelling}
                            className="btn-secondary whitespace-nowrap px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={!accountActive || busy || sellBusy}
                            onClick={() => openSellForm(holding)}
                            type="button"
                          >
                            <ArrowRightLeft aria-hidden="true" size={15} /> Sell
                          </button>
                        </td>
                      </tr>
                      {isSelling ? (
                        <tr>
                          <td className="bg-off/70 p-5" colSpan={8}>
                            <form onSubmit={(event) => sellStock(event, holding)}>
                              <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                  <h3 className="font-head text-lg font-bold">Convert {holding.symbol} to cash</h3>
                                  <p className="mt-1 text-sm text-grey">
                                    You own {formatShares(holding.shares)} shares. Current paper price: {money(holding.reference_price)} per share.
                                  </p>
                                </div>
                                <button
                                  aria-label={`Close ${holding.symbol} sale form`}
                                  className="btn-secondary px-2.5 py-2"
                                  disabled={sellBusy}
                                  onClick={() => setSellSymbol(null)}
                                  type="button"
                                >
                                  <X aria-hidden="true" size={16} />
                                </button>
                              </div>

                              <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                                <div>
                                  <label className="label" htmlFor={`sell-shares-${holding.symbol}`}>Shares to convert</label>
                                  <input
                                    autoComplete="off"
                                    className="input text-xl font-bold"
                                    id={`sell-shares-${holding.symbol}`}
                                    max={holding.shares}
                                    min="0.0001"
                                    onChange={(event) => setSellSharesInput(event.target.value)}
                                    required
                                    step="0.0001"
                                    type="number"
                                    value={sellSharesInput}
                                  />
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {([
                                      ["25%", 0.25],
                                      ["50%", 0.5],
                                      ["75%", 0.75],
                                      ["Max", 1]
                                    ] as Array<[string, number]>).map(([label, fraction]) => (
                                      <button
                                        className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-black text-navy transition hover:border-teal hover:text-teal2 disabled:opacity-50"
                                        disabled={sellBusy}
                                        key={label}
                                        onClick={() => setSellFraction(holding, fraction)}
                                        type="button"
                                      >
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  {Number.isFinite(sharesToSell) && sharesToSell > holding.shares ? (
                                    <p className="mt-3 text-xs font-semibold text-red-700">You only own {formatShares(holding.shares)} shares of {holding.symbol}.</p>
                                  ) : null}
                                  {sellSharesInput && !isValidShareQuantity(sharesToSell) && sharesToSell <= holding.shares ? (
                                    <p className="mt-3 text-xs font-semibold text-red-700">Enter at least 0.0001 shares, using up to 4 decimal places.</p>
                                  ) : null}
                                  {isValidShareQuantity(sharesToSell) && sharesToSell <= holding.shares && estimatedProceeds < 0.01 ? (
                                    <p className="mt-3 text-xs font-semibold text-red-700">Sale proceeds must be at least $0.01.</p>
                                  ) : null}
                                </div>

                                <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
                                  <div className="flex justify-between gap-3 text-grey"><span>Estimated cash</span><strong className="text-navy">{money(estimatedProceeds)}</strong></div>
                                  <div className="flex justify-between gap-3 text-grey"><span>Remaining shares</span><strong className="text-navy">{formatShares(remainingShares)}</strong></div>
                                  <div className="flex justify-between gap-3 text-grey"><span>Available cash now</span><strong className="text-navy">{money(availableBalance)}</strong></div>
                                  <p className="border-t border-slate-100 pt-3 text-xs leading-5 text-grey">Final proceeds use the paper-market price when the sale executes and are added to available cash.</p>
                                </div>
                              </div>

                              <button className="btn-primary mt-5 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSell} type="submit">
                                {sellBusy ? "Converting…" : <>Convert to cash <ArrowRightLeft aria-hidden="true" size={17} /></>}
                              </button>
                            </form>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
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
