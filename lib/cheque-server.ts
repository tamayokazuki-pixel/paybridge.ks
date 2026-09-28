import type { createSupabaseAdminClient } from "./supabase-server";
import { describeDbError, missingColumn, type DbError } from "./transactions";

export const REQUIRED_CHEQUE_COLUMNS = ["method_key", "method_label", "cheque_details"] as const;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export async function isActiveAccount(supabase: AdminClient, userId: string) {
  const { data, error } = await supabase.from("users").select("status").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.status === "active";
}

export function chequeInsertError(error: DbError) {
  if (missingColumn(error)) return "Cheque requests are temporarily unavailable. Please contact support.";
  if (error?.code === "23505" && /transactions_unique_cheque_deposit/i.test(error.message || "")) {
    return "This cheque already has a pending or completed deposit request.";
  }
  return `Could not create cheque request: ${describeDbError(error)}`;
}
