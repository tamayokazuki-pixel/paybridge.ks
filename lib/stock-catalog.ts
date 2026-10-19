/**
 * The tradable catalog. The database seed in `supabase/add_stock_trading.sql`
 * (and `supabase/schema.sql`) must list the same symbols — a unit test checks
 * they stay in sync. `seed_price` is only an illustrative fallback used until
 * the delayed market feed (or the stored database quote) supplies a price.
 */
export type StockCatalogEntry = {
  symbol: string;
  company_name: string;
  sector: string;
  seed_price: number;
  /** Extra words the dashboard search should match, e.g. "trump" or "barron". */
  aliases?: string;
};

export const STOCK_CATALOG: StockCatalogEntry[] = [
  { symbol: "AAPL", company_name: "Apple Inc.", sector: "Technology", seed_price: 231.0, aliases: "apple iphone" },
  { symbol: "DJT", company_name: "Trump Media & Technology Group", sector: "Media & Entertainment", seed_price: 18.5, aliases: "trump truth social" },
  { symbol: "NWSA", company_name: "News Corp — Barron's / Dow Jones", sector: "Media & Entertainment", seed_price: 28.0, aliases: "barron barrons barron's dow jones news" },
  { symbol: "BRK.B", company_name: "Berkshire Hathaway Inc. Class B", sector: "Financials", seed_price: 485.0, aliases: "berkshire buffett" },
  { symbol: "MSFT", company_name: "Microsoft Corporation", sector: "Technology", seed_price: 425.0, aliases: "microsoft" },
  { symbol: "NVDA", company_name: "NVIDIA Corporation", sector: "Semiconductors", seed_price: 141.0, aliases: "nvidia gpu ai" },
  { symbol: "AMZN", company_name: "Amazon.com, Inc.", sector: "Consumer Discretionary", seed_price: 218.0, aliases: "amazon aws" },
  { symbol: "TSLA", company_name: "Tesla, Inc.", sector: "Consumer Discretionary", seed_price: 320.0, aliases: "tesla elon ev" },
  { symbol: "GOOGL", company_name: "Alphabet Inc.", sector: "Communication Services", seed_price: 177.0, aliases: "google alphabet youtube" },
  { symbol: "META", company_name: "Meta Platforms, Inc.", sector: "Communication Services", seed_price: 612.0, aliases: "meta facebook instagram whatsapp" },
  { symbol: "AMD", company_name: "Advanced Micro Devices, Inc.", sector: "Semiconductors", seed_price: 132.0, aliases: "amd" },
  { symbol: "AVGO", company_name: "Broadcom Inc.", sector: "Semiconductors", seed_price: 340.0, aliases: "broadcom" },
  { symbol: "NFLX", company_name: "Netflix, Inc.", sector: "Communication Services", seed_price: 112.0, aliases: "netflix" },
  { symbol: "JPM", company_name: "JPMorgan Chase & Co.", sector: "Financials", seed_price: 295.0, aliases: "jpmorgan chase bank" },
  { symbol: "BAC", company_name: "Bank of America Corporation", sector: "Financials", seed_price: 52.0, aliases: "bank of america" },
  { symbol: "V", company_name: "Visa Inc.", sector: "Financials", seed_price: 340.0, aliases: "visa" },
  { symbol: "MA", company_name: "Mastercard Incorporated", sector: "Financials", seed_price: 540.0, aliases: "mastercard" },
  { symbol: "WMT", company_name: "Walmart Inc.", sector: "Consumer Staples", seed_price: 98.0, aliases: "walmart" },
  { symbol: "COST", company_name: "Costco Wholesale Corporation", sector: "Consumer Staples", seed_price: 920.0, aliases: "costco" },
  { symbol: "HD", company_name: "The Home Depot, Inc.", sector: "Consumer Discretionary", seed_price: 380.0, aliases: "home depot" },
  { symbol: "PG", company_name: "The Procter & Gamble Company", sector: "Consumer Staples", seed_price: 155.0, aliases: "procter gamble p&g" },
  { symbol: "XOM", company_name: "Exxon Mobil Corporation", sector: "Energy", seed_price: 118.0, aliases: "exxon oil" },
  { symbol: "ORCL", company_name: "Oracle Corporation", sector: "Technology", seed_price: 230.0, aliases: "oracle" },
  { symbol: "CRM", company_name: "Salesforce, Inc.", sector: "Technology", seed_price: 260.0, aliases: "salesforce" },
  { symbol: "PLTR", company_name: "Palantir Technologies Inc.", sector: "Technology", seed_price: 160.0, aliases: "palantir" },
  { symbol: "COIN", company_name: "Coinbase Global, Inc.", sector: "Financials", seed_price: 320.0, aliases: "coinbase crypto bitcoin" },
  { symbol: "SPY", company_name: "SPDR S&P 500 ETF Trust", sector: "Index ETF", seed_price: 640.0, aliases: "s&p 500 index etf spy" },
  { symbol: "QQQ", company_name: "Invesco QQQ Trust (Nasdaq-100)", sector: "Index ETF", seed_price: 560.0, aliases: "nasdaq 100 index etf qqq" }
];

/** Symbols pinned to the front of the market watch list. */
export const FEATURED_SYMBOLS = ["AAPL", "DJT", "NWSA", "BRK.B"];

export function catalogEntry(symbol: string): StockCatalogEntry | undefined {
  return STOCK_CATALOG.find((entry) => entry.symbol === symbol.toUpperCase());
}
