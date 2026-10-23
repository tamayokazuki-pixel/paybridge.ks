import { useId } from "react";
import {
  buildStockSparklineGeometry,
  formatStockMovementPercent,
  stockMovementChange
} from "@/lib/stock-movement";

const CHART_WIDTH = 260;
const CHART_HEIGHT = 72;

export function StockMovementChart({
  points,
  symbol
}: {
  points: readonly number[];
  symbol: string;
}) {
  const gradientId = `stock-fill-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const movement = stockMovementChange(points);
  const geometry = buildStockSparklineGeometry(points, CHART_WIDTH, CHART_HEIGHT);
  const stroke = movement.direction === "up"
    ? "#00a88a"
    : movement.direction === "down"
      ? "#e11d48"
      : "#64748b";
  const directionLabel = movement.direction === "flat" ? "unchanged" : movement.direction;

  return (
    <svg
      aria-label={`${symbol} session movement chart, ${directionLabel} ${formatStockMovementPercent(movement.percent)}`}
      className="h-16 w-full overflow-visible"
      preserveAspectRatio="none"
      role="img"
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.24" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {[18, 36, 54].map((y) => (
        <line
          key={y}
          stroke="#e2e8f0"
          strokeDasharray="2 5"
          strokeWidth="1"
          vectorEffect="non-scaling-stroke"
          x1="0"
          x2={CHART_WIDTH}
          y1={y}
          y2={y}
        />
      ))}

      <line
        stroke="#94a3b8"
        strokeDasharray="3 4"
        strokeOpacity="0.55"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
        x1={geometry.firstPoint.x}
        x2={geometry.lastPoint.x}
        y1={geometry.baselineY}
        y2={geometry.baselineY}
      />
      <path d={geometry.areaPath} fill={`url(#${gradientId})`} />
      <path
        d={geometry.linePath}
        fill="none"
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.6"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        className="animate-pulse motion-reduce:animate-none"
        cx={geometry.lastPoint.x}
        cy={geometry.lastPoint.y}
        fill={stroke}
        opacity="0.18"
        r="7"
      />
      <circle
        cx={geometry.lastPoint.x}
        cy={geometry.lastPoint.y}
        fill={stroke}
        r="3.5"
        stroke="#ffffff"
        strokeWidth="1.5"
      />
    </svg>
  );
}
