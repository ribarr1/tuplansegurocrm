import { z } from "zod";

export const commissionStatementIdSchema = z.uuid("Identificador de reporte inválido.");
export const commissionStatementRowIdSchema = z.uuid("Identificador de fila inválido.");

export const uploadCommissionStatementSchema = z.object({
  source: z.string().trim().min(1, "Selecciona una fuente/formato válido."),
});
export type UploadCommissionStatementInput = z.infer<typeof uploadCommissionStatementSchema>;

// Fase 025.5.6 (UAT-22): policyMemberId solo aplica a Orange Referidas
// (paga por miembro, no por póliza agregada); outOfPeriodReason es
// obligatorio SOLO cuando la póliza elegida no cubre el periodo de
// comisión — esa validación cruzada vive en reconciliation.service.ts
// (requiere leer el periodo real de la fila), nunca aquí en el schema.
export const manualMatchRowSchema = z.object({
  policyId: z.uuid("Selecciona una póliza válida."),
  policyMemberId: z.uuid("Selecciona un miembro válido.").nullish(),
  outOfPeriodReason: z.string().trim().min(3, "Escribe un motivo breve.").max(500).nullish(),
});
export type ManualMatchRowInput = z.infer<typeof manualMatchRowSchema>;

// 5 MB — generoso para un reporte de comisiones (decenas/cientos de
// filas de texto), muy por debajo de lo que justificaría streaming.
export const MAX_STATEMENT_SIZE_BYTES = 5 * 1024 * 1024;
