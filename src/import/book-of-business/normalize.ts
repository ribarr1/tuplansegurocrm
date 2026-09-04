// Normalización pura (sin I/O) para el importador del libro de
// negocio real — Fase 023. Nunca registra ni transforma PII de forma
// que se pierda su valor original antes de cifrarlo; estas funciones
// operan sobre nombres/carriers/planes/estados, nunca sobre
// SSN/USCIS/números de documento (esos solo se tocan en sensitive.ts).

export function collapseSpaces(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeForMatch(value: string): string {
  return collapseSpaces(value).toUpperCase();
}

// Mismo criterio que products.service.ts::normalizeProductName (trim +
// minúsculas + espacios colapsados) — reimplementado aquí en vez de
// importado porque ese archivo es "server-only" (usa Prisma) y este
// módulo de normalización pura debe poder probarse sin DB. Si alguna
// vez divergen, ambas implementaciones son deliberadamente idénticas.
export function normalizeCarrierName(value: string): string {
  return collapseSpaces(value).toLowerCase();
}

export function normalizePlanName(value: string): string {
  return collapseSpaces(value);
}

const US_STATE_MAP: Record<string, string> = {
  ILLINOIS: "IL",
  GEORGIA: "GA",
  OHIO: "OH",
  "NUEVA JERSEY": "NJ",
  FLORIDA: "FL",
  "CAROLINA DEL SUR": "SC",
};

export function normalizeUsState(value: string): { code: string | null; matched: boolean } {
  const key = normalizeForMatch(value);
  if (key === "") return { code: null, matched: true };
  // Ya viene como código de 2 letras válido.
  if (/^[A-Z]{2}$/.test(key) && Object.values(US_STATE_MAP).includes(key)) {
    return { code: key, matched: true };
  }
  const mapped = US_STATE_MAP[key];
  return mapped ? { code: mapped, matched: true } : { code: null, matched: false };
}

export type ImmigrationSourceMapping = {
  immigrationCategory: "US_CITIZEN" | "LAWFUL_PERMANENT_RESIDENT" | "EMPLOYMENT_AUTHORIZATION" | "OTHER";
  documentType: "PERMANENT_RESIDENT_CARD" | "EMPLOYMENT_AUTHORIZATION_DOCUMENT" | "OTHER" | null;
};

const IMMIGRATION_MAP: Record<string, ImmigrationSourceMapping> = {
  CIUDADANO: { immigrationCategory: "US_CITIZEN", documentType: null },
  "GREEN CARD": { immigrationCategory: "LAWFUL_PERMANENT_RESIDENT", documentType: "PERMANENT_RESIDENT_CARD" },
  "PERMISO DE TRABAJO": { immigrationCategory: "EMPLOYMENT_AUTHORIZATION", documentType: "EMPLOYMENT_AUTHORIZATION_DOCUMENT" },
  OTRO: { immigrationCategory: "OTHER", documentType: "OTHER" },
};

// blank/desconocido -> null (el caller decide si eso significa
// "no tocar" UNKNOWN por default de schema, o reportar advertencia).
export function mapImmigrationSource(value: string): ImmigrationSourceMapping | null {
  const key = normalizeForMatch(value);
  if (key === "") return null;
  return IMMIGRATION_MAP[key] ?? null;
}

export type PolicyStatusSource = "CANCELADA" | "CREADA" | "ENVIADA" | "PROCESADA";
const POLICY_STATUS_MAP: Record<PolicyStatusSource, "CANCELLED" | "PENDING" | "ACTIVE"> = {
  CANCELADA: "CANCELLED",
  CREADA: "PENDING",
  ENVIADA: "PENDING",
  PROCESADA: "ACTIVE",
};
export function mapPolicyStatus(value: string): "CANCELLED" | "PENDING" | "ACTIVE" | null {
  const key = normalizeForMatch(value) as PolicyStatusSource;
  return POLICY_STATUS_MAP[key] ?? null;
}

export type OperationTypeSource = "CLIENTE NUEVO" | "RENOVACION" | "CAMBIO DE PLAN";
const OPERATION_TYPE_MAP: Record<OperationTypeSource, "NEW_ENROLLMENT" | "RENEWAL" | "REPLACEMENT"> = {
  "CLIENTE NUEVO": "NEW_ENROLLMENT",
  RENOVACION: "RENEWAL",
  "CAMBIO DE PLAN": "REPLACEMENT",
};
export function mapOperationType(value: string): "NEW_ENROLLMENT" | "RENEWAL" | "REPLACEMENT" | null {
  const key = normalizeForMatch(value) as OperationTypeSource;
  return OPERATION_TYPE_MAP[key] ?? null;
}

// "SI"/"SÍ" (con o sin acento, cualquier capitalización) -> true. Todo
// lo demás (incluido blank) -> false — nunca se asume cobertura sin
// una marca explícita "SI" en el source.
export function isSourceYes(value: string): boolean {
  const key = normalizeForMatch(value);
  return key === "SI" || key === "SÍ";
}

// Nombre completo normalizado para matching fuerte de personas:
// mayúsculas, espacios colapsados, sin acentos (evita que "Perez" y
// "Pérez" del mismo holder en filas distintas se traten como personas
// diferentes por un typo de tildes).
export function normalizeNameForMatch(first: string, last: string): string {
  const full = `${first} ${last}`;
  return collapseSpaces(full)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// "MM/DD/YYYY" -> Date UTC anclado a medianoche (fecha-solo), o null si
// no es una fecha real de calendario (nunca hace roll-over silencioso,
// mismo criterio que dateOnlySchema en src/schemas/common.ts, pero
// reimplementado aquí en formato MM/DD/YYYY en vez de YYYY-MM-DD porque
// así es como llega este CSV).
export function parseSourceDateMDY(value: string): Date | null {
  const trimmed = value.trim();
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

// Orden cronológico de pólizas del MISMO titular para la heurística de
// encadenado de renovación/reemplazo (build-plan.ts) y la creación
// real en orden (apply-plan.ts) — ambos deben ordenar IDÉNTICO o el
// previousPolicyId resuelto en el plan no coincidiría con el orden de
// creación real. Desempate cuando dos filas comparten la misma
// effectiveDate (raro pero ocurre en el book real: un cambio de plan
// registrado el mismo día que la inscripción): NEW_ENROLLMENT siempre
// se considera anterior a RENEWAL/REPLACEMENT en el mismo día, nunca
// al revés — una renovación no puede preceder a la inscripción que
// renueva.
export function comparePolicyChronology<T extends { effectiveDate: Date; operationType: string | null }>(
  a: T,
  b: T
): number {
  const dateDiff = a.effectiveDate.getTime() - b.effectiveDate.getTime();
  if (dateDiff !== 0) return dateDiff;
  const aIsNew = a.operationType === "NEW_ENROLLMENT" || a.operationType === null;
  const bIsNew = b.operationType === "NEW_ENROLLMENT" || b.operationType === null;
  if (aIsNew && !bIsNew) return -1;
  if (!aIsNew && bIsNew) return 1;
  return 0;
}

// Monto en dólares desde texto de source ("$1,234.50", "1234.5", "",
// "N/A") -> number o null si no es un monto real. No se usa Decimal
// aquí (el import trabaja en memoria); apply-plan.ts convierte a
// Prisma.Decimal recién al escribir.
export function parseSourceAmount(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const cleaned = trimmed.replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}
