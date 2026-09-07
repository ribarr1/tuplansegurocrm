import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { buildTestTablePdf } from "./test-pdf-builder";
import { OrangeOscarPdfAdapter } from "./orange-oscar-pdf-adapter";

// ---------------------------------------------------------------------------
// Fase 025.5.2 — la cantidad de filas de un reporte PDF NUNCA es fija (1,
// 2, 4, 25, cientos), y puede venir en una o varias páginas. Estas
// pruebas verifican al ADAPTER completo (no solo pdf-table-extract.ts)
// contra PDF sintéticos generados a medida — nunca datos reales, nunca
// una cantidad de filas codificada en el parser.
//
// Se usa OrangeOscarPdfAdapter como vehículo representativo del layout
// Orange (Member ID/Name/Agent/State/Carrier/Status/Rate/Members/
// Subtotal/Asistencia/Total/Effective Date/Paid At) — Kaiser y Elite
// comparten el mismo motor de extracción (pdf-table-extract.ts), cuya
// corrección aquí los beneficia igual (ver pdf-import.service.test.ts
// para pruebas dedicadas a cada adapter).
// ---------------------------------------------------------------------------

const HEADERS = [
  "Member ID", "Name", "Agent", "State", "Carrier", "Status", "Rate", "Members",
  "Subtotal", "Asistencia", "Total", "Effective Date", "Paid At",
];

function dataRow(i: number, subtotal: string, assistance: string, total: string): string[] {
  return [
    `OSC${1000 + i}`, `Sintetico Nombre${i}`, "Agent Test", "IL", "Oscar", "ACTIVE",
    "25.00", "1", subtotal, assistance, total, "2026-01-01", "2026-01-15",
  ];
}

function footerRow(amount: string): string[] {
  return ["Total", "", "", "", "", "", "", "", "", "", amount, "", ""];
}

describe("pdf-table-extract / adaptadores PDF — cantidad variable de filas (Fase 025.5.2)", () => {
  it("1 fila: se detecta correctamente, footer coincide", async () => {
    const pdf = buildTestTablePdf([HEADERS, dataRow(1, "25.00", "3.00", "22.00"), footerRow("22.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "one-row.pdf");
    expect(result.rows).toHaveLength(1);
    expect(result.declaredTotal).toBe("22.00");
  });

  it("2 filas: se detectan ambas, footer = suma de netos", async () => {
    const rows = [dataRow(1, "25.00", "3.00", "22.00"), dataRow(2, "30.00", "5.00", "25.00")];
    const pdf = buildTestTablePdf([HEADERS, ...rows, footerRow("47.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "two-rows.pdf");
    expect(result.rows).toHaveLength(2);
    expect(result.declaredTotal).toBe("47.00");
  });

  it("25 filas: todas se detectan, ninguna se pierde ni se trunca", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => dataRow(i + 1, "20.00", "2.00", "18.00"));
    const pdf = buildTestTablePdf([HEADERS, ...rows, footerRow("450.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "twentyfive-rows.pdf");
    expect(result.rows).toHaveLength(25);
    const netSum = result.rows
      .reduce((sum, r) => sum.plus(new Prisma.Decimal(r.netAmount ?? "0")), new Prisma.Decimal(0))
      .toFixed(2);
    expect(netSum).toBe("450.00");
    expect(result.declaredTotal).toBe("450.00");
  });

  it("cero filas de datos (encabezado + footer sin ningún registro) produce un resultado sin filas, nunca inventa una", async () => {
    const pdf = buildTestTablePdf([HEADERS, footerRow("0.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "zero-rows.pdf");
    expect(result.rows).toHaveLength(0);
  });

  it("nombres largos no rompen el mapeo posicional de columnas", async () => {
    const longName = "Nombre Sintetico Extremadamente Largo Para Probar Ancho De Columna Variable";
    const row = [
      "OSC9999", longName, "Agent Test", "IL", "Oscar", "ACTIVE",
      "25.00", "1", "25.00", "0.00", "25.00", "2026-01-01", "2026-01-15",
    ];
    const pdf = buildTestTablePdf([HEADERS, row]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "long-name.pdf");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].memberName).toBe(longName);
  });

  it("Asistencia = 0.00 se conserva como cero, nunca se confunde con ausente", async () => {
    const pdf = buildTestTablePdf([HEADERS, dataRow(1, "25.00", "0.00", "25.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "zero-assistance.pdf");
    expect(result.rows[0].assistanceAmount).toBe("0.00");
    expect(result.rows[0].netAmount).toBe("25.00");
  });

  it("importes decimales (centavos) se preservan con precisión exacta", async () => {
    const pdf = buildTestTablePdf([HEADERS, dataRow(1, "33.33", "1.11", "32.22")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "decimals.pdf");
    expect(result.rows[0].receivedAmount).toBe("33.33");
    expect(result.rows[0].assistanceAmount).toBe("1.11");
    expect(result.rows[0].netAmount).toBe("32.22");
  });

  it("footer incorrecto (no coincide con la suma) se reporta tal cual — declaredTotal nunca se corrige solo", async () => {
    const rows = [dataRow(1, "25.00", "3.00", "22.00"), dataRow(2, "30.00", "5.00", "25.00")];
    const pdf = buildTestTablePdf([HEADERS, ...rows, footerRow("999.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "wrong-footer.pdf");
    expect(result.rows).toHaveLength(2);
    expect(result.declaredTotal).toBe("999.00"); // se reporta el valor real del PDF, la validación de coincidencia ocurre en reconciliation.service.ts
  });

  it("fila incompleta (columna faltante en esa fila puntual) se reconstruye por posición X y se marca con warning, nunca se descarta en silencio", async () => {
    // Fila sin el campo "Members" (12 celdas en vez de 13) — rowToRecord
    // reconstruye por cercanía en X y reporta mismatched=true.
    const incompleteRow = [
      "OSC1234", "Persona Incompleta", "Agent Test", "IL", "Oscar", "ACTIVE",
      "25.00", "25.00", "3.00", "22.00", "2026-01-01", "2026-01-15",
    ];
    const pdf = buildTestTablePdf([HEADERS, incompleteRow]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "incomplete-row.pdf");
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].warnings?.some((w) => w.includes("no coincidieron"))).toBe(true);
  });
});

describe("pdf-table-extract / adaptadores PDF — reportes de varias páginas (Fase 025.5.2)", () => {
  it("2 páginas con encabezado repetido: todas las filas de ambas páginas se detectan, en orden, sin duplicar el encabezado como dato", async () => {
    const page1 = [HEADERS, dataRow(1, "25.00", "3.00", "22.00"), dataRow(2, "30.00", "5.00", "25.00")];
    const page2 = [HEADERS, dataRow(3, "40.00", "4.00", "36.00"), footerRow("83.00")];
    const pdf = buildTestTablePdf([page1, page2]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "two-pages.pdf");
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.externalMemberId)).toEqual(["OSC1001", "OSC1002", "OSC1003"]);
    expect(result.declaredTotal).toBe("83.00");
  });

  it("una fila justo antes del salto de página y otra justo después se detectan ambas, sin fusionarse", async () => {
    const page1 = [HEADERS, dataRow(1, "25.00", "3.00", "22.00")];
    const page2 = [HEADERS, dataRow(2, "30.00", "5.00", "25.00")];
    const pdf = buildTestTablePdf([page1, page2]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "page-break.pdf");
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].externalMemberId).toBe("OSC1001");
    expect(result.rows[1].externalMemberId).toBe("OSC1002");
  });

  it("3 páginas: el total general es el ÚLTIMO footer encontrado, no un subtotal intermedio de página", async () => {
    // Cada página trae su propio "Total" (subtotal de esa página) — solo
    // el de la última página debe quedar como declaredTotal, nunca el
    // de una página intermedia.
    const page1 = [HEADERS, dataRow(1, "25.00", "3.00", "22.00"), footerRow("22.00")];
    const page2 = [HEADERS, dataRow(2, "30.00", "5.00", "25.00"), footerRow("25.00")];
    const page3 = [HEADERS, dataRow(3, "40.00", "4.00", "36.00"), footerRow("83.00")]; // total general acumulado
    const pdf = buildTestTablePdf([page1, page2, page3]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "three-pages-subtotals.pdf");
    expect(result.rows).toHaveLength(3);
    expect(result.declaredTotal).toBe("83.00");
  });

  it("una sola fila de datos repartida en 1 página sigue funcionando igual que antes (no se rompe el caso de una sola página)", async () => {
    const pdf = buildTestTablePdf([[HEADERS, dataRow(1, "25.00", "3.00", "22.00")]]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "single-page-array.pdf");
    expect(result.rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Regresión dirigida — Fase 025.5.2, Corrección 2: el PDF real de
// Orange/Oscar suministrado en Fase 025.5.1 tiene 3 filas (no 4), con
// netos $22/$22/$15 = $59, footer $59.00 — confirmado por extracción
// directa contra el archivo real (ver informe de esta fase). Esta
// prueba reproduce, con datos 100% sintéticos, el escenario que SÍ
// describe correctamente el comportamiento esperado del sistema para un
// reporte de 4 filas con netos $17/$22/$22/$15 = $76 (el escenario que
// el ticket describía) — confirma que CUALQUIERA de los dos casos (3 o
// 4 filas) se detecta y reconcilia correctamente, sin asumir un número
// fijo.
// ---------------------------------------------------------------------------
describe("Regresión dirigida — reporte Oscar de 4 filas ($17+$22+$22+$15=$76)", () => {
  it("4 filas sintéticas equivalentes en estructura al escenario reportado: se detectan las 4, el neto suma $76, footer coincide", async () => {
    const rows = [
      dataRow(1, "20.00", "3.00", "17.00"),
      dataRow(2, "25.00", "3.00", "22.00"),
      dataRow(3, "25.00", "3.00", "22.00"),
      dataRow(4, "18.00", "3.00", "15.00"),
    ];
    const pdf = buildTestTablePdf([HEADERS, ...rows, footerRow("76.00")]);
    const result = await OrangeOscarPdfAdapter.parse(pdf, "oscar-4-rows.pdf");

    expect(result.rows).toHaveLength(4);
    const netSum = result.rows
      .reduce((sum, r) => sum.plus(new Prisma.Decimal(r.netAmount ?? "0")), new Prisma.Decimal(0))
      .toFixed(2);
    expect(netSum).toBe("76.00");
    expect(result.declaredTotal).toBe("76.00");
  });
});
