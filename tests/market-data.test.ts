import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLiveQuotes,
  parseStooqHistoryCsv,
  parseStooqQuotesCsv,
  refreshStoredQuote,
  simulateQuote,
  toStooqSymbol
} from "@/lib/market-data";
import { STOCK_CATALOG, catalogEntry } from "@/lib/stock-catalog";

const originalSource = process.env.STOCK_DATA_SOURCE;

afterEach(() => {
  if (originalSource === undefined) delete process.env.STOCK_DATA_SOURCE;
  else process.env.STOCK_DATA_SOURCE = originalSource;
  vi.unstubAllGlobals();
});

describe("Stooq symbol and CSV parsing", () => {
  it("maps app tickers to Stooq symbols, including Berkshire Hathaway", () => {
    expect(toStooqSymbol("AAPL")).toBe("aapl.us");
    expect(toStooqSymbol("BRK.B")).toBe("brk-b.us");
    expect(toStooqSymbol("djt")).toBe("djt.us");
  });

  it("parses bulk quotes and drops unavailable rows", () => {
    const rows = parseStooqQuotesCsv([
      "Symbol,Date,Time,Open,High,Low,Close,Volume",
      "AAPL.US,2026-02-13,16:00:00,228.10,233.00,227.50,231.25,51234567",
      "BRK-B.US,2026-02-13,16:00:00,480.00,490.00,478.00,486.50,2345678",
      "NWSA.US,N/D,N/D,N/D,N/D,N/D,N/D,N/D"
    ].join("\n"));

    expect(rows).toEqual([
      {
        symbol: "AAPL",
        date: "2026-02-13",
        time: "16:00:00",
        open: 228.1,
        high: 233,
        low: 227.5,
        close: 231.25,
        volume: 51234567
      },
      {
        symbol: "BRK.B",
        date: "2026-02-13",
        time: "16:00:00",
        open: 480,
        high: 490,
        low: 478,
        close: 486.5,
        volume: 2345678
      }
    ]);
  });

  it("parses daily history into chart points", () => {
    expect(parseStooqHistoryCsv([
      "Date,Open,High,Low,Close,Volume",
      "2026-02-12,18.00,19.00,17.80,18.75,1200000",
      "2026-02-13,18.80,20.00,18.60,19.40,1500000",
      "2026-02-14,N/D,N/D,N/D,N/D,N/D"
    ].join("\n"))).toEqual([
      { t: "2026-02-12", c: 18.75, o: 18, h: 19, l: 17.8, v: 1200000 },
      { t: "2026-02-13", c: 19.4, o: 18.8, h: 20, l: 18.6, v: 1500000 }
    ]);
  });
});

describe("simulated market fallback", () => {
  it("creates a stable labelled simulated quote around the stored price", () => {
    const entry = catalogEntry("NWSA");
    expect(entry).toBeDefined();

    const first = simulateQuote(entry!, 28, new Date("2026-02-13T15:00:00Z"));
    const second = simulateQuote(entry!, 28, new Date("2026-02-13T18:00:00Z"));

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      symbol: "NWSA",
      company_name: "News Corp — Barron's / Dow Jones",
      price: 28,
      source: "simulated",
      as_of: null
    });
    expect(first.sparkline).toHaveLength(24);
    expect(first.sparkline[first.sparkline.length - 1]).toBe(28);
  });

  it("returns simulated quotes when STOCK_DATA_SOURCE disables the feed", async () => {
    process.env.STOCK_DATA_SOURCE = "simulated";

    const result = await getLiveQuotes([
      { symbol: "DJT", company_name: "Trump Media & Technology Group", sector: "Media & Entertainment", price_per_share: 18.5 }
    ]);

    expect(result.source).toBe("simulated");
    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0]).toMatchObject({ symbol: "DJT", price: 18.5, source: "simulated" });
  });

  it("does not touch stored quotes when the feed is forced to simulated mode", async () => {
    process.env.STOCK_DATA_SOURCE = "simulated";
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    const supabase = { from: vi.fn(() => ({ update })) };

    await expect(refreshStoredQuote(supabase, "AAPL")).resolves.toBeNull();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});

describe("stock catalog and database seed sync", () => {
  it("includes Apple, Trump Media, Barron's owner, and Berkshire Hathaway", () => {
    expect(catalogEntry("AAPL")?.company_name).toContain("Apple");
    expect(catalogEntry("DJT")?.company_name).toContain("Trump Media");
    expect(catalogEntry("NWSA")?.company_name).toContain("Barron's");
    expect(catalogEntry("BRK.B")?.company_name).toContain("Berkshire Hathaway");
  });

  it.each(["supabase/add_stock_trading.sql", "supabase/schema.sql"])(
    "seeds every catalog symbol and installs selling in %s",
    (file) => {
      const sql = readFileSync(join(process.cwd(), file), "utf8");

      for (const entry of STOCK_CATALOG) {
        const escaped = entry.symbol.replace(".", "\\.");
        expect(sql, `${entry.symbol} missing from ${file}`).toMatch(new RegExp(`\\('${escaped}',`));
      }
      expect(sql).toContain("execute_stock_sale");
      expect(sql).toContain("side text not null default 'buy'");
    }
  );
});
