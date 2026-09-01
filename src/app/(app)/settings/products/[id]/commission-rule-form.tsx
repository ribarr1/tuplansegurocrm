"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  COMMISSION_METHOD_LABELS,
  COMMISSION_BASE_LABELS,
  COMMISSION_PERIODICITY_LABELS,
} from "@/lib/labels";
import { createCommissionRuleAction, type CommissionRuleFormState } from "./commission-rules-actions";

const selectClass =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm";
const inputClass = selectClass;

export function CommissionRuleForm({ productId }: { productId: string }) {
  const action = createCommissionRuleAction.bind(null, productId);
  const [state, formAction, isPending] = useActionState<CommissionRuleFormState, FormData>(
    action,
    undefined
  );
  const [method, setMethod] = useState<string>("FIXED_AMOUNT");
  const [residualEnabled, setResidualEnabled] = useState(false);

  // Remonta el formulario tras éxito (limpia todos los campos) — mismo
  // patrón "ajustar estado durante el render" usado en note-form.tsx /
  // upload-document-form.tsx para no disparar un render en cascada.
  const [prevState, setPrevState] = useState(state);
  const [resetCount, setResetCount] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    if (state?.success) {
      setResetCount((c) => c + 1);
      setMethod("FIXED_AMOUNT");
      setResidualEnabled(false);
    }
  }

  return (
    <form
      key={resetCount}
      action={formAction}
      className="flex flex-col gap-3 rounded-md border p-3 text-sm"
    >
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Método</span>
          <select
            name="method"
            className={selectClass}
            value={method}
            onChange={(e) => setMethod(e.target.value)}
          >
            {Object.entries(COMMISSION_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Base</span>
          <select name="base" className={selectClass} defaultValue="FIXED">
            {Object.entries(COMMISSION_BASE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        {method === "FIXED_AMOUNT" ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Monto inicial (ej. 25.00)</span>
            <input name="initialAmount" className={inputClass} placeholder="25.00" />
          </label>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Porcentaje inicial (ej. 80.00)</span>
            <input name="initialPercentage" className={inputClass} placeholder="80.00" />
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Periodicidad inicial</span>
          <select name="initialPeriodicity" className={selectClass} defaultValue="MONTHLY">
            {Object.entries(COMMISSION_PERIODICITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          name="residualEnabled"
          checked={residualEnabled}
          onChange={(e) => setResidualEnabled(e.target.checked)}
        />
        Tiene comisión residual
      </label>

      {residualEnabled && (
        <div className="grid gap-3 rounded-md bg-muted/30 p-3 sm:grid-cols-2">
          {method === "FIXED_AMOUNT" ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Monto residual</span>
              <input name="residualAmount" className={inputClass} placeholder="5.00" />
            </label>
          ) : (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Porcentaje residual</span>
              <input name="residualPercentage" className={inputClass} placeholder="4.00" />
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Periodicidad residual</span>
            <select name="residualPeriodicity" className={selectClass} defaultValue="ANNUAL">
              {Object.entries(COMMISSION_PERIODICITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Desde qué año de póliza</span>
            <input
              name="residualStartYear"
              type="number"
              min={1}
              max={50}
              defaultValue={2}
              className={inputClass}
            />
          </label>
        </div>
      )}

      <Button type="submit" size="sm" disabled={isPending} className="w-fit">
        {isPending ? "Guardando…" : "Crear regla"}
      </Button>
    </form>
  );
}
