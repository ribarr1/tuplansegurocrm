"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { USDateInput } from "@/components/ui/us-date-input";
import { Label } from "@/components/ui/label";
import { FormError, FieldError } from "@/components/ui/form-feedback";
import {
  POLICY_STATUS_VALUES,
  BILLING_FREQUENCY_VALUES,
  PAYMENT_STATUS_VALUES,
  POLICY_OPERATION_TYPE_VALUES,
  HEALTH_COVERAGE_SOURCE_VALUES,
} from "@/schemas/policy.schema";
import {
  POLICY_STATUS_LABELS,
  BILLING_FREQUENCY_LABELS,
  PAYMENT_STATUS_LABELS,
  POLICY_OPERATION_TYPE_LABELS,
  HEALTH_COVERAGE_SOURCE_LABELS,
} from "@/lib/labels";
import type { PolicyFormState } from "../form-helpers";
import type { ProductOption } from "../policy-form";

export type EditPolicyDefaultValues = {
  productId: string;
  policyNumber?: string;
  status: string;
  effectiveDate?: string;
  terminationDate?: string;
  premiumAmount?: string;
  billingFrequency?: string;
  nextPaymentDueDate?: string;
  autopay: boolean;
  needsPaymentAssistance: boolean;
  paymentStatus?: string;
  operationType?: string;
  processedById?: string;
  healthCoverageSource?: string;
};

export function EditPolicyForm({
  action,
  defaultValues,
  canChangeProduct,
  products,
  showProcessedBySelect,
  activeAgents = [],
  isHealthPolicy,
}: {
  action: (state: PolicyFormState, formData: FormData) => Promise<PolicyFormState>;
  defaultValues: EditPolicyDefaultValues;
  canChangeProduct: boolean;
  products: ProductOption[];
  showProcessedBySelect: boolean;
  activeAgents?: { id: string; name: string }[];
  isHealthPolicy: boolean;
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  // Los checkboxes viajan en state.values como string "true"/"false"
  // (formDataToUpdatePolicyInput) tras un error — un simple spread los
  // dejaría siempre truthy ("false" es una string no vacía). Se
  // resuelven aparte para no perder el valor real.
  const autopay = state?.values?.autopay !== undefined
    ? state.values.autopay === "true"
    : defaultValues.autopay;
  const needsPaymentAssistance =
    state?.values?.needsPaymentAssistance !== undefined
      ? state.values.needsPaymentAssistance === "true"
      : defaultValues.needsPaymentAssistance;
  const values = { ...defaultValues, ...(state?.values ?? {}), autopay, needsPaymentAssistance };
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-2xl flex-col gap-4">
      {/* updatePolicyAction redirige a /policies/[id] al guardar (nunca
          retorna success:true) — la navegación a la póliza actualizada
          ES la confirmación, mismo patrón que el resto de formularios
          "crear/editar" que redirigen en la app. */}
      <FormError message={state?.error} />

      <div className="flex flex-col gap-1">
        <Label htmlFor="productId">Producto</Label>
        {canChangeProduct ? (
          <select
            id="productId"
            name="productId"
            defaultValue={values.productId}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.carrier.name} — {product.name}
                {product.planYear ? ` (${product.planYear})` : ""}
              </option>
            ))}
          </select>
        ) : (
          <>
            <input type="hidden" name="productId" value={values.productId} />
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              El producto solo puede cambiarse mientras la póliza está Pendiente.
            </p>
          </>
        )}
        {state?.fieldErrors?.productId && (
          <p className="text-sm text-destructive">{state.fieldErrors.productId}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyNumber">Número de póliza</Label>
          <Input id="policyNumber" name="policyNumber" defaultValue={values.policyNumber ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Estado</Label>
          <select
            id="status"
            name="status"
            defaultValue={values.status}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {POLICY_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {POLICY_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="effectiveDate">Fecha efectiva (MM/DD/AAAA)</Label>
          <USDateInput
            id="effectiveDate"
            name="effectiveDate"
            defaultValue={values.effectiveDate ?? ""}
          />
          {state?.fieldErrors?.effectiveDate && (
            <p className="text-sm text-destructive">{state.fieldErrors.effectiveDate}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="terminationDate">Fecha de terminación (MM/DD/AAAA)</Label>
          <USDateInput
            id="terminationDate"
            name="terminationDate"
            defaultValue={values.terminationDate ?? ""}
            aria-invalid={!!state?.fieldErrors?.terminationDate}
            aria-describedby={state?.fieldErrors?.terminationDate ? "terminationDate-error" : undefined}
          />
          <FieldError id="terminationDate-error" message={state?.fieldErrors?.terminationDate} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="premiumAmount">Prima</Label>
          <Input
            id="premiumAmount"
            name="premiumAmount"
            placeholder="Ej. 125.50"
            defaultValue={values.premiumAmount ?? ""}
          />
          {state?.fieldErrors?.premiumAmount && (
            <p className="text-sm text-destructive">{state.fieldErrors.premiumAmount}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="billingFrequency">Frecuencia de pago</Label>
          <select
            id="billingFrequency"
            name="billingFrequency"
            defaultValue={values.billingFrequency ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {BILLING_FREQUENCY_VALUES.map((freq) => (
              <option key={freq} value={freq}>
                {BILLING_FREQUENCY_LABELS[freq]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="nextPaymentDueDate">Próximo pago (MM/DD/AAAA)</Label>
          <USDateInput
            id="nextPaymentDueDate"
            name="nextPaymentDueDate"
            defaultValue={values.nextPaymentDueDate ?? ""}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="paymentStatus">Estado de pago</Label>
          <select
            id="paymentStatus"
            name="paymentStatus"
            defaultValue={values.paymentStatus ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {PAYMENT_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {PAYMENT_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex gap-6 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="autopay" defaultChecked={values.autopay} />
          Autopay
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            name="needsPaymentAssistance"
            defaultChecked={values.needsPaymentAssistance}
          />
          Necesita asistencia para pagar
        </label>
      </div>

      {isHealthPolicy && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="healthCoverageSource">Tipo de cobertura</Label>
          <select
            id="healthCoverageSource"
            name="healthCoverageSource"
            defaultValue={values.healthCoverageSource ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin definir</option>
            {HEALTH_COVERAGE_SOURCE_VALUES.map((source) => (
              <option key={source} value={source}>
                {HEALTH_COVERAGE_SOURCE_LABELS[source]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex flex-col gap-1">
        <Label htmlFor="operationType">Tipo de operación</Label>
        <select
          id="operationType"
          name="operationType"
          defaultValue={values.operationType ?? "NEW_ENROLLMENT"}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {POLICY_OPERATION_TYPE_VALUES.map((type) => (
            <option key={type} value={type}>
              {POLICY_OPERATION_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>

      {showProcessedBySelect && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="processedById">Procesado por</Label>
          <select
            id="processedById"
            name="processedById"
            defaultValue={values.processedById ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Sin cambios</option>
            {activeAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Guardar cambios"}
      </Button>
    </form>
  );
}
