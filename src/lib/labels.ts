import type { ContactStatus, UserRole } from "@/generated/prisma/client";

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
