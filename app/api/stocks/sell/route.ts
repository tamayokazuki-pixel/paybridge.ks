import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { isActiveAccount } from "@/lib/cheque-server";
import { stockPriceMultiplier } from "@/lib/stock-movement";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

type RpcError = { code?: string | null; message?: string | null; details?: string | null };

const sellSchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z]{1,5}(?:\.[A-Z])?$/, "Choose a valid stock symbol."),
  shares: z.number()
    .finite("Enter a valid number of shares.")
    .min(0.0001, "Sell at least 0.0001 shares.")
    .max(1_000_000, "The maximum sale is 1,000,000 shares.")
    .refine((value) => Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.00001, "Shares can have up to 4 decimal places.")
    .transform((value) => Math.round(value * 10_000) / 10_000)
});

function saleError(error: RpcError) {
  const message = `${error.message || ""} ${error.details || ""}`;
  if (/insufficient shares/i.test(message)) {
    return { status: 400, error: "You do not own enough shares for this sale." };
  }
  if (/minimum order|invalid stock order|stock order must be at least/i.test(message)) {
    return { status: 400, error: "Enter a valid sale with proceeds of at least $0.01." };
  }
  if (/active account|suspended/i.test(message)) {
    return { status: 403, error: "An active account is required to sell shares." };
  }
  if (/stock listing is unavailable/i.test(message)) {
    return { status: 404, error: "That stock is not currently available." };
  }
  if (
    ["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"].includes(error.code || "") ||
    /execute_stock_sale|stock_trades|stock_quotes|side/i.test(message)
  ) {
    return { status: 503, error: "Stock sales are not configured yet. Ask your administrator to apply supabase/add_stock_sales.sql." };
  }
  return { status: 500, error: "Could not complete this stock sale. Please try again." };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = sellSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid stock sale." }, { status: 400 });
  }

  try {
    const supabase = createSupabaseAdminClient();
    if (!await isActiveAccount(supabase, user.id)) {
      return NextResponse.json({ error: "An active account is required to sell shares." }, { status: 403 });
    }

    // The browser supplies only a ticker and quantity. The server recalculates
    // the bounded paper-market multiplier, and the RPC atomically verifies
    // ownership, records the sale, and credits available cash.
    const { data: order, error } = await supabase.rpc("execute_stock_sale", {
      p_user_id: user.id,
      p_symbol: parsed.data.symbol,
      p_shares: parsed.data.shares,
      p_price_multiplier: stockPriceMultiplier(parsed.data.symbol, Date.now())
    });

    if (error) {
      const result = saleError(error);
      if (result.status >= 500) console.error("Stock sale RPC failed:", error);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ order }, { status: 201 });
  } catch (error) {
    console.error("Stock sale request failed:", error);
    return NextResponse.json({ error: "Could not complete this stock sale. Please try again." }, { status: 500 });
  }
}
