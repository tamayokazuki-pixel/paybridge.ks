import { STOCK_CATALOG, catalogEntry, type StockCatalogEntry } from "@/lib/stock-catalog";
import {
  hashSeed,
  mulberry32,
  simulateDailySeries,
  type PricePoint,
  type StockQuote
} from "@/lib/stocks";

/**
 * Server-side market data.
 *
 * Primary source: Stooq's free CSV endpoints (no API key). Quotes are the
 * latest available trade (delayed during market hours, last close outside
 * them) and the daily endpoint supplies several years of real price history
 * for the market-flow chart.
 *
 * If the feed cannot be reached (offline host, provider outage, …) every
 * function falls back to a deterministic simulated series anchored on the
 * stored database quote, and says so via `source: "simulated"` so the UI
 * never presents invented numbers as real market data. Set
 * `STOCK_DATA_SOURCE=simulated` to force the fallback.
 *
 * This module is server-only: never import it from a client component.
 */

export type MarketDataSource = "live" | "simulated";

export type LiveQuote = {
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
  /** Recent daily closes (real when available) for the mini sparkline. */
  sparkline: number[];
  source: MarketDataSource;
  as_of: string | null;
};

export type HistoryRange = "1M" | "3M" | "6M" | "1Y" | "5Y";

export const HISTORY_RANGES: HistoryRange[] = ["1M", "3M", "6M", "1Y", "5Y"];

/** Trading days needed from the daily feed for each range. */
const RANGE_TRADING_DAYS: Record<HistoryRange, number> = {
  "1M": 22,
  "3M": 66,
  "6M": 132,
  "1Y": 252,
  "5Y": 1260
};

const QUOTE_CACHE_MS = 45_000;
const HISTORY_CACHE_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 4_500;

type CacheEntry<T> = { value: T; expiresAt: number };
const quoteCache = new Map<string, CacheEntry<LiveQuote[]>>();
const historyCache = new Map<string, CacheEntry<PricePoint[]>>();

function feedDisabled() {
  return process.env.STOCK_DATA_SOURCE === "simulated";
}

/** Map an app ticker to Stooq's symbol, e.g. BRK.B -> brk-b.us. */
export function toStooqSymbol(symbol: string) {
  return `${symbol.toUpperCase().replace(".", "-").toLowerCase()}.us`;
}

async function fetchText(url: string): Promise<string | null> {
  if (feedDisabled()) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "paybridge.ks market-data/1.0" },
      cache: "no-store"
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function parseNumber(value: string | undefined): number | null {
  if (!value || value.trim() === "N/D") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Split a CSV document into header-indexed row objects. */
function csvRows(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] || "").trim();
    });
    return row;
  });
}

export type StooqQuoteRow = {
  symbol: string;
  date: string | null;
  time: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
  volume: number | null;
};

/** Parse Stooq's `q/l` bulk-quote CSV (exported for tests). */
export function parseStooqQuotesCsv(text: string): StooqQuoteRow[] {
  return csvRows(text).flatMap((row) => {
    const close = parseNumber(row.close);
    const rawSymbol = row.symbol;
    if (!rawSymbol || close === null || close <= 0) return [];
    return [{
      // brk-b.us -> BRK.B
      symbol: rawSymbol.replace(/\.us$/i, "").replace("-", ".").toUpperCase(),
      date: row.date || null,
      time: row.time || null,
      open: parseNumber(row.open),
      high: parseNumber(row.high),
      low: parseNumber(row.low),
      close,
      volume: parseNumber(row.volume)
    }];
  });
}

/** Parse Stooq's `q/d/l` daily-history CSV (exported for tests). */
export function parseStooqHistoryCsv(text: string): PricePoint[] {
  return csvRows(text).flatMap((row) => {
    const close = parseNumber(row.close);
    if (!row.date || close === null || close <= 0) return [];
    const point: PricePoint = { t: row.date, c: close };
    const open = parseNumber(row.open);
    const high = parseNumber(row.high);
    const low = parseNumber(row.low);
    const volume = parseNumber(row.volume);
    if (open !== null) point.o = open;
    if (high !== null) point.h = high;
    if (low !== null) point.l = low;
    if (volume !== null) point.v = volume;
    return [point];
  });
}

async function fetchStooqQuotes(symbols: string[]): Promise<Map<string, StooqQuoteRow>> {
  const map = new Map<string, StooqQuoteRow>();
  if (!symbols.length) return map;
  const query = symbols.map(toStooqSymbol).join(",");
  const text = await fetchText(`https://stooq.com/q/l/?s=${query}&f=sd2t2ohlcv&h&e=csv`);
  if (!text) return map;
  for (const row of parseStooqQuotesCsv(text)) map.set(row.symbol, row);
  return map;
}

/** Up to ~5 years of daily closes for one symbol, cached per instance. */
export async function fetchDailyHistory(symbol: string): Promise<PricePoint[] | null> {
  const key = symbol.toUpperCase();
  const cached = historyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const from = new Date();
  from.setFullYear(from.getFullYear() - 5);
  const d1 = from.toISOString().slice(0, 10).replace(/-/g, "");
  const text = await fetchText(
    `https://stooq.com/q/d/l/?s=${toStooqSymbol(key)}&d1=${d1}&i=d`
  );
  if (!text) return null;

  const points = parseStooqHistoryCsv(text);
  if (points.length < 2) return null;
  historyCache.set(key, { value: points, expiresAt: Date.now() + HISTORY_CACHE_MS });
  return points;
}

/** Simulated quote anchored on a stored/seed price; stable within a day. */
export function simulateQuote(entry: StockCatalogEntry, anchorPrice: number, now = new Date()): LiveQuote {
  const day = now.toISOString().slice(0, 10);
  const random = mulberry32(hashSeed(`${entry.symbol}-quote-${day}`));
  const changePercent = Math.round(((random() - 0.46) * 5) * 100) / 100; // about -2.3%…+2.7%
  const previousClose = Math.round((anchorPrice / (1 + changePercent / 100)) * 100) / 100;
  const open = Math.round(previousClose * (1 + (random() - 0.5) * 0.006) * 100) / 100;
  const high = Math.round(Math.max(open, anchorPrice) * (1 + random() * 0.008) * 100) / 100;
  const low = Math.round(Math.min(open, anchorPrice) * (1 - random() * 0.008) * 100) / 100;
  const sparkline = simulateDailySeries(entry.symbol, anchorPrice, 24, now).map((point) => point.c);

  return {
    symbol: entry.symbol,
    company_name: entry.company_name,
    sector: entry.sector,
    price: anchorPrice,
    previous_close: previousClose,
    open,
    high,
    low,
    volume: Math.round(250_000 + random() * 40_000_000),
    change: Math.round((anchorPrice - previousClose) * 100) / 100,
    change_percent: changePercent,
    sparkline,
    source: "simulated",
    as_of: null
  };
}

type StoredQuoteLike = Pick<StockQuote, "symbol" | "company_name" | "sector" | "price_per_share">;

function catalogFor(stored: StoredQuoteLike[]): { entry: StockCatalogEntry; anchor: number }[] {
  if (stored.length) {
    return stored.map((quote) => {
      const known = catalogEntry(quote.symbol);
      const entry: StockCatalogEntry = known || {
        symbol: quote.symbol,
        company_name: quote.company_name,
        sector: quote.sector,
        seed_price: Number(quote.price_per_share) || 1
      };
      // Company name / sector from the code catalog wins for the renamed
      // listings (e.g. NWSA "Barron's") on databases seeded earlier.
      return { entry, anchor: Number(quote.price_per_share) || entry.seed_price };
    });
  }
  return STOCK_CATALOG.map((entry) => ({ entry, anchor: entry.seed_price }));
}

/**
 * Live (delayed) quotes for the catalog, merged over the stored database
 * quotes. Symbols the feed does not answer for fall back individually to a
 * labelled simulated quote.
 */
export async function getLiveQuotes(stored: StoredQuoteLike[]): Promise<{ quotes: LiveQuote[]; source: MarketDataSource; fetched_at: string }> {
  const items = catalogFor(stored);
  const cacheKey = items.map((item) => item.entry.symbol).sort().join(",");
  const cached = quoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return {
      quotes: cached.value,
      source: cached.value.some((quote) => quote.source === "live") ? "live" : "simulated",
      fetched_at: new Date().toISOString()
    };
  }

  const liveRows = await fetchStooqQuotes(items.map((item) => item.entry.symbol));

  const quotes = await Promise.all(items.map(async ({ entry, anchor }) => {
    const row = liveRows.get(entry.symbol);
    if (!row) return simulateQuote(entry, anchor);

    const history = await fetchDailyHistory(entry.symbol).catch(() => null);
    let previousClose: number | null = null;
    let sparkline: number[] = [];
    if (history && history.length >= 2) {
      const last = history[history.length - 1];
      previousClose = row.date && last.t >= row.date
        ? history[history.length - 2].c
        : last.c;
      sparkline = history.slice(-24).map((point) => point.c);
      if (sparkline[sparkline.length - 1] !== row.close) sparkline.push(row.close);
    } else {
      previousClose = row.open;
      sparkline = simulateDailySeries(entry.symbol, row.close, 24).map((point) => point.c);
    }

    const change = previousClose ? Math.round((row.close - previousClose) * 100) / 100 : 0;
    const changePercent = previousClose
      ? Math.round(((row.close - previousClose) / previousClose) * 10_000) / 100
      : 0;

    const quote: LiveQuote = {
      symbol: entry.symbol,
      company_name: entry.company_name,
      sector: entry.sector,
      price: row.close,
      previous_close: previousClose,
      open: row.open,
      high: row.high,
      low: row.low,
      volume: row.volume,
      change,
      change_percent: changePercent,
      sparkline,
      source: "live",
      as_of: row.date ? `${row.date}T${row.time || "00:00:00"}` : null
    };
    return quote;
  }));

  quoteCache.set(cacheKey, { value: quotes, expiresAt: Date.now() + QUOTE_CACHE_MS });
  return {
    quotes,
    source: quotes.some((quote) => quote.source === "live") ? "live" : "simulated",
    fetched_at: new Date().toISOString()
  };
}

/** Daily price history for the chart, down-sampled to a drawable size. */
export async function getPriceHistory(
  symbol: string,
  range: HistoryRange,
  anchorPrice: number
): Promise<{ points: PricePoint[]; source: MarketDataSource }> {
  const wanted = RANGE_TRADING_DAYS[range];
  const history = await fetchDailyHistory(symbol).catch(() => null);

  if (history && history.length >= 2) {
    let points = history.slice(-wanted);
    const maxPoints = 400;
    if (points.length > maxPoints) {
      const step = Math.ceil(points.length / maxPoints);
      points = points.filter((_, index) => index % step === 0 || index === points.length - 1);
    }
    return { points, source: "live" };
  }

  return { points: simulateDailySeries(symbol, anchorPrice, wanted), source: "simulated" };
}

type SupabaseLike = {
  from(table: string): {
    update(values: Record<string, unknown>): { eq(column: string, value: string): PromiseLike<{ error: unknown }> };
  };
};

/**
 * Copy the freshest feed price into `stock_quotes` so the atomic buy/sell
 * RPCs execute at the current market price. Best-effort: any failure leaves
 * the previously stored quote in place and the trade still goes through the
 * same balance checks. Returns the refreshed price when one was stored.
 */
export async function refreshStoredQuote(supabase: SupabaseLike, symbol: string): Promise<number | null> {
  try {
    const entry = catalogEntry(symbol);
    if (!entry || feedDisabled()) return null;
    const rows = await fetchStooqQuotes([symbol]);
    const row = rows.get(symbol.toUpperCase());
    if (!row || row.close <= 0) return null;

    const { error } = await supabase
      .from("stock_quotes")
      .update({ price_per_share: row.close, updated_at: new Date().toISOString() })
      .eq("symbol", symbol.toUpperCase());
    if (error) return null;
    return row.close;
  } catch {
    return null;
  }
}
