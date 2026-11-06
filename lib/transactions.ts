import { z } from "zod";
import type { createSupabaseAdminClient } from "./supabase-server";
import { LEGACY_STATUS_FALLBACK, type TransactionStatus } from "./transaction-status";

/**
 * Databases created from an older schema still differ from supabase/schema.sql
 * in two ways that break writes:
 *
 *   1. the app writes a column the table does not have yet
 *      (e.g. `admin_note`, `reference`, `profile_id`)
 *   2. the table's CHECK constraint on `status` only allows the legacy values
 *      ('pending', 'completed', 'failed') and rejects 'rejected'
 *
 * Both show up as a failed write, which is why "approve" used to work while
 * "reject" silently failed: approve writes 'completed' (allowed everywhere),
 * reject writes 'rejected' (not allowed on a legacy table).
 *
 * The helpers below retry the write without the offending column / with the
 * legacy status value, so the admin console keeps working until
 * supabase/fix_transactions_status.sql has been run.
 */

type SupabaseAdmin = ReturnType<typeof createSupabaseAdminClient>;

export const TRANSACTION_TYPES = ["deposit", "withdrawal", "transfer", "admin_adjustment"] as const;

export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const adminAmountSchema = z
  .number({ invalid_type_error: "Enter a valid dollar amount." })
  .finite("Enter a valid dollar amount.")
  .min(0.01, "Amount must be at least $0.01.")
  .max(999_999_999_999.99, "Amount exceeds the maximum ledger limit.")
  .refine((value) => /^\d+(?:\.\d{1,2})?$/.test(String(value)), "Use dollars and cents (at most two decimal places).");

const ISO_DATE_OR_DATETIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,6}))?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Validates a calendar date or date-time string (past, present, or future) and
 * returns a canonical ISO-8601 UTC timestamp. Rejects impossible calendar dates
 * such as 2024-02-31 or 2025-02-29 that `new Date(...)` would otherwise roll over.
 */
export function parseTransactionTimestamp(
  raw: unknown
): { ok: true; iso: string } | { ok: false; error: string } {
  if (typeof raw !== "string") {
    return { ok: false, error: "Enter a valid transaction date and time." };
  }
  const trimmed = raw.trim();
  const match = ISO_DATE_OR_DATETIME_RE.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Enter a valid transaction date and time." };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hasTime = match[4] !== undefined;
  const hour = hasTime ? Number(match[4]) : 0;
  const minute = hasTime ? Number(match[5]) : 0;
  const second = match[6] !== undefined ? Number(match[6]) : 0;
  const fraction = match[7] ? match[7].slice(0, 3).padEnd(3, "0") : "000";
  const tz = match[8];

  if (year < 1970 || year > 2100) {
    return { ok: false, error: "Transaction year must be between 1970 and 2100." };
  }
  if (month < 1 || month > 12) {
    return { ok: false, error: "Enter a valid calendar month." };
  }
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > maxDay) {
    return { ok: false, error: "Enter a valid calendar day for that month." };
  }
  if (hour > 23 || minute > 59 || second > 59) {
    return { ok: false, error: "Enter a valid time of day." };
  }
  if (tz && tz !== "Z") {
    const [offsetHours, offsetMinutes] = tz.slice(1).split(":").map(Number);
    if (offsetHours > 23 || offsetMinutes > 59) {
      return { ok: false, error: "Enter a valid timezone offset." };
    }
  }

  const normalized = !hasTime
    ? `${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`
    : `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${String(second).padStart(2, "0")}.${fraction}${tz || ""}`;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "Enter a valid transaction date and time." };
  }

  return { ok: true, iso: parsed.toISOString() };
}

/**
 * Formats an ISO timestamp or Date as `YYYY-MM-DDTHH:mm` in the local timezone
 * for `<input type="datetime-local" />`.
 */
export function toLocalDateTimeInputValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type DbError = { code?: string | null; message?: string | null; details?: string | null } | null;

export type WriteResult<T> = {
  data: T | null;
  error: DbError;
  /** True when the row was stored with a legacy status value such as 'failed'. */
  legacyStatus: boolean;
};

const MAX_ATTEMPTS = 8;

function errorMessage(error: DbError) {
  return `${error?.message || ""} ${error?.details || ""}`;
}

/** Column name from a PostgREST "column not found" error, if that is what we got. */
export function missingColumn(error: DbError): string | null {
  if (!error) return null;
  const message = errorMessage(error);
  const code = error.code || "";
  const isMissingColumn =
    code === "PGRST204" || code === "42703" || /could not find the '.*' column|column .* does not exist/i.test(message);
  if (!isMissingColumn) return null;

  const match = /could not find the '([^']+)' column/i.exec(message) || /column "?([\w.]+)"? does not exist/i.exec(message);
  return match?.[1]?.split(".").pop() || null;
}

/** True when Postgres refused the write because of a CHECK constraint on status. */
export function isStatusConstraintError(error: DbError): boolean {
  if (!error) return false;
  const message = errorMessage(error);
  if (error.code !== "23514" && !/violates check constraint/i.test(message)) return false;
  return /status/i.test(message);
}

/** True when Postgres refused the write because of a CHECK constraint on type. */
export function isTypeConstraintError(error: DbError): boolean {
  if (!error) return false;
  const message = errorMessage(error);
  if (error.code !== "23514" && !/violates check constraint/i.test(message)) return false;
  return /type/i.test(message) && !/cheque_details/i.test(message);
}

export function describeDbError(error: DbError): string {
  if (!error) return "";
  if (isStatusConstraintError(error)) {
    return "the database still only allows the old transaction status values (run supabase/fix_transactions_status.sql in the Supabase SQL editor)";
  }
  if (isTypeConstraintError(error)) {
    return "the database still only allows the old transaction type values (run supabase/fix_transactions_status.sql in the Supabase SQL editor)";
  }
  return error.message || "unknown database error";
}

/**
 * Moves a `pending` transaction to its final status.
 * Only ever updates a row that is still pending, so a double click cannot
 * process the same request twice.
 */
export async function finalizeTransaction(
  supabase: SupabaseAdmin,
  transactionId: string,
  fields: {
    status: TransactionStatus;
    admin_note?: string | null;
    reference?: string | null;
    completed_at?: string;
    created_at?: string;
  },
  options: { requiredColumns?: readonly string[] } = {}
): Promise<WriteResult<Record<string, unknown>>> {
  const payload: Record<string, unknown> = { ...fields };
  let legacyStatus = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("transactions")
      .update(payload)
      .eq("id", transactionId)
      .eq("status", "pending")
      .select("*")
      .single();

    if (!error) {
      return { data: data as Record<string, unknown>, error: null, legacyStatus };
    }

    const column = missingColumn(error);
    if (column && column in payload && !options.requiredColumns?.includes(column)) {
      // Legacy databases may lack optional columns. Never discard cheque audit
      // fields (reference or rejection reason) when they are required.
      delete payload[column];
      continue;
    }

    if (isStatusConstraintError(error)) {
      const current = String(payload.status);
      const fallback = LEGACY_STATUS_FALLBACK[current as TransactionStatus];
      if (fallback && current !== fallback) {
        payload.status = fallback;
        legacyStatus = true;
        continue;
      }
    }

    return { data: null, error, legacyStatus };
  }

  return {
    data: null,
    error: { message: "Could not update the transaction after several attempts." },
    legacyStatus
  };
}

/**
 * Inserts a transaction, dropping any column the live table does not have
 * (a fresh install from schema.sql has no `profile_id`, an older database does)
 * and falling back to legacy status vocabulary when needed.
 */
export async function insertTransaction(
  supabase: SupabaseAdmin,
  row: Record<string, unknown>,
  options: { requiredColumns?: readonly string[] } = {}
): Promise<WriteResult<Record<string, unknown>>> {
  const payload: Record<string, unknown> = { ...row };
  let legacyStatus = false;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.from("transactions").insert(payload).select("*").single();
    if (!error) return { data: data as Record<string, unknown>, error: null, legacyStatus };

    const column = missingColumn(error);
    if (column && column in payload && !options.requiredColumns?.includes(column)) {
      delete payload[column];
      continue;
    }

    if (isStatusConstraintError(error) && typeof payload.status === "string") {
      const current = payload.status;
      const fallback = LEGACY_STATUS_FALLBACK[current as TransactionStatus];
      if (fallback && current !== fallback) {
        payload.status = fallback;
        legacyStatus = true;
        continue;
      }
    }

    return { data: null, error, legacyStatus };
  }

  return { data: null, error: { message: "Could not create the transaction after several attempts." }, legacyStatus };
}

/**
 * Updates `created_at` (and optional `completed_at` / `admin_note`) on an
 * existing transaction while tolerating missing optional columns on older DBs.
 */
export async function updateTransactionDate(
  supabase: SupabaseAdmin,
  transactionId: string,
  fields: {
    created_at: string;
    completed_at?: string | null;
    admin_note?: string | null;
  },
  options: { requiredColumns?: readonly string[] } = {}
): Promise<WriteResult<Record<string, unknown>>> {
  const required = new Set(["created_at", ...(options.requiredColumns || [])]);
  const payload: Record<string, unknown> = { ...fields };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase
      .from("transactions")
      .update(payload)
      .eq("id", transactionId)
      .select("*")
      .single();

    if (!error) {
      return { data: data as Record<string, unknown>, error: null, legacyStatus: false };
    }

    const column = missingColumn(error);
    if (column && column in payload && !required.has(column)) {
      delete payload[column];
      continue;
    }

    return { data: null, error, legacyStatus: false };
  }

  return {
    data: null,
    error: { message: "Could not update the transaction date after several attempts." },
    legacyStatus: false
  };
}
