import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createSupabaseAdminClient: vi.fn(),
  refreshStoredQuote: vi.fn().mockResolvedValue(null)
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));
vi.mock("@/lib/market-data", () => ({ refreshStoredQuote: mocks.refreshStoredQuote }));

import { POST } from "@/app/api/stocks/buy/route";
import { POST as SELL_POST } from "@/app/api/stocks/sell/route";
import { availableBalance } from "@/lib/balance";
import {
  aggregateStockTrades,
  generateIntradaySeries,
  simulateDailySeries,
  tradeSide,
  type StockQuote,
  type StockTrade
} from "@/lib/stocks";

const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "jane@example.org" };
const userId = user.id;

function makeClient() {
  const db = {
    accountStatus: "active" as string | null,
    from: vi.fn(),
    rpc: vi.fn().mockImplementation(async (fnName: string) => fnName === "execute_stock_sale"
      ? {
          data: {
            id: "trade-2",
            transaction_id: "transaction-2",
            symbol: "AAPL",
            company_name: "Apple Inc.",
            side: "sell",
            shares: 0.5,
            price_per_share: 240,
            total_amount: 120,
            available_balance: 620
          },
          error: null
        }
      : {
          data: {
            id: "trade-1",
            transaction_id: "transaction-1",
            symbol: "AAPL",
            company_name: "Apple Inc.",
            side: "buy",
            shares: 1.25,
            price_per_share: 231,
            total_amount: 288.75,
            available_balance: 211.25
          },
          error: null
        })
  };
  db.from.mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: db.accountStatus ? { status: db.accountStatus } : null, error: null })
      })
    })
  }));
  return db;
}

function request(body: unknown) {
  return new Request("http://localhost:3000/api/stocks/buy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

let db: ReturnType<typeof makeClient>;

beforeEach(() => {
  db = makeClient();
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.createSupabaseAdminClient.mockReturnValue(db);
});

describe("stock purchase API", () => {
  it("requires a signed-in user", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const response = await POST(request({ symbol: "AAPL", shares: 1 }));
    expect(response.status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("validates share precision and order size before calling the database", async () => {
    const tooPrecise = await POST(request({ symbol: "AAPL", shares: 1.12345 }));
    expect(tooPrecise.status).toBe(400);
    const tooLarge = await POST(request({ symbol: "AAPL", shares: 1_000_001 }));
    expect(tooLarge.status).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("sends only the authenticated user, ticker, and share count to the atomic purchase RPC", async () => {
    const response = await POST(request({ symbol: " aapl ", shares: 1.25, price: 0.01, user_id: "forged" }));
    expect(response.status).toBe(201);
    expect(db.rpc).toHaveBeenCalledWith("execute_stock_purchase", {
      p_user_id: userId,
      p_symbol: "AAPL",
      p_shares: 1.25
    });
    expect(await response.json()).toMatchObject({ order: { symbol: "AAPL", shares: 1.25, total_amount: 288.75 } });
  });

  it("blocks suspended accounts before they can place a purchase", async () => {
    db.accountStatus = "suspended";
    const response = await POST(request({ symbol: "AAPL", shares: 1 }));
    expect(response.status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns safe errors for unavailable stocks, insufficient cash, and an unapplied migration", async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Stock listing is unavailable." } });
    expect((await POST(request({ symbol: "FAKE", shares: 1 }))).status).toBe(404);

    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Insufficient available balance." } });
    expect((await POST(request({ symbol: "AAPL", shares: 1 }))).status).toBe(400);

    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find function public.execute_stock_purchase." } });
    const notConfigured = await POST(request({ symbol: "AAPL", shares: 1 }));
    expect(notConfigured.status).toBe(503);
    expect((await notConfigured.json()).error).toContain("add_stock_trading.sql");
  });
});

describe("stock ledger calculations", () => {
  it("aggregates fractional purchases into a portfolio position", () => {
    const quotes: StockQuote[] = [{ symbol: "AAPL", company_name: "Apple Inc.", sector: "Technology", price_per_share: 220 }];
    const trades: StockTrade[] = [
      { id: "1", symbol: "AAPL", company_name: "Apple Inc.", shares: 0.5, price_per_share: 200, total_amount: 100, created_at: "2026-01-01" },
      { id: "2", symbol: "AAPL", company_name: "Apple Inc.", shares: 1.25, price_per_share: 200, total_amount: 250, created_at: "2026-01-02" }
    ];

    expect(aggregateStockTrades(trades, quotes)).toEqual([{
      symbol: "AAPL",
      company_name: "Apple Inc.",
      shares: 1.75,
      total_invested: 350,
      average_cost: 200,
      reference_price: 220,
      reference_value: 385,
      unrealized_gain: 35,
      unrealized_gain_percent: 10,
      realized_gain: 0
    }]);
  });

  it("debits completed stock purchases as withdrawals from available cash", () => {
    expect(availableBalance([
      { type: "deposit", status: "completed", amount: 500 },
      { type: "withdrawal", status: "pending", amount: 100 },
      { type: "withdrawal", status: "completed", amount: 55 }
    ])).toBe(345);
  });

  it("credits completed stock-sale proceeds back to available cash", () => {
    // Sales are recorded as completed deposits with method_key = 'stocks'.
    expect(availableBalance([
      { type: "deposit", status: "completed", amount: 500 },
      { type: "withdrawal", status: "completed", amount: 200 },
      { type: "deposit", status: "completed", amount: 120 }
    ])).toBe(420);
  });

  it("nets sells against buys at average cost and books realized gain", () => {
    const quotes: StockQuote[] = [{ symbol: "DJT", company_name: "Trump Media & Technology Group", sector: "Media & Entertainment", price_per_share: 30 }];
    // Deliberately newest-first, as the dashboard query returns them.
    const trades: StockTrade[] = [
      { id: "3", symbol: "DJT", company_name: "Trump Media & Technology Group", side: "sell", shares: 4, price_per_share: 25, total_amount: 100, created_at: "2026-01-03" },
      { id: "2", symbol: "DJT", company_name: "Trump Media & Technology Group", side: "buy", shares: 10, price_per_share: 20, total_amount: 200, created_at: "2026-01-02" },
      { id: "1", symbol: "DJT", company_name: "Trump Media & Technology Group", shares: 10, price_per_share: 10, total_amount: 100, created_at: "2026-01-01" }
    ];

    expect(tradeSide(trades[2])).toBe("buy"); // legacy rows without side are buys
    expect(aggregateStockTrades(trades, quotes)).toEqual([{
      symbol: "DJT",
      company_name: "Trump Media & Technology Group",
      shares: 16,
      total_invested: 240, // 300 cost - 4 shares at 15 average cost
      average_cost: 15,
      reference_price: 30,
      reference_value: 480,
      unrealized_gain: 240,
      unrealized_gain_percent: 100,
      realized_gain: 40 // 100 proceeds - 60 average cost
    }]);
  });

  it("keeps fully sold positions at zero shares with their realized gain", () => {
    const trades: StockTrade[] = [
      { id: "1", symbol: "NWSA", company_name: "News Corp — Barron's / Dow Jones", side: "buy", shares: 2, price_per_share: 28, total_amount: 56, created_at: "2026-01-01" },
      { id: "2", symbol: "NWSA", company_name: "News Corp — Barron's / Dow Jones", side: "sell", shares: 2, price_per_share: 35, total_amount: 70, created_at: "2026-01-05" }
    ];
    const [holding] = aggregateStockTrades(trades, []);
    expect(holding.shares).toBe(0);
    expect(holding.total_invested).toBe(0);
    expect(holding.realized_gain).toBe(14);
  });
});

describe("stock sale API", () => {
  it("requires a signed-in user", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const response = await SELL_POST(request({ symbol: "AAPL", shares: 1 }));
    expect(response.status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("sends only the authenticated user, ticker, and share count to the atomic sale RPC", async () => {
    const response = await SELL_POST(request({ symbol: " brk.b ", shares: 0.5, price: 9999, user_id: "forged" }));
    expect(response.status).toBe(201);
    expect(db.rpc).toHaveBeenCalledWith("execute_stock_sale", {
      p_user_id: userId,
      p_symbol: "BRK.B",
      p_shares: 0.5
    });
    expect(await response.json()).toMatchObject({ order: { side: "sell", total_amount: 120 } });
  });

  it("blocks suspended accounts and validates precision before calling the database", async () => {
    expect((await SELL_POST(request({ symbol: "AAPL", shares: 1.12345 }))).status).toBe(400);

    db.accountStatus = "suspended";
    expect((await SELL_POST(request({ symbol: "AAPL", shares: 1 }))).status).toBe(403);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns safe errors for insufficient shares and an unapplied selling migration", async () => {
    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "Insufficient shares to sell." } });
    expect((await SELL_POST(request({ symbol: "AAPL", shares: 5 }))).status).toBe(400);

    db.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "Could not find function public.execute_stock_sale." } });
    const notConfigured = await SELL_POST(request({ symbol: "AAPL", shares: 1 }));
    expect(notConfigured.status).toBe(503);
    expect((await notConfigured.json()).error).toContain("add_stock_trading.sql");
  });
});

describe("simulated market series", () => {
  it("generates a deterministic daily series ending at the anchor price", () => {
    const first = simulateDailySeries("AAPL", 231, 30, new Date("2026-02-13T12:00:00Z"));
    const second = simulateDailySeries("AAPL", 231, 30, new Date("2026-02-13T12:00:00Z"));
    expect(first).toEqual(second);
    expect(first).toHaveLength(30);
    expect(first[first.length - 1].c).toBe(231);
    // Trading days only: never a Saturday or Sunday.
    for (const point of first) {
      const day = new Date(`${point.t}T12:00:00Z`).getUTCDay();
      expect(day).not.toBe(0);
      expect(day).not.toBe(6);
    }
  });

  it("generates a deterministic intraday flow from open to the latest price", () => {
    const series = generateIntradaySeries("DJT", 18, 19.25, 48, "2026-02-13");
    expect(series).toHaveLength(48);
    expect(series[0].t).toBe("09:30");
    expect(series[series.length - 1].c).toBe(19.25);
    expect(generateIntradaySeries("DJT", 18, 19.25, 48, "2026-02-13")).toEqual(series);
  });
});
