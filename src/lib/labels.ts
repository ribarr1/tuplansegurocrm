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
} from "@/generated/prisma/client";

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
  SPOUSE: "Cónyuge",
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

export const POLICY_OPERATION_TYPE_LABELS: Record<PolicyOperationType, string> = {
  NEW_ENROLLMENT: "Nueva inscripción",
  RENEWAL: "Renovación",
  PLAN_CHANGE: "Cambio de plan",
};

export const POLICY_MEMBER_ROLE_LABELS: Record<PolicyMemberRole, string> = {
  PRIMARY: "Titular cubierto",
  SPOUSE: "Cónyuge",
  DEPENDENT: "Dependiente",
  OTHER: "Otro",
};

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
