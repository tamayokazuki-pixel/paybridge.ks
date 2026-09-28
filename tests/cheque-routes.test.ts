import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  getAdminUser: vi.fn(),
  createSupabaseAdminClient: vi.fn()
}));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.getCurrentUser, getAdminUser: mocks.getAdminUser }));
vi.mock("@/lib/supabase-server", () => ({ createSupabaseAdminClient: mocks.createSupabaseAdminClient }));

import { POST as deposit } from "@/app/api/transactions/cheque/deposit/route";
import { POST as withdraw } from "@/app/api/transactions/cheque/withdraw/route";
import { POST as regularWithdraw } from "@/app/api/transactions/withdraw/route";
import { POST as regularDeposit } from "@/app/api/transactions/deposit/route";
import { GET as images } from "@/app/api/transactions/cheque/[transactionId]/images/route";
import { POST as approve } from "@/app/api/admin/transactions/approve/route";
import { POST as reject } from "@/app/api/admin/transactions/reject/route";

const userId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const strangerId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const adminId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const url = "http://localhost:3000/api/transactions/cheque";
const user = { id: userId, email: "jane@example.org" };
const admin = { id: adminId };

type Row = Record<string, unknown>;

function fakeSupabase() {
  const rows: Record<string, Row[]> = {
    users: [{ id: userId, status: "active" }],
    transactions: [], activity_logs: [], payment_methods: []
  };
  const uploaded: string[] = [];
  const removed: string[][] = [];
  const signed: string[] = [];
  let failUploadAt = 0;
  let missingChequeColumn = false;
  let duplicate = false;

  const storage = {
    from: vi.fn(() => ({
      upload: async (path: string) => {
        if (failUploadAt && uploaded.length + 1 === failUploadAt) return { error: { message: "Upload failed" } };
        uploaded.push(path);
        return { error: null };
      },
      remove: async (paths: string[]) => { removed.push(paths); return { error: null }; },
      createSignedUrl: async (path: string) => {
        signed.push(path);
        return { data: { signedUrl: `https://storage.example.org/signed/${path}` }, error: null };
      }
    }))
  };

  function from(table: string) {
    const entries = rows[table];
    if (!entries) throw new Error(`Unknown table: ${table}`);
    return {
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const found = () => entries.filter((entry) => filters.every(([key, value]) => entry[key] === value));
        const query = {
          eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
          maybeSingle: async () => ({ data: found()[0] || null, error: null }),
          then: (resolve: (result: unknown) => void) => Promise.resolve({ data: found(), error: null }).then(resolve)
        };
        return query;
      },
      insert: (payload: Row) => {
        const result = () => {
          if (table === "transactions" && "profile_id" in payload) {
            return { data: null, error: { code: "PGRST204", message: "Could not find the 'profile_id' column of 'transactions' in the schema cache" } };
          }
          if (table === "transactions" && missingChequeColumn && "cheque_details" in payload) {
            return { data: null, error: { code: "PGRST204", message: "Could not find the 'cheque_details' column of 'transactions' in the schema cache" } };
          }
          if (table === "transactions" && duplicate) return { data: null, error: { code: "23505", message: "duplicate key violates unique constraint \"transactions_unique_cheque_deposit\"" } };
          const entry = { ...payload, id: payload.id || randomUUID(), created_at: new Date().toISOString() };
          entries.push(entry);
          return { data: entry, error: null };
        };
        return {
          select: () => ({ single: async () => result() }),
          then: (resolve: (response: unknown) => void) => Promise.resolve(result()).then(resolve)
        };
      },
      update: (fields: Row) => {
        const filters: Array<[string, unknown]> = [];
        const query = {
          eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
          select: () => ({
            single: async () => {
              const entry = entries.find((item) => filters.every(([key, value]) => item[key] === value));
              if (!entry) return { data: null, error: { code: "PGRST116", message: "No row" } };
              Object.assign(entry, fields);
              return { data: entry, error: null };
            }
          })
        };
        return query;
      }
    };
  }

  return {
    client: { from, storage }, rows, uploaded, removed, signed,
    failSecondUpload: () => { failUploadAt = 2; },
    missingChequeColumn: () => { missingChequeColumn = true; },
    duplicateCheque: () => { duplicate = true; }
  };
}

type FakeDb = ReturnType<typeof fakeSupabase>;
let db: FakeDb;

beforeEach(() => {
  db = fakeSupabase();
  mocks.createSupabaseAdminClient.mockReturnValue(db.client);
  mocks.getCurrentUser.mockResolvedValue(user);
  mocks.getAdminUser.mockResolvedValue(null);
});

const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "cheque.jpg", { type: "image/jpeg" });
const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "cheque.png", { type: "image/png" });

function depositRequest(overrides: Record<string, string | File> = {}) {
  const form = new FormData();
  const fields = {
    amount: "125.25", chequeNumber: "000100", bankName: "Sample Bank",
    payerName: "Jane Doe", chequeDate: "2024-06-01", frontImage: jpeg, backImage: png,
    ...overrides
  };
  Object.entries(fields).forEach(([name, value]) => form.set(name, value));
  return new Request(`${url}/deposit`, { method: "POST", body: form });
}

function jsonRequest(path: string, body: unknown) {
  return new Request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

const withdrawalBody = {
  amount: 70, payeeName: "Jane Doe",
  mailingAddress: { line1: "12 High St", line2: "", city: "Lagos", region: "Lagos", postalCode: "100001", country: "Nigeria" }
};

describe("cheque deposit API", () => {
  it("requires login and validates both images before uploading", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    expect((await deposit(depositRequest())).status).toBe(401);
    const response = await deposit(depositRequest({ backImage: new File(["<script>"], "back.jpg", { type: "image/jpeg" }) }));
    expect(response.status).toBe(400);
    expect(db.uploaded).toHaveLength(0);
    expect(db.rows.transactions).toHaveLength(0);
  });

  it("stores two private scans and a pending deposit with complete metadata", async () => {
    const response = await deposit(depositRequest());
    expect(response.status).toBe(201);
    const { transaction } = await response.json();
    expect(transaction).toMatchObject({ user_id: userId, type: "deposit", status: "pending", amount: 125.25, method_key: "cheque" });
    expect(transaction.cheque_details).toMatchObject({ kind: "deposit", chequeNumber: "000100", bankName: "Sample Bank" });
    expect(db.uploaded).toEqual([
      `${userId}/${transaction.id}/front.jpg`, `${userId}/${transaction.id}/back.png`
    ]);
    expect(db.removed).toHaveLength(0);
  });

  it("credits only after admin approval; never approves mismatched cheque details", async () => {
    const { transaction } = await (await deposit(depositRequest())).json();
    expect(transaction.status).toBe("pending");
    mocks.getAdminUser.mockResolvedValue(admin);
    const request = () => jsonRequest("http://localhost:3000/api/admin/transactions/approve", { transactionId: transaction.id, reference: "CLEAR-5" });
    db.rows.transactions[0].cheque_details = { ...transaction.cheque_details, kind: "withdrawal" };
    expect((await approve(request())).status).toBe(400);
    db.rows.transactions[0].cheque_details = transaction.cheque_details;
    expect((await approve(request())).status).toBe(200);
    expect(db.rows.transactions[0]).toMatchObject({ status: "completed", reference: "CLEAR-5" });
  });

  it("cleans up the first scan when the second upload fails", async () => {
    db.failSecondUpload();
    const response = await deposit(depositRequest());
    expect(response.status).toBe(500);
    expect(db.rows.transactions).toHaveLength(0);
    expect(db.removed).toEqual([[db.uploaded[0]]]);
  });

  it("does not create an incomplete request if schema migration is missing or the cheque is a duplicate", async () => {
    db.missingChequeColumn();
    const response = await deposit(depositRequest());
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("temporarily unavailable");
    expect(db.removed[0]).toHaveLength(2);
    expect(db.rows.transactions).toHaveLength(0);

    db = fakeSupabase();
    db.duplicateCheque();
    mocks.createSupabaseAdminClient.mockReturnValue(db.client);
    const duplicateResponse = await deposit(depositRequest());
    expect(duplicateResponse.status).toBe(400);
    expect((await duplicateResponse.json()).error).toContain("already has");
    expect(db.removed[0]).toHaveLength(2);
  });
});

describe("cheque withdrawal and admin review", () => {
  beforeEach(() => {
    db.rows.transactions.push({ id: randomUUID(), user_id: userId, type: "deposit", amount: 100, status: "completed" });
  });

  it("reserves funds, rejects overspending, and releases a hold after admin rejection", async () => {
    const response = await withdraw(jsonRequest(`${url}/withdraw`, withdrawalBody));
    expect(response.status).toBe(201);
    const { transaction } = await response.json();
    expect(transaction).toMatchObject({ type: "withdrawal", status: "pending", method_key: "cheque", amount: 70 });
    expect(transaction.cheque_details.mailingAddress).toMatchObject({ country: "Nigeria", line1: "12 High St" });

    const overdraft = await withdraw(jsonRequest(`${url}/withdraw`, { ...withdrawalBody, amount: 50 }));
    expect(overdraft.status).toBe(400);
    expect((await overdraft.json()).error).toContain("Insufficient");

    mocks.getAdminUser.mockResolvedValue(admin);
    const noReason = await reject(jsonRequest("http://localhost:3000/api/admin/transactions/reject", { transactionId: transaction.id }));
    expect(noReason.status).toBe(400);
    const rejected = await reject(jsonRequest("http://localhost:3000/api/admin/transactions/reject", { transactionId: transaction.id, reason: "Address not verified" }));
    expect(rejected.status).toBe(200);
    expect(db.rows.transactions.find((row) => row.id === transaction.id)).toMatchObject({ status: "rejected", admin_note: "Address not verified" });
    expect(db.rows.activity_logs).toHaveLength(1);

    expect((await withdraw(jsonRequest(`${url}/withdraw`, { ...withdrawalBody, amount: 80 }))).status).toBe(201);
  });

  it("requires admin access and a dispatch reference before approving a mailed cheque", async () => {
    const { transaction } = await (await withdraw(jsonRequest(`${url}/withdraw`, withdrawalBody))).json();
    const request = (reference?: string) => jsonRequest("http://localhost:3000/api/admin/transactions/approve", { transactionId: transaction.id, reference });
    expect((await approve(request("CHQ-123"))).status).toBe(403);
    mocks.getAdminUser.mockResolvedValue(admin);
    expect((await approve(request())).status).toBe(400);
    expect((await approve(request("CHQ-123"))).status).toBe(200);
    expect(db.rows.transactions.find((row) => row.id === transaction.id)).toMatchObject({ status: "completed", reference: "CHQ-123" });
    expect((await approve(request("CHQ-123"))).status).toBe(404); // cannot double-approve
  });

  it("does not permit a suspended account to submit a cheque request", async () => {
    db.rows.users[0].status = "suspended";
    expect((await withdraw(jsonRequest(`${url}/withdraw`, withdrawalBody))).status).toBe(403);
    expect((await deposit(depositRequest())).status).toBe(403);
    expect(db.uploaded).toHaveLength(0);
  });
});

describe("other payment methods share cheque holds and account restrictions", () => {
  it("cannot spend funds already held for a cheque, or invent a payment method", async () => {
    db.rows.payment_methods.push({ key: "wire", label: "Wire Transfer", is_active: true });
    db.rows.transactions.push({ id: randomUUID(), user_id: userId, type: "deposit", amount: 100, status: "completed" });
    expect((await withdraw(jsonRequest(`${url}/withdraw`, withdrawalBody))).status).toBe(201);

    const regularUrl = "http://localhost:3000/api/transactions/withdraw";
    const body = { amount: 50, paymentMethodKey: "wire", destination: "Bank account 1234" };
    expect((await regularWithdraw(jsonRequest(regularUrl, body))).status).toBe(400); // only $30 is left
    expect((await regularWithdraw(jsonRequest(regularUrl, { ...body, paymentMethodKey: "cheque" }))).status).toBe(404);
  });

  it("cannot fund or withdraw from a suspended account through a non-cheque method", async () => {
    db.rows.users[0].status = "suspended";
    const fund = { amount: 100, paymentMethodKey: "wire" };
    const withdrawBody = { ...fund, destination: "Bank account 1234" };
    expect((await regularDeposit(jsonRequest("http://localhost:3000/api/transactions/deposit", fund))).status).toBe(403);
    expect((await regularWithdraw(jsonRequest("http://localhost:3000/api/transactions/withdraw", withdrawBody))).status).toBe(403);
  });
});

describe("private cheque images", () => {
  it("only signs scans for their owner or a verified admin", async () => {
    const { transaction } = await (await deposit(depositRequest())).json();
    const requestImages = () => images(new Request(`${url}/${transaction.id}/images`), { params: Promise.resolve({ transactionId: transaction.id }) });
    const ownerResponse = await requestImages();
    expect(ownerResponse.status).toBe(200);
    expect((await ownerResponse.json()).frontUrl).toContain("/signed/");
    expect(ownerResponse.headers.get("cache-control")).toBe("no-store");

    db.signed.length = 0;
    mocks.getCurrentUser.mockResolvedValue({ id: strangerId });
    expect((await requestImages()).status).toBe(404);
    expect(db.signed).toHaveLength(0);
    mocks.getAdminUser.mockResolvedValue(admin);
    expect((await requestImages()).status).toBe(200);

    mocks.getCurrentUser.mockResolvedValue(user);
    db.signed.length = 0;
    db.rows.transactions[0].cheque_details = { ...transaction.cheque_details, frontImagePath: `${strangerId}/another/front.jpg` };
    expect((await requestImages()).status).toBe(404); // never sign an arbitrary Storage object
    expect(db.signed).toHaveLength(0);
    mocks.getCurrentUser.mockResolvedValue(null);
    expect((await requestImages()).status).toBe(401);
  });
});
