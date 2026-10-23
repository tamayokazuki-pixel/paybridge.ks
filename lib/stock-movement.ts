export const STOCK_MOVEMENT_POINT_COUNT = 32;
export const STOCK_MOVEMENT_UPDATE_MS = 2_500;
export const STOCK_PRICE_MIN_MULTIPLIER = 0.94;
export const STOCK_PRICE_MAX_MULTIPLIER = 1.06;

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

const FALLBACK_POINT = 100;
const NOISE_NODE_TICKS = 24;

function hashSymbol(symbol: string) {
  let hash = 0x811c9dc5;
  const normalized = symbol.trim().toUpperCase() || "STOCK";

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function splitmix32(seed: number) {
  let value = (seed + 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return ((value ^ (value >>> 15)) >>> 0) / 4_294_967_296;
}

function seededUnit(seed: number, salt: number) {
  return splitmix32(seed ^ Math.imul(salt + 1, 0x85ebca6b));
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundMultiplier(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function roundCoordinate(value: number) {
  return Math.round(value * 100) / 100;
}

function sanitizePoints(points: readonly number[]) {
  const values = points.filter((point) => Number.isFinite(point));
  if (!values.length) return [FALLBACK_POINT, FALLBACK_POINT];
  if (values.length === 1) return [values[0], values[0]];
  return values;
}

function seededNoise(seed: number, node: number) {
  const mixedSeed = seed ^ Math.imul(node + 0x9e3779b9, 0x85ebca6b);
  return splitmix32(mixedSeed) * 2 - 1;
}

function interpolatedNoise(seed: number, tick: number) {
  const node = Math.floor(tick / NOISE_NODE_TICKS);
  const fraction = (tick - node * NOISE_NODE_TICKS) / NOISE_NODE_TICKS;
  const smoothFraction = fraction * fraction * (3 - 2 * fraction);
  const start = seededNoise(seed, node);
  const end = seededNoise(seed, node + 1);
  return start + (end - start) * smoothFraction;
}

export function stockMarketTick(timestampMs: number) {
  const safeTimestamp = Number.isFinite(timestampMs) ? Math.max(0, timestampMs) : 0;
  return Math.floor(safeTimestamp / STOCK_MOVEMENT_UPDATE_MS);
}

/**
 * Price multiplier for the paper market at a point in time.
 *
 * The value is a deterministic, bounded function of ticker and timestamp.
 * The browser uses it for display; the Next.js API recalculates it on the
 * server for an order, and the database RPC only accepts a bounded result
 * around the stored anchor quote.
 */
export function stockPriceMultiplier(symbol: string, timestampMs: number) {
  const seed = hashSymbol(symbol);
  const tick = stockMarketTick(timestampMs);
  const twoPi = Math.PI * 2;

  const waves = [
    { period: 144, amplitude: 0.003 + seededUnit(seed, 1) * 0.0025, phase: seededUnit(seed, 2) * twoPi },
    { period: 720, amplitude: 0.005 + seededUnit(seed, 3) * 0.004, phase: seededUnit(seed, 4) * twoPi },
    { period: 4_320, amplitude: 0.008 + seededUnit(seed, 5) * 0.006, phase: seededUnit(seed, 6) * twoPi },
    { period: 34_560, amplitude: 0.007 + seededUnit(seed, 7) * 0.005, phase: seededUnit(seed, 8) * twoPi }
  ];

  const waveMovement = waves.reduce(
    (total, wave) => total + Math.sin((tick / wave.period) * twoPi + wave.phase) * wave.amplitude,
    0
  );
  const noiseMovement = interpolatedNoise(seed, tick) * 0.0075;

  return roundMultiplier(clamp(1 + waveMovement + noiseMovement, STOCK_PRICE_MIN_MULTIPLIER, STOCK_PRICE_MAX_MULTIPLIER));
}

export function simulatedStockPrice(anchorPrice: number, symbol: string, timestampMs: number) {
  const safeAnchor = Number(anchorPrice);
  if (!Number.isFinite(safeAnchor) || safeAnchor <= 0) return 0;
  return Math.max(0.01, roundCurrency(safeAnchor * stockPriceMultiplier(symbol, timestampMs)));
}

export function createStockPriceSeries(
  anchorPrice: number,
  symbol: string,
  timestampMs: number,
  pointCount = STOCK_MOVEMENT_POINT_COUNT
): number[] {
  const count = Math.max(2, Math.trunc(pointCount) || STOCK_MOVEMENT_POINT_COUNT);
  const endTick = stockMarketTick(timestampMs);

  return Array.from({ length: count }, (_, index) => {
    const tick = endTick - (count - 1 - index);
    return simulatedStockPrice(anchorPrice, symbol, tick * STOCK_MOVEMENT_UPDATE_MS);
  });
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
