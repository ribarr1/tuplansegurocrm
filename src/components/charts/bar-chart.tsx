"use client";

import { useId, useState } from "react";

// Gráfica de barras SVG hecha a mano — el proyecto no tiene ninguna
// librería de gráficas (package.json) y el ticket pide explícitamente
// no agregar una dependencia nueva si no es necesario. Series
// múltiples se dibujan agrupadas (una barra por serie, por categoría).
// Usa los tokens --chart-1..5 ya definidos en globals.css (claro/oscuro).
export type BarChartSeries = { key: string; label: string; color?: string };
export type BarChartDatum = { category: string; values: Record<string, number> };
// Formato serializable — NUNCA una función como prop: este componente
// es "use client" y las páginas que lo usan (Server Components) no
// pueden pasarle un valueFormatter de tipo función a través de la
// frontera servidor/cliente (React la rechaza en runtime con "Functions
// cannot be passed directly to Client Components"). El formateo real
// ocurre aquí adentro, del lado del cliente, a partir de esta etiqueta.
export type ChartValueFormat = "currency" | "number" | "percent";

const DEFAULT_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

// CORRECCIÓN — hydration mismatch en el <title> de cada punto/barra:
// formatChartValue corre tanto en el servidor (SSR del árbol de este
// Client Component, ya que se renderiza dentro de un Server Component)
// como en el navegador durante la hidratación. Cualquier formato que
// dependa del locale/ICU del entorno en tiempo de ejecución (el locale
// "default" del navegador del usuario vs. el locale/build de ICU de
// Node en el servidor) puede producir un texto distinto entre ambos
// renders — React detecta la diferencia de texto dentro de <title> y
// lanza un hydration mismatch. Los tres formatos usan SIEMPRE locale
// "en-US" explícito vía instancias de Intl.NumberFormat cacheadas a
// nivel de módulo (nunca Number.prototype.toLocaleString sin locale,
// nunca el locale del navegador, nunca Date.now()/Math.random()/window
// durante el render) — el mismo Intl.NumberFormat("en-US", ...)
// produce el mismo string en Node y en cualquier navegador, siempre.
const currencyFormatter = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const numberFormatter = new Intl.NumberFormat("en-US");

export function formatChartValue(value: number, format: ChartValueFormat): string {
  if (format === "currency") return currencyFormatter.format(value);
  // Intl.NumberFormat({style:"percent"}) espera una fracción (0.42 ->
  // "42.0%"), pero los valores de este proyecto ya vienen expresados
  // como porcentaje entero/decimal (ej. 42.0 -> "42.0%") — se divide
  // entre 100 antes de formatear para conservar exactamente el mismo
  // significado que tenía `${value.toFixed(1)}%`, solo que ahora con
  // locale explícito y determinista.
  if (format === "percent") return percentFormatter.format(value / 100);
  return numberFormatter.format(value);
}

export function BarChart({
  data,
  series,
  height = 240,
  valueFormat = "number",
  emptyMessage = "No hay datos para mostrar con los filtros actuales.",
}: {
  data: BarChartDatum[];
  series: BarChartSeries[];
  height?: number;
  valueFormat?: ChartValueFormat;
  emptyMessage?: string;
}) {
  const valueFormatter = (v: number) => formatChartValue(v, valueFormat);
  const gradientId = useId();
  const [hovered, setHovered] = useState<{ category: string; seriesKey: string } | null>(null);

  if (data.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  const maxValue = Math.max(1, ...data.flatMap((d) => series.map((s) => d.values[s.key] ?? 0)));
  const width = Math.max(320, data.length * series.length * 36 + data.length * 16);
  const chartHeight = height;
  const paddingBottom = 28;
  const paddingTop = 8;
  const plotHeight = chartHeight - paddingBottom - paddingTop;
  const groupWidth = width / data.length;
  const barWidth = Math.min(28, (groupWidth - 12) / series.length);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${chartHeight}`}
          width="100%"
          height={chartHeight}
          role="img"
          aria-label="Gráfica de barras"
          className="min-w-[320px]"
        >
          <title id={gradientId}>Gráfica de barras</title>
          <line
            x1={0}
            y1={chartHeight - paddingBottom}
            x2={width}
            y2={chartHeight - paddingBottom}
            stroke="var(--color-border)"
            strokeWidth={1}
          />
          {data.map((d, groupIndex) => {
            const groupX = groupIndex * groupWidth;
            return (
              <g key={d.category}>
                {series.map((s, seriesIndex) => {
                  const value = d.values[s.key] ?? 0;
                  const barHeight = maxValue === 0 ? 0 : (value / maxValue) * plotHeight;
                  const x = groupX + seriesIndex * barWidth + (groupWidth - series.length * barWidth) / 2;
                  const y = chartHeight - paddingBottom - barHeight;
                  const isHovered = hovered?.category === d.category && hovered?.seriesKey === s.key;
                  return (
                    <g key={s.key}>
                      <rect
                        x={x}
                        y={y}
                        width={barWidth}
                        height={barHeight}
                        rx={2}
                        fill={s.color ?? DEFAULT_COLORS[seriesIndex % DEFAULT_COLORS.length]}
                        opacity={isHovered ? 1 : 0.85}
                        onMouseEnter={() => setHovered({ category: d.category, seriesKey: s.key })}
                        onMouseLeave={() => setHovered(null)}
                      >
                        {/* CORRECCIÓN — hydration mismatch real: React exige que
                            <title> reciba un ÚNICO string como children (documentado
                            en su propio warning de desarrollo) — con varios hijos
                            interpolados (ej. {a} — {b}: {c}) el SSR renderiza un
                            <title></title> VACÍO mientras la hidratación en el
                            navegador sí lo puebla, produciendo exactamente el
                            mismatch reportado. Se precomputa el texto completo como
                            UN solo string determinista (nunca suppressHydrationWarning). */}
                        <title>{`${d.category} — ${s.label}: ${valueFormatter(value)}`}</title>
                      </rect>
                    </g>
                  );
                })}
                <text
                  x={groupX + groupWidth / 2}
                  y={chartHeight - 10}
                  textAnchor="middle"
                  fontSize={11}
                  fill="var(--color-muted-foreground)"
                >
                  {d.category.length > 14 ? `${d.category.slice(0, 13)}…` : d.category}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {series.map((s, i) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ background: s.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length] }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <AccessibleTable data={data} series={series} valueFormatter={valueFormatter} />
    </div>
  );
}

// Alternativa tabular accesible — el ticket exige explícitamente
// "incluir tooltips, leyendas, estados vacíos y alternativa tabular
// accesible" para cada gráfica del dashboard de pólizas (y por
// consistencia, se aplica también a comisiones). Oculta visualmente
// pero disponible para lectores de pantalla y para quien prefiera ver
// los números exactos.
function AccessibleTable({
  data,
  series,
  valueFormatter,
}: {
  data: BarChartDatum[];
  series: BarChartSeries[];
  valueFormatter: (value: number) => string;
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Ver como tabla</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b">
              <th className="py-1 pr-3 font-medium">Categoría</th>
              {series.map((s) => (
                <th key={s.key} className="py-1 pr-3 font-medium">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.category} className="border-b last:border-0">
                <td className="py-1 pr-3">{d.category}</td>
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

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
      {message}
    </div>
  );
}
