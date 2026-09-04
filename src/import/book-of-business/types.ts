// Tipos del importador del libro de negocio real — Fase 023. Los
// campos marcados "SENSIBLE" nunca deben pasar por console.log,
// JSON.stringify hacia un archivo de reporte, ni AuditEvent — solo se
// leen para cifrarlos (ver sensitive.ts) y se descartan.

export type PersonSourceData = {
  firstName: string;
  lastName: string;
  displayName: string; // NOMBRE Y APELLIDO tal cual, solo para desambiguar en warnings sin PII estructurada
  dateOfBirth: Date | null;
  email: string | null;
  phone: string | null;
  ssn: string | null; // SENSIBLE — normalizado a 9 dígitos, o null
  immigrationSource: string | null; // valor crudo de TIPO DE DOCUMENTO
  uscisNumber: string | null; // SENSIBLE — normalizado
  covered: boolean;
};

export type DependentSourceData = PersonSourceData & {
  relationRaw: string;
};

export type SourceRow = {
  rowIndex: number; // fila real del CSV (1-based, sin contar encabezado) — SOLO para reportes/errores, nunca INDEX de negocio
  sourceIndex: string; // columna INDEX del CSV — trazabilidad de origen únicamente
  status: string;
  holderDisplayName: string;
  agent: string;
  effectiveDateRaw: string;
  // Nunca null en un SourceRow ya emitido por parse-source.ts — una
  // fila sin fecha efectiva real se marca SKIPPED y no llega a `rows`.
  effectiveDate: Date;
  stateRaw: string;
  carrierRaw: string;
  processedBy: string;
  consentUsed: string;
  assistance: boolean;
  planRaw: string;
  premium: number | null;
  deductible: number | null;
  outOfPocketMax: number | null;
  income: number | null;
  taxCredit: number | null;
  operationTypeRaw: string;
  holder: PersonSourceData;
  spouse: PersonSourceData | null;
  dependents: DependentSourceData[];
  addressRaw: string;
  county: string | null;
  observaciones: string;
  membersRaw: string;
};

export type RowIssue = {
  rowIndex: number;
  sourceIndex: string;
  code: string;
  message: string;
  severity: "BLOCKING" | "WARNING" | "SKIPPED";
};

export type PersonPlanEntry = {
  matchKey: string; // normalizeNameForMatch + DOB — clave interna del plan, nunca PII cruda expuesta en reportes
  outcome: "NEW" | "MATCHED_EXISTING" | "MATCHED_IN_BATCH";
  existingPersonId?: string;
  data: {
    firstName: string;
    lastName: string;
    dateOfBirth: Date | null;
    email: string | null;
    phone: string | null;
  };
  sensitive: {
    ssn: string | null;
    uscisNumber: string | null;
    immigrationCategory:
      | "US_CITIZEN"
      | "LAWFUL_PERMANENT_RESIDENT"
      | "EMPLOYMENT_AUTHORIZATION"
      | "OTHER"
      | null;
    documentType: "PERMANENT_RESIDENT_CARD" | "EMPLOYMENT_AUTHORIZATION_DOCUMENT" | "OTHER" | null;
  };
};

export type HouseholdPlanEntry = {
  holderMatchKey: string;
  addressLine1: string | null;
  county: string | null;
  state: string | null;
  annualHouseholdIncome: number | null;
  incomeYear: number | null;
  members: { matchKey: string; role: "HEAD" | "SPOUSE" | "CHILD" | "DEPENDENT" | "OTHER" }[];
};

export type PolicyPlanEntry = {
  rowIndex: number;
  sourceIndex: string;
  holderMatchKey: string;
  carrierName: string;
  planName: string;
  planYear: number;
  status: "PENDING" | "ACTIVE" | "CANCELLED";
  operationType: "NEW_ENROLLMENT" | "RENEWAL" | "REPLACEMENT" | null;
  effectiveDate: Date;
  terminationDate: Date | null;
  premiumAmount: number | null;
  needsPaymentAssistance: boolean;
  healthCoverageSource: "MARKETPLACE";
  marketplaceState: string | null;
  deductible: number | null;
  outOfPocketMax: number | null;
  incomeUsed: number | null;
  taxCredit: number | null;
  holderCovered: boolean;
  coveredMembers: { matchKey: string; role: "SPOUSE" | "DEPENDENT" }[];
  note: string | null;
  previousPolicySourceIndex: string | null; // heurística de renovación, resuelto en build-plan
};

export type ImportPlan = {
  generatedAt: string;
  persons: PersonPlanEntry[];
  households: HouseholdPlanEntry[];
  policies: PolicyPlanEntry[];
  carrierNames: string[]; // ya normalizados/matcheados contra el catálogo
  issues: RowIssue[];
  readyToImport: boolean;
  counts: {
    sourceRows: number;
    rowsSkipped: number;
    personsNew: number;
    personsMatched: number;
    householdsNew: number;
    policiesToCreate: number;
    policyMembersToCreate: number;
    carriersNeeded: number;
    productsNeeded: number;
    sensitiveIdentitiesToImport: number;
    uscisToImport: number;
    notesToImport: number;
  };
};
