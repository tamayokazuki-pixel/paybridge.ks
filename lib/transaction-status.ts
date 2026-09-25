/**
 * Single source of truth for transaction status values.
 *
 * The app (API routes, admin console, dashboard) uses:
 *   pending -> completed -> rejected
 *
 * Older data still exists in some databases:
 *   - the first static demo in this repo (admin.html) wrote "failed" for a
 *     rejected request and "completed" for an approved one
 *   - an earlier version of supabase/schema.sql allowed "approved" instead of
 *     "completed"
 *
 * Everything that reads a row goes through `normalizeStatus` so legacy rows
 * behave like current ones, and nothing has to know which vocabulary the
 * database happens to use.
 */

export const TRANSACTION_STATUSES = ["pending", "completed", "rejected"] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

/** Legacy value -> value the current app uses. */
export const LEGACY_STATUS_MAP: Record<string, TransactionStatus> = {
  failed: "rejected",
  declined: "rejected",
  approved: "completed",
  complete: "completed",
  succeeded: "completed",
  success: "completed"
};

/** Value the app uses -> legacy value, for databases that only allow the old set. */
export const LEGACY_STATUS_FALLBACK: Partial<Record<TransactionStatus, string>> = {
  rejected: "failed",
  completed: "approved"
};

export function isTransactionStatus(value: unknown): value is TransactionStatus {
  return TRANSACTION_STATUSES.includes(String(value) as TransactionStatus);
}

/**
 * Maps any status found in the database to the current vocabulary.
 * Unknown values are returned as lowercase text so the UI can still show them.
 */
export function normalizeStatus(value: unknown): TransactionStatus | string {
  const status = String(value ?? "").trim().toLowerCase();
  if (!status) return "pending";
  if (LEGACY_STATUS_MAP[status]) return LEGACY_STATUS_MAP[status];
  return status;
}

/** Human readable, normalised status label for the UI. */
export function statusLabel(value: unknown): string {
  return normalizeStatus(value);
}
