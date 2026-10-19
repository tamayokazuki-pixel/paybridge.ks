export type StockQuote = {
  symbol: string;
  company_name: string;
  sector: string;
  price_per_share: number | string;
  is_active?: boolean;
  updated_at?: string;
};

export type StockTradeSide = "buy" | "sell";

export type StockTrade = {
  id: string;
  symbol: string;
  company_name: string;
  /** Older trade rows predate the `side` column and are always buys. */
  side?: string | null;
  shares: number | string;
  price_per_share: number | string;
  total_amount: number | string;
  created_at: string;
};

export type StockHolding = {
  symbol: string;
  company_name: string;
  shares: number;
  /** Cost basis of the shares still held (average-cost method). */
  total_invested: number;
  average_cost: number;
  reference_price: number;
  reference_value: number;
  unrealized_gain: number;
  unrealized_gain_percent: number;
  /** Profit locked in by past sales of this symbol. */
  realized_gain: number;
};

export type PricePoint = {
  /** ISO date (daily history) or time label (intraday flow). */
  t: string;
  c: number;
  o?: number;
  h?: number;
  l?: number;
  v?: number;
};

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundShares(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

export function tradeSide(trade: StockTrade): StockTradeSide {
  return String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy";
}

/**
 * Aggregate immutable buy/sell records into the user's current positions
 * using the average-cost method: a sale removes shares at the average cost
 * paid so far and books the difference to proceeds as realized gain.
 * Returns every symbol ever traded (fully sold positions have 0 shares) so
 * callers can still total realized gains; filter `shares > 0` for open ones.
 */
export function aggregateStockTrades(trades: StockTrade[], quotes: StockQuote[]): StockHolding[] {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, Number(quote.price_per_share)]));
  const holdings = new Map<string, {
    company_name: string;
    shares: number;
    cost_basis: number;
    realized_gain: number;
  }>();

  // Average cost depends on order, so always walk chronologically even
  // though the dashboard query returns newest first.
  const chronological = [...trades].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
  );

  for (const trade of chronological) {
    const shares = Number(trade.shares);
    const totalAmount = Number(trade.total_amount);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(totalAmount) || totalAmount < 0) continue;

    const holding = holdings.get(trade.symbol) || {
      company_name: trade.company_name,
      shares: 0,
      cost_basis: 0,
      realized_gain: 0
    };

    if (tradeSide(trade) === "sell") {
      const soldShares = Math.min(shares, holding.shares);
      const averageCost = holding.shares > 0 ? holding.cost_basis / holding.shares : 0;
      const costRemoved = averageCost * soldShares;
      // Pro-rate the recorded proceeds if a legacy row somehow sells more
      // shares than were held, so the books never go negative.
      const proceeds = shares > 0 ? totalAmount * (soldShares / shares) : 0;
      holding.realized_gain += proceeds - costRemoved;
      holding.cost_basis -= costRemoved;
      holding.shares -= soldShares;
      if (holding.shares < 0.00005) {
        holding.shares = 0;
        holding.cost_basis = 0;
      }
    } else {
      holding.shares += shares;
      holding.cost_basis += totalAmount;
    }
    holdings.set(trade.symbol, holding);
  }

  return [...holdings.entries()]
    .map(([symbol, holding]) => {
      const shares = roundShares(holding.shares);
      const averageCost = shares > 0 ? holding.cost_basis / shares : 0;
      const referencePrice = quoteBySymbol.get(symbol) ?? averageCost;
      const referenceValue = shares * referencePrice;
      const unrealizedGain = referenceValue - holding.cost_basis;
      return {
        symbol,
        company_name: holding.company_name,
        shares,
        total_invested: roundCurrency(holding.cost_basis),
        average_cost: roundCurrency(averageCost),
        reference_price: referencePrice,
        reference_value: roundCurrency(referenceValue),
        unrealized_gain: roundCurrency(unrealizedGain),
        unrealized_gain_percent: holding.cost_basis > 0
          ? Math.round((unrealizedGain / holding.cost_basis) * 10_000) / 100
          : 0,
        realized_gain: roundCurrency(holding.realized_gain)
      };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function formatShares(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatPercent(value: number) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/* ------------------------------------------------------------------ */
/* Deterministic pseudo-random helpers. The same seed always produces */
/* the same series, so simulated charts are stable between refreshes */
/* and identical for every user looking at the same day.              */
/* ------------------------------------------------------------------ */

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A simulated daily-close series that ends exactly at `endPrice`.
 * Used only when the real market feed is unreachable, and always
 * labelled "simulated" in the UI.
 */
export function simulateDailySeries(symbol: string, endPrice: number, points: number, endDate = new Date()): PricePoint[] {
  const count = Math.max(2, Math.min(points, 1500));
  const random = mulberry32(hashSeed(`${symbol}-daily`));
  const closes: number[] = [];
  let value = endPrice * (0.82 + random() * 0.3);

  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    const driftTarget = value + (endPrice - value) * (0.04 + progress * 0.05);
    const shock = (random() - 0.48) * endPrice * 0.018;
    value = Math.max(0.5, driftTarget + shock);
    closes.push(value);
  }
  closes[count - 1] = endPrice;

  // Walk backwards over weekdays so the x-axis looks like trading days.
  const days: Date[] = [];
  const cursor = new Date(endDate);
  while (days.length < count) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days.unshift(new Date(cursor));
    cursor.setDate(cursor.getDate() - 1);
  }

  return closes.map((close, index) => ({
    t: days[index].toISOString().slice(0, 10),
    c: roundCurrency(close)
  }));
}

/**
 * A simulated intraday "live flow" series from the day's open to the latest
 * price. Seeded per symbol + day so it does not jump around on re-render.
 */
export function generateIntradaySeries(
  symbol: string,
  openPrice: number,
  currentPrice: number,
  points = 48,
  daySeed = new Date().toISOString().slice(0, 10)
): PricePoint[] {
  const count = Math.max(2, Math.min(points, 200));
  const random = mulberry32(hashSeed(`${symbol}-intraday-${daySeed}`));
  const series: PricePoint[] = [];
  // US market opens 09:30; 5-minute steps give a natural time axis.
  const startMinutes = 9 * 60 + 30;

  for (let index = 0; index < count; index += 1) {
    const progress = index / (count - 1);
    const trend = openPrice + (currentPrice - openPrice) * progress;
    const wiggle = (random() - 0.5) * currentPrice * 0.004 * Math.sin(progress * Math.PI);
    const close = index === count - 1 ? currentPrice : Math.max(0.01, trend + wiggle);
    const minutes = startMinutes + index * 5;
    const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
    const mm = String(minutes % 60).padStart(2, "0");
    series.push({ t: `${hh}:${mm}`, c: roundCurrency(close) });
  }
  return series;
}
