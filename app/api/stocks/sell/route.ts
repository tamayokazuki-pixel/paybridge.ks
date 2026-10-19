import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isActiveAccount } from "@/lib/cheque-server";
import { refreshStoredQuote } from "@/lib/market-data";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type RpcError = { code?: string | null; message?: string | null; details?: string | null };

const sellSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z]{1,5}(?:\.[A-Z])?$/, "Choose a valid stock symbol."),
  shares: z.number()
    .finite("Enter a valid number of shares.")
    .min(0.0001, "Sell at least 0.0001 shares.")
    .max(1_000_000, "The maximum order is 1,000,000 shares.")
    .refine((value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.00001, "Shares can have up to 4 decimal places.")
    .transform((value) => Math.round(value * 10_000) / 10_000)
});

function saleError(error: RpcError) {
  const message = `${error.message || ""} ${error.details || ""}`;
  if (/insufficient shares/i.test(message)) {
    return { status: 400, error: "You do not own that many shares to sell." };
  }
  if (/minimum order|invalid stock order|at least \$0\.01/i.test(message)) {
    return { status: 400, error: "Enter a valid order with a total of at least $0.01." };
  }
  if (/active account|suspended/i.test(message)) {
    return { status: 403, error: "An active account is required to sell shares." };
  }
  if (/stock (quote|listing|symbol)|unavailable stock/i.test(message)) {
    return { status: 404, error: "That stock is not currently available." };
  }
  if (
    ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"].includes(error.code || "") ||
    /execute_stock_sale|stock_trades|stock_quotes/i.test(message)
  ) {
    return { status: 503, error: "Selling is not configured yet. Ask your administrator to apply the updated supabase/add_stock_trading.sql." };
  }
  return { status: 500, error: "Could not place this stock order. Please try again." };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = sellSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid stock order." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    if (!await isActiveAccount(supabase, user.id)) {
      return NextResponse.json({ error: "An active account is required to sell shares." }, { status: 403 });
    }

    // Refresh the stored quote from the delayed feed first so the atomic RPC
    // credits the sale at the current price. Non-fatal if the feed is down.
    await refreshStoredQuote(supabase, parsed.data.symbol);

    const { data: order, error } = await supabase.rpc("execute_stock_sale", {
      p_user_id: user.id,
      p_symbol: parsed.data.symbol,
      p_shares: parsed.data.shares
    });

    if (error) {
      const result = saleError(error);
      if (result.status >= 500) console.error("Stock sale RPC failed:", error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    console.error("Stock sale request failed:", error);
    return NextResponse.json({ error: "Could not place this stock order. Please try again." }, { status: 500 });
  }
}
