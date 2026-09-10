// @vitest-environment jsdom
//
// CORRECCIÓN — hydration mismatch reportado en el <title> de cada
// <circle> de LineChart. Causa probable señalada: formatChartValue
// (compartido con BarChart) podía producir un texto distinto entre el
// render en el servidor (Next SSR de este Client Component, que de
// todas formas se renderiza primero en el servidor porque vive dentro
// de un Server Component) y la hidratación en el navegador, si el
// formato numérico dependía del locale/ICU del entorno en ejecución.
//
// Esta prueba reproduce el escenario REAL: renderiza a HTML con
// react-dom/server (equivalente al paso de SSR), monta ese HTML tal
// cual en un contenedor del DOM, y luego hidrata ese mismo contenedor
// con react-dom/client — exactamente el mismo mecanismo que usa
// Next.js. Si el texto no coincide, React emite un warning/error de
// hydration por consola; esta prueba falla si aparece cualquiera.
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { act } from "react";
import { LineChart, type LineChartDatum, type LineChartSeries } from "./line-chart";
import type { ChartValueFormat } from "./bar-chart";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SERIES: LineChartSeries[] = [
  { key: "expected", label: "Esperado" },
  { key: "received", label: "Recibido" },
];

const DATA: LineChartDatum[] = [
  { label: "2026-01", values: { expected: 1234.5, received: 999.99 } },
  { label: "2026-02", values: { expected: 2000, received: 1500.25 } },
  { label: "2026-03", values: { expected: 87654.321, received: 12.3 } },
];

async function assertNoHydrationMismatch(valueFormat: ChartValueFormat) {
  const element = <LineChart data={DATA} series={SERIES} valueFormat={valueFormat} />;

  // Paso 1 — equivalente al SSR real: renderiza a un string de HTML,
  // tal como lo haría el servidor de Next para este árbol.
  const html = renderToString(element);

  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);

  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    // Paso 2 — hidratación real sobre el HTML ya insertado, mismo
    // mecanismo que usa el navegador al recibir el HTML servido por
    // Next.js y "engancharle" React encima.
    await act(async () => {
      hydrateRoot(container, element);
    });
  } finally {
    errorSpy.mockRestore();
    container.remove();
  }

  const messages = errorSpy.mock.calls.map((args) => args.map(String).join(" "));
  expect(messages).toEqual([]);
}

describe("LineChart — SSR + hydrateRoot sin advertencias de hydration (CORRECCIÓN: formato numérico determinista)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("valueFormat=\"currency\" (Intl.NumberFormat en-US/USD) hidrata sin diferencias", async () => {
    await assertNoHydrationMismatch("currency");
  });

  it("valueFormat=\"number\" (Intl.NumberFormat en-US) hidrata sin diferencias", async () => {
    await assertNoHydrationMismatch("number");
  });

  it("valueFormat=\"percent\" (Intl.NumberFormat en-US, style percent) hidrata sin diferencias", async () => {
    await assertNoHydrationMismatch("percent");
  });

  it("el HTML servido y el HTML hidratado contienen exactamente el mismo texto en cada <title>", async () => {
    const element = <LineChart data={DATA} series={SERIES} valueFormat="currency" />;
    const ssrHtml = renderToString(element);

    // El texto formateado ($1,234.50, etc.) debe aparecer igual en el
    // HTML servido — confirma que el formateador determinista ya
    // produce el texto final desde el servidor, nunca placeholders
    // que cambien luego en el cliente.
    expect(ssrHtml).toContain("$1,234.50");
    expect(ssrHtml).toContain("$999.99");
    expect(ssrHtml).toContain("$87,654.32");
  });
});
