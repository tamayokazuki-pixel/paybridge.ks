import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUser } from "@/lib/auth";
import { availableBalance } from "@/lib/balance";
import { CHEQUE_METHOD_KEY } from "@/lib/cheques";
import { money } from "@/lib/format";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { TRANSACTION_STATUSES } from "@/lib/transaction-status";
import {
  TRANSACTION_TYPES,
  adminAmountSchema,
  describeDbError,
  insertTransaction,
  parseTransactionTimestamp
} from "@/lib/transactions";

const createSchema = z.object({
  userId: z.string().uuid("Select a valid user account."),
  type: z.enum(TRANSACTION_TYPES, {
    errorMap: () => ({ message: "Select a valid transaction type." })
  }),
  status: z.enum(TRANSACTION_STATUSES).default("completed"),
  amount: adminAmountSchema,
  description: z
    .string()
    .trim()
    .min(1, "Description is required.")
    .max(500, "Description must be 500 characters or fewer."),
  methodKey: z.string().trim().max(64).optional().nullable(),
  methodLabel: z.string().trim().max(100).optional().nullable(),
  reference: z.string().trim().max(100).optional().nullable(),
  adminNote: z.string().trim().max(500).optional().nullable(),
  transactionDate: z.string().trim().min(1, "Select a transaction date and time.")
});

export async function POST(request: Request) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    return NextResponse.json({ error: "Admin access required. Please sign in again." }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid request body." }, { status: 400 });
  }
  const body = parsed.data;

  const parsedDate = parseTransactionTimestamp(body.transactionDate);
  if (!parsedDate.ok) {
    return NextResponse.json({ error: parsedDate.error }, { status: 400 });
  }

  if (body.methodKey?.toLowerCase() === CHEQUE_METHOD_KEY) {
    return NextResponse.json(
      { error: "Cheque transactions require cheque scan or payee details. Select another method or enter a custom label." },
      { status: 400 }
    );
  }

  try {
    const supabase = createSupabaseAdminClient();
    const { data: targetUser, error: userError } = await supabase
      .from("users")
      .select("id,status")
      .eq("id", body.userId)
      .maybeSingle();

    if (userError) throw userError;
    if (!targetUser) {
      return NextResponse.json({ error: "User account not found." }, { status: 404 });
    }

    const isDebit = body.type === "withdrawal" || body.type === "transfer";
    if (isDebit && body.status === "pending" && targetUser.status !== "active") {
      return NextResponse.json(
        { error: "Cannot create a pending withdrawal or transfer on a suspended account." },
        { status: 400 }
      );
    }

    if (isDebit && (body.status === "pending" || body.status === "completed")) {
      const { data: ledger, error: ledgerError } = await supabase
        .from("transactions")
        .select("amount,type,status")
        .eq("user_id", targetUser.id);

      if (ledgerError) throw ledgerError;
      const available = availableBalance((ledger || []) as Array<{ amount: number | string; type: string; status: string }>);
      if (body.amount > available) {
        return NextResponse.json(
          { error: `Insufficient available balance for this user (${money(available)} available).` },
          { status: 400 }
        );
      }
    }

    const rawMethodKey = body.methodKey?.trim() || "";
    const customLabel = body.methodLabel?.trim() || "";
    let resolvedMethodKey: string;
    let resolvedMethodLabel: string;

    if (!rawMethodKey || rawMethodKey === "internal") {
      resolvedMethodKey = body.type === "admin_adjustment" ? "admin" : "internal";
      resolvedMethodLabel = customLabel || (body.type === "admin_adjustment" ? "Admin Adjustment" : "Internal");
    } else if (rawMethodKey === "bank_transfer") {
      resolvedMethodKey = "bank_transfer";
      resolvedMethodLabel = customLabel || "Bank Transfer";
    } else if (rawMethodKey === "custom") {
      resolvedMethodKey = "custom";
      resolvedMethodLabel = customLabel || "Custom";
    } else {
      const { data: method } = await supabase
        .from("payment_methods")
        .select("key,label")
        .eq("key", rawMethodKey)
        .maybeSingle();

      resolvedMethodKey = method?.key ? String(method.key) : rawMethodKey;
      resolvedMethodLabel = customLabel || (method?.label ? String(method.label) : rawMethodKey);
    }

    const { data, error, legacyStatus } = await insertTransaction(
      supabase,
      {
        user_id: targetUser.id,
        profile_id: targetUser.id,
        type: body.type,
        status: body.status,
        amount: body.amount,
        description: body.description,
        method_key: resolvedMethodKey,
        method_label: resolvedMethodLabel,
        reference: body.reference?.trim() || null,
        admin_note: body.adminNote?.trim() || null,
        created_at: parsedDate.iso,
        completed_at: body.status === "pending" ? null : parsedDate.iso
      },
      { requiredColumns: ["created_at"] }
    );

    if (error || !data) {
      console.error("Admin create transaction failed:", error);
      return NextResponse.json(
        { error: `Could not create transaction: ${describeDbError(error)}` },
        { status: 400 }
      );
    }

    const { error: logError } = await supabase.from("activity_logs").insert({
      actor_id: adminUser.id,
      user_id: targetUser.id,
      action: "transaction_created",
      details: `Created ${body.status} ${body.type} of $${body.amount.toFixed(2)} dated ${parsedDate.iso} (${String(data.id)})`
    });
    if (logError) console.error("Could not write activity log:", logError.message);

    return NextResponse.json({ transaction: data, legacyStatus }, { status: 201 });
  } catch (error) {
    console.error("Admin create transaction crashed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected server error." },
      { status: 500 }
    );
  }
}
