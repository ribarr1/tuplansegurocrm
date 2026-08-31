import { z } from "zod";

export const policyIdForHealthSchema = z.uuid("Identificador de póliza inválido.");

const decimalAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Ingresa un monto válido (ej. 1250.00).")
  .refine((v) => Number(v) >= 0, "El monto no puede ser negativo.");

// Cada campo distingue tres estados, no dos:
//   - clave ausente del FormData  -> undefined -> "no tocar" (update:
//     deja el valor existente; create: Prisma lo omite, queda null).
//   - clave presente pero vacía   -> null -> "borrar explícitamente".
//   - clave presente con valor    -> se valida y se guarda.
// El ".optional()" exterior es lo que preserva el primer caso — sin
// él, un formulario que no renderiza un campo (ej. ASSISTANT sin
// incomeUsed) lo borraría sin querer en vez de dejarlo intacto.
function nullableTrimmedString(max: number, label: string) {
  return z
    .string()
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.union([z.null(), z.string().max(max, `${label} es demasiado largo.`)]))
    .optional();
}

function nullableDecimal() {
  return z
    .string()
    .transform((v) => {
      const trimmed = v.trim();
      return trimmed === "" ? null : trimmed;
    })
    .pipe(z.union([z.null(), decimalAmountSchema]))
    .optional();
}

// VarChar(2): se normaliza a mayúsculas antes de validar (il -> IL).
// Sin catálogo rígido de estados — cualquier par de letras es válido.
const marketplaceStateSchema = z
  .string()
  .transform((v) => {
    const trimmed = v.trim().toUpperCase();
    return trimmed === "" ? null : trimmed;
  })
  .pipe(
    z.union([
      z.null(),
      z.string().regex(/^[A-Z]{2}$/, "El estado debe ser de 2 letras (ej. IL, TX, FL)."),
    ])
  )
  .optional();

// Campos reales de HealthPolicyDetail (prisma/schema.prisma). Mismo
// shape para crear y actualizar — "actualizar" en esta fase es
// reemplazar la pantalla completa, no editar campo por campo.
const healthPolicyDetailFields = {
  marketplaceApplicationId: nullableTrimmedString(100, "El número de aplicación"),
  marketplaceState: marketplaceStateSchema,
  planNameSnapshot: nullableTrimmedString(300, "El nombre del plan"),
  taxCreditAmount: nullableDecimal(),
  incomeUsed: nullableDecimal(),
  deductibleIndividual: nullableDecimal(),
  deductibleFamily: nullableDecimal(),
  outOfPocketIndividual: nullableDecimal(),
  outOfPocketFamily: nullableDecimal(),
};

export const createHealthPolicyDetailSchema = z.object({
  policyId: policyIdForHealthSchema,
  ...healthPolicyDetailFields,
});
export type CreateHealthPolicyDetailInput = z.infer<typeof createHealthPolicyDetailSchema>;

export const updateHealthPolicyDetailSchema = z.object(healthPolicyDetailFields);
export type UpdateHealthPolicyDetailInput = z.infer<typeof updateHealthPolicyDetailSchema>;

// Campos financieros de Marketplace restringidos para ASSISTANT (ver
// docs/DECISIONS.md) — ni siquiera puede intentar modificarlos.
export const ASSISTANT_RESTRICTED_HEALTH_FIELDS = ["incomeUsed", "taxCreditAmount"] as const;
