"use client";

import { useMemo, useRef, useState } from "react";
import { money } from "@/lib/format";
import type { PricePoint } from "@/lib/stocks";

const WIDTH = 720;
const HEIGHT = 260;
const PAD = { top: 14, right: 56, bottom: 24, left: 8 };

function formatAxisDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value; // intraday "09:30" labels
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTooltipDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return `${value} ET`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Dependency-free SVG area chart for the market-flow view, with a
 * hover/touch crosshair. Green when the visible period ends higher
 * than it started, red otherwise.
 */
export function StockChart({ points, ariaLabel }: { points: PricePoint[]; ariaLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const model = useMemo(() => {
    if (points.length < 2) return null;
    const closes = points.map((point) => point.c);
    const min = Math.min(...closes);
    const max = Math.max(...closes);
    const span = max - min || max * 0.02 || 1;
    const low = min - span * 0.08;
    const high = max + span * 0.08;
    const plotWidth = WIDTH - PAD.left - PAD.right;
    const plotHeight = HEIGHT - PAD.top - PAD.bottom;

    const x = (index: number) => PAD.left + (index / (points.length - 1)) * plotWidth;
    const y = (value: number) => PAD.top + (1 - (value - low) / (high - low)) * plotHeight;

    const line = points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index).toFixed(2)},${y(point.c).toFixed(2)}`).join(" ");
    const area = `${line} L${x(points.length - 1).toFixed(2)},${HEIGHT - PAD.bottom} L${x(0).toFixed(2)},${HEIGHT - PAD.bottom} Z`;
    const gridValues = [0.1, 0.36, 0.62, 0.88].map((fraction) => low + (high - low) * fraction);
    const rising = closes[closes.length - 1] >= closes[0];

    return { x, y, line, area, gridValues, rising, min, max };
  }, [points]);

  if (!model) {
    return (
      <div className="grid h-[260px] place-items-center rounded-xl bg-off text-sm text-grey" role="img" aria-label={ariaLabel}>
        Not enough price data to draw this chart yet.
      </div>
    );
  }

  const stroke = model.rising ? "#00a88a" : "#e11d48";
  const hovered = hoverIndex !== null ? points[hoverIndex] : null;

  function moveHover(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || !model) return;
    const fraction = (clientX - rect.left) / rect.width;
    const plotFraction = (fraction * WIDTH - PAD.left) / (WIDTH - PAD.left - PAD.right);
    const index = Math.round(plotFraction * (points.length - 1));
    setHoverIndex(Math.max(0, Math.min(points.length - 1, index)));
  }

  const xLabels = [0, 0.25, 0.5, 0.75, 1].map((fraction) => {
    const index = Math.min(points.length - 1, Math.round(fraction * (points.length - 1)));
    return { index, label: formatAxisDate(points[index].t) };
  });

  return (
    <div className="relative" ref={containerRef}>
      <svg
        aria-label={ariaLabel}
        className="block w-full"
        onMouseLeave={() => setHoverIndex(null)}
        onMouseMove={(event) => moveHover(event.clientX)}
        onTouchMove={(event) => moveHover(event.touches[0].clientX)}
        onTouchStart={(event) => moveHover(event.touches[0].clientX)}
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <defs>
          <linearGradient id="stock-chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.26" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {model.gridValues.map((value) => (
          <g key={value}>
            <line stroke="#e6ecf5" strokeDasharray="3 5" x1={PAD.left} x2={WIDTH - PAD.right} y1={model.y(value)} y2={model.y(value)} />
            <text fill="#8a96a8" fontSize="10" x={WIDTH - PAD.right + 8} y={model.y(value) + 3}>
              {money(value)}
            </text>
          </g>
        ))}

        <path d={model.area} fill="url(#stock-chart-fill)" />
        <path d={model.line} fill="none" stroke={stroke} strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />

        <circle cx={model.x(points.length - 1)} cy={model.y(points[points.length - 1].c)} fill={stroke} r="3.5">
          <animate attributeName="r" dur="1.6s" repeatCount="indefinite" values="3.5;5;3.5" />
        </circle>

        {hovered && hoverIndex !== null ? (
          <g>
            <line stroke="#0a1628" strokeDasharray="3 3" strokeOpacity="0.35" x1={model.x(hoverIndex)} x2={model.x(hoverIndex)} y1={PAD.top} y2={HEIGHT - PAD.bottom} />
            <circle cx={model.x(hoverIndex)} cy={model.y(hovered.c)} fill="#fff" r="4.5" stroke={stroke} strokeWidth="2.5" />
          </g>
        ) : null}

        {xLabels.map(({ index, label }) => (
          <text
            fill="#8a96a8"
            fontSize="10"
            key={`${index}-${label}`}
            textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"}
            x={model.x(index)}
            y={HEIGHT - 6}
          >
            {label}
          </text>
        ))}
      </svg>

      {hovered && hoverIndex !== null ? (
        <div
          className="pointer-events-none absolute top-2 z-10 -translate-x-1/2 rounded-lg bg-navy px-3 py-2 text-center text-white shadow-lg"
          style={{ left: `${Math.max(12, Math.min(88, (model.x(hoverIndex) / WIDTH) * 100))}%` }}
        >
          <p className="text-sm font-black">{money(hovered.c)}</p>
          <p className="text-[10px] text-white/60">{formatTooltipDate(hovered.t)}</p>
          {typeof hovered.v === "number" ? (
            <p className="text-[10px] text-white/60">Vol {Math.round(hovered.v).toLocaleString("en-US")}</p>
          ) : null}
        </div>
      ) : (
        <div className="pointer-events-none absolute right-14 top-2 flex gap-3 text-[11px] font-semibold text-grey">
          <span>High {money(model.max)}</span>
          <span>Low {money(model.min)}</span>
        </div>
      )}
    </div>
  );
}

/** Tiny inline trend line used in the market-watch list. */
export function Sparkline({ data, width = 88, height = 28 }: { data: number[]; width?: number; height?: number }) {
  if (data.length < 2) return <span className="inline-block text-xs text-grey" style={{ width }}>—</span>;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((value, index) => `${((index / (data.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 3 - ((value - min) / span) * (height - 6)).toFixed(1)}`)
    .join(" ");
  const rising = data[data.length - 1] >= data[0];
  return (
    <svg aria-hidden="true" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      <polyline fill="none" points={points} stroke={rising ? "#00a88a" : "#e11d48"} strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </svg>
  );
}
