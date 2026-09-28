import { describe, expect, it } from "vitest";
import { availableBalance } from "@/lib/balance";
import { chequeDepositSchema, chequeWithdrawalSchema, readChequeImage } from "@/lib/cheques";
import { finalizeTransaction, insertTransaction } from "@/lib/transactions";

describe("cheque data and amounts", () => {
  const deposit = {
    amount: "150.25", chequeNumber: "004321", bankName: "Example Bank",
    payerName: "Jane Doe", chequeDate: "2024-01-01"
  };
  const withdrawal = {
    amount: 80.5, payeeName: "Jane Doe",
    mailingAddress: { line1: "12 High St", city: "Lagos", region: "Lagos", postalCode: "100001", country: "Nigeria" }
  };

  it("validates paper-cheque data, cent precision and real, non-future dates", () => {
    expect(chequeDepositSchema.parse(deposit).amount).toBe(150.25);
    expect(chequeDepositSchema.safeParse({ ...deposit, amount: "50.001" }).success).toBe(false);
    expect(chequeDepositSchema.safeParse({ ...deposit, chequeDate: "2099-01-01" }).success).toBe(false);
    expect(chequeDepositSchema.safeParse({ ...deposit, chequeDate: "2024-02-31" }).success).toBe(false);
    expect(chequeWithdrawalSchema.parse(withdrawal).mailingAddress.city).toBe("Lagos");
    expect(chequeWithdrawalSchema.safeParse({ ...withdrawal, amount: 49.99 }).success).toBe(false);
    expect(chequeWithdrawalSchema.safeParse({ ...withdrawal, amount: 80.005 }).success).toBe(false);
    expect(chequeWithdrawalSchema.safeParse({ ...withdrawal, amount: Infinity }).success).toBe(false);
    expect(chequeWithdrawalSchema.safeParse({ ...withdrawal, mailingAddress: { city: "Lagos" } }).success).toBe(false);
  });

  it("only accepts small, genuine JPEG/PNG/WebP images, regardless of filename", async () => {
    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0x00])], "front.png", { type: "image/jpeg" });
    const valid = await readChequeImage(jpeg);
    expect(valid).toMatchObject({ ok: true, contentType: "image/jpeg", extension: "jpg" });
    expect((await readChequeImage(new File(["<svg onload=alert(1)>"], "back.jpg", { type: "image/jpeg" }))).ok).toBe(false);
    expect((await readChequeImage(new File([new Uint8Array([0xff, 0xd8, 0xff])], "front.jpg", { type: "image/png" }))).ok).toBe(false);
    expect((await readChequeImage(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "huge.jpg", { type: "image/jpeg" }))).ok).toBe(false);
    expect((await readChequeImage(null)).ok).toBe(false);
  });

  it("uses one ledger for cheques, other methods and legacy statuses", () => {
    const entries = [
      { type: "deposit", amount: "150.25", status: "approved" },
      { type: "deposit", amount: 100, status: "pending" }, // not yet cleared
      { type: "withdrawal", amount: "50.10", status: "pending" }, // cheque hold
      { type: "withdrawal", amount: "20.05", status: "completed" },
      { type: "withdrawal", amount: 10, status: "failed" }, // rejected -> released
      { type: "admin_adjustment", amount: 5, status: "completed" }
    ];
    expect(availableBalance(entries)).toBe(85.1);
    expect(availableBalance(entries.map((entry) => entry.amount === "50.10" ? { ...entry, status: "rejected" } : entry))).toBe(135.2);
  });

  it("never strips required cheque/audit columns to accommodate an outdated DB", async () => {
    const inserts: Record<string, unknown>[] = [];
    const admin = {
      from: () => ({
        insert: (payload: Record<string, unknown>) => {
          inserts.push({ ...payload });
          return { select: () => ({ single: async () => ({ data: null, error: {
            code: "PGRST204", message: `Could not find the '${"profile_id" in payload ? "profile_id" : "cheque_details"}' column of 'transactions' in the schema cache`
          } }) }) };
        },
        update: () => ({
          eq: () => ({ eq: () => ({ select: () => ({ single: async () => ({ data: null, error: {
            code: "PGRST204", message: "Could not find the 'admin_note' column of 'transactions' in the schema cache"
          } }) }) }) })
        })
      })
    } as unknown as Parameters<typeof insertTransaction>[0];
    const inserted = await insertTransaction(admin, { profile_id: "user", cheque_details: { kind: "deposit" } }, { requiredColumns: ["cheque_details"] });
    expect(inserts).toHaveLength(2);
    expect(inserts[1]).not.toHaveProperty("profile_id");
    expect(inserts[1]).toHaveProperty("cheque_details");
    expect(inserted.error?.code).toBe("PGRST204");

    const finalized = await finalizeTransaction(admin, "transaction-id", { status: "rejected", admin_note: "Unreadable" }, { requiredColumns: ["admin_note"] });
    expect(finalized.error?.code).toBe("PGRST204");
  });
});
