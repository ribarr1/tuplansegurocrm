"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  POLICY_STATUS_VALUES,
  BILLING_FREQUENCY_VALUES,
  PAYMENT_STATUS_VALUES,
  POLICY_OPERATION_TYPE_VALUES,
  COVERED_MEMBER_ROLE_VALUES,
} from "@/schemas/policy.schema";
import {
  POLICY_STATUS_LABELS,
  BILLING_FREQUENCY_LABELS,
  PAYMENT_STATUS_LABELS,
  POLICY_OPERATION_TYPE_LABELS,
  POLICY_MEMBER_ROLE_LABELS,
} from "@/lib/labels";
import type { PolicyFormState } from "./form-helpers";

export type ProductOption = {
  id: string;
  name: string;
  planYear: number | null;
  carrier: { name: string };
};

export type CoveredCandidate = { id: string; firstName: string; lastName: string };

export function PolicyForm({
  action,
  holderId,
  holderLabel,
  products,
  candidates,
  showProcessedBySelect,
  activeAgents = [],
}: {
  action: (state: PolicyFormState, formData: FormData) => Promise<PolicyFormState>;
  holderId: string;
  holderLabel: string;
  products: ProductOption[];
  candidates: CoveredCandidate[];
  showProcessedBySelect: boolean;
  activeAgents?: { id: string; name: string }[];
}) {
  const [state, formAction, isPending] = useActionState(action, undefined);
  const values = state?.values ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex max-w-2xl flex-col gap-6">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}

      <input type="hidden" name="holderId" value={holderId} />
      <input type="hidden" name="candidatePersonIds" value={candidates.map((c) => c.id).join(",")} />

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Titular</h3>
        <p className="text-sm text-muted-foreground">{holderLabel}</p>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Producto</h3>
        <div className="flex flex-col gap-1">
          <Label htmlFor="productId">Producto</Label>
          <select
            id="productId"
            name="productId"
            defaultValue={values.productId ?? ""}
            required
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="" disabled>
              Selecciona un producto
            </option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.carrier.name} — {product.name}
                {product.planYear ? ` (${product.planYear})` : ""}
              </option>
            ))}
          </select>
          {products.length === 0 && (
            <p className="text-xs text-muted-foreground">
              No hay productos activos que coincidan con el filtro. Ajusta el filtro arriba.
            </p>
          )}
          {state?.fieldErrors?.productId && (
            <p className="text-sm text-destructive">{state.fieldErrors.productId}</p>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Cobertura</h3>
        <div className="flex flex-col gap-1">
          <span className="text-sm">¿El titular está cubierto por esta póliza?</span>
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="holderCovered"
                value="true"
                defaultChecked={(values.holderCovered ?? "false") === "true"}
              />
              Sí
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="holderCovered"
                value="false"
                defaultChecked={(values.holderCovered ?? "false") === "false"}
              />
              No
            </label>
          </div>
        </div>

        {candidates.length > 0 && (
          <div className="flex flex-col gap-2">
            <span className="text-sm">Otras personas a cubrir (miembros del hogar)</span>
            <div className="flex flex-col gap-2">
              {candidates.map((candidate) => (
                <div key={candidate.id} className="flex items-center gap-3">
                  <label className="flex flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" name={`member_${candidate.id}`} />
                    {candidate.firstName} {candidate.lastName}
                  </label>
                  <select
                    name={`role_${candidate.id}`}
                    defaultValue="OTHER"
                    className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  >
                    {COVERED_MEMBER_ROLE_VALUES.map((role) => (
                      <option key={role} value={role}>
                        {POLICY_MEMBER_ROLE_LABELS[role]}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">Datos de la póliza</h3>

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
              defaultValue={values.status ?? "PENDING"}
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
            <Label htmlFor="effectiveDate">Fecha efectiva</Label>
            <Input
              id="effectiveDate"
              name="effectiveDate"
              type="date"
              defaultValue={values.effectiveDate ?? ""}
            />
            {state?.fieldErrors?.effectiveDate && (
              <p className="text-sm text-destructive">{state.fieldErrors.effectiveDate}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="terminationDate">Fecha de terminación</Label>
            <Input
              id="terminationDate"
              name="terminationDate"
              type="date"
              defaultValue={values.terminationDate ?? ""}
            />
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
            <Label htmlFor="nextPaymentDueDate">Próximo pago</Label>
            <Input
              id="nextPaymentDueDate"
              name="nextPaymentDueDate"
              type="date"
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
            <input type="checkbox" name="autopay" defaultChecked={values.autopay === "true"} />
            Autopay
          </label>
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              name="needsPaymentAssistance"
              defaultChecked={values.needsPaymentAssistance === "true"}
            />
            Necesita asistencia para pagar
          </label>
        </div>

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
              <option value="">Yo (quien crea la póliza)</option>
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </section>

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Crear póliza"}
      </Button>
    </form>
  );
}
