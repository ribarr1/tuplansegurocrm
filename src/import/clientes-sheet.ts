import type ExcelJS from "exceljs";
import { getSheet, stringCell, dateCell, decimalCell, type SheetHandle } from "./workbook";
import { normalizeName, normalizeEmail, normalizePhone, splitFullName } from "./normalize";
import { PersonRegistry, type PersonCandidate } from "./matching";
import {
  POLICY_STATUS_MAP,
  OPERATION_TYPE_MAP,
  MARKETPLACE_STATE_MAP,
  CARRIER_NAME_MAP,
  AGENT_NAME_TO_EMAIL_MAP,
} from "./mappings";
import type {
  ImportIssue,
  PersonPlanEntry,
  HouseholdPlanEntry,
  PolicyPlanEntry,
  PersonMatchOutcome,
} from "./types";

// Parser de la hoja "clientes" (y, en modo solo-validación-cruzada, de
// "clientescumpleaños") — Fase 019. Una fila = un titular + su póliza +
// (opcionalmente) cónyuge y hasta 6 dependientes. Ver
// docs/IMPORTING_LEGACY_DATA.md para el mapeo completo columna→campo.

const SI_VALUES = new Set(["SI", "SÍ", "S", "YES", "Y"]);
function isYes(v: string | null): boolean {
  return v !== null && SI_VALUES.has(v.trim().toUpperCase());
}

function personFromColumns(
  sheet: SheetHandle,
  row: ExcelJS.Row,
  prefix: string,
  fullNameHeader?: string
): PersonCandidate | null {
  const explicitFirst = stringCell(sheet, row, `${prefix} NOMBRE`);
  const explicitLast = stringCell(sheet, row, `${prefix} APELLIDO`);
  let firstName: string | null = normalizeName(explicitFirst);
  let lastName: string | null = normalizeName(explicitLast);

  if ((!firstName || !lastName) && fullNameHeader) {
    const full = stringCell(sheet, row, fullNameHeader);
    if (full) {
      const split = splitFullName(full);
      firstName = firstName ?? normalizeName(split.firstName);
      lastName = lastName ?? normalizeName(split.lastName);
    }
  }
  if (!firstName || !lastName) return null;

  return {
    firstName,
    lastName,
    email: normalizeEmail(stringCell(sheet, row, `${prefix} EMAIL`)),
    phone: normalizePhone(stringCell(sheet, row, `${prefix} TELEFONO`)),
    dateOfBirth: dateCell(sheet, row, `${prefix} FECHA DE NACIMIENTO`),
  };
}

function dependentRelationToHouseholdRole(relacion: string | null): "CHILD" | "DEPENDENT" {
  if (!relacion) return "DEPENDENT";
  const r = relacion.trim().toLowerCase();
  if (/(hij|son|daughter|child)/.test(r)) return "CHILD";
  return "DEPENDENT";
}

export type ClientesParseResult = {
  persons: PersonPlanEntry[];
  households: HouseholdPlanEntry[];
  policies: PolicyPlanEntry[];
  issues: ImportIssue[];
};

export async function parseClientesSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  registry: PersonRegistry
): Promise<ClientesParseResult> {
  const sheet = getSheet(workbook, sheetName);
  const issues: ImportIssue[] = [];
  const persons: PersonPlanEntry[] = [];
  const households: HouseholdPlanEntry[] = [];
  const policies: PolicyPlanEntry[] = [];

  if (!sheet) {
    issues.push({
      severity: "WARNING",
      code: "SHEET_NOT_FOUND",
      sheet: sheetName,
      message: `La hoja "${sheetName}" no existe en este workbook.`,
    });
    return { persons, households, policies, issues };
  }

  const rows: { row: ExcelJS.Row; rowNumber: number }[] = [];
  sheet.worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    let hasData = false;
    row.eachCell({ includeEmpty: false }, () => {
      hasData = true;
    });
    if (hasData) rows.push({ row, rowNumber });
  });

  for (const { row, rowNumber } of rows) {
    const titularCandidate = personFromColumns(sheet, row, "TITULAR", "TITULAR NOMBRE Y APELLIDO");
    if (!titularCandidate) {
      issues.push({
        severity: "BLOCKING",
        code: "MISSING_HOLDER_NAME",
        sheet: sheetName,
        row: rowNumber,
        message: "Fila sin nombre de titular reconocible — no se puede procesar.",
      });
      continue;
    }

    const titularResolved = await registry.resolve(titularCandidate);
    reportPersonOutcome(issues, sheetName, rowNumber, "titular", titularResolved.outcome);
    persons.push(toPersonPlanEntry(titularResolved, sheetName, rowNumber, titularCandidate));
    if (titularResolved.outcome === "AMBIGUOUS") continue; // no se puede construir household/policy sin identidad resuelta

    const householdMembers: HouseholdPlanEntry["memberKeys"] = [
      { personKey: titularResolved.key, role: "HEAD" },
    ];
    const coveredMembers: PolicyPlanEntry["coveredMemberKeys"] = [];

    const spouseCandidate = personFromColumns(sheet, row, "CONYUGUE");
    if (spouseCandidate) {
      const spouseResolved = await registry.resolve(spouseCandidate);
      reportPersonOutcome(issues, sheetName, rowNumber, "cónyuge", spouseResolved.outcome);
      persons.push(toPersonPlanEntry(spouseResolved, sheetName, rowNumber, spouseCandidate));
      if (spouseResolved.outcome !== "AMBIGUOUS") {
        householdMembers.push({ personKey: spouseResolved.key, role: "SPOUSE" });
        if (isYes(stringCell(sheet, row, "¿EL CONYUGUE ESTARA CUBIERTO EN ESTA POLIZA?"))) {
          coveredMembers.push({ personKey: spouseResolved.key, role: "SPOUSE" });
        }
      }
    }

    for (let d = 1; d <= 6; d++) {
      const prefix = `DEPENDIENTE ${d}`;
      const depCandidate = personFromColumns(sheet, row, prefix, `${prefix} NOMBRE Y APELLIDO`);
      if (!depCandidate) continue;
      const depResolved = await registry.resolve(depCandidate);
      reportPersonOutcome(issues, sheetName, rowNumber, `dependiente ${d}`, depResolved.outcome);
      persons.push(toPersonPlanEntry(depResolved, sheetName, rowNumber, depCandidate));
      if (depResolved.outcome === "AMBIGUOUS") continue;

      const relacion = stringCell(sheet, row, `${prefix} RELACION`);
      const householdRole = dependentRelationToHouseholdRole(relacion);
      householdMembers.push({ personKey: depResolved.key, role: householdRole });
      if (isYes(stringCell(sheet, row, `¿EL DEPENDIENTE ${d} ESTARA CUBIERTO EN ESTA POLIZA?`))) {
        coveredMembers.push({ personKey: depResolved.key, role: "DEPENDENT" });
      }
    }

    // TITULAR DIRECCION es texto libre e inconsistente en el source real
    // ("1470 ASHTON CT, AURORA, IL, 60504" vs "314 S OHIO ST AURORA
    // ILLINOIS" vs "98 Etowah terrace sw. Rome GA 30161") — partirlo en
    // addressLine1/city/state/zipCode con heurísticas sería adivinar.
    // Se guarda tal cual en Household.addressLine1; TITULAR CONDADO sí
    // es un valor limpio de una sola columna y se guarda en county.
    const addressLine1 = stringCell(sheet, row, "TITULAR DIRECCION");
    const county = stringCell(sheet, row, "TITULAR CONDADO");

    if (householdMembers.length > 1) {
      households.push({
        sheet: sheetName,
        row: rowNumber,
        headPersonKey: titularResolved.key,
        memberKeys: householdMembers,
        addressLine1,
        county,
      });
    } else if (addressLine1 || county) {
      // Un titular solo no genera Household en el modelo actual (ver
      // apply.ts), así que su dirección no tiene dónde guardarse todavía
      // — se reporta en vez de perderse silenciosamente.
      issues.push({
        severity: "INFO",
        code: "ADDRESS_WITHOUT_HOUSEHOLD",
        sheet: sheetName,
        row: rowNumber,
        message:
          "El titular tiene dirección/condado en el source pero no tiene hogar (household) en esta importación — no se puede guardar hasta que exista una decisión de modelo para titulares sin hogar.",
      });
    }

    // --- Policy ---
    const estatusRaw = stringCell(sheet, row, "ESTATUS");
    const status = estatusRaw ? POLICY_STATUS_MAP[estatusRaw.trim().toUpperCase()] : undefined;
    if (estatusRaw && !status) {
      issues.push({
        severity: "BLOCKING",
        code: "UNKNOWN_POLICY_STATUS",
        sheet: sheetName,
        row: rowNumber,
        message: `Valor de ESTATUS no reconocido ("${estatusRaw}") — agregar a POLICY_STATUS_MAP o corregir el dato.`,
      });
      continue;
    }

    const carrierRaw = stringCell(sheet, row, "COMPAÑIA DE SEGUROS");
    const carrierName = carrierRaw ? CARRIER_NAME_MAP[carrierRaw.trim().toUpperCase()] : undefined;
    if (carrierRaw && !carrierName) {
      issues.push({
        severity: "BLOCKING",
        code: "UNKNOWN_CARRIER",
        sheet: sheetName,
        row: rowNumber,
        message: `Compañía de seguros no reconocida ("${carrierRaw}") — agregar a CARRIER_NAME_MAP.`,
      });
      continue;
    }
    if (!carrierName) {
      issues.push({
        severity: "BLOCKING",
        code: "MISSING_CARRIER",
        sheet: sheetName,
        row: rowNumber,
        message: "Fila sin compañía de seguros — no se puede crear la póliza.",
      });
      continue;
    }

    const planName = stringCell(sheet, row, "PLAN");
    if (!planName) {
      issues.push({
        severity: "BLOCKING",
        code: "MISSING_PLAN_NAME",
        sheet: sheetName,
        row: rowNumber,
        message: "Fila sin nombre de plan — no se puede identificar el producto.",
      });
      continue;
    }

    // AGENTE (legacy) nunca crea un User — solo se reporta si no hay
    // mapping explícito a un User real (ver docs/DECISIONS.md). agentId/
    // processedById quedan en null en apply.ts, nunca inventados.
    const agentRaw = stringCell(sheet, row, "AGENTE");
    if (agentRaw && !AGENT_NAME_TO_EMAIL_MAP[agentRaw.trim().toUpperCase()]) {
      issues.push({
        severity: "INFO",
        code: "UNMAPPED_AGENT",
        sheet: sheetName,
        row: rowNumber,
        message: "Nombre de agente sin mapping explícito a un User — la póliza se importará sin agente/procesador asignado.",
      });
    }

    const operationRaw = stringCell(sheet, row, "TIPO DE APLICACION");
    const operationType = operationRaw ? (OPERATION_TYPE_MAP[operationRaw.trim().toUpperCase()] ?? null) : null;
    if (operationRaw && !operationType) {
      issues.push({
        severity: "WARNING",
        code: "UNKNOWN_OPERATION_TYPE",
        sheet: sheetName,
        row: rowNumber,
        message: `Tipo de aplicación no reconocido ("${operationRaw}") — se importará sin operationType.`,
      });
    }

    const effectiveDate = dateCell(sheet, row, "FECHA DE INICIO");
    const resolvedStatus = status ?? "PENDING";
    let blocked = false;
    let blockReason: string | undefined;
    if (resolvedStatus === "ACTIVE" && !effectiveDate) {
      issues.push({
        severity: "BLOCKING",
        code: "ACTIVE_MISSING_EFFECTIVE_DATE",
        sheet: sheetName,
        row: rowNumber,
        message: "Póliza ACTIVE sin FECHA DE INICIO reconocible — se bloquea la fila (no se degrada a PENDING automáticamente).",
      });
      blocked = true;
      blockReason = "ACTIVE_MISSING_EFFECTIVE_DATE";
    }

    const stateRaw = stringCell(sheet, row, "ESTADO");
    const marketplaceState = stateRaw ? (MARKETPLACE_STATE_MAP[stateRaw.trim().toUpperCase()] ?? null) : null;
    if (stateRaw && !marketplaceState) {
      issues.push({
        severity: "WARNING",
        code: "UNKNOWN_MARKETPLACE_STATE",
        sheet: sheetName,
        row: rowNumber,
        message: `Estado no reconocido ("${stateRaw}") — se importará sin marketplaceState.`,
      });
    }

    // El source actual no tiene columna de fecha de terminación —
    // dateCell() devuelve null de forma segura para un header
    // inexistente, así que esta validación queda lista para cuando
    // exista sin afectar el comportamiento de hoy.
    const terminationDate = dateCell(sheet, row, "FECHA DE TERMINACION");
    if (effectiveDate && terminationDate && terminationDate < effectiveDate) {
      issues.push({
        severity: "BLOCKING",
        code: "POLICY_TERMINATION_BEFORE_EFFECTIVE",
        sheet: sheetName,
        row: rowNumber,
        message: "La fecha de finalización no puede ser anterior a la fecha de inicio.",
      });
      blocked = true;
      blockReason = "POLICY_TERMINATION_BEFORE_EFFECTIVE";
    }

    // Marketplace vs Privado: nunca por nombre de carrier. marketplaceState
    // solo tiene sentido para cobertura ACA, así que su presencia es
    // evidencia estructurada suficiente de MARKETPLACE. Su ausencia NO
    // prueba PRIVATE (podría ser un dato simplemente no capturado) —
    // queda ambigua y se reporta para revisión manual.
    let healthCoverageSource: "MARKETPLACE" | "PRIVATE" | null = null;
    if (marketplaceState) {
      healthCoverageSource = "MARKETPLACE";
    } else {
      issues.push({
        severity: "WARNING",
        code: "UNKNOWN_HEALTH_SOURCE",
        sheet: sheetName,
        row: rowNumber,
        message:
          "No hay evidencia estructurada suficiente para clasificar esta póliza de salud como Marketplace o Privada — requiere revisión manual antes de importar.",
      });
    }

    policies.push({
      sheet: sheetName,
      row: rowNumber,
      holderPersonKey: titularResolved.key,
      holderCovered: isYes(stringCell(sheet, row, "¿EL TITULAR ESTARA CUBIERTO EN ESTA POLIZA?")),
      coveredMemberKeys: coveredMembers,
      carrierName,
      planName,
      policyType: "HEALTH",
      operationType,
      status: resolvedStatus,
      effectiveDate,
      terminationDate,
      healthCoverageSource,
      marketplaceState,
      premiumAmount: decimalCell(sheet, row, "PRIMA"),
      deductibleIndividual: decimalCell(sheet, row, "DEDUCIBLE"),
      outOfPocketIndividual: decimalCell(sheet, row, "MAXIMO DE BOLSILLO"),
      incomeUsed: decimalCell(sheet, row, "INGRESOS"),
      taxCreditAmount: decimalCell(sheet, row, "CREDITO FISCAL"),
      needsPaymentAssistance: isYes(stringCell(sheet, row, "ASISTENCIA")),
      blocked,
      blockReason,
    });
  }

  return { persons, households, policies, issues };
}

function reportPersonOutcome(
  issues: ImportIssue[],
  sheet: string,
  row: number,
  role: string,
  outcome: PersonMatchOutcome
): void {
  if (outcome === "AMBIGUOUS") {
    issues.push({
      severity: "BLOCKING",
      code: "AMBIGUOUS_PERSON_MATCH",
      sheet,
      row,
      message: `Coincidencia ambigua para ${role} — requiere revisión manual antes de importar.`,
    });
  }
}

function toPersonPlanEntry(
  resolved: { key: string; outcome: PersonMatchOutcome; confidence?: import("./types").PersonMatchConfidence; existingPersonId?: string },
  sheet: string,
  row: number,
  data: PersonCandidate
): PersonPlanEntry {
  return {
    key: resolved.key,
    outcome: resolved.outcome,
    confidence: resolved.confidence,
    existingPersonId: resolved.existingPersonId,
    sheet,
    row,
    data,
  };
}
