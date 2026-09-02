import type {
  ContactStatus,
  HouseholdMemberRole,
  UserRole,
  PolicyType,
  PolicyStatus,
  PolicyOperationType,
  PolicyMemberRole,
  BillingFrequency,
  PaymentStatus,
  TaskStatus,
  TaskPriority,
  BirthdayGreetingStatus,
  BirthdayGreetingChannel,
  CommissionExpectationStatus,
  CommissionPaymentType,
  HealthCoverageSource,
  PolicyDocumentType,
  CommissionMethod,
  CommissionBase,
  CommissionPeriodicity,
  ProviderType,
} from "@/generated/prisma/client";

// Duplicado deliberadamente de COMMISSION_DERIVED_STATUS_VALUES
// (commissions.service.ts) — ese módulo es "server-only" y labels.ts se
// importa también desde componentes cliente, así que no puede
// depender de él directamente.
type CommissionDerivedStatus =
  | "CANCELLED"
  | "ZERO"
  | "NO_EXPECTATION"
  | "NEGATIVE_BALANCE"
  | "PENDING"
  | "PARTIAL"
  | "PAID"
  | "OVERPAID";

// Solo presentación — los valores de enum en la base de datos no cambian.
export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  PROSPECT: "Prospecto",
  CLIENT: "Cliente",
  FORMER_CLIENT: "Ex cliente",
  OTHER: "Otro",
};

export const CONTACT_STATUS_BADGE_VARIANT: Record<
  ContactStatus,
  "default" | "secondary" | "outline"
> = {
  PROSPECT: "secondary",
  CLIENT: "default",
  FORMER_CLIENT: "outline",
  OTHER: "outline",
};

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrador",
  AGENT: "Agente",
  ASSISTANT: "Asistente",
};

export const HOUSEHOLD_MEMBER_ROLE_LABELS: Record<HouseholdMemberRole, string> = {
  HEAD: "Titular del hogar",
  SPOUSE: "Esposo/a",
  CHILD: "Hijo/a",
  DEPENDENT: "Dependiente",
  OTHER: "Otro",
};

export const POLICY_TYPE_LABELS: Record<PolicyType, string> = {
  HEALTH: "Salud",
  LIFE: "Vida",
  SUPPLEMENTAL: "Complementario",
  DENTAL: "Dental",
  FINAL_EXPENSE: "Gastos finales",
};

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  PENDING: "Pendiente",
  ACTIVE: "Activa",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
};

export const POLICY_STATUS_BADGE_VARIANT: Record<
  PolicyStatus,
  "default" | "secondary" | "outline"
> = {
  PENDING: "secondary",
  ACTIVE: "default",
  CANCELLED: "outline",
  EXPIRED: "outline",
};

export const HEALTH_COVERAGE_SOURCE_LABELS: Record<HealthCoverageSource, string> = {
  MARKETPLACE: "Marketplace",
  PRIVATE: "Privado",
};

export const POLICY_DOCUMENT_TYPE_LABELS: Record<PolicyDocumentType, string> = {
  PLAN_SUMMARY: "Resumen del plan",
  BROCHURE: "Brochure",
  FORMULARY: "Listado de medicamentos",
  PROVIDER_DIRECTORY: "Directorio de proveedores",
  MEMBER_CARD: "Tarjeta / ID",
  APPLICATION: "Solicitud",
  OTHER: "Otro",
};

export const POLICY_OPERATION_TYPE_LABELS: Record<PolicyOperationType, string> = {
  NEW_ENROLLMENT: "Nueva inscripción",
  RENEWAL: "Renovación",
  PLAN_CHANGE: "Cambio de plan",
};

export const POLICY_MEMBER_ROLE_LABELS: Record<PolicyMemberRole, string> = {
  PRIMARY: "Titular cubierto",
  SPOUSE: "Esposo/a",
  DEPENDENT: "Dependiente",
  OTHER: "Otro",
};

// Fase 019.7 (hallazgo #13 de UAT): HouseholdMember.role (filiación
// familiar real, ya capturada al armar el hogar) es el source of
// truth de la relación — PolicyMember.role es un concepto DISTINTO
// (rol dentro de la cobertura de la póliza) y nunca debe mezclarse ni
// mostrarse como si fuera lo mismo. Esta función solo sugiere un
// default razonable al agregar alguien a una póliza; el usuario puede
// cambiarlo — no es una regla de negocio impuesta por el servicio.
// PRIMARY queda deliberadamente fuera del mapeo: está reservado para
// el titular vía holderCovered, nunca se asigna desde "agregar miembro".
export function suggestPolicyMemberRole(
  householdRole: HouseholdMemberRole
): Exclude<PolicyMemberRole, "PRIMARY"> {
  switch (householdRole) {
    case "SPOUSE":
      return "SPOUSE";
    case "CHILD":
    case "DEPENDENT":
      return "DEPENDENT";
    case "HEAD":
    case "OTHER":
    default:
      return "OTHER";
  }
}

export const BILLING_FREQUENCY_LABELS: Record<BillingFrequency, string> = {
  MONTHLY: "Mensual",
  QUARTERLY: "Trimestral",
  SEMIANNUAL: "Semestral",
  ANNUAL: "Anual",
  OTHER: "Otra",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  CURRENT: "Al día",
  DUE: "Por vencer",
  PAST_DUE: "Vencido",
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  OPEN: "Pendiente",
  IN_PROGRESS: "En progreso",
  COMPLETED: "Completada",
  CANCELLED: "Cancelada",
};

export const TASK_STATUS_BADGE_VARIANT: Record<
  TaskStatus,
  "default" | "secondary" | "outline"
> = {
  OPEN: "secondary",
  IN_PROGRESS: "default",
  COMPLETED: "outline",
  CANCELLED: "outline",
};

export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: "Baja",
  NORMAL: "Normal",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export const TASK_PRIORITY_BADGE_VARIANT: Record<
  TaskPriority,
  "outline" | "secondary" | "default" | "destructive"
> = {
  LOW: "outline",
  NORMAL: "secondary",
  HIGH: "default",
  URGENT: "destructive",
};

export const BIRTHDAY_GREETING_STATUS_LABELS: Record<BirthdayGreetingStatus, string> = {
  PENDING: "Pendiente",
  SENT: "Enviada",
  SKIPPED: "Omitida",
};

export const BIRTHDAY_GREETING_STATUS_BADGE_VARIANT: Record<
  BirthdayGreetingStatus,
  "default" | "secondary" | "outline"
> = {
  PENDING: "secondary",
  SENT: "default",
  SKIPPED: "outline",
};

export const BIRTHDAY_GREETING_CHANNEL_LABELS: Record<BirthdayGreetingChannel, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Email",
  OTHER: "Otro",
};

export const COMMISSION_EXPECTATION_STATUS_LABELS: Record<CommissionExpectationStatus, string> = {
  ACTIVE: "Activa",
  CANCELLED: "Cancelada",
};

export const COMMISSION_PAYMENT_TYPE_LABELS: Record<CommissionPaymentType, string> = {
  PAYMENT: "Pago",
  CHARGEBACK: "Chargeback",
  ADJUSTMENT: "Ajuste",
};

// PENDING/PARTIAL/PAID/OVERPAID/etc. son estados DERIVADOS (nunca se
// guardan) — ver computeCommissionStatus en commissions.service.ts.
export const COMMISSION_DERIVED_STATUS_LABELS: Record<CommissionDerivedStatus, string> = {
  CANCELLED: "Cancelada",
  ZERO: "Sin monto esperado",
  NO_EXPECTATION: "Movimiento sin expectativa",
  NEGATIVE_BALANCE: "Saldo negativo",
  PENDING: "Pendiente",
  PARTIAL: "Parcial",
  PAID: "Pagada",
  OVERPAID: "Sobrepagada",
};

export const COMMISSION_DERIVED_STATUS_BADGE_VARIANT: Record<
  CommissionDerivedStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  CANCELLED: "outline",
  ZERO: "outline",
  NO_EXPECTATION: "destructive",
  NEGATIVE_BALANCE: "destructive",
  PENDING: "secondary",
  PARTIAL: "secondary",
  PAID: "default",
  OVERPAID: "destructive",
};

export const COMMISSION_METHOD_LABELS: Record<CommissionMethod, string> = {
  FIXED_AMOUNT: "Monto fijo",
  PERCENTAGE: "Porcentaje",
};

export const COMMISSION_BASE_LABELS: Record<CommissionBase, string> = {
  PREMIUM_MONTHLY: "Prima mensual",
  PREMIUM_ANNUALIZED: "Prima anualizada",
  PER_MEMBER: "Por miembro cubierto",
  FIXED: "Monto fijo (sin base)",
  OTHER: "Otro",
};

export const COMMISSION_PERIODICITY_LABELS: Record<CommissionPeriodicity, string> = {
  ONE_TIME: "Única vez",
  MONTHLY: "Mensual",
  ANNUAL: "Anual",
};

// Fase 019.8 (hallazgo #18 de UAT) — proveedores/médicos preferidos.
export const PROVIDER_TYPE_LABELS: Record<ProviderType, string> = {
  PCP: "Médico primario (PCP)",
  SPECIALIST: "Especialista",
  OTHER: "Otro",
};
