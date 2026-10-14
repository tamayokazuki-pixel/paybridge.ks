export type StockQuote = {
  symbol: string;
  company_name: string;
  sector: string;
  price_per_share: number | string;
  is_active?: boolean;
  updated_at?: string;
};

export type StockTrade = {
  id: string;
  symbol: string;
  company_name: string;
  shares: number | string;
  price_per_share: number | string;
  total_amount: number | string;
  created_at: string;
};

export type StockHolding = {
  symbol: string;
  company_name: string;
  shares: number;
  total_invested: number;
  average_cost: number;
  reference_price: number;
  reference_value: number;
};

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Aggregate immutable buy records into the user's current positions. */
export function aggregateStockTrades(trades: StockTrade[], quotes: StockQuote[]): StockHolding[] {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, Number(quote.price_per_share)]));
  const holdings = new Map<string, { company_name: string; shares: number; total_invested: number }>();

  for (const trade of trades) {
    const shares = Number(trade.shares);
    const totalInvested = Number(trade.total_amount);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(totalInvested) || totalInvested < 0) continue;

    const holding = holdings.get(trade.symbol) || {
      company_name: trade.company_name,
      shares: 0,
      total_invested: 0
    };
    holding.shares += shares;
    holding.total_invested += totalInvested;
    holdings.set(trade.symbol, holding);
  }

  return [...holdings.entries()]
    .map(([symbol, holding]) => {
      const averageCost = holding.shares > 0 ? holding.total_invested / holding.shares : 0;
      const referencePrice = quoteBySymbol.get(symbol) ?? averageCost;
      return {
        symbol,
        company_name: holding.company_name,
        shares: holding.shares,
        total_invested: roundCurrency(holding.total_invested),
        average_cost: roundCurrency(averageCost),
        reference_price: referencePrice,
        reference_value: roundCurrency(holding.shares * referencePrice)
      };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function formatShares(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
