import { describe, it, expect } from "vitest";
import { parseCsv, csvRowsToRecords } from "../csv";
import { parseSourceRecords } from "../parse-source";
import { buildFixtureCsv, type FixtureRow } from "./fixture";

function parse(rows: FixtureRow[]) {
  const csv = buildFixtureCsv(rows);
  const records = csvRowsToRecords(parseCsv(csv));
  return parseSourceRecords(records);
}

const BASE_ROW: FixtureRow = {
  INDEX: "10001",
  ESTATUS: "PROCESADA",
  "TITULAR NOMBRE Y APELLIDO": "Fixture Uno Prueba",
  "FECHA DE INICIO": "01/01/2026",
  ESTADO: "ILLINOIS",
  "COMPAÑIA DE SEGUROS": "AMBETTER",
  PLAN: "Gold Simple",
  PRIMA: "450.25",
  "TITULAR NOMBRE": "Fixture",
  "TITULAR APELLIDO": "Uno Prueba",
  "TITULAR FECHA DE NACIMIENTO": "05/10/1985",
  "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
  "TIPO DE APLICACION": "CLIENTE NUEVO",
};

describe("book-of-business parse-source", () => {
  it("parsea el CSV completo (encabezado + filas de datos)", () => {
    const { rows, issues } = parse([BASE_ROW]);
    expect(issues).toHaveLength(0);
    expect(rows).toHaveLength(1);
    expect(rows[0].holder.firstName).toBe("Fixture");
    expect(rows[0].holder.lastName).toBe("Uno Prueba");
    expect(rows[0].carrierRaw).toBe("AMBETTER");
    expect(rows[0].premium).toBe(450.25);
  });

  it("una fila incompleta conocida (sin holder/fecha/estado/plan) se omite con SKIPPED_INCOMPLETE_SOURCE_ROW", () => {
    const { rows, issues } = parse([
      BASE_ROW,
      { INDEX: "23191", ESTATUS: "CREADA", "COMPAÑIA DE SEGUROS": "AMBETTER" },
    ]);
    expect(rows).toHaveLength(1);
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("SKIPPED_INCOMPLETE_SOURCE_ROW");
    expect(issues[0].sourceIndex).toBe("23191");
  });

  it("extrae SSN válido normalizado a 9 dígitos y descarta uno inválido", () => {
    const { rows: withSsn } = parse([{ ...BASE_ROW, "TITULAR NUMERO DE SEGURIDAD SOCIAL": "123-45-6789" }]);
    expect(withSsn[0].holder.ssn).toBe("123456789");

    const { rows: withBadSsn } = parse([{ ...BASE_ROW, "TITULAR NUMERO DE SEGURIDAD SOCIAL": "12-34" }]);
    expect(withBadSsn[0].holder.ssn).toBeNull();
  });

  it("extrae cónyuge cuando hay nombre/apellido, respeta bandera de cobertura", () => {
    const { rows } = parse([
      {
        ...BASE_ROW,
        "CONYUGUE NOMBRE": "Pareja",
        "CONYUGUE APELLIDO": "Fixture",
        "¿EL CONYUGUE ESTARA CUBIERTO EN ESTA POLIZA?": "NO",
      },
    ]);
    expect(rows[0].spouse).not.toBeNull();
    expect(rows[0].spouse?.firstName).toBe("Pareja");
    expect(rows[0].spouse?.covered).toBe(false);
  });

  it("sin nombre de cónyuge, spouse queda null", () => {
    const { rows } = parse([BASE_ROW]);
    expect(rows[0].spouse).toBeNull();
  });

  it("procesa dependientes solo cuando la columna de nombre no está vacía", () => {
    const { rows } = parse([
      {
        ...BASE_ROW,
        "DEPENDIENTE 1 NOMBRE Y APELLIDO": "Hijo Fixture",
        "DEPENDIENTE 1 FECHA DE NACIMIENTO": "01/01/2015",
        "DEPENDIENTE 1 RELACION": "HIJO",
        "¿EL DEPENDIENTE 1 ESTARA CUBIERTO EN ESTA POLIZA?": "SI",
        // DEPENDIENTE 2 en blanco -> no debe crear un segundo dependiente
      },
    ]);
    expect(rows[0].dependents).toHaveLength(1);
    expect(rows[0].dependents[0].firstName).toBe("Hijo");
    expect(rows[0].dependents[0].covered).toBe(true);
  });

  it("una fecha efectiva inválida omite la fila (nunca hace roll-over silencioso)", () => {
    const { rows, issues } = parse([{ ...BASE_ROW, "FECHA DE INICIO": "02/30/2026" }]);
    expect(rows).toHaveLength(0);
    expect(issues[0].code).toBe("INVALID_EFFECTIVE_DATE");
  });

  it("bancarios/tarjeta nunca se leen (el parser no tiene esas columnas mapeadas a ningún campo)", () => {
    const { rows } = parse([
      {
        ...BASE_ROW,
        BANCO: "Banco Ficticio",
        "NUMERO DE CUENTA": "000111222",
        "NUMERO DE LA TARJETA": "4111111111111111",
        "CODIGO DE SEGURIDAD DE LA TARJETA": "999",
      },
    ]);
    const serialized = JSON.stringify(rows[0]);
    expect(serialized).not.toContain("Banco Ficticio");
    expect(serialized).not.toContain("000111222");
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("999");
  });
});
