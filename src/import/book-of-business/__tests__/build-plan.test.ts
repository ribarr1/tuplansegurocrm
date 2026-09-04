import { describe, it, expect } from "vitest";
import { parseCsv, csvRowsToRecords } from "../csv";
import { parseSourceRecords } from "../parse-source";
import { buildImportPlan } from "../build-plan";
import { buildFixtureCsv, type FixtureRow } from "./fixture";

const CARRIER_CATALOG = [{ name: "AMBETTER" }, { name: "OSCAR" }];

async function plan(rows: FixtureRow[], carriers = CARRIER_CATALOG) {
  const csv = buildFixtureCsv(rows);
  const records = csvRowsToRecords(parseCsv(csv));
  const { rows: sourceRows, issues } = parseSourceRecords(records);
  return buildImportPlan(sourceRows, issues, carriers);
}

const HOLDER_ROW: FixtureRow = {
  INDEX: "10001",
  ESTATUS: "PROCESADA",
  "TITULAR NOMBRE Y APELLIDO": "Holder Fixture",
  "FECHA DE INICIO": "01/01/2026",
  ESTADO: "ILLINOIS",
  "COMPAÑIA DE SEGUROS": "ambetter", // minúsculas a propósito: debe matchear normalizado
  PLAN: "  Gold  Simple ",
  PRIMA: "450",
  "TITULAR NOMBRE": "Holder",
  "TITULAR APELLIDO": "Fixture",
  "TITULAR FECHA DE NACIMIENTO": "05/10/1985",
  "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
  "TIPO DE APLICACION": "CLIENTE NUEVO",
};

describe("book-of-business build-plan", () => {
  it("un carrier fuente que no existe en el catálogo bloquea la fila (nunca fuzzy-match)", async () => {
    const result = await plan([{ ...HOLDER_ROW, "COMPAÑIA DE SEGUROS": "AETNA" }]);
    expect(result.readyToImport).toBe(false);
    expect(result.issues.some((i) => i.code === "CARRIER_NOT_IN_CATALOG" && i.severity === "BLOCKING")).toBe(true);
  });

  it("carrier matcheado exacto tras normalizar (mayúsculas/espacios)", async () => {
    const result = await plan([HOLDER_ROW]);
    expect(result.readyToImport).toBe(true);
    expect(result.policies[0].carrierName).toBe("AMBETTER");
  });

  it("nombre de plan normalizado (trim + espacios colapsados)", async () => {
    const result = await plan([HOLDER_ROW]);
    expect(result.policies[0].planName).toBe("Gold Simple");
  });

  it("el mismo titular en dos filas fuente no duplica la Person ni el Household", async () => {
    const result = await plan([
      HOLDER_ROW,
      { ...HOLDER_ROW, INDEX: "10002", ESTATUS: "CANCELADA", "FECHA DE INICIO": "06/01/2025" },
    ]);
    expect(result.persons.filter((p) => p.outcome === "NEW")).toHaveLength(1);
    expect(result.households).toHaveLength(1);
    expect(result.policies).toHaveLength(2);
  });

  it("cónyuge y dependientes se deduplican igual que el titular", async () => {
    const row: FixtureRow = {
      ...HOLDER_ROW,
      "CONYUGUE NOMBRE": "Pareja",
      "CONYUGUE APELLIDO": "Fixture",
      "CONYUGUE FECHA DE NACIMIENTO": "01/01/1986",
      "¿EL CONYUGUE ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
      "DEPENDIENTE 1 NOMBRE Y APELLIDO": "Hijo Fixture",
      "DEPENDIENTE 1 FECHA DE NACIMIENTO": "01/01/2015",
      "DEPENDIENTE 1 RELACION": "HIJO",
      "¿EL DEPENDIENTE 1 ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
    };
    const row2: FixtureRow = { ...row, INDEX: "10002", "FECHA DE INICIO": "01/01/2027" };
    const result = await plan([row, row2]);
    // holder + spouse + 1 dependiente = 3 personas nuevas, nunca 6
    expect(result.persons.filter((p) => p.outcome === "NEW")).toHaveLength(3);
    expect(result.households).toHaveLength(1);
    expect(result.households[0].members).toHaveLength(3); // HEAD + SPOUSE + CHILD
  });

  it("solo se crea PolicyMember para quien tiene la bandera de cobertura en SI", async () => {
    const row: FixtureRow = {
      ...HOLDER_ROW,
      "CONYUGUE NOMBRE": "Pareja",
      "CONYUGUE APELLIDO": "Fixture",
      "¿EL CONYUGUE ESTARA CUBIERTO EN ESTA POLIZA?": "NO",
    };
    const result = await plan([row]);
    expect(result.policies[0].holderCovered).toBe(true);
    expect(result.policies[0].coveredMembers).toHaveLength(0);
  });

  it("dependiente HIJO se asigna a Household como CHILD", async () => {
    const row: FixtureRow = {
      ...HOLDER_ROW,
      "DEPENDIENTE 1 NOMBRE Y APELLIDO": "Hijo Fixture",
      "DEPENDIENTE 1 RELACION": "HIJO",
      "¿EL DEPENDIENTE 1 ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
    };
    const result = await plan([row]);
    const childMember = result.households[0].members.find((m) => m.role === "CHILD");
    expect(childMember).toBeDefined();
    expect(result.policies[0].coveredMembers[0].role).toBe("DEPENDENT");
  });

  it("mapea ESTATUS/TIPO DE APLICACION fuente a los enums reales", async () => {
    const cancelled = await plan([{ ...HOLDER_ROW, ESTATUS: "CANCELADA" }]);
    expect(cancelled.policies[0].status).toBe("CANCELLED");

    const renewal = await plan([{ ...HOLDER_ROW, "TIPO DE APLICACION": "RENOVACION" }]);
    expect(renewal.policies[0].operationType).toBe("RENEWAL");
  });

  it("un producto con el mismo carrier+plan+año en dos filas cuenta como un solo producto necesario", async () => {
    const result = await plan([
      HOLDER_ROW,
      { ...HOLDER_ROW, INDEX: "10002", "FECHA DE INICIO": "03/01/2026", "TITULAR NOMBRE Y APELLIDO": "Otro Titular", "TITULAR NOMBRE": "Otro", "TITULAR APELLIDO": "Titular", "TITULAR FECHA DE NACIMIENTO": "01/01/1990" },
    ]);
    expect(result.counts.productsNeeded).toBe(1);
  });

  it("planYear se deriva del año de FECHA DE INICIO", async () => {
    const result = await plan([{ ...HOLDER_ROW, "FECHA DE INICIO": "01/01/2027" }]);
    expect(result.policies[0].planYear).toBe(2027);
  });

  // Fase 024 (Hallazgo #1): Person.sex en build-plan.
  it("importa el sexo del titular desde TITULAR SEXO", async () => {
    const result = await plan([{ ...HOLDER_ROW, "TITULAR SEXO": "Mujer" }]);
    expect(result.persons[0].data.sex).toBe("FEMALE");
  });

  it("sex nunca es identidad fuerte de dedup: la misma persona con sex distinto en dos filas no duplica", async () => {
    const row1 = { ...HOLDER_ROW, "TITULAR SEXO": "Hombre" };
    const row2 = { ...HOLDER_ROW, INDEX: "10002", "FECHA DE INICIO": "01/01/2027", "TITULAR SEXO": "Mujer" };
    const result = await plan([row1, row2]);
    expect(result.persons.filter((p) => p.outcome === "NEW")).toHaveLength(1);
    expect(result.issues.some((i) => i.code === "PERSON_SEX_CONFLICT")).toBe(true);
  });

  it("una fila sin sex y otra con sex conocido: se conserva el conocido, sin advertencia", async () => {
    const row1 = { ...HOLDER_ROW, "TITULAR SEXO": "" };
    const row2 = { ...HOLDER_ROW, INDEX: "10002", "FECHA DE INICIO": "01/01/2027", "TITULAR SEXO": "Mujer" };
    const result = await plan([row1, row2]);
    expect(result.persons[0].data.sex).toBe("FEMALE");
    expect(result.issues.some((i) => i.code === "PERSON_SEX_CONFLICT")).toBe(false);
  });

  it("sin dato de sexo, la persona queda UNKNOWN (nunca se infiere del nombre)", async () => {
    const result = await plan([HOLDER_ROW]);
    expect(result.persons[0].data.sex).toBe("UNKNOWN");
  });

  // Fase 024, Parte C: normalización de pólizas HEALTH 2025.
  it("una póliza HEALTH 2025 PROCESADA se normaliza a CANCELLED con terminationDate 2025-12-31", async () => {
    const result = await plan([{ ...HOLDER_ROW, "FECHA DE INICIO": "03/01/2025", ESTATUS: "PROCESADA" }]);
    expect(result.policies[0].status).toBe("CANCELLED");
    expect(result.policies[0].terminationDate).toEqual(new Date(Date.UTC(2025, 11, 31)));
    expect(result.policies[0].normalizedHealth2025).toBe(true);
    expect(result.issues.some((i) => i.code === "HEALTH_2025_NORMALIZED_TO_CANCELLED")).toBe(true);
  });

  it("una póliza 2025 ya CANCELADA en el source no genera warning de normalización (no cambió nada)", async () => {
    const result = await plan([{ ...HOLDER_ROW, "FECHA DE INICIO": "03/01/2025", ESTATUS: "CANCELADA" }]);
    expect(result.policies[0].status).toBe("CANCELLED");
    expect(result.issues.some((i) => i.code === "HEALTH_2025_NORMALIZED_TO_CANCELLED")).toBe(false);
  });

  it("una póliza 2026 nunca se normaliza (la regla es exclusiva de 2025)", async () => {
    const result = await plan([{ ...HOLDER_ROW, "FECHA DE INICIO": "03/01/2026", ESTATUS: "PROCESADA" }]);
    expect(result.policies[0].status).toBe("ACTIVE");
    expect(result.policies[0].terminationDate).toBeNull();
    expect(result.policies[0].normalizedHealth2025).toBe(false);
  });

  it("counts.healthPolicies2025NormalizedToCancelled cuenta solo las filas realmente normalizadas", async () => {
    const result = await plan([
      { ...HOLDER_ROW, "FECHA DE INICIO": "03/01/2025", ESTATUS: "PROCESADA" },
      {
        ...HOLDER_ROW,
        INDEX: "10002",
        "TITULAR NOMBRE Y APELLIDO": "Otro Titular",
        "TITULAR NOMBRE": "Otro",
        "TITULAR APELLIDO": "Titular",
        "TITULAR FECHA DE NACIMIENTO": "01/01/1990",
        "FECHA DE INICIO": "03/01/2026",
        ESTATUS: "PROCESADA",
      },
    ]);
    expect(result.counts.healthPolicies2025NormalizedToCancelled).toBe(1);
  });
});
