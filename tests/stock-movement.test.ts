import { describe, expect, it } from "vitest";
import {
  advanceStockMovementSeries,
  buildStockSparklineGeometry,
  createStockMovementSeries,
  formatStockMovementPercent,
  nextStockMovementValue,
  stockMovementChange,
  STOCK_MOVEMENT_POINT_COUNT
} from "@/lib/stock-movement";

describe("stock movement series", () => {
  it("creates a bounded, deterministic series for a ticker", () => {
    const first = createStockMovementSeries("AAPL");
    const second = createStockMovementSeries("aapl");

    expect(first).toEqual(second);
    expect(first).toHaveLength(STOCK_MOVEMENT_POINT_COUNT);
    expect(first.every((point) => Number.isFinite(point) && point >= 94.5 && point <= 105.5)).toBe(true);
    expect(createStockMovementSeries("MSFT")).not.toEqual(first);
  });

  it("advances a series without growing it beyond the display window", () => {
    const series = createStockMovementSeries("NVDA", 6);
    const advanced = advanceStockMovementSeries(series, "NVDA", 4, 6);

    expect(advanced).toHaveLength(6);
    expect(advanced.slice(0, -1)).toEqual(series.slice(1));
    expect(advanced[advanced.length - 1]).toBe(nextStockMovementValue("NVDA", series[series.length - 1], 4));
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
