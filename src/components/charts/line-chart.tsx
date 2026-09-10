"use client";

import { useState } from "react";
import { EmptyState } from "@/components/charts/bar-chart";

// Gráfica de líneas SVG hecha a mano (mismo criterio que bar-chart.tsx
// — sin dependencia nueva). Series múltiples se dibujan como
// polilíneas superpuestas, cada una con su propio color de
// --chart-1..5.
export type LineChartSeries = { key: string; label: string; color?: string };
export type LineChartDatum = { label: string; values: Record<string, number> };

const DEFAULT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function LineChart({
  data,
  series,
  height = 240,
  valueFormatter = (v: number) => v.toLocaleString("en-US"),
  emptyMessage = "No hay datos para mostrar con los filtros actuales.",
}: {
  data: LineChartDatum[];
  series: LineChartSeries[];
  height?: number;
  valueFormatter?: (value: number) => string;
  emptyMessage?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const allValues = data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0));
  const maxValue = Math.max(1, ...allValues);
  const minValue = Math.min(0, ...allValues);
  const width = Math.max(360, data.length * 56);
  const paddingBottom = 28;
  const paddingTop = 12;
  const paddingX = 12;
  const plotHeight = height - paddingBottom - paddingTop;
  const plotWidth = width - paddingX * 2;
  const range = maxValue - minValue || 1;

  function xFor(index: number): number {
    return paddingX + (data.length === 1 ? plotWidth / 2 : (index / (data.length - 1)) * plotWidth);
  }
  function yFor(value: number): number {
    return paddingTop + plotHeight - ((value - minValue) / range) * plotHeight;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} role="img" aria-label="Gráfica de líneas" className="min-w-[320px]">
          <line x1={paddingX} y1={yFor(0)} x2={width - paddingX} y2={yFor(0)} stroke="var(--color-border)" strokeWidth={1} />
          {series.map((s, seriesIndex) => {
            const color = s.color ?? DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length];
            const points = data.map((d, i) => `${xFor(i)},${yFor(d.values[s.key] ?? 0)}`).join(" ");
            return (
              <g key={s.key}>
                <polyline points={points} fill="none" stroke={color} strokeWidth={2} />
                {data.map((d, i) => (
                  <circle
                    key={i}
                    cx={xFor(i)}
                    cy={yFor(d.values[s.key] ?? 0)}
                    r={hovered === i ? 4 : 2.5}
                    fill={color}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <title>
                      {d.label} — {s.label}: {valueFormatter(d.values[s.key] ?? 0)}
                    </title>
                  </circle>
                ))}
              </g>
            );
          })}
          {data.map((d, i) => (
            <text key={d.label} x={xFor(i)} y={height - 8} textAnchor="middle" fontSize={11} fill="var(--color-muted-foreground)">
              {d.label}
            </text>
          ))}
        </svg>
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="inline-block size-2.5 rounded-full" style={{ background: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <AccessibleTable data={data} series={series} valueFormatter={valueFormatter} />
    </div>
  );
}

function AccessibleTable({
  data,
  series,
  valueFormatter,
}: {
  data: LineChartDatum[];
  series: LineChartSeries[];
  valueFormatter: (value: number) => string;
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Ver como tabla</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-3 font-medium">Período</th>
              {series.map((s) => (
                <th key={s.key} className="py-1 pr-3 font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label} className="border-b last:border-0">
                <td className="py-1 pr-3">{d.label}</td>
                {series.map((s) => (
                  <td key={s.key} className="py-1 pr-3">
                    {valueFormatter(d.values[s.key] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
