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
  shares: number | string;
  price_per_share: number | string;
  total_amount: number | string;
  created_at: string;
  side?: StockTradeSide | string | null;
};

export type StockHolding = {
  symbol: string;
  company_name: string;
  shares: number;
  total_invested: number;
  average_cost: number;
  reference_price: number;
  reference_value: number;
  unrealized_gain_loss: number;
  unrealized_gain_loss_percent: number;
};

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundShares(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function tradeTime(trade: StockTrade) {
  const timestamp = Date.parse(trade.created_at);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Aggregate buy/sell records into current positions using average cost.
 *
 * Sales do not rewrite earlier buy rows. A sale removes shares and removes
 * the same proportion of the position's remaining cost basis.
 */
export function aggregateStockTrades(trades: StockTrade[], quotes: StockQuote[]): StockHolding[] {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol, Number(quote.price_per_share)]));
  const holdings = new Map<string, { company_name: string; shares: number; total_invested: number }>();
  const chronologicalTrades = [...trades].sort((left, right) => {
    const timeDifference = tradeTime(left) - tradeTime(right);
    return timeDifference !== 0 ? timeDifference : left.id.localeCompare(right.id);
  });

  for (const trade of chronologicalTrades) {
    const shares = Number(trade.shares);
    const totalAmount = Number(trade.total_amount);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(totalAmount) || totalAmount < 0) continue;

    const holding = holdings.get(trade.symbol) || {
      company_name: trade.company_name,
      shares: 0,
      total_invested: 0
    };
    holding.company_name = trade.company_name || holding.company_name;

    if (String(trade.side || "buy").toLowerCase() === "sell") {
      if (holding.shares > 0) {
        const soldShares = Math.min(shares, holding.shares);
        const averageCost = holding.total_invested / holding.shares;
        holding.shares = roundShares(holding.shares - soldShares);
        holding.total_invested = holding.shares > 0
          ? Math.max(0, holding.total_invested - averageCost * soldShares)
          : 0;
      }
    } else {
      holding.shares = roundShares(holding.shares + shares);
      holding.total_invested += totalAmount;
    }

    holdings.set(trade.symbol, holding);
  }

  return [...holdings.entries()]
    .filter(([, holding]) => holding.shares > 0.00005)
    .map(([symbol, holding]) => {
      const averageCost = holding.shares > 0 ? holding.total_invested / holding.shares : 0;
      const referencePrice = quoteBySymbol.get(symbol) ?? averageCost;
      const referenceValue = holding.shares * referencePrice;
      const unrealizedGainLoss = referenceValue - holding.total_invested;
      return {
        symbol,
        company_name: holding.company_name,
        shares: roundShares(holding.shares),
        total_invested: roundCurrency(holding.total_invested),
        average_cost: roundCurrency(averageCost),
        reference_price: referencePrice,
        reference_value: roundCurrency(referenceValue),
        unrealized_gain_loss: roundCurrency(unrealizedGainLoss),
        unrealized_gain_loss_percent: holding.total_invested > 0
          ? roundCurrency((unrealizedGainLoss / holding.total_invested) * 100)
          : 0
      };
    })
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

export function formatShares(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
