import { z } from "zod";

export const commissionStatementIdSchema = z.uuid("Identificador de reporte inválido.");
export const commissionStatementRowIdSchema = z.uuid("Identificador de fila inválido.");

export const uploadCommissionStatementSchema = z.object({
  source: z.string().trim().min(1, "Selecciona una fuente/formato válido."),
});
export type UploadCommissionStatementInput = z.infer<typeof uploadCommissionStatementSchema>;

export const manualMatchRowSchema = z.object({
  policyId: z.uuid("Selecciona una póliza válida."),
});
export type ManualMatchRowInput = z.infer<typeof manualMatchRowSchema>;

// 5 MB — generoso para un reporte de comisiones (decenas/cientos de
// filas de texto), muy por debajo de lo que justificaría streaming.
export const MAX_STATEMENT_SIZE_BYTES = 5 * 1024 * 1024;
