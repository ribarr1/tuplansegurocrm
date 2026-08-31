// Mappings explícitos legacy → modelo actual — Fase 019. Nunca fuzzy
// match automático (ver docs/DECISIONS.md): cada valor legacy debe
// aparecer aquí literalmente o se reporta como UNKNOWN/bloqueado.
//
// Construidos inspeccionando los valores REALES y distintos del
// workbook de TuPlanSeguro USA (columnas ESTATUS, COMPAÑIA DE
// SEGUROS, TIPO DE APLICACION, ESTADO) — nunca adivinados.

// ESTATUS (legacy) -> PolicyStatus real. "FALTA" es ambiguo (puede
// significar "falta pago"/"falta documento"/etc.) — se deja fuera del
// mapa a propósito, cualquier valor sin entrada aquí se reporta como
// UNKNOWN_POLICY_STATUS y bloquea la fila (nunca se asume PENDING).
export const POLICY_STATUS_MAP: Record<string, "PENDING" | "ACTIVE" | "CANCELLED"> = {
  PROCESADA: "ACTIVE",
  CANCELADA: "CANCELLED",
  BRADON: "PENDING", // "borrador" (draft) — confirmado como valor legacy real, no un typo a corregir a mano
};

// TIPO DE APLICACION (legacy) -> PolicyOperationType real.
export const OPERATION_TYPE_MAP: Record<string, "NEW_ENROLLMENT" | "RENEWAL" | "PLAN_CHANGE"> = {
  "CLIENTE NUEVO": "NEW_ENROLLMENT",
  RENOVACION: "RENEWAL",
  "CAMBIO DE PLAN": "PLAN_CHANGE",
};

// ESTADO (nombre de estado en español, columna de la póliza en el
// source — corresponde a HealthPolicyDetail.marketplaceState, no a una
// dirección de Person, que el schema no tiene todavía) -> código de 2
// letras real.
export const MARKETPLACE_STATE_MAP: Record<string, string> = {
  "CAROLINA DEL SUR": "SC",
  FLORIDA: "FL",
  GEORGIA: "GA",
  ILLINOIS: "IL",
  "NUEVA JERSEY": "NJ",
  OHIO: "OH",
};

// COMPAÑIA DE SEGUROS (legacy) -> nombre real de Carrier a crear/reutilizar.
// Todos los valores reales del source ya vienen limpios (sin variantes
// de mayúsculas/espacios detectadas en "clientes") — se normalizan 1:1.
// Deliberadamente NUNCA se mapea contra un Carrier "(Dev Seed)".
export const CARRIER_NAME_MAP: Record<string, string> = {
  AMBETTER: "Ambetter",
  "BLUE CROSS BLUE SHIELD (BCBS)": "Blue Cross Blue Shield (BCBS)",
  "KAISER PERMANENTE": "Kaiser Permanente",
  OSCAR: "Oscar",
};

// AGENTE (legacy, nombre de staff) -> User.email real. Vacío a
// propósito: NUNCA se crea un User automáticamente (ver
// docs/DECISIONS.md) — se completa explícitamente antes de --apply, o
// las filas quedan con agentId/processedById en null y se reportan
// como UNMAPPED_AGENT (INFO, no bloquea).
export const AGENT_NAME_TO_EMAIL_MAP: Record<string, string> = {
  // "RUBEN IBARRA": "admin.prueba@tuplanseguro.test",
};
