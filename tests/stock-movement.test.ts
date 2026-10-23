import { describe, expect, it } from "vitest";
import {
  buildStockSparklineGeometry,
  createStockPriceSeries,
  formatStockMovementPercent,
  simulatedStockPrice,
  stockMarketTick,
  stockMovementChange,
  stockPriceMultiplier,
  STOCK_MOVEMENT_POINT_COUNT,
  STOCK_PRICE_MAX_MULTIPLIER,
  STOCK_PRICE_MIN_MULTIPLIER
} from "@/lib/stock-movement";

const timestamp = Date.UTC(2026, 0, 15, 14, 30, 0);

describe("simulated stock market prices", () => {
  it("creates a bounded, deterministic multiplier for a ticker and time", () => {
    const first = stockPriceMultiplier("AAPL", timestamp);
    const second = stockPriceMultiplier("aapl", timestamp);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(STOCK_PRICE_MIN_MULTIPLIER);
    expect(first).toBeLessThanOrEqual(STOCK_PRICE_MAX_MULTIPLIER);
    expect(stockPriceMultiplier("MSFT", timestamp)).not.toBe(first);
    expect(stockMarketTick(timestamp + 2_499)).toBe(stockMarketTick(timestamp));
  });

  it("derives a current price and price history from the stored anchor quote", () => {
    const price = simulatedStockPrice(231, "AAPL", timestamp);
    const series = createStockPriceSeries(231, "AAPL", timestamp);

    expect(price).toBeGreaterThanOrEqual(231 * STOCK_PRICE_MIN_MULTIPLIER - 0.01);
    expect(price).toBeLessThanOrEqual(231 * STOCK_PRICE_MAX_MULTIPLIER + 0.01);
    expect(series).toHaveLength(STOCK_MOVEMENT_POINT_COUNT);
    expect(series[series.length - 1]).toBe(price);
    expect(series.every((point) => Number.isFinite(point) && point > 0)).toBe(true);
    expect(simulatedStockPrice(0, "AAPL", timestamp)).toBe(0);
  });

  it("reports up, down, and flat movement from the visible window", () => {
    expect(stockMovementChange([100, 101, 103])).toEqual({ percent: 3, direction: "up" });
    expect(stockMovementChange([100, 99, 98])).toEqual({ percent: -2, direction: "down" });
    expect(stockMovementChange([100, 100])).toEqual({ percent: 0, direction: "flat" });
  });

  it("formats signed movement percentages", () => {
    expect(formatStockMovementPercent(1.234)).toBe("+1.23%");
    expect(formatStockMovementPercent(-0.456)).toBe("-0.46%");
    expect(formatStockMovementPercent(0)).toBe("0.00%");
    expect(formatStockMovementPercent(Number.NaN)).toBe("0.00%");
  });
});

describe("stock sparkline geometry", () => {
  it("builds usable line and area paths within the chart bounds", () => {
    const geometry = buildStockSparklineGeometry([100, 102, 101, 104], 260, 72, 6);

    expect(geometry.linePath.startsWith("M 6 ")).toBe(true);
    expect(geometry.areaPath.endsWith(" Z")).toBe(true);
    expect(geometry.points.every((point) => point.x >= 6 && point.x <= 254 && point.y >= 6 && point.y <= 66)).toBe(true);
    expect(geometry.lastPoint.x).toBe(254);
  });

  it("handles a flat series without dividing by zero", () => {
    const geometry = buildStockSparklineGeometry([100, 100, 100], 260, 72, 6);

    expect(geometry.points.map((point) => point.y)).toEqual([36, 36, 36]);
    expect(geometry.baselineY).toBe(36);
  });

  it("supplies a safe fallback for empty points", () => {
    const geometry = buildStockSparklineGeometry([]);

    expect(geometry.points).toHaveLength(2);
    expect(stockMovementChange([])).toEqual({ percent: 0, direction: "flat" });
  });
});
