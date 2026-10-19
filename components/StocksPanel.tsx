"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  WalletCards
} from "lucide-react";
import {
  aggregateStockTrades,
  formatPercent,
  formatShares,
  generateIntradaySeries,
  tradeSide,
  type PricePoint,
  type StockQuote,
  type StockTrade
} from "@/lib/stocks";
import { FEATURED_SYMBOLS, catalogEntry } from "@/lib/stock-catalog";
import { Sparkline, StockChart } from "@/components/StockChart";
import { money } from "@/lib/format";

type Feedback = { kind: "success" | "error"; message: string } | null;
type ChartRange = "LIVE" | "1M" | "3M" | "6M" | "1Y" | "5Y";
type SortMode = "featured" | "gainers" | "losers" | "price" | "name";

type QuoteView = {
  symbol: string;
  company_name: string;
  sector: string;
  price: number;
  previous_close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number;
  change_percent: number;
  sparkline: number[];
  source: "live" | "simulated" | "stored";
  as_of: string | null;
};

const CHART_RANGES: ChartRange[] = ["LIVE", "1M", "3M", "6M", "1Y", "5Y"];

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function floorShares(value: number) {
  return Math.floor(value * 10_000) / 10_000;
}

function compactVolume(value: number | null) {
  if (!value) return "—";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function symbolHue(symbol: string) {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) % 360;
  return hash;
}

function orderQuotes(quotes: QuoteView[]) {
  const featuredIndex = new Map(FEATURED_SYMBOLS.map((symbol, index) => [symbol, index]));
  return [...quotes].sort((left, right) => {
    const leftFeatured = featuredIndex.get(left.symbol);
    const rightFeatured = featuredIndex.get(right.symbol);
    if (leftFeatured !== undefined || rightFeatured !== undefined) {
      if (leftFeatured === undefined) return 1;
      if (rightFeatured === undefined) return -1;
      return leftFeatured - rightFeatured;
    }
    return left.symbol.localeCompare(right.symbol);
  });
}

function toQuoteView(quote: StockQuote): QuoteView {
  const entry = catalogEntry(quote.symbol);
  return {
    symbol: quote.symbol,
    company_name: entry?.company_name || quote.company_name,
    sector: entry?.sector || quote.sector,
    price: Number(quote.price_per_share) || 0,
    previous_close: null,
    open: null,
    high: null,
    low: null,
    volume: null,
    change: 0,
    change_percent: 0,
    sparkline: [],
    source: "stored",
    as_of: quote.updated_at || null
  };
}

export function StocksPanel({
  availableBalance,
  accountActive,
  quotes,
  trades,
  tradingReady,
  sellReady = true
}: {
  availableBalance: number;
  accountActive: boolean;
  quotes: StockQuote[];
  trades: StockTrade[];
  tradingReady: boolean;
  sellReady?: boolean;
}) {
  const router = useRouter();
  const initialQuotes = useMemo(
    () => orderQuotes(quotes.filter((quote) => quote.is_active !== false).map(toQuoteView)),
    [quotes]
  );
  const [liveQuotes, setLiveQuotes] = useState<QuoteView[]>(initialQuotes);
  const [dataSource, setDataSource] = useState<"live" | "simulated" | "stored">("stored");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [symbol, setSymbol] = useState(
    () => initialQuotes.find((quote) => quote.symbol === "AAPL")?.symbol || initialQuotes[0]?.symbol || ""
  );
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("featured");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [sharesInput, setSharesInput] = useState("1");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState<ChartRange>("LIVE");
  const [history, setHistory] = useState<{ symbol: string; range: string; points: PricePoint[]; source: string } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [liveSeries, setLiveSeries] = useState<Record<string, PricePoint[]>>({});

  const quotesRef = useRef<QuoteView[]>(initialQuotes);
  const anchorsRef = useRef<Record<string, number>>(
    Object.fromEntries(initialQuotes.map((quote) => [quote.symbol, quote.price]))
  );
  const selectedRef = useRef(symbol);
  selectedRef.current = symbol;

  useEffect(() => {
    quotesRef.current = liveQuotes;
  }, [liveQuotes]);

  const refreshQuotes = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/stocks/quotes", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json();
      const incoming: QuoteView[] = Array.isArray(payload.quotes) ? payload.quotes : [];
      if (!incoming.length) return;
      for (const quote of incoming) anchorsRef.current[quote.symbol] = Number(quote.price);
      setLiveQuotes(orderQuotes(incoming.map((quote) => ({ ...quote, price: Number(quote.price) }))));
      setDataSource(payload.source === "live" ? "live" : "simulated");
      setLastUpdated(new Date());
    } catch {
      // Keep showing the last known prices while offline.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!tradingReady) return;
    refreshQuotes();
    const interval = setInterval(() => {
      if (!document.hidden) refreshQuotes();
    }, 20_000);
    return () => clearInterval(interval);
  }, [refreshQuotes, tradingReady]);

  // Simulated tick flow between delayed market updates: small mean-reverting
  // moves around the latest real price keep the LIVE chart flowing.
  useEffect(() => {
    if (!tradingReady) return;
    const interval = setInterval(() => {
      if (document.hidden) return;
      const current = quotesRef.current;
      if (!current.length) return;

      const next = current.map((quote) => {
        const anchor = anchorsRef.current[quote.symbol] ?? quote.price;
        let candidate = quote.price * (1 + (Math.random() - 0.5) * 0.0016) + (anchor - quote.price) * 0.08;
        candidate = Math.max(anchor * 0.992, Math.min(anchor * 1.008, candidate));
        const price = Math.max(0.01, round2(candidate));
        const previousClose = quote.previous_close ?? anchor;
        const sparkline = quote.sparkline.length
          ? [...quote.sparkline.slice(0, -1), price]
          : quote.sparkline;
        return {
          ...quote,
          price,
          change: round2(price - previousClose),
          change_percent: previousClose ? round2(((price - previousClose) / previousClose) * 100) : 0,
          high: quote.high !== null ? Math.max(quote.high, price) : price,
          low: quote.low !== null ? Math.min(quote.low, price) : price,
          sparkline
        };
      });
      quotesRef.current = next;
      setLiveQuotes(next);

      const selectedQuote = next.find((quote) => quote.symbol === selectedRef.current);
      if (selectedQuote) {
        const label = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
        setLiveSeries((previous) => {
          const series = previous[selectedQuote.symbol];
          if (!series) return previous;
          return {
            ...previous,
            [selectedQuote.symbol]: [...series, { t: label, c: selectedQuote.price }].slice(-160)
          };
        });
      }
    }, 2_500);
    return () => clearInterval(interval);
  }, [tradingReady]);

  // Seed each symbol's intraday flow the first time it is opened.
  useEffect(() => {
    if (!symbol) return;
    setLiveSeries((previous) => {
      if (previous[symbol]) return previous;
      const quote = quotesRef.current.find((item) => item.symbol === symbol);
      if (!quote) return previous;
      const open = quote.open ?? quote.previous_close ?? quote.price * 0.995;
      return { ...previous, [symbol]: generateIntradaySeries(symbol, open, quote.price) };
    });
  }, [symbol, liveQuotes.length]);

  useEffect(() => {
    if (!tradingReady || range === "LIVE" || !symbol) return;
    const controller = new AbortController();
    setHistoryLoading(true);
    fetch(`/api/stocks/history?symbol=${encodeURIComponent(symbol)}&range=${range}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("history failed");
        const payload = await response.json();
        setHistory({ symbol, range, points: payload.points || [], source: payload.source || "simulated" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setHistory({ symbol, range, points: [], source: "simulated" });
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
      });
    return () => controller.abort();
  }, [range, symbol, tradingReady]);

  const selectedQuote = liveQuotes.find((quote) => quote.symbol === symbol) || liveQuotes[0];
  const aggregateQuotes = useMemo<StockQuote[]>(
    () => liveQuotes.map((quote) => ({
      symbol: quote.symbol,
      company_name: quote.company_name,
      sector: quote.sector,
      price_per_share: quote.price
    })),
    [liveQuotes]
  );
  const allHoldings = useMemo(() => aggregateStockTrades(trades, aggregateQuotes), [trades, aggregateQuotes]);
  const holdings = allHoldings.filter((holding) => holding.shares > 0);
  const portfolioValue = holdings.reduce((total, holding) => total + holding.reference_value, 0);
  const portfolioCost = holdings.reduce((total, holding) => total + holding.total_invested, 0);
  const totalUnrealized = holdings.reduce((total, holding) => total + holding.unrealized_gain, 0);
  const totalRealized = allHoldings.reduce((total, holding) => total + holding.realized_gain, 0);
  const selectedPosition = selectedQuote ? holdings.find((holding) => holding.symbol === selectedQuote.symbol) : undefined;
  const ownedShares = selectedPosition?.shares || 0;

  const visibleQuotes = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? liveQuotes.filter((quote) => {
          const aliases = catalogEntry(quote.symbol)?.aliases || "";
          return `${quote.symbol} ${quote.company_name} ${quote.sector} ${aliases}`.toLowerCase().includes(term);
        })
      : liveQuotes;
    const sorted = [...filtered];
    if (sortMode === "gainers") sorted.sort((a, b) => b.change_percent - a.change_percent);
    if (sortMode === "losers") sorted.sort((a, b) => a.change_percent - b.change_percent);
    if (sortMode === "price") sorted.sort((a, b) => b.price - a.price);
    if (sortMode === "name") sorted.sort((a, b) => a.company_name.localeCompare(b.company_name));
    return sorted;
  }, [liveQuotes, search, sortMode]);

  const chartPoints: PricePoint[] = range === "LIVE"
    ? (selectedQuote ? liveSeries[selectedQuote.symbol] || [] : [])
    : history && history.symbol === selectedQuote?.symbol && history.range === range
      ? history.points
      : [];
  const periodChange = chartPoints.length >= 2
    ? ((chartPoints[chartPoints.length - 1].c - chartPoints[0].c) / chartPoints[0].c) * 100
    : 0;

  const shares = Number(sharesInput);
  const sharesValid = Number.isFinite(shares) && shares >= 0.0001 && shares <= 1_000_000 &&
    Math.abs(shares * 10_000 - Math.round(shares * 10_000)) < 0.00001;
  const estimatedTotal = selectedQuote && sharesValid ? round2(shares * selectedQuote.price) : 0;
  const estimatedGain = side === "sell" && selectedPosition && sharesValid
    ? round2((selectedQuote!.price - selectedPosition.average_cost) * shares)
    : null;
  const canBuy = side === "buy" && tradingReady && accountActive && Boolean(selectedQuote) && !busy &&
    sharesValid && estimatedTotal >= 0.01 && estimatedTotal <= availableBalance;
  const canSell = side === "sell" && tradingReady && sellReady && accountActive && Boolean(selectedQuote) && !busy &&
    sharesValid && shares <= ownedShares + 0.000001 && ownedShares > 0 && estimatedTotal >= 0.01;
  const canTrade = side === "buy" ? canBuy : canSell;

  function selectSymbol(nextSymbol: string, nextSide?: "buy" | "sell") {
    setSymbol(nextSymbol);
    selectedRef.current = nextSymbol;
    if (nextSide) setSide(nextSide);
    setFeedback(null);
  }

  async function placeOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedQuote || !canTrade) return;

    setBusy(true);
    setFeedback(null);
    try {
      const response = await fetch(side === "buy" ? "/api/stocks/buy" : "/api/stocks/sell", {
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
      const filledShares = Number(order?.shares ?? shares);
      const filledTotal = Number(order?.total_amount ?? estimatedTotal);
      const filledPrice = Number(order?.price_per_share ?? selectedQuote.price);
      setFeedback({
        kind: "success",
        message: side === "buy"
          ? `Bought ${formatShares(filledShares)} ${selectedQuote.symbol} at ${money(filledPrice)} — ${money(filledTotal)} debited from your available balance.`
          : `Sold ${formatShares(filledShares)} ${selectedQuote.symbol} at ${money(filledPrice)} — ${money(filledTotal)} credited to your available balance.`
      });
      setSharesInput("1");
      router.refresh();
      refreshQuotes();
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
          Ask your administrator to run (or re-run) <code className="rounded bg-off px-1.5 py-1">supabase/add_stock_trading.sql</code> in the Supabase SQL Editor. The updated script adds the full stock catalog (Apple, Trump Media, News Corp/Barron&apos;s, Berkshire Hathaway and more) plus selling. No trades have been made.
        </p>
      </div>
    );
  }

  const gainColor = (value: number) => value >= 0 ? "text-teal2" : "text-rose-600";
  const tickerQuotes = [...liveQuotes, ...liveQuotes];

  return (
    <section className="space-y-6">
      {/* Portfolio summary */}
      <div className="rounded-2xl bg-gradient-to-br from-navy to-navy2 p-7 text-white">
        <div className="grid gap-6 md:grid-cols-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-white/50">Cash available</p>
            <p className="mt-2 font-head text-3xl font-black">{money(availableBalance)}</p>
            <p className="mt-1 text-xs text-white/50">Ready to invest</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-white/50">Portfolio value</p>
            <p className="mt-2 font-head text-3xl font-black">{money(portfolioValue)}</p>
            <p className="mt-1 text-xs text-white/50">{holdings.length} open position{holdings.length === 1 ? "" : "s"}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-white/50">Unrealized gain/loss</p>
            <p className={`mt-2 font-head text-3xl font-black ${totalUnrealized >= 0 ? "text-teal" : "text-rose-300"}`}>
              {totalUnrealized >= 0 ? "+" : "−"}{money(Math.abs(totalUnrealized))}
            </p>
            <p className="mt-1 text-xs text-white/50">
              {portfolioCost > 0 ? `${formatPercent((totalUnrealized / portfolioCost) * 100)} on ${money(portfolioCost)} invested` : "No shares held yet"}
            </p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.12em] text-white/50">Realized gain/loss</p>
            <p className={`mt-2 font-head text-3xl font-black ${totalRealized >= 0 ? "text-teal" : "text-rose-300"}`}>
              {totalRealized >= 0 ? "+" : "−"}{money(Math.abs(totalRealized))}
            </p>
            <p className="mt-1 text-xs text-white/50">Locked in from sales</p>
          </div>
        </div>
      </div>

      {/* Ticker tape */}
      {liveQuotes.length ? (
        <div className="overflow-hidden rounded-xl bg-navy py-2.5" aria-hidden="true">
          <div className="ticker-track flex w-max gap-8 px-4">
            {tickerQuotes.map((quote, index) => (
              <span className="flex items-center gap-2 whitespace-nowrap text-xs font-bold text-white/80" key={`${quote.symbol}-${index}`}>
                <span className="text-white">{quote.symbol}</span>
                {money(quote.price)}
                <span className={quote.change_percent >= 0 ? "text-teal" : "text-rose-300"}>
                  {quote.change_percent >= 0 ? "▲" : "▼"} {formatPercent(quote.change_percent)}
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900" role="note">
        <ShieldCheck className="mt-0.5 shrink-0" size={19} />
        <p>
          <strong>Paper trading:</strong>{" "}
          {dataSource === "live"
            ? "Prices are real but delayed market data (free Stooq feed); the LIVE view adds simulated ticks between delayed updates. "
            : "The live feed is unreachable right now, so prices are simulated. "}
          Orders are simulated against your in-app balance and are not sent to a broker — you are not buying real shares.
        </p>
      </div>

      {accountActive ? null : (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">
          <CircleAlert className="mt-0.5 shrink-0" size={18} /> Trading is disabled while your account is suspended.
        </div>
      )}
      {feedback ? (
        <div className={`rounded-lg border p-3 text-sm font-bold ${feedback.kind === "success" ? "border-teal/20 bg-teal/10 text-teal2" : "border-red-200 bg-red-50 text-red-700"}`} role={feedback.kind === "error" ? "alert" : "status"}>
          {feedback.message}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.55fr)_minmax(320px,.85fr)]">
        <div className="space-y-6">
          {/* Market flow chart */}
          <div className="card overflow-hidden">
            <div className="border-b border-slate-100 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  {selectedQuote ? (
                    <span
                      className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-sm font-black text-white"
                      style={{ background: `linear-gradient(135deg, hsl(${symbolHue(selectedQuote.symbol)} 65% 45%), hsl(${(symbolHue(selectedQuote.symbol) + 40) % 360} 65% 35%))` }}
                    >
                      {selectedQuote.symbol.slice(0, 2)}
                    </span>
                  ) : null}
                  <div>
                    <h2 className="font-head text-xl font-bold">
                      {selectedQuote?.company_name} <span className="text-base text-grey">({selectedQuote?.symbol})</span>
                    </h2>
                    <p className="mt-0.5 text-xs text-grey">{selectedQuote?.sector} · NASDAQ/NYSE</p>
                    <div className="mt-2 flex flex-wrap items-baseline gap-3">
                      <p className="font-head text-4xl font-black">{money(selectedQuote?.price || 0)}</p>
                      {selectedQuote ? (
                        <p className={`flex items-center gap-1 text-sm font-black ${gainColor(selectedQuote.change)}`}>
                          {selectedQuote.change >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                          {selectedQuote.change >= 0 ? "+" : "−"}{money(Math.abs(selectedQuote.change))} ({formatPercent(selectedQuote.change_percent)}) today
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="space-y-2 text-right">
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${dataSource === "live" ? "bg-teal/10 text-teal2" : "bg-amber-100 text-amber-800"}`}>
                    <Radio size={13} className={dataSource === "live" ? "animate-pulse" : ""} />
                    {dataSource === "live" ? "LIVE · delayed" : dataSource === "simulated" ? "SIMULATED FEED" : "STORED QUOTES"}
                  </span>
                  <div className="flex items-center justify-end gap-2 text-xs text-grey">
                    <span>{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : "Loading market data…"}</span>
                    <button
                      className="btn-secondary px-2.5 py-1.5"
                      disabled={refreshing}
                      onClick={refreshQuotes}
                      title="Refresh quotes"
                      type="button"
                    >
                      <RefreshCw className={refreshing ? "animate-spin" : ""} size={14} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex gap-1 rounded-lg bg-off p-1" role="tablist" aria-label="Chart range">
                  {CHART_RANGES.map((value) => (
                    <button
                      aria-selected={range === value}
                      className={`rounded-md px-3 py-1.5 text-xs font-black transition ${range === value ? "bg-navy text-white shadow" : "text-grey hover:text-navy"}`}
                      key={value}
                      onClick={() => setRange(value)}
                      role="tab"
                      type="button"
                    >
                      {value === "LIVE" ? "● LIVE" : value}
                    </button>
                  ))}
                </div>
                <p className={`text-sm font-black ${gainColor(periodChange)}`}>
                  {historyLoading && range !== "LIVE" ? "Loading chart…" : `${formatPercent(periodChange)} ${range === "LIVE" ? "this session" : `past ${range}`}`}
                </p>
              </div>
            </div>

            <div className="p-4">
              <StockChart
                ariaLabel={`Price chart for ${selectedQuote?.company_name || symbol} over ${range}`}
                points={chartPoints}
              />
              {selectedQuote ? (
                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  {[
                    ["Open", selectedQuote.open !== null ? money(selectedQuote.open) : "—"],
                    ["Prev. close", selectedQuote.previous_close !== null ? money(selectedQuote.previous_close) : "—"],
                    ["Day high", selectedQuote.high !== null ? money(selectedQuote.high) : "—"],
                    ["Day low", selectedQuote.low !== null ? money(selectedQuote.low) : "—"],
                    ["Volume", compactVolume(selectedQuote.volume)],
                    ["Feed", dataSource === "live" ? "Stooq (delayed)" : dataSource === "simulated" ? "Simulated" : "Stored"]
                  ].map(([label, value]) => (
                    <div className="rounded-xl bg-off p-3" key={label}>
                      <p className="text-[10px] font-bold uppercase tracking-[.08em] text-grey">{label}</p>
                      <p className="mt-1 truncate text-sm font-black">{value}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {range !== "LIVE" && history?.source === "simulated" ? (
                <p className="mt-3 text-xs text-grey">History is simulated while the market feed is unreachable.</p>
              ) : null}
            </div>
          </div>

          {/* Market watch */}
          <div className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
              <div>
                <h2 className="font-head text-xl font-bold">Market watch</h2>
                <p className="mt-1 text-sm text-grey">Apple, Trump Media, Barron&apos;s owner News Corp, Berkshire Hathaway and more. Select a row to chart and trade it.</p>
              </div>
              <span className="rounded-full bg-off px-3 py-1 text-xs font-bold text-grey">{liveQuotes.length} listings</span>
            </div>
            <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
              <label className="relative min-w-[220px] flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-grey" size={17} />
                <span className="sr-only">Search stocks</span>
                <input
                  className="input pl-10"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search apple, trump, barron, tesla…"
                  type="search"
                  value={search}
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-grey">
                Sort
                <select className="select w-auto py-2.5" onChange={(event) => setSortMode(event.target.value as SortMode)} value={sortMode}>
                  <option value="featured">Featured</option>
                  <option value="gainers">Top gainers</option>
                  <option value="losers">Top losers</option>
                  <option value="price">Highest price</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>
            {visibleQuotes.length ? (
              <div className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
                {visibleQuotes.map((quote) => {
                  const selected = selectedQuote?.symbol === quote.symbol;
                  const owned = holdings.find((holding) => holding.symbol === quote.symbol);
                  return (
                    <button
                      aria-pressed={selected}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition sm:gap-4 sm:px-5 ${selected ? "bg-teal/5" : "hover:bg-off/70"}`}
                      key={quote.symbol}
                      onClick={() => selectSymbol(quote.symbol)}
                      type="button"
                    >
                      <span
                        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xs font-black text-white"
                        style={{ background: `linear-gradient(135deg, hsl(${symbolHue(quote.symbol)} 65% 45%), hsl(${(symbolHue(quote.symbol) + 40) % 360} 65% 35%))` }}
                      >
                        {quote.symbol.slice(0, 2)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <strong className="truncate">{quote.company_name}</strong>
                          <span className="rounded bg-navy px-1.5 py-0.5 text-[10px] font-black tracking-wide text-white">{quote.symbol}</span>
                          {owned ? <span className="rounded-full bg-gold/25 px-2 py-0.5 text-[10px] font-black text-[#8a6d1c]">Own {formatShares(owned.shares)}</span> : null}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-grey">{quote.sector}</span>
                      </span>
                      <span className="hidden shrink-0 md:block">
                        <Sparkline data={quote.sparkline} />
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block font-head text-lg font-bold">{money(quote.price)}</span>
                        <span className={`flex items-center justify-end gap-1 text-xs font-black ${gainColor(quote.change_percent)}`}>
                          {quote.change_percent >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                          {formatPercent(quote.change_percent)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="p-8 text-center text-sm text-grey">No listings match “{search}”.</p>
            )}
          </div>
        </div>

        {/* Trade ticket */}
        <form className="card h-fit p-5" onSubmit={placeOrder}>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-off p-1" role="tablist" aria-label="Buy or sell">
            <button
              aria-selected={side === "buy"}
              className={`rounded-lg py-2.5 text-sm font-black transition ${side === "buy" ? "bg-teal text-navy shadow" : "text-grey"}`}
              onClick={() => { setSide("buy"); setSharesInput("1"); setFeedback(null); }}
              role="tab"
              type="button"
            >
              Buy
            </button>
            <button
              aria-selected={side === "sell"}
              className={`rounded-lg py-2.5 text-sm font-black transition ${side === "sell" ? "bg-rose-600 text-white shadow" : "text-grey"}`}
              onClick={() => { setSide("sell"); setSharesInput(ownedShares > 0 ? String(Math.min(1, ownedShares)) : "1"); setFeedback(null); }}
              role="tab"
              type="button"
            >
              Sell
            </button>
          </div>

          {selectedQuote ? (
            <>
              <div className="mt-5 rounded-xl bg-off p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{selectedQuote.company_name}</p>
                    <p className="mt-0.5 text-xs text-grey">{selectedQuote.symbol} · {selectedQuote.sector}</p>
                  </div>
                  <p className="text-right">
                    <span className="block font-head text-xl font-black">{money(selectedQuote.price)}</span>
                    <span className={`text-xs font-black ${gainColor(selectedQuote.change_percent)}`}>{formatPercent(selectedQuote.change_percent)} today</span>
                  </p>
                </div>
                {selectedPosition ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-200 pt-3 text-center">
                    <div><p className="text-[10px] font-bold uppercase text-grey">You own</p><p className="mt-0.5 text-sm font-black">{formatShares(selectedPosition.shares)}</p></div>
                    <div><p className="text-[10px] font-bold uppercase text-grey">Avg. cost</p><p className="mt-0.5 text-sm font-black">{money(selectedPosition.average_cost)}</p></div>
                    <div><p className="text-[10px] font-bold uppercase text-grey">Gain/loss</p><p className={`mt-0.5 text-sm font-black ${gainColor(selectedPosition.unrealized_gain)}`}>{formatPercent(selectedPosition.unrealized_gain_percent)}</p></div>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-slate-200 pt-3 text-xs text-grey">You do not own {selectedQuote.symbol} yet.</p>
                )}
              </div>

              {side === "sell" && !sellReady ? (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                  Selling needs the updated database script. Ask your administrator to re-run <code className="rounded bg-white px-1">supabase/add_stock_trading.sql</code>.
                </div>
              ) : null}
              {side === "sell" && ownedShares === 0 ? (
                <div className="mt-4 rounded-lg border border-slate-200 bg-off p-3 text-xs leading-5 text-grey">
                  You have no {selectedQuote.symbol} shares to sell. Switch to Buy to open a position.
                </div>
              ) : null}

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

              <div className="mt-3 flex flex-wrap gap-2">
                {side === "buy"
                  ? [50, 100, 500, 1000].map((amount) => (
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-black hover:border-teal hover:text-teal2 disabled:opacity-40"
                        disabled={selectedQuote.price <= 0 || amount > availableBalance}
                        key={amount}
                        onClick={() => setSharesInput(String(floorShares(amount / selectedQuote.price) || ""))}
                        type="button"
                      >
                        ${amount.toLocaleString()}
                      </button>
                    )).concat(
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-black hover:border-teal hover:text-teal2 disabled:opacity-40"
                        disabled={selectedQuote.price <= 0 || availableBalance <= 0}
                        key="max"
                        onClick={() => setSharesInput(String(floorShares(availableBalance / selectedQuote.price) || ""))}
                        type="button"
                      >
                        Max cash
                      </button>
                    )
                  : [0.25, 0.5, 0.75, 1].map((fraction) => (
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-black hover:border-rose-400 hover:text-rose-600 disabled:opacity-40"
                        disabled={ownedShares <= 0}
                        key={fraction}
                        onClick={() => setSharesInput(String(fraction === 1 ? ownedShares : floorShares(ownedShares * fraction) || ""))}
                        type="button"
                      >
                        {fraction === 1 ? "Sell all" : `${fraction * 100}%`}
                      </button>
                    ))}
              </div>

              <div className="mt-5 space-y-3 rounded-xl border border-slate-100 p-4 text-sm">
                <div className="flex justify-between gap-3 text-grey">
                  <span>{side === "buy" ? "Estimated cost" : "Estimated proceeds"}</span>
                  <strong className="text-navy">{money(estimatedTotal)}</strong>
                </div>
                <div className="flex justify-between gap-3 text-grey">
                  <span>Available cash {side === "buy" ? "before" : "after sale"}</span>
                  <strong className="text-navy">{money(side === "buy" ? availableBalance : availableBalance + estimatedTotal)}</strong>
                </div>
                {side === "buy" ? (
                  <div className="flex justify-between gap-3 text-grey">
                    <span>Cash remaining</span>
                    <strong className={availableBalance - estimatedTotal < 0 ? "text-rose-600" : "text-navy"}>{money(availableBalance - estimatedTotal)}</strong>
                  </div>
                ) : null}
                {estimatedGain !== null ? (
                  <div className="flex justify-between gap-3 text-grey">
                    <span>Est. gain on this sale</span>
                    <strong className={gainColor(estimatedGain)}>{estimatedGain >= 0 ? "+" : "−"}{money(Math.abs(estimatedGain))}</strong>
                  </div>
                ) : null}
                {side === "buy" && estimatedTotal > availableBalance ? <p className="text-xs font-semibold text-red-700">This order is above your available balance.</p> : null}
                {side === "sell" && sharesValid && shares > ownedShares ? <p className="text-xs font-semibold text-red-700">You only own {formatShares(ownedShares)} shares.</p> : null}
                {estimatedTotal > 0 && estimatedTotal < 0.01 ? <p className="text-xs font-semibold text-red-700">Order total must be at least $0.01.</p> : null}
                <p className="text-[11px] leading-4 text-grey">Final price is set by the server at execution from the latest feed and may differ slightly from this estimate.</p>
              </div>

              {side === "buy" ? (
                <button className="btn-primary mt-5 w-full disabled:cursor-not-allowed disabled:opacity-50" disabled={!canTrade} type="submit">
                  {busy ? "Placing order…" : <>Buy {selectedQuote.symbol} · {money(estimatedTotal)} <ArrowRight size={17} /></>}
                </button>
              ) : (
                <button
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-[10px] bg-gradient-to-br from-rose-500 to-rose-600 px-[18px] py-[13px] font-extrabold text-white transition hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!canTrade}
                  type="submit"
                >
                  {busy ? "Placing order…" : <>Sell {selectedQuote.symbol} · {money(estimatedTotal)} <ArrowRight size={17} /></>}
                </button>
              )}

              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-grey">
                <WalletCards size={14} /> {side === "buy" ? "Charged to" : "Credited to"} your available balance instantly
              </p>
            </>
          ) : (
            <p className="mt-5 rounded-xl bg-off p-4 text-sm text-grey">Select a listing to prepare an order.</p>
          )}
        </form>
      </div>

      {/* Portfolio */}
      <div className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5">
          <div>
            <h2 className="font-head text-xl font-bold">My portfolio</h2>
            <p className="mt-1 text-sm text-grey">Live values from your simulated buy and sell orders.</p>
          </div>
          <div className="flex gap-5 text-right text-sm">
            <div><p className="text-xs text-grey">Cost basis</p><p className="mt-1 font-bold">{money(portfolioCost)}</p></div>
            <div><p className="text-xs text-grey">Market value</p><p className="mt-1 font-bold">{money(portfolioValue)}</p></div>
            <div>
              <p className="text-xs text-grey">Unrealized</p>
              <p className={`mt-1 font-bold ${gainColor(totalUnrealized)}`}>{totalUnrealized >= 0 ? "+" : "−"}{money(Math.abs(totalUnrealized))}</p>
            </div>
          </div>
        </div>
        {holdings.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Company</th><th>Shares</th><th>Average cost</th><th>Current price</th><th>Market value</th><th>Gain/loss</th><th>Trade</th></tr>
              </thead>
              <tbody>
                {holdings.map((holding) => (
                  <tr key={holding.symbol}>
                    <td>
                      <p className="font-bold">{holding.company_name}</p>
                      <p className="mt-1 text-xs text-grey">{holding.symbol}</p>
                    </td>
                    <td>{formatShares(holding.shares)}</td>
                    <td>{money(holding.average_cost)}</td>
                    <td>{money(holding.reference_price)}</td>
                    <td className="font-bold">{money(holding.reference_value)}</td>
                    <td className={`font-bold ${gainColor(holding.unrealized_gain)}`}>
                      {holding.unrealized_gain >= 0 ? "+" : "−"}{money(Math.abs(holding.unrealized_gain))}
                      <span className="block text-xs font-semibold">{formatPercent(holding.unrealized_gain_percent)}</span>
                    </td>
                    <td>
                      <span className="flex gap-2">
                        <button className="rounded-md bg-teal/10 px-2.5 py-1.5 text-xs font-black text-teal2 hover:bg-teal/20" onClick={() => selectSymbol(holding.symbol, "buy")} type="button">Buy</button>
                        <button className="rounded-md bg-rose-50 px-2.5 py-1.5 text-xs font-black text-rose-600 hover:bg-rose-100 disabled:opacity-40" disabled={!sellReady} onClick={() => { selectSymbol(holding.symbol, "sell"); setSharesInput(String(Math.min(1, holding.shares))); }} type="button">Sell</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center">
            <p className="font-bold">No shares yet</p>
            <p className="mt-1 text-sm text-grey">Choose Apple, Trump Media, Barron&apos;s owner News Corp or any listing above to place your first simulated buy order.</p>
          </div>
        )}
      </div>

      {/* Recent trades */}
      {trades.length ? (
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 p-5">
            <h2 className="font-head text-xl font-bold">Recent trades</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {trades.slice(0, 8).map((trade) => {
              const tradeAction = tradeSide(trade);
              return (
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 text-sm" key={trade.id}>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-md px-2 py-1 text-[11px] font-black ${tradeAction === "buy" ? "bg-teal/10 text-teal2" : "bg-rose-50 text-rose-600"}`}>
                      {tradeAction.toUpperCase()}
                    </span>
                    <div>
                      <p className="font-bold">{trade.company_name} <span className="text-grey">({trade.symbol})</span></p>
                      <p className="text-xs text-grey">{new Date(trade.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </div>
                  </div>
                  <p className="text-right">
                    <span className="block font-bold">{formatShares(Number(trade.shares))} @ {money(Number(trade.price_per_share))}</span>
                    <span className={`text-xs font-black ${tradeAction === "buy" ? "text-rose-600" : "text-teal2"}`}>
                      {tradeAction === "buy" ? "−" : "+"}{money(Number(trade.total_amount))}
                    </span>
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}
