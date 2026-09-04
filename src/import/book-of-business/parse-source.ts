import { normalizeIdentifier, isValidSsn, normalizeSsn } from "@/lib/sensitive-identity-format";
import { parseSourceAmount, parseSourceDateMDY, isSourceYes, collapseSpaces, mapPersonSex } from "./normalize";
import type { SourceRow, PersonSourceData, DependentSourceData, RowIssue } from "./types";

// Nombres de columna EXACTOS del CSV real (private-imports/exported-table.csv).
// La columna del SSN del cónyuge viene duplicada/concatenada en el
// header del archivo fuente tal como se entregó — se preserva tal cual
// aquí, no es un typo de este código.
const COL = {
  INDEX: "INDEX",
  ESTATUS: "ESTATUS",
  AGENTE: "AGENTE",
  FECHA_INICIO: "FECHA DE INICIO",
  ESTADO: "ESTADO",
  CARRIER: "COMPAÑIA DE SEGUROS",
  PROCESADA_POR: "PROCESADA POR",
  CONSENTIMIENTO: "CONSENTIMIENTO USADO",
  ASISTENCIA: "ASISTENCIA",
  PLAN: "PLAN",
  PRIMA: "PRIMA",
  DEDUCIBLE: "DEDUCIBLE",
  OOP: "MAXIMO DE BOLSILLO",
  INGRESOS: "INGRESOS",
  CREDITO_FISCAL: "CREDITO FISCAL",
  TITULAR_DISPLAY: "TITULAR NOMBRE Y APELLIDO",
  TITULAR_SEXO: "TITULAR SEXO",
  TITULAR_EMAIL: "TITULAR EMAIL",
  TITULAR_DOB: "TITULAR FECHA DE NACIMIENTO",
  TITULAR_SSN: "TITULAR NUMERO DE SEGURIDAD SOCIAL",
  TITULAR_NOMBRE: "TITULAR NOMBRE",
  TITULAR_APELLIDO: "TITULAR APELLIDO",
  TITULAR_DOC_TYPE: "TITULAR TIPO DE DOCUMENTO",
  TITULAR_USCIS: "TITULAR USCIS#",
  TITULAR_COVERED: "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?",
  TITULAR_TELEFONO: "TITULAR TELEFONO",
  TITULAR_DIRECCION: "TITULAR DIRECCION",
  TITULAR_CONDADO: "TITULAR CONDADO",
  CONYUGUE_SEXO: "CONYUGUE SEXO",
  CONYUGUE_EMAIL: "CONYUGUE EMAIL",
  CONYUGUE_DOB: "CONYUGUE FECHA DE NACIMIENTO",
  CONYUGUE_SSN: "CONYUGUE NUMERO DE SEGURIDAD SOCIALCONYUGUE NUMERO DE SEGURIDAD SOCIAL",
  CONYUGUE_NOMBRE: "CONYUGUE NOMBRE",
  CONYUGUE_APELLIDO: "CONYUGUE APELLIDO",
  CONYUGUE_DOC_TYPE: "CONYUGUE TIPO DE DOCUMENTO",
  CONYUGUE_USCIS: "CONYUGUE USCIS#",
  CONYUGUE_COVERED: "¿EL CONYUGUE ESTARA CUBIERTO EN ESTA POLIZA?",
  CONYUGUE_TELEFONO: "CONYUGUE TELEFONO",
  OBSERVACIONES: "OBSERVACIONES",
  MIEMBROS: "MIEMBROS",
  TIPO_APLICACION: "TIPO DE APLICACION",
} as const;

function dependentCol(n: number, suffix: string): string {
  return `DEPENDIENTE ${n} ${suffix}`;
}

function cell(record: Record<string, string>, key: string): string {
  return (record[key] ?? "").trim();
}

// SSN: acepta con/sin guiones, exige 9 dígitos reales — nunca se
// "adivina" un SSN parcial. Retorna normalizado a 9 dígitos o null.
function extractSsn(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  return isValidSsn(trimmed) ? normalizeSsn(trimmed) : null;
}

function extractUscis(raw: string): string | null {
  return normalizeIdentifier(raw);
}

function splitFullName(displayName: string): { firstName: string; lastName: string } | null {
  const collapsed = collapseSpaces(displayName);
  if (collapsed === "") return null;
  const parts = collapsed.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  const firstName = parts[0];
  const lastName = parts.slice(1).join(" ");
  return { firstName, lastName };
}

function buildPersonFromStructured(
  firstNameRaw: string,
  lastNameRaw: string,
  dobRaw: string,
  sexRaw: string,
  emailRaw: string,
  phoneRaw: string,
  ssnRaw: string,
  docTypeRaw: string,
  uscisRaw: string,
  coveredRaw: string,
  displayFallback: string
): PersonSourceData | null {
  let firstName = collapseSpaces(firstNameRaw);
  let lastName = collapseSpaces(lastNameRaw);
  if ((firstName === "" || lastName === "") && displayFallback.trim() !== "") {
    const split = splitFullName(displayFallback);
    if (split) {
      firstName = firstName || split.firstName;
      lastName = lastName || split.lastName;
    }
  }
  if (firstName === "" || lastName === "") return null;

  const sexResult = mapPersonSex(sexRaw);

  return {
    firstName,
    lastName,
    displayName: displayFallback.trim() || `${firstName} ${lastName}`,
    dateOfBirth: dobRaw.trim() ? parseSourceDateMDY(dobRaw) : null,
    sex: sexResult?.value ?? "UNKNOWN",
    email: emailRaw.trim() || null,
    phone: phoneRaw.trim() || null,
    ssn: extractSsn(ssnRaw),
    immigrationSource: docTypeRaw.trim() || null,
    uscisNumber: extractUscis(uscisRaw),
    covered: isSourceYes(coveredRaw),
  };
}

const DEPENDENT_SLOTS = 6;

export type ParsedSource = {
  rows: SourceRow[];
  issues: RowIssue[];
};

export function parseSourceRecords(records: Record<string, string>[]): ParsedSource {
  const rows: SourceRow[] = [];
  const issues: RowIssue[] = [];

  records.forEach((record, i) => {
    const rowIndex = i + 1; // 1-based, sin contar encabezado
    const sourceIndex = cell(record, COL.INDEX) || `(sin INDEX, fila ${rowIndex})`;

    const holderDisplayName = cell(record, COL.TITULAR_DISPLAY);
    const carrierRaw = cell(record, COL.CARRIER);
    const effectiveDateRaw = cell(record, COL.FECHA_INICIO);
    const stateRaw = cell(record, COL.ESTADO);
    const planRaw = cell(record, COL.PLAN);
    const holderDobRaw = cell(record, COL.TITULAR_DOB);

    // Hallazgo #12 de la ficha: fila conocida incompleta (ej. INDEX
    // 23191) sin holder/effectiveDate/state/plan — se marca SKIPPED y
    // el import continúa con las demás filas, nunca crea Person/
    // Household/Policy a partir de una fila así.
    const missingCore: string[] = [];
    if (!holderDisplayName && !cell(record, COL.TITULAR_NOMBRE)) missingCore.push("holder");
    if (!effectiveDateRaw) missingCore.push("effectiveDate");
    if (!stateRaw) missingCore.push("state");
    if (!planRaw) missingCore.push("plan");

    if (missingCore.length > 0) {
      issues.push({
        rowIndex,
        sourceIndex,
        code: "SKIPPED_INCOMPLETE_SOURCE_ROW",
        message: `Fila fuente incompleta (falta: ${missingCore.join(", ")}) — omitida, no se crea Person/Household/Policy.`,
        severity: "SKIPPED",
      });
      return;
    }

    const holderSexRaw = cell(record, COL.TITULAR_SEXO);
    const holder = buildPersonFromStructured(
      cell(record, COL.TITULAR_NOMBRE),
      cell(record, COL.TITULAR_APELLIDO),
      holderDobRaw,
      holderSexRaw,
      cell(record, COL.TITULAR_EMAIL),
      cell(record, COL.TITULAR_TELEFONO),
      cell(record, COL.TITULAR_SSN),
      cell(record, COL.TITULAR_DOC_TYPE),
      cell(record, COL.TITULAR_USCIS),
      cell(record, COL.TITULAR_COVERED),
      holderDisplayName
    );
    if (!holder) {
      issues.push({
        rowIndex,
        sourceIndex,
        code: "SKIPPED_INCOMPLETE_SOURCE_ROW",
        message: "No se pudo determinar nombre/apellido del titular — fila omitida.",
        severity: "SKIPPED",
      });
      return;
    }
    if (holderSexRaw && mapPersonSex(holderSexRaw)?.recognized === false) {
      issues.push({
        rowIndex,
        sourceIndex,
        code: "PERSON_SEX_UNRECOGNIZED",
        message: `Sexo del titular no reconocido ("${holderSexRaw}") — se deja como No especificado.`,
        severity: "WARNING",
      });
    }

    const spouseFirstRaw = cell(record, COL.CONYUGUE_NOMBRE);
    const spouseLastRaw = cell(record, COL.CONYUGUE_APELLIDO);
    const spouseSexRaw = cell(record, COL.CONYUGUE_SEXO);
    let spouse: PersonSourceData | null = null;
    if (spouseFirstRaw || spouseLastRaw) {
      spouse = buildPersonFromStructured(
        spouseFirstRaw,
        spouseLastRaw,
        cell(record, COL.CONYUGUE_DOB),
        spouseSexRaw,
        cell(record, COL.CONYUGUE_EMAIL),
        cell(record, COL.CONYUGUE_TELEFONO),
        cell(record, COL.CONYUGUE_SSN),
        cell(record, COL.CONYUGUE_DOC_TYPE),
        cell(record, COL.CONYUGUE_USCIS),
        cell(record, COL.CONYUGUE_COVERED),
        `${spouseFirstRaw} ${spouseLastRaw}`
      );
      if (spouse && spouseSexRaw && mapPersonSex(spouseSexRaw)?.recognized === false) {
        issues.push({
          rowIndex,
          sourceIndex,
          code: "PERSON_SEX_UNRECOGNIZED",
          message: `Sexo del cónyuge no reconocido ("${spouseSexRaw}") — se deja como No especificado.`,
          severity: "WARNING",
        });
      }
      if (!spouse) {
        issues.push({
          rowIndex,
          sourceIndex,
          code: "SPOUSE_NAME_UNRESOLVED",
          message: "No se pudo determinar nombre/apellido del cónyuge — cónyuge omitido en esta fila.",
          severity: "WARNING",
        });
      }
    }

    const dependents: DependentSourceData[] = [];
    for (let n = 1; n <= DEPENDENT_SLOTS; n++) {
      const displayRaw = cell(record, dependentCol(n, "NOMBRE Y APELLIDO"));
      if (!displayRaw) continue; // columna vacía -> no se crea dependiente
      const split = splitFullName(displayRaw);
      if (!split) continue;
      const relationRaw = cell(record, dependentCol(n, "RELACION"));
      const base = buildPersonFromStructured(
        split.firstName,
        split.lastName,
        cell(record, dependentCol(n, "FECHA DE NACIMIENTO")),
        "", // el CSV real no trae SEXO por dependiente — nunca se infiere
        "",
        "",
        cell(record, dependentCol(n, "NUMERO DE SEGURIDAD SOCIAL")),
        cell(record, dependentCol(n, "TIPO DE DOCUMENTO")),
        cell(record, dependentCol(n, "USCIS#")),
        cell(record, `¿EL DEPENDIENTE ${n} ESTARA CUBIERTO EN ESTA POLIZA?`),
        displayRaw
      );
      if (base) {
        dependents.push({ ...base, relationRaw });
      }
    }

    const effectiveDate = parseSourceDateMDY(effectiveDateRaw);
    if (!effectiveDate) {
      issues.push({
        rowIndex,
        sourceIndex,
        code: "INVALID_EFFECTIVE_DATE",
        message: `Fecha de inicio no válida ("${effectiveDateRaw}") — fila omitida.`,
        severity: "SKIPPED",
      });
      return;
    }

    rows.push({
      rowIndex,
      sourceIndex,
      status: cell(record, COL.ESTATUS),
      holderDisplayName: holderDisplayName || holder.displayName,
      agent: cell(record, COL.AGENTE),
      effectiveDateRaw,
      effectiveDate,
      stateRaw,
      carrierRaw,
      processedBy: cell(record, COL.PROCESADA_POR),
      consentUsed: cell(record, COL.CONSENTIMIENTO),
      assistance: isSourceYes(cell(record, COL.ASISTENCIA)),
      planRaw,
      premium: parseSourceAmount(cell(record, COL.PRIMA)),
      deductible: parseSourceAmount(cell(record, COL.DEDUCIBLE)),
      outOfPocketMax: parseSourceAmount(cell(record, COL.OOP)),
      income: parseSourceAmount(cell(record, COL.INGRESOS)),
      taxCredit: parseSourceAmount(cell(record, COL.CREDITO_FISCAL)),
      operationTypeRaw: cell(record, COL.TIPO_APLICACION),
      holder,
      spouse,
      dependents,
      addressRaw: cell(record, COL.TITULAR_DIRECCION),
      county: cell(record, COL.TITULAR_CONDADO) || null,
      observaciones: cell(record, COL.OBSERVACIONES),
      membersRaw: cell(record, COL.MIEMBROS),
    });
  });

  return { rows, issues };
}
