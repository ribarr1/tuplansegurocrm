import { describe, it, expect } from "vitest";
import { OrangeOscarAdapter } from "./orange-oscar-adapter";

// Fase 020 (§30, letras A-F) — ejemplo real del reporte "REPORTE DE
// PAGO OSCAR AGOSTO ORANGE 2026" tal como aparece en la ficha.
const SAMPLE_CSV = [
  "Member ID,Name,Agent,Sale Type,State,Type,Carrier,Status,Rate,Members,Subtotal,Asistencia,Total,Effective Date,Paid At",
  "OSC74659064-01,Viridiana Cabrales,Agent A,NEW,IL,HEALTH,Oscar,ACTIVE,25,2,50,6,44,08/01/2026,08/15/2026",
  "OSC74752358-01,Leonardo Cardoso,Agent A,NEW,IL,HEALTH,Oscar,ACTIVE,25,1,25,0,25,08/01/2026,08/15/2026",
  "OSC75029566-01,Scarlen Luna Sanchez,Agent B,NEW,NJ,HEALTH,Oscar,ACTIVE,20,1,20,0,20,08/01/2026,08/15/2026",
  "OSC75182990-01,Erynic Avila-Alvarez,Agent B,NEW,NJ,HEALTH,Oscar,ACTIVE,20,1,20,0,20,08/01/2026,08/15/2026",
  "OSC75364647-01,Jaime Rubio Franco,Agent A,NEW,IL,HEALTH,Oscar,ACTIVE,25,1,25,0,25,08/01/2026,08/15/2026",
  "OSC75552125-01,Vanessa Campos,Agent A,NEW,IL,HEALTH,Oscar,ACTIVE,25,3,75,0,75,08/01/2026,08/15/2026",
  "OSC77869554-01,Domingo Duque Vera,Agent C,RENEW,OH,HEALTH,Oscar,ACTIVE,18,1,18,0,18,08/01/2026,08/15/2026",
].join("\n");

describe("OrangeOscarAdapter — reconciliación de comisiones (Fase 020)", () => {
  it("A) receivedAmount usa Subtotal", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const viridiana = parsed.rows.find((r) => r.externalMemberId === "OSC74659064-01")!;
    expect(viridiana.receivedAmount).toBe("50");
  });

  it("B) NUNCA usa Total como receivedAmount", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const viridiana = parsed.rows.find((r) => r.externalMemberId === "OSC74659064-01")!;
    expect(viridiana.receivedAmount).not.toBe("44");
  });

  it("C) Asistencia se ignora por completo — nunca aparece en el DTO normalizado", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const viridiana = parsed.rows.find((r) => r.externalMemberId === "OSC74659064-01")!;
    expect(viridiana).not.toHaveProperty("asistencia");
    expect(viridiana).not.toHaveProperty("assistance");
  });

  it("D) ejemplo Rate=25/Members=2/Subtotal=50/Asistencia=6/Total=44 -> receivedAmount = 50", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const viridiana = parsed.rows.find((r) => r.externalMemberId === "OSC74659064-01")!;
    expect(viridiana.rate).toBe("25");
    expect(viridiana.memberCount).toBe(2);
    expect(viridiana.receivedAmount).toBe("50");
  });

  it("E) Vanessa Campos (Rate=25, Members=3) -> receivedAmount = 75", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const vanessa = parsed.rows.find((r) => r.externalMemberId === "OSC75552125-01")!;
    expect(vanessa.receivedAmount).toBe("75");
  });

  it("F) total normalizado del statement es $233, nunca $203 (que sería post-Asistencia)", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const total = parsed.rows.reduce((sum, r) => sum + Number(r.receivedAmount), 0);
    expect(total).toBe(233);
    expect(total).not.toBe(203);
    expect(parsed.declaredTotal).toBe("233.00");
  });

  it("parsea 7 filas del reporte de ejemplo", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    expect(parsed.rows).toHaveLength(7);
  });

  it("parsea fechas MM/DD/YYYY sin desplazamiento de zona horaria", async () => {
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV, "utf-8"), "reporte.csv");
    const viridiana = parsed.rows.find((r) => r.externalMemberId === "OSC74659064-01")!;
    expect(viridiana.paidAt?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(viridiana.effectiveDate?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  it("rechaza un archivo sin las columnas requeridas", async () => {
    const badCsv = "Foo,Bar\n1,2";
    await expect(OrangeOscarAdapter.parse(Buffer.from(badCsv, "utf-8"), "malo.csv")).rejects.toThrow();
  });

  it("rechaza una extensión no soportada", async () => {
    await expect(OrangeOscarAdapter.parse(Buffer.from(SAMPLE_CSV), "reporte.pdf")).rejects.toThrow();
  });

  it("maneja campos entrecomillados con comas (ej. apellidos compuestos)", async () => {
    const csvWithQuotes = [
      "Member ID,Name,Agent,Sale Type,State,Type,Carrier,Status,Rate,Members,Subtotal,Asistencia,Total,Effective Date,Paid At",
      'OSC99999999-01,"Cardoso, Leonardo",Agent A,NEW,IL,HEALTH,Oscar,ACTIVE,25,1,25,0,25,08/01/2026,08/15/2026',
    ].join("\n");
    const parsed = await OrangeOscarAdapter.parse(Buffer.from(csvWithQuotes, "utf-8"), "reporte.csv");
    expect(parsed.rows[0].memberName).toBe("Cardoso, Leonardo");
  });
});
