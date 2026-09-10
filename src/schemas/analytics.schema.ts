import { z } from "zod";
import { emptyStringToUndefined, optionalUuidFilter, optionalEnumFilter, dateOnlySchema } from "@/schemas/common";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { US_STATE_CODES } from "@/lib/us-states";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — Dashboards de analítica (comisiones y
// pólizas). Un mismo selector de PERÍODO (Mes/Trimestre/Año/Rango) se
// reutiliza en ambos dashboards — nunca dos formas distintas de
// expresar lo mismo. `range` es el único caso con dos fechas; los
// demás se resuelven aquí a un [start, end) exclusivo del lado del
// servicio (nunca en el schema, que no conoce reglas de calendario de
// negocio como "primer día del mes").
// ---------------------------------------------------------------------------

export const ANALYTICS_PERIOD_MODE_VALUES = ["MONTH", "QUARTER", "YEAR", "RANGE", "ALL"] as const;

export const BUSINESS_SOURCE_VALUES = ["OWN", "REFERRAL", "UNKNOWN"] as const;

const yearSchema = z.coerce.number().int().min(2000).max(2100);
const monthNumberSchema = z.coerce.number().int().min(1).max(12);
const quarterSchema = z.coerce.number().int().min(1).max(4);

export const analyticsPeriodSchema = z
  .object({
    // Ausente o vacío se trata como "ALL" (todo el histórico
    // accesible) del lado del servicio — nunca aquí, para no depender
    // de la semántica exacta de z.default() con preprocess (que solo
    // se aplica cuando el valor de entrada es `undefined` en sentido
    // estricto, no para "" ya normalizada a undefined).
    periodMode: optionalEnumFilter(ANALYTICS_PERIOD_MODE_VALUES),
    year: z.preprocess(emptyStringToUndefined, yearSchema.optional()),
    month: z.preprocess(emptyStringToUndefined, monthNumberSchema.optional()),
    quarter: z.preprocess(emptyStringToUndefined, quarterSchema.optional()),
    startDate: z.preprocess(emptyStringToUndefined, dateOnlySchema().optional()),
    endDate: z.preprocess(emptyStringToUndefined, dateOnlySchema().optional()),
  })
  .refine((v) => v.periodMode !== "MONTH" || (v.year !== undefined && v.month !== undefined), {
    message: "Selecciona mes y año.",
    path: ["month"],
  })
  .refine((v) => v.periodMode !== "QUARTER" || (v.year !== undefined && v.quarter !== undefined), {
    message: "Selecciona trimestre y año.",
    path: ["quarter"],
  })
  .refine((v) => v.periodMode !== "YEAR" || v.year !== undefined, {
    message: "Selecciona un año.",
    path: ["year"],
  })
  .refine((v) => v.periodMode !== "RANGE" || (v.startDate !== undefined && v.endDate !== undefined), {
    message: "Selecciona una fecha de inicio y de fin.",
    path: ["startDate"],
  })
  .refine((v) => !(v.startDate && v.endDate) || v.startDate <= v.endDate, {
    message: "La fecha de inicio no puede ser posterior a la de fin.",
    path: ["endDate"],
  });

export type AnalyticsPeriodInput = z.infer<typeof analyticsPeriodSchema>;

export const commissionAnalyticsQuerySchema = analyticsPeriodSchema.and(
  z.object({
    carrierId: optionalUuidFilter(),
    agentId: optionalUuidFilter(),
    policyType: optionalEnumFilter(POLICY_TYPE_VALUES),
    businessSource: optionalEnumFilter(BUSINESS_SOURCE_VALUES),
  })
);
export type CommissionAnalyticsQuery = z.infer<typeof commissionAnalyticsQuerySchema>;

export const policyAnalyticsQuerySchema = analyticsPeriodSchema.and(
  z.object({
    // Fecha que el rango de período filtra — cada indicador del
    // dashboard de pólizas ya indica en su propia etiqueta cuál usa
    // (ver policy-analytics.service.ts); este selector solo decide
    // sobre qué campo aplican Mes/Trimestre/Año/Rango.
    // Ausente/vacío se trata como "CREATED" del lado del servicio (ver
    // nota sobre periodMode arriba).
    dateField: optionalEnumFilter(["CREATED", "EFFECTIVE", "TERMINATION"] as const),
    carrierId: optionalUuidFilter(),
    agentId: optionalUuidFilter(),
    policyType: optionalEnumFilter(POLICY_TYPE_VALUES),
    status: optionalEnumFilter(["PENDING", "ACTIVE", "CANCELLED", "EXPIRED"] as const),
    businessSource: optionalEnumFilter(BUSINESS_SOURCE_VALUES),
    geographicState: optionalEnumFilter(US_STATE_CODES),
  })
);
export type PolicyAnalyticsQuery = z.infer<typeof policyAnalyticsQuerySchema>;
