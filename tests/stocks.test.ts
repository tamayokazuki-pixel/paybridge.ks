import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

import { POST } from "@/app/api/stocks/buy/route";
import { availableBalance } from "@/lib/balance";
import { aggregateStockTrades, type StockQuote, type StockTrade } from "@/lib/stocks";

const user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "jane@example.org" };
const userId = user.id;

function makeClient() {
  const db = {
    accountStatus: "active" as string | null,
    from: vi.fn(),
    rpc: vi.fn().mockResolvedValue({
      data: {
        id: "trade-1",
        transaction_id: "transaction-1",
        symbol: "AAPL",
        company_name: "Apple Inc.",
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
      reference_value: 385
    }]);
  });

  it("debits completed stock purchases as withdrawals from available cash", () => {
    expect(availableBalance([
      { type: "deposit", status: "completed", amount: 500 },
      { type: "withdrawal", status: "pending", amount: 100 },
      { type: "withdrawal", status: "completed", amount: 55 }
    ])).toBe(345);
  });
});
