import { z } from "zod";
import {
  optionalSearchFilter,
  optionalUuidFilter,
  optionalEnumFilter,
  optionalBooleanFilter,
  emptyStringToUndefined,
} from "@/schemas/common";
import { CONTACT_STATUS_VALUES } from "@/schemas/person.schema";
import { IMMIGRATION_CATEGORY_VALUES } from "@/schemas/sensitive-identity.schema";

// Valores reales de PolicyType/HealthCoverageSource (prisma/schema.prisma)
// — duplicados aquí como literales por la misma razón que en el resto
// de schemas (evitar depender del cliente Prisma generado en la capa
// de validación).
const POLICY_TYPE_VALUES = ["HEALTH", "LIFE", "SUPPLEMENTAL", "DENTAL", "FINAL_EXPENSE"] as const;

// Reporte operativo de clientes — Fase 021 (§31-§38). Nunca duplica
// Contact Detail: es una vista de cartera para filtrar/exportar, cada
// fila enlaza al Contact Detail real (fuente de verdad). Nunca incluye
// SSN/USCIS/A-Number/número de documento — solo la categoría
// migratoria (ver docs/SENSITIVE_PII.md).
export const clientReportQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: optionalSearchFilter(),
  contactStatus: optionalEnumFilter(CONTACT_STATUS_VALUES),
  assignedAgentId: optionalUuidFilter(),
  state: z.preprocess(
    emptyStringToUndefined,
    z.string().trim().toUpperCase().length(2, "Estado inválido.").optional()
  ),
  city: optionalSearchFilter(100),
  county: optionalSearchFilter(100),
  zipCode: optionalSearchFilter(10),
  immigrationCategory: optionalEnumFilter(IMMIGRATION_CATEGORY_VALUES),
  hasActivePolicy: optionalBooleanFilter(),
  policyType: optionalEnumFilter(POLICY_TYPE_VALUES),
  carrierId: optionalUuidFilter(),
  paymentAssistance: optionalBooleanFilter(),
  expiringSoon: optionalBooleanFilter(),
});
export type ClientReportQuery = z.infer<typeof clientReportQuerySchema>;
