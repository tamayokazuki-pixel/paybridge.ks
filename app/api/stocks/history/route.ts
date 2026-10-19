import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { getPriceHistory, HISTORY_RANGES, type HistoryRange } from "@/lib/market-data";
import { catalogEntry } from "@/lib/stock-catalog";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  symbol: z.string().trim().toUpperCase().regex(/^[A-Z]{1,5}(?:\.[A-Z])?$/, "Choose a valid stock symbol."),
  range: z.enum(["1M", "3M", "6M", "1Y", "5Y"]).default("3M")
});

/** Daily price history for the market-flow chart of one listing. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    symbol: params.get("symbol") || "",
    range: HISTORY_RANGES.includes(params.get("range") as HistoryRange) ? params.get("range") : "3M"
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid history request." }, { status: 400 });
  }

  const entry = catalogEntry(parsed.data.symbol);
  if (!entry) {
    return NextResponse.json({ error: "That stock is not currently available." }, { status: 404 });
  }

  // Anchor the simulated fallback on the stored quote when we have one.
  let anchor = entry.seed_price;
  try {
    const supabase = createSupabaseAdminClient();
    const { data } = await supabase
      .from("stock_quotes")
      .select("price_per_share")
      .eq("symbol", entry.symbol)
      .maybeSingle();
    if (data?.price_per_share) anchor = Number(data.price_per_share) || anchor;
  } catch {
    // Fall back to the catalog seed price.
  }

  const { points, source } = await getPriceHistory(entry.symbol, parsed.data.range, anchor);
  return NextResponse.json(
    { symbol: entry.symbol, range: parsed.data.range, source, points },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
