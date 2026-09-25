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

export type DbError = { code?: string | null; message?: string | null; details?: string | null } | null;

export type WriteResult<T> = {
  data: T | null;
  error: DbError;
  /** True when the row was stored with a legacy status value such as 'failed'. */
  legacyStatus: boolean;
};

const MAX_ATTEMPTS = 6;

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

export function describeDbError(error: DbError): string {
  if (!error) return "";
  if (isStatusConstraintError(error)) {
    return "the database still only allows the old transaction status values (run supabase/fix_transactions_status.sql in the Supabase SQL editor)";
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
  fields: { status: TransactionStatus; admin_note?: string | null; reference?: string | null; completed_at?: string }
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
    if (column && column in payload) {
      // The table does not have this column yet: write the rest of the change.
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
 * (a fresh install from schema.sql has no `profile_id`, an older database does).
 */
export async function insertTransaction(
  supabase: SupabaseAdmin,
  row: Record<string, unknown>
): Promise<WriteResult<Record<string, unknown>>> {
  const payload: Record<string, unknown> = { ...row };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const { data, error } = await supabase.from("transactions").insert(payload).select("*").single();
    if (!error) return { data: data as Record<string, unknown>, error: null, legacyStatus: false };

    const column = missingColumn(error);
    if (column && column in payload) {
      delete payload[column];
      continue;
    }
    return { data: null, error, legacyStatus: false };
  }

  return { data: null, error: { message: "Could not create the transaction after several attempts." }, legacyStatus: false };
}
