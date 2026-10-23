import { redirect } from "next/navigation";
import { DashboardClient } from "@/components/DashboardClient";
import { ensureProfile } from "@/lib/auth";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { normalizeStatus } from "@/lib/transaction-status";
import { availableBalance } from "@/lib/balance";
import type { StockTrade } from "@/lib/stocks";

export default async function DashboardPage() {
  const profile = await ensureProfile();

  if (profile.role === "admin" && profile.is_verified && profile.status === "active") {
    redirect("/admin");
  }

  const supabase = createSupabaseAdminClient();

  const [
    { data: transactions },
    { data: paymentMethods },
    { data: stockQuotes, error: stockQuotesError },
    { data: stockTrades, error: stockTradesError }
  ] = await Promise.all([
    supabase
      .from("transactions")
      .select("*")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase.from("payment_methods").select("*").eq("is_active", true).order("label"),
    supabase.from("stock_quotes").select("*").eq("is_active", true).order("symbol"),
    supabase
      .from("stock_trades")
      .select("id,symbol,company_name,shares,price_per_share,total_amount,created_at,side")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
  ]);

  // Older rows can still carry the legacy status values ('failed', 'approved').
  const ledger = (transactions || []).map((txn) => ({ ...txn, status: normalizeStatus(txn.status) }));

  let stockTradeRows: StockTrade[] | null = stockTrades as StockTrade[] | null;
  let resolvedStockTradesError = stockTradesError;
  const stockTradesErrorText = `${stockTradesError?.message || ""} ${stockTradesError?.details || ""}`;
  if (
    stockTradesError &&
    ["42703", "PGRST204"].includes(stockTradesError.code || "") &&
    /\bside\b/i.test(stockTradesErrorText)
  ) {
    // Keep the existing portfolio readable until add_stock_sales.sql is applied.
    const fallback = await supabase
      .from("stock_trades")
      .select("id,symbol,company_name,shares,price_per_share,total_amount,created_at")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false });
    stockTradeRows = fallback.data as StockTrade[] | null;
    resolvedStockTradesError = fallback.error;
  }

  if (stockQuotesError || resolvedStockTradesError) {
    console.error(
      "Stock trading tables are unavailable. Apply supabase/add_stock_trading.sql and supabase/add_stock_sales.sql.",
      stockQuotesError || resolvedStockTradesError
    );
  }

  return (
    <DashboardClient
      profile={{ ...profile, balance: availableBalance(ledger) }}
      transactions={ledger}
      paymentMethods={paymentMethods || []}
      stockQuotes={stockQuotes || []}
      stockTrades={stockTradeRows || []}
      stockTradingReady={!stockQuotesError && !resolvedStockTradesError}
    />
  );
}
