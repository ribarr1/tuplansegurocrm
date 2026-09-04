import { prisma } from "@/lib/prisma";
import { normalizeCarrierName, normalizePlanName, normalizeForMatch, normalizeNameForMatch, normalizeUsState, mapImmigrationSource, mapPolicyStatus, mapOperationType, comparePolicyChronology } from "./normalize";
import type {
  SourceRow,
  PersonSourceData,
  ImportPlan,
  PersonPlanEntry,
  HouseholdPlanEntry,
  PolicyPlanEntry,
  RowIssue,
} from "./types";

export type CarrierCatalogEntry = { name: string };

function matchKeyFor(person: PersonSourceData): string {
  const name = normalizeNameForMatch(person.firstName, person.lastName);
  const dob = person.dateOfBirth ? person.dateOfBirth.toISOString().slice(0, 10) : "NODOB";
  return `${name}|${dob}`;
}

function dependentRoleFor(relationRaw: string): "CHILD" | "DEPENDENT" {
  const key = normalizeForMatch(relationRaw);
  return key.startsWith("HIJ") ? "CHILD" : "DEPENDENT"; // HIJO/HIJA -> CHILD; cualquier otra relación -> DEPENDENT (nunca OTHER: sigue siendo familiar directo del hogar)
}

// Construye el plan de import completo EN MEMORIA, sin tocar la DB
// salvo lecturas de solo-consulta para dedup contra el estado actual
// (persons existentes) — nunca escribe nada. Usado tanto por --dry-run
// como como primer paso de --apply (ver requiredImportOrder en
// tuplanseguro_client_import_mapping.json: "confirm no blocking
// parser/schema errors" ANTES de wipe).
export async function buildImportPlan(
  sourceRows: SourceRow[],
  parseIssues: RowIssue[],
  carrierCatalog: CarrierCatalogEntry[]
): Promise<ImportPlan> {
  const issues: RowIssue[] = [...parseIssues];
  const carrierByNormalizedName = new Map(carrierCatalog.map((c) => [normalizeCarrierName(c.name), c.name]));

  // --- Personas: dedup dentro del batch + contra la DB actual ---
  const personEntries = new Map<string, PersonPlanEntry>();

  async function resolvePerson(source: PersonSourceData, rowIndex: number, sourceIndex: string): Promise<string> {
    const key = matchKeyFor(source);
    const existing = personEntries.get(key);
    if (existing) {
      // Enriquecer con sensible/contacto si esta fila trae más datos que
      // la primera vez que se vio a esta persona — nunca sobrescribe un
      // valor ya presente con uno vacío.
      existing.data.email = existing.data.email ?? source.email;
      existing.data.phone = existing.data.phone ?? source.phone;
      existing.sensitive.ssn = existing.sensitive.ssn ?? source.ssn;
      existing.sensitive.uscisNumber = existing.sensitive.uscisNumber ?? source.uscisNumber;
      return key;
    }

    const immigrationMapping = source.immigrationSource ? mapImmigrationSource(source.immigrationSource) : null;
    if (source.immigrationSource && !immigrationMapping) {
      issues.push({
        rowIndex,
        sourceIndex,
        code: "IMMIGRATION_SOURCE_UNRECOGNIZED",
        message: `Tipo de documento fuente no reconocido ("${source.immigrationSource}") — categoría migratoria omitida para esta persona.`,
        severity: "WARNING",
      });
    }

    let existingPersonId: string | undefined;
    if (source.dateOfBirth) {
      const candidates = await prisma.person.findMany({
        where: { firstName: { equals: source.firstName, mode: "insensitive" }, lastName: { equals: source.lastName, mode: "insensitive" }, dateOfBirth: source.dateOfBirth },
        select: { id: true },
      });
      if (candidates.length === 1) existingPersonId = candidates[0].id;
      else if (candidates.length > 1) {
        issues.push({
          rowIndex,
          sourceIndex,
          code: "PERSON_MATCH_AMBIGUOUS",
          message: "Más de una persona existente coincide por nombre+fecha de nacimiento — se creará una persona nueva en vez de adivinar.",
          severity: "WARNING",
        });
      }
    }

    personEntries.set(key, {
      matchKey: key,
      outcome: existingPersonId ? "MATCHED_EXISTING" : "NEW",
      existingPersonId,
      data: {
        firstName: source.firstName,
        lastName: source.lastName,
        dateOfBirth: source.dateOfBirth,
        email: source.email,
        phone: source.phone,
      },
      sensitive: {
        ssn: source.ssn,
        uscisNumber: source.uscisNumber,
        immigrationCategory: immigrationMapping?.immigrationCategory ?? null,
        documentType: immigrationMapping?.documentType ?? null,
      },
    });
    return key;
  }

  // --- Households (holder-centered) ---
  const householdByHolderKey = new Map<string, HouseholdPlanEntry>();

  // --- Policies ---
  const policies: PolicyPlanEntry[] = [];

  for (const row of sourceRows) {
    const holderKey = await resolvePerson(row.holder, row.rowIndex, row.sourceIndex);

    let spouseKey: string | null = null;
    if (row.spouse) spouseKey = await resolvePerson(row.spouse, row.rowIndex, row.sourceIndex);

    const dependentKeys: { key: string; role: "CHILD" | "DEPENDENT"; covered: boolean }[] = [];
    for (const dep of row.dependents) {
      const key = await resolvePerson(dep, row.rowIndex, row.sourceIndex);
      dependentKeys.push({ key, role: dependentRoleFor(dep.relationRaw), covered: dep.covered });
    }

    // Household: se crea/reutiliza una vez por holder; dirección/condado
    // solo se toman de la PRIMERA fila fuente vista para ese holder
    // (mismo criterio que src/import/apply.ts, Fase 019 — nunca
    // sobrescribe con una fila posterior).
    let household = householdByHolderKey.get(holderKey);
    if (!household) {
      const { code: stateCode, matched: stateMatched } = normalizeUsState(row.stateRaw);
      if (!stateMatched) {
        issues.push({
          rowIndex: row.rowIndex,
          sourceIndex: row.sourceIndex,
          code: "STATE_UNRECOGNIZED",
          message: `Estado fuente no reconocido ("${row.stateRaw}") — se deja sin normalizar en el household.`,
          severity: "WARNING",
        });
      }
      household = {
        holderMatchKey: holderKey,
        addressLine1: row.addressRaw || null,
        county: row.county,
        state: stateCode,
        annualHouseholdIncome: row.income,
        incomeYear: row.effectiveDate.getUTCFullYear(),
        members: [{ matchKey: holderKey, role: "HEAD" }],
      };
      householdByHolderKey.set(holderKey, household);
      if (row.addressRaw && !stateCode) {
        issues.push({
          rowIndex: row.rowIndex,
          sourceIndex: row.sourceIndex,
          code: "ADDRESS_PARTIAL_PARSE",
          message: "Dirección conservada tal como vino del source (sin parseo de ciudad/ZIP confiable).",
          severity: "WARNING",
        });
      }
    }
    if (spouseKey && !household.members.some((m) => m.matchKey === spouseKey)) {
      household.members.push({ matchKey: spouseKey, role: "SPOUSE" });
    }
    for (const dep of dependentKeys) {
      if (!household.members.some((m) => m.matchKey === dep.key)) {
        household.members.push({ matchKey: dep.key, role: dep.role });
      }
    }

    // --- Carrier matching: exacto tras normalización, nunca fuzzy ---
    const normalizedCarrier = normalizeCarrierName(row.carrierRaw);
    const matchedCarrierName = carrierByNormalizedName.get(normalizedCarrier);
    if (!matchedCarrierName) {
      issues.push({
        rowIndex: row.rowIndex,
        sourceIndex: row.sourceIndex,
        code: "CARRIER_NOT_IN_CATALOG",
        message: `Carrier fuente ("${row.carrierRaw}") no existe en el catálogo normalizado — fila bloqueada.`,
        severity: "BLOCKING",
      });
      continue;
    }

    const status = mapPolicyStatus(row.status);
    if (!status) {
      issues.push({
        rowIndex: row.rowIndex,
        sourceIndex: row.sourceIndex,
        code: "STATUS_UNRECOGNIZED",
        message: `Estatus fuente no reconocido ("${row.status}") — fila bloqueada.`,
        severity: "BLOCKING",
      });
      continue;
    }

    const operationType = row.operationTypeRaw ? mapOperationType(row.operationTypeRaw) : null;
    if (row.operationTypeRaw && !operationType) {
      issues.push({
        rowIndex: row.rowIndex,
        sourceIndex: row.sourceIndex,
        code: "OPERATION_TYPE_UNRECOGNIZED",
        message: `Tipo de aplicación fuente no reconocido ("${row.operationTypeRaw}") — se deja sin operationType.`,
        severity: "WARNING",
      });
    }

    policies.push({
      rowIndex: row.rowIndex,
      sourceIndex: row.sourceIndex,
      holderMatchKey: holderKey,
      carrierName: matchedCarrierName,
      planName: normalizePlanName(row.planRaw),
      planYear: row.effectiveDate.getUTCFullYear(),
      status,
      operationType,
      effectiveDate: row.effectiveDate,
      terminationDate: null, // nunca se infiere — ver Hallazgo §37/§38 de la ficha
      premiumAmount: row.premium,
      needsPaymentAssistance: row.assistance,
      healthCoverageSource: "MARKETPLACE",
      marketplaceState: household.state,
      deductible: row.deductible,
      outOfPocketMax: row.outOfPocketMax,
      incomeUsed: row.income,
      taxCredit: row.taxCredit,
      holderCovered: row.holder.covered,
      coveredMembers: [
        ...(spouseKey && row.spouse?.covered ? [{ matchKey: spouseKey, role: "SPOUSE" as const }] : []),
        ...dependentKeys.filter((d) => d.covered).map((d) => ({ matchKey: d.key, role: "DEPENDENT" as const })),
      ],
      note: row.observaciones || null,
      previousPolicySourceIndex: null,
    });
  }

  // --- Heurística de renovación/reemplazo: encadenar por holder + orden cronológico ---
  const policiesByHolder = new Map<string, PolicyPlanEntry[]>();
  for (const p of policies) {
    const list = policiesByHolder.get(p.holderMatchKey) ?? [];
    list.push(p);
    policiesByHolder.set(p.holderMatchKey, list);
  }
  for (const [, list] of policiesByHolder) {
    const sorted = [...list].sort(comparePolicyChronology);
    for (let i = 0; i < sorted.length; i++) {
      const current = sorted[i];
      if (current.operationType !== "RENEWAL" && current.operationType !== "REPLACEMENT") continue;
      const previous = sorted[i - 1];
      if (!previous) {
        issues.push({
          rowIndex: current.rowIndex,
          sourceIndex: current.sourceIndex,
          code: "RENEWAL_LINK_AMBIGUOUS",
          message: "Marcada como renovación/cambio de plan pero no se encontró una póliza previa del mismo titular anterior en el tiempo — se crea sin previousPolicyId.",
          severity: "WARNING",
        });
        continue;
      }
      current.previousPolicySourceIndex = previous.sourceIndex;
    }

    // Detección de solapamiento de cobertura de salud entre pólizas
    // ACTIVE del mismo holder (nunca se apaga esta regla — Hallazgo #6B
    // de Fase 022). Este chequeo es informativo en el plan; el
    // aplicador vuelve a validarlo de verdad con
    // assertNoOverlappingHealthCoverage antes de cada INSERT real.
    const activeOnes = sorted.filter((p) => p.status === "ACTIVE");
    for (let i = 0; i < activeOnes.length; i++) {
      for (let j = i + 1; j < activeOnes.length; j++) {
        const a = activeOnes[i];
        const b = activeOnes[j];
        const aEnd = a.terminationDate ?? new Date(8640000000000000);
        const bEnd = b.terminationDate ?? new Date(8640000000000000);
        const overlap = a.effectiveDate <= bEnd && b.effectiveDate <= aEnd;
        const isDirectRenewalLink = a.sourceIndex === b.previousPolicySourceIndex || b.sourceIndex === a.previousPolicySourceIndex;
        if (overlap && !isDirectRenewalLink) {
          issues.push({
            rowIndex: b.rowIndex,
            sourceIndex: b.sourceIndex,
            code: "HEALTH_COVERAGE_OVERLAP_REQUIRES_REVIEW",
            message: `Se solapa con la póliza de origen ${a.sourceIndex} del mismo titular — se validará estrictamente al aplicar (puede bloquearse esa fila sin detener el resto).`,
            severity: "WARNING",
          });
        }
      }
    }
  }

  const persons = [...personEntries.values()];
  const households = [...householdByHolderKey.values()];

  const blocking = issues.filter((i) => i.severity === "BLOCKING");
  const carriersNeeded = new Set(policies.map((p) => p.carrierName)).size;
  const productKeySet = new Set(
    policies.map((p) => `${p.carrierName}::${normalizeCarrierName(p.planName)}::${p.planYear}`)
  );

  return {
    generatedAt: new Date().toISOString(),
    persons,
    households,
    policies,
    carrierNames: [...new Set(policies.map((p) => p.carrierName))],
    issues,
    readyToImport: blocking.length === 0,
    counts: {
      sourceRows: sourceRows.length + parseIssues.filter((i) => i.severity === "SKIPPED").length,
      rowsSkipped: issues.filter((i) => i.severity === "SKIPPED").length,
      personsNew: persons.filter((p) => p.outcome === "NEW").length,
      personsMatched: persons.filter((p) => p.outcome === "MATCHED_EXISTING").length,
      householdsNew: households.length,
      policiesToCreate: policies.length,
      policyMembersToCreate: policies.reduce((sum, p) => sum + (p.holderCovered ? 1 : 0) + p.coveredMembers.length, 0),
      carriersNeeded,
      productsNeeded: productKeySet.size,
      sensitiveIdentitiesToImport: persons.filter((p) => p.sensitive.ssn).length,
      uscisToImport: persons.filter((p) => p.sensitive.uscisNumber).length,
      notesToImport: policies.filter((p) => p.note).length,
    },
  };
}
