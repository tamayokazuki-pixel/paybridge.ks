import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getAdminUser: vi.fn(),
  createSupabaseAdminClient: vi.fn()
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUser,
  getAdminUser: mocks.getAdminUser
}));
vi.mock("@/lib/supabase-server", () => ({
  createSupabaseAdminClient: mocks.createSupabaseAdminClient
}));

import { POST as createTransaction } from "@/app/api/admin/transactions/create/route";
import { POST as backdateTransaction } from "@/app/api/admin/transactions/backdate/route";
import { POST as approveTransaction } from "@/app/api/admin/transactions/approve/route";
import { availableBalance } from "@/lib/balance";
import {
  adminAmountSchema,
  parseTransactionTimestamp,
  toLocalDateTimeInputValue
} from "@/lib/transactions";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const adminId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const missingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const admin = { id: adminId };

type Row = Record<string, unknown>;

function makeFakeSupabase() {
  const rows: Record<string, Row[]> = {
    users: [{ id: userId, status: "active", full_name: "Jane Doe", account_id: "PB100001" }],
    payment_methods: [{ key: "wire", label: "Wire Transfer (SWIFT)", is_active: true }],
    transactions: [],
    stock_trades: [],
    activity_logs: []
  };

  let legacyStatusOnly = false;
  const missingColumns = new Set<string>(["profile_id"]);

  function from(table: string) {
    const entries = rows[table];
    if (!entries) throw new Error(`Unknown table: ${table}`);

    return {
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const match = () =>
          entries.filter((entry) => filters.every(([key, value]) => entry[key] === value));
        const query = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          maybeSingle: async () => ({ data: match()[0] || null, error: null }),
          then: (resolve: (result: unknown) => void) =>
            Promise.resolve({ data: match(), error: null }).then(resolve)
        };
        return query;
      },
      insert: (payload: Row) => {
        const exec = () => {
          if (table === "transactions") {
            for (const col of missingColumns) {
              if (col in payload) {
                return {
                  data: null,
                  error: {
                    code: "PGRST204",
                    message: `Could not find the '${col}' column of 'transactions' in the schema cache`
                  }
                };
              }
            }
            if (legacyStatusOnly && payload.status === "rejected") {
              return {
                data: null,
                error: {
                  code: "23514",
                  message:
                    'new row for relation "transactions" violates check constraint "transactions_status_check"'
                }
              };
            }
          }
          const created: Row = {
            ...payload,
            id: payload.id || randomUUID(),
            created_at: payload.created_at || new Date().toISOString()
          };
          entries.push(created);
          return { data: created, error: null };
        };

        return {
          select: () => ({ single: async () => exec() }),
          then: (resolve: (result: unknown) => void) => Promise.resolve(exec()).then(resolve)
        };
      },
      update: (fields: Row) => {
        const filters: Array<[string, unknown]> = [];
        const applyUpdate = () => {
          if (table === "transactions") {
            for (const col of missingColumns) {
              if (col in fields) {
                return {
                  data: null,
                  error: {
                    code: "PGRST204",
                    message: `Could not find the '${col}' column of 'transactions' in the schema cache`
                  }
                };
              }
            }
          }
          const matched = entries.filter((item) =>
            filters.every(([key, value]) => item[key] === value)
          );
          if (!matched.length) {
            return { data: null, error: { code: "PGRST116", message: "No row" } };
          }
          for (const item of matched) {
            Object.assign(item, fields);
          }
          return { data: matched[0], error: null };
        };

        const query = {
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          select: () => ({
            single: async () => applyUpdate()
          }),
          then: (resolve: (result: unknown) => void) =>
            Promise.resolve({ error: applyUpdate().error }).then(resolve)
        };
        return query;
      }
    };
  }

  return {
    client: { from },
    rows,
    enableLegacyStatusConstraint: () => {
      legacyStatusOnly = true;
    },
    dropColumn: (col: string) => {
      missingColumns.add(col);
    }
  };
}

function jsonPost(url: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

let db: ReturnType<typeof makeFakeSupabase>;

beforeEach(() => {
  db = makeFakeSupabase();
  mocks.createSupabaseAdminClient.mockReturnValue(db.client);
  mocks.getAdminUser.mockResolvedValue(admin);
  mocks.getCurrentUser.mockResolvedValue(admin);
});

describe("timestamp and amount validation helpers", () => {
  it("parses past, present, and future dates & times while rejecting impossible calendar dates", () => {
    expect(parseTransactionTimestamp("2023-05-14T09:30:00.000Z")).toEqual({
      ok: true,
      iso: "2023-05-14T09:30:00.000Z"
    });
    expect(parseTransactionTimestamp("2028-11-20T18:45:00+01:00")).toEqual({
      ok: true,
      iso: "2028-11-20T17:45:00.000Z"
    });
    expect(parseTransactionTimestamp("2024-02-29T12:00:00Z")).toEqual({
      ok: true,
      iso: "2024-02-29T12:00:00.000Z"
    });
    expect(parseTransactionTimestamp("2022-08-01")).toEqual({
      ok: true,
      iso: "2022-08-01T00:00:00.000Z"
    });

    // Reject impossible calendar dates (no silent JS Date rollover)
    expect(parseTransactionTimestamp("2025-02-29T12:00:00Z").ok).toBe(false);
    expect(parseTransactionTimestamp("2024-02-31T12:00:00Z").ok).toBe(false);
    expect(parseTransactionTimestamp("2026-04-31T08:00:00Z").ok).toBe(false);
    expect(parseTransactionTimestamp("2026-13-01T08:00:00Z").ok).toBe(false);
    expect(parseTransactionTimestamp("2026-05-10T25:00:00Z").ok).toBe(false);
    expect(parseTransactionTimestamp("1965-01-01T00:00:00Z").ok).toBe(false);
    expect(parseTransactionTimestamp("not-a-date").ok).toBe(false);
  });

  it("formats local datetime-local values and validates cent-precise amounts", () => {
    const sample = new Date(2025, 9, 5, 14, 7, 0);
    expect(toLocalDateTimeInputValue(sample)).toBe("2025-10-05T14:07");
    expect(toLocalDateTimeInputValue("invalid")).toBe("");

    expect(adminAmountSchema.parse(0.01)).toBe(0.01);
    expect(adminAmountSchema.parse(2500.75)).toBe(2500.75);
    expect(adminAmountSchema.safeParse(0).success).toBe(false);
    expect(adminAmountSchema.safeParse(-5).success).toBe(false);
    expect(adminAmountSchema.safeParse(12.345).success).toBe(false);
  });
});

describe("POST /api/admin/transactions/create", () => {
  const endpoint = "http://localhost:3000/api/admin/transactions/create";

  it("requires verified admin authorization", async () => {
    mocks.getAdminUser.mockResolvedValueOnce(null);
    const res = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "deposit",
        status: "completed",
        amount: 500,
        description: "Historical wire deposit",
        transactionDate: "2024-03-15T10:30:00.000Z"
      })
    );
    expect(res.status).toBe(403);
    expect(db.rows.transactions).toHaveLength(0);
  });

  it("creates backdated and custom-dated transactions, updates balance, and writes an audit log", async () => {
    const backdatedIso = "2024-03-15T10:30:00.000Z";
    const res = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "deposit",
        status: "completed",
        amount: 1250.5,
        methodKey: "wire",
        description: "Backdated wire credit",
        reference: "WIRE-2024-001",
        adminNote: "Imported historical wire",
        transactionDate: backdatedIso
      })
    );

    expect(res.status).toBe(201);
    const { transaction } = await res.json();
    expect(transaction).toMatchObject({
      user_id: userId,
      type: "deposit",
      status: "completed",
      amount: 1250.5,
      method_key: "wire",
      method_label: "Wire Transfer (SWIFT)",
      description: "Backdated wire credit",
      reference: "WIRE-2024-001",
      admin_note: "Imported historical wire",
      created_at: backdatedIso,
      completed_at: backdatedIso
    });
    expect(availableBalance(db.rows.transactions as Array<{ type: string; status: string; amount: number }>)).toBe(1250.5);
    expect(db.rows.activity_logs).toHaveLength(1);
    expect(db.rows.activity_logs[0]).toMatchObject({
      actor_id: adminId,
      user_id: userId,
      action: "transaction_created"
    });

    // Supports future custom date & time as well
    const futureRes = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "admin_adjustment",
        status: "pending",
        amount: 75,
        description: "Scheduled promotional credit",
        transactionDate: "2027-06-01T08:00:00.000Z"
      })
    );
    expect(futureRes.status).toBe(201);
    const futurePayload = await futureRes.json();
    expect(futurePayload.transaction).toMatchObject({
      created_at: "2027-06-01T08:00:00.000Z",
      completed_at: null,
      method_key: "admin",
      method_label: "Admin Adjustment"
    });
  });

  it("enforces available balance for pending/completed debits and blocks pending debits on suspended accounts", async () => {
    db.rows.transactions.push({
      id: randomUUID(),
      user_id: userId,
      type: "deposit",
      status: "completed",
      amount: 300,
      created_at: "2025-01-01T00:00:00.000Z"
    });

    // Overdraft rejected
    const overdraft = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "withdrawal",
        status: "completed",
        amount: 400,
        description: "Backdated wire withdrawal",
        transactionDate: "2025-02-01T12:00:00.000Z"
      })
    );
    expect(overdraft.status).toBe(400);
    expect((await overdraft.json()).error).toContain("Insufficient available balance");

    // Rejected withdrawal does not consume balance, so it succeeds even above balance
    const rejectedWithdrawal = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "withdrawal",
        status: "rejected",
        amount: 400,
        description: "Historical declined withdrawal",
        transactionDate: "2025-02-01T12:00:00.000Z"
      })
    );
    expect(rejectedWithdrawal.status).toBe(201);

    // Valid completed withdrawal within available balance succeeds
    const validWithdrawal = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "transfer",
        status: "completed",
        amount: 120.25,
        description: "Historical outgoing transfer",
        transactionDate: "2025-02-05T15:00:00.000Z"
      })
    );
    expect(validWithdrawal.status).toBe(201);
    expect(availableBalance(db.rows.transactions as Array<{ type: string; status: string; amount: number }>)).toBe(179.75);

    // Suspended user cannot have a pending withdrawal created
    db.rows.users[0].status = "suspended";
    const suspendedPending = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "withdrawal",
        status: "pending",
        amount: 50,
        description: "Pending hold on suspended user",
        transactionDate: "2025-03-01T10:00:00.000Z"
      })
    );
    expect(suspendedPending.status).toBe(400);
  });

  it("rejects cheque method key, invalid timestamps, and unknown users, and handles legacy DB quirks", async () => {
    expect(
      (
        await createTransaction(
          jsonPost(endpoint, {
            userId,
            type: "deposit",
            status: "completed",
            amount: 100,
            methodKey: "cheque",
            description: "Cheque without scan",
            transactionDate: "2025-01-01T10:00:00.000Z"
          })
        )
      ).status
    ).toBe(400);

    expect(
      (
        await createTransaction(
          jsonPost(endpoint, {
            userId: missingId,
            type: "deposit",
            status: "completed",
            amount: 100,
            description: "Missing user",
            transactionDate: "2025-01-01T10:00:00.000Z"
          })
        )
      ).status
    ).toBe(404);

    // Legacy DB missing completed_at and using 'failed' instead of 'rejected'
    db.dropColumn("completed_at");
    db.enableLegacyStatusConstraint();
    const legacyRes = await createTransaction(
      jsonPost(endpoint, {
        userId,
        type: "deposit",
        status: "rejected",
        amount: 80,
        description: "Legacy rejected deposit",
        transactionDate: "2024-07-10T11:20:00.000Z"
      })
    );
    expect(legacyRes.status).toBe(201);
    const legacyPayload = await legacyRes.json();
    expect(legacyPayload.legacyStatus).toBe(true);
    expect(legacyPayload.transaction).toMatchObject({
      status: "failed",
      created_at: "2024-07-10T11:20:00.000Z"
    });
  });
});

describe("POST /api/admin/transactions/backdate and custom-date approval", () => {
  const backdateEndpoint = "http://localhost:3000/api/admin/transactions/backdate";
  const approveEndpoint = "http://localhost:3000/api/admin/transactions/approve";

  it("requires admin authorization and returns 404 for unknown transactions", async () => {
    mocks.getAdminUser.mockResolvedValueOnce(null);
    expect(
      (
        await backdateTransaction(
          jsonPost(backdateEndpoint, {
            transactionId: missingId,
            transactionDate: "2024-06-01T10:00:00.000Z"
          })
        )
      ).status
    ).toBe(403);

    expect(
      (
        await backdateTransaction(
          jsonPost(backdateEndpoint, {
            transactionId: missingId,
            transactionDate: "2024-06-01T10:00:00.000Z"
          })
        )
      ).status
    ).toBe(404);
  });

  it("updates created_at (and completed_at for finalized rows), syncs stock_trades, and logs audit history", async () => {
    const pendingId = randomUUID();
    const stockTxnId = randomUUID();
    db.rows.transactions.push(
      {
        id: pendingId,
        user_id: userId,
        type: "deposit",
        status: "pending",
        amount: 200,
        description: "Pending wire",
        admin_note: "Keep me",
        created_at: "2026-11-01T10:00:00.000Z",
        completed_at: null
      },
      {
        id: stockTxnId,
        user_id: userId,
        type: "withdrawal",
        status: "completed",
        method_key: "stocks",
        amount: 462,
        description: "Stock purchase: 2 shares of Apple Inc. (AAPL)",
        created_at: "2026-11-02T14:00:00.000Z",
        completed_at: "2026-11-02T14:00:00.000Z"
      }
    );
    db.rows.stock_trades.push({
      id: randomUUID(),
      user_id: userId,
      transaction_id: stockTxnId,
      symbol: "AAPL",
      shares: 2,
      created_at: "2026-11-02T14:00:00.000Z"
    });

    // Backdate pending transaction (keeps completed_at null and preserves existing admin_note when omitted)
    const pendingRes = await backdateTransaction(
      jsonPost(backdateEndpoint, {
        transactionId: pendingId,
        transactionDate: "2025-09-10T08:15:00.000Z"
      })
    );
    expect(pendingRes.status).toBe(200);
    expect(db.rows.transactions[0]).toMatchObject({
      created_at: "2025-09-10T08:15:00.000Z",
      completed_at: null,
      admin_note: "Keep me"
    });

    // Backdate completed stock transaction (updates created_at, completed_at, admin_note, and stock_trades.created_at)
    const stockRes = await backdateTransaction(
      jsonPost(backdateEndpoint, {
        transactionId: stockTxnId,
        transactionDate: "2025-04-22T16:40:00.000Z",
        adminNote: "Aligned with trade settlement statement"
      })
    );
    expect(stockRes.status).toBe(200);
    expect(db.rows.transactions[1]).toMatchObject({
      created_at: "2025-04-22T16:40:00.000Z",
      completed_at: "2025-04-22T16:40:00.000Z",
      admin_note: "Aligned with trade settlement statement"
    });
    expect(db.rows.stock_trades[0].created_at).toBe("2025-04-22T16:40:00.000Z");
    expect(db.rows.activity_logs).toHaveLength(2);
    expect(db.rows.activity_logs[1]).toMatchObject({
      actor_id: adminId,
      user_id: userId,
      action: "transaction_backdated"
    });

    // Approve pending transaction with an explicit backdated transactionDate
    const approveRes = await approveTransaction(
      jsonPost(approveEndpoint, {
        transactionId: pendingId,
        reference: "WIRE-CLR-99",
        transactionDate: "2025-09-12T11:00:00.000Z"
      })
    );
    expect(approveRes.status).toBe(200);
    expect(db.rows.transactions[0]).toMatchObject({
      status: "completed",
      reference: "WIRE-CLR-99",
      created_at: "2025-09-12T11:00:00.000Z",
      completed_at: "2025-09-12T11:00:00.000Z"
    });
  });
});
