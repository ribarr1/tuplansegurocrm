// Tipos compartidos del pipeline de importación legacy (Fase 019).
// Ningún tipo de aquí debe transportar valores sensibles crudos — ver
// docs/IMPORTING_LEGACY_DATA.md.

export type IssueSeverity = "INFO" | "WARNING" | "BLOCKING" | "EXCLUDED_SENSITIVE";

// row/sheet ubican el problema sin exponer el contenido de la fila.
// message es texto seguro para consola/reporte — nunca debe incluir el
// valor de una columna sensible ni el valor completo de un campo con PII
// (a lo sumo un identificador ya truncado/seguro, ver sensitive.ts).
export type ImportIssue = {
  severity: IssueSeverity;
  code: string;
  sheet: string;
  row?: number;
  message: string;
};

export type PersonMatchConfidence = "STRONG" | "MEDIUM" | "WEAK";
export type PersonMatchOutcome = "MATCHED" | "NEW" | "AMBIGUOUS" | "CONFLICT";

export type PersonPlanEntry = {
  key: string;
  outcome: PersonMatchOutcome;
  confidence?: PersonMatchConfidence;
  existingPersonId?: string;
  sheet: string;
  row: number;
  // Datos ya normalizados que se usarían para crear/actualizar — nunca
  // el row crudo del Excel.
  data: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    dateOfBirth: Date | null;
  };
};

export type HouseholdPlanEntry = {
  sheet: string;
  row: number;
  headPersonKey: string; // referencia lógica dentro del plan, no un id de DB todavía
  memberKeys: { personKey: string; role: "HEAD" | "SPOUSE" | "CHILD" | "DEPENDENT" | "OTHER" }[];
  // Dirección tal como aparece en el source (texto libre, sin partir en
  // líneas/ciudad/estado/ZIP — el formato real es inconsistente, ver
  // docs/IMPORTING_LEGACY_DATA.md). county sí es un valor limpio de una
  // sola columna.
  addressLine1?: string | null;
  county?: string | null;
};

export type PolicyPlanEntry = {
  sheet: string;
  row: number;
  holderPersonKey: string;
  holderCovered: boolean;
  coveredMemberKeys: { personKey: string; role: "SPOUSE" | "DEPENDENT" | "OTHER" }[];
  carrierName: string;
  planName: string;
  policyType: "HEALTH"; // único tipo detectable de forma inequívoca en el source actual
  operationType: "NEW_ENROLLMENT" | "RENEWAL" | "PLAN_CHANGE" | null;
  status: "PENDING" | "ACTIVE" | "CANCELLED";
  effectiveDate: Date | null;
  // El source actual no tiene columna de fecha de terminación — este
  // campo queda preparado (siempre null hoy) para cuando exista, con la
  // misma validación que policies.service.ts::assertTerminationNotBeforeEffective.
  terminationDate: Date | null;
  // MARKETPLACE cuando hay evidencia estructurada (ESTADO/marketplaceState
  // resuelto — un campo que solo tiene sentido para cobertura ACA); nunca
  // inferido del nombre del carrier. null cuando es ambiguo — se reporta
  // UNKNOWN_HEALTH_SOURCE para revisión manual, nunca se asume PRIVATE.
  healthCoverageSource: "MARKETPLACE" | "PRIVATE" | null;
  marketplaceState: string | null;
  premiumAmount: string | null;
  deductibleIndividual: string | null;
  outOfPocketIndividual: string | null;
  incomeUsed: string | null;
  taxCreditAmount: string | null;
  needsPaymentAssistance: boolean;
  blocked: boolean;
  blockReason?: string;
};

export type CommissionExpectationPlanEntry = {
  sheet: string;
  row: number;
  holderNameRaw: string;
  carrierName: string;
  period: Date;
  expectedAmount: string;
  matchedPolicy: PolicyPlanEntry;
};

export type CommissionPaymentPlanEntry = {
  sheet: string;
  row: number;
  holderNameRaw: string;
  carrierName: string;
  period: Date;
  amount: string;
  matchedPolicy: PolicyPlanEntry;
};

export type ImportPlan = {
  generatedAt: Date;
  sourceFileName: string; // nombre de archivo, nunca la ruta completa (puede revelar el usuario/máquina)
  persons: PersonPlanEntry[];
  households: HouseholdPlanEntry[];
  policies: PolicyPlanEntry[];
  commissionExpectations: CommissionExpectationPlanEntry[];
  commissionPayments: CommissionPaymentPlanEntry[];
  issues: ImportIssue[];
  sensitiveSummary: {
    excludedColumns: string[];
    rowsWithExcludedData: number;
    sheetsExcluded: string[];
  };
  deferredMedical: { peopleWithApparentMedicalData: number };
  readyToImport: boolean;
};
