import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getLiveQuotes } from "@/lib/market-data";
import { STOCK_CATALOG } from "@/lib/stock-catalog";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Delayed live quotes for the whole catalog (simulated fallback when the
 * free Stooq feed is unreachable). Authenticated so the endpoint cannot be
 * used as a public market-data proxy.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let stored: { symbol: string; company_name: string; sector: string; price_per_share: number | string }[] = [];
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("stock_quotes")
      .select("symbol,company_name,sector,price_per_share")
      .eq("is_active", true)
      .order("symbol");
    stored = data || [];
  } catch {
    // Database not configured / migration not applied yet: still return the
    // code catalog so the market screen can render its charts.
    stored = STOCK_CATALOG.map((entry) => ({
      symbol: entry.symbol,
      company_name: entry.company_name,
      sector: entry.sector,
      price_per_share: entry.seed_price
    }));
  }

  const { quotes, source, fetched_at } = await getLiveQuotes(stored);
  return NextResponse.json(
    { quotes, source, fetched_at },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
