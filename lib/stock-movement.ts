export const STOCK_MOVEMENT_POINT_COUNT = 32;
export const STOCK_MOVEMENT_UPDATE_MS = 2_500;

export type StockMovementDirection = "up" | "down" | "flat";

export type StockMovementChange = {
  percent: number;
  direction: StockMovementDirection;
};

export type StockSparklinePoint = {
  x: number;
  y: number;
};

export type StockSparklineGeometry = {
  points: StockSparklinePoint[];
  linePath: string;
  areaPath: string;
  firstPoint: StockSparklinePoint;
  lastPoint: StockSparklinePoint;
  baselineY: number;
};

const BASE_INDEX = 100;
const MIN_INDEX = 94.5;
const MAX_INDEX = 105.5;

function hashSymbol(symbol: string) {
  let hash = 0x811c9dc5;
  const normalized = symbol.trim().toUpperCase() || "STOCK";

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function mulberry32(seed: number) {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function splitmix32(seed: number) {
  let value = (seed + 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4_294_967_296;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMovement(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function symbolDrift(seed: number) {
  return ((((seed >>> 8) % 2001) - 1000) / 1000) * 0.1;
}

function symbolPhase(seed: number) {
  return (seed % 628) / 100;
}

function sanitizePoints(points: readonly number[]) {
  const values = points.filter((point) => Number.isFinite(point));
  if (!values.length) return [BASE_INDEX, BASE_INDEX];
  if (values.length === 1) return [values[0], values[0]];
  return values;
}

/**
 * Build a stable, symbol-specific session movement index.
 *
 * The series is deterministic for a ticker, which keeps server and client
 * rendering in agreement. It is used only to draw each card's movement
 * chart; the server-side quote remains the value used for paper orders.
 */
export function createStockMovementSeries(
  symbol: string,
  pointCount = STOCK_MOVEMENT_POINT_COUNT
): number[] {
  const count = Math.max(2, Math.trunc(pointCount) || STOCK_MOVEMENT_POINT_COUNT);
  const seed = hashSymbol(symbol);
  const random = mulberry32(seed);
  const drift = symbolDrift(seed);
  const phase = symbolPhase(seed);

  let value = BASE_INDEX + (random() - 0.5) * 1.6;
  const series = [roundMovement(value)];

  for (let index = 1; index < count; index += 1) {
    const shock = (random() - 0.5) * 0.72;
    const wave = Math.sin(index / 4.2 + phase) * 0.07;
    const meanReversion = (BASE_INDEX - value) * 0.018;
    value = clamp(value + drift + shock + wave + meanReversion, MIN_INDEX, MAX_INDEX);
    series.push(roundMovement(value));
  }

  return series;
}

export function nextStockMovementValue(symbol: string, previousValue: number, tick: number) {
  const seed = hashSymbol(symbol);
  const safeTick = Math.max(0, Math.trunc(tick) || 0);
  const safePrevious = Number.isFinite(previousValue)
    ? clamp(previousValue, MIN_INDEX, MAX_INDEX)
    : BASE_INDEX;
  const random = splitmix32(seed ^ Math.imul(safeTick + 1, 0x85ebca6b));
  const drift = symbolDrift(seed) * 0.65;
  const shock = (random - 0.5) * 0.62;
  const wave = Math.sin(safeTick / 4.5 + symbolPhase(seed)) * 0.06;
  const meanReversion = (BASE_INDEX - safePrevious) * 0.022;

  return roundMovement(clamp(safePrevious + drift + shock + wave + meanReversion, MIN_INDEX, MAX_INDEX));
}

export function advanceStockMovementSeries(
  series: readonly number[],
  symbol: string,
  tick: number,
  maxPoints = STOCK_MOVEMENT_POINT_COUNT
): number[] {
  const limit = Math.max(2, Math.trunc(maxPoints) || STOCK_MOVEMENT_POINT_COUNT);
  const safeSeries = sanitizePoints(series);
  const nextValue = nextStockMovementValue(symbol, safeSeries[safeSeries.length - 1], tick);
  return [...safeSeries.slice(-(limit - 1)), nextValue];
}

export function stockMovementChange(points: readonly number[]): StockMovementChange {
  const safePoints = sanitizePoints(points);
  const first = safePoints[0];
  const last = safePoints[safePoints.length - 1];
  const percent = first !== 0 ? ((last - first) / first) * 100 : 0;
  const direction: StockMovementDirection = percent > 0.005 ? "up" : percent < -0.005 ? "down" : "flat";

  return { percent, direction };
}

export function formatStockMovementPercent(percent: number) {
  if (!Number.isFinite(percent)) return "0.00%";
  const rounded = Math.round(percent * 100) / 100;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(2)}%`;
}

function smoothLinePath(points: StockSparklinePoint[]) {
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const following = points[Math.min(points.length - 1, index + 2)];

    const controlOne = {
      x: roundCoordinate(current.x + (next.x - previous.x) / 6),
      y: roundCoordinate(current.y + (next.y - previous.y) / 6)
    };
    const controlTwo = {
      x: roundCoordinate(next.x - (following.x - current.x) / 6),
      y: roundCoordinate(next.y - (following.y - current.y) / 6)
    };

    path += ` C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`;
  }

  return path;
}

export function buildStockSparklineGeometry(
  values: readonly number[],
  width = 260,
  height = 72,
  padding = 6
): StockSparklineGeometry {
  const safeValues = sanitizePoints(values);
  const safeWidth = Math.max(2 * padding + 1, width);
  const safeHeight = Math.max(2 * padding + 1, height);
  let minimum = Math.min(...safeValues);
  let maximum = Math.max(...safeValues);

  if (maximum - minimum < 0.000001) {
    minimum -= 0.5;
    maximum += 0.5;
  } else {
    const rangePadding = (maximum - minimum) * 0.12;
    minimum -= rangePadding;
    maximum += rangePadding;
  }

  const points = safeValues.map((value, index) => ({
    x: roundCoordinate(padding + (index * (safeWidth - padding * 2)) / (safeValues.length - 1)),
    y: roundCoordinate(
      padding + ((maximum - value) / (maximum - minimum)) * (safeHeight - padding * 2)
    )
  }));

  const linePath = smoothLinePath(points);
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const areaPath = `${linePath} L ${lastPoint.x} ${safeHeight} L ${firstPoint.x} ${safeHeight} Z`;

  return {
    points,
    linePath,
    areaPath,
    firstPoint,
    lastPoint,
    baselineY: firstPoint.y
  };
}
