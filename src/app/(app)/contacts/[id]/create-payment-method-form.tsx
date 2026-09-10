"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_METHOD_TYPE_VALUES,
  CARD_BRAND_VALUES,
  BANK_ACCOUNT_TYPE_VALUES,
  PAYMENT_CONSENT_USE_VALUES,
} from "@/schemas/payment-method.schema";
import {
  PAYMENT_METHOD_TYPE_LABELS,
  CARD_BRAND_LABELS,
  BANK_ACCOUNT_TYPE_LABELS,
  PAYMENT_CONSENT_USE_LABELS,
} from "@/lib/labels";
import { createPaymentMethodAction } from "./payment-methods-actions";

const currentYear = new Date().getUTCFullYear();
const EXP_YEARS = Array.from({ length: 16 }, (_, i) => currentYear + i);
const EXP_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export function CreatePaymentMethodForm({
  personId,
  policies,
}: {
  personId: string;
  policies: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<(typeof PAYMENT_METHOD_TYPE_VALUES)[number]>("CREDIT_CARD");
  const [state, formAction, isPending] = useActionState(
    createPaymentMethodAction.bind(null, personId),
    undefined
  );

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        + Agregar método de pago
      </Button>
    );
  }

  const isCard = type === "CREDIT_CARD" || type === "DEBIT_CARD";

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-md border p-4">
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <div className="flex flex-col gap-1">
        <Label htmlFor="type">Tipo de método</Label>
        <select
          id="type"
          name="type"
          className="h-9 w-fit rounded-md border border-input bg-background px-3 text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as typeof type)}
        >
          {PAYMENT_METHOD_TYPE_VALUES.map((t) => (
            <option key={t} value={t}>
              {PAYMENT_METHOD_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </div>

      {isCard ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="cardholderName">Nombre impreso</Label>
            <Input id="cardholderName" name="cardholderName" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cardBrand">Marca</Label>
            <select
              id="cardBrand"
              name="cardBrand"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              {CARD_BRAND_VALUES.map((b) => (
                <option key={b} value={b}>
                  {CARD_BRAND_LABELS[b]}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="cardNumber">Número de tarjeta</Label>
            <Input id="cardNumber" name="cardNumber" inputMode="numeric" autoComplete="off" required />
            {state?.fieldErrors?.cardNumber && (
              <p className="text-sm text-destructive">{state.fieldErrors.cardNumber}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cardExpMonth">Mes de vencimiento</Label>
            <select
              id="cardExpMonth"
              name="cardExpMonth"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              {EXP_MONTHS.map((m) => (
                <option key={m} value={m}>
                  {String(m).padStart(2, "0")}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cardExpYear">Año de vencimiento</Label>
            <select
              id="cardExpYear"
              name="cardExpYear"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              {EXP_YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-2">
            El CVV no se almacena. Debe solicitarse al cliente cuando la compañía lo requiera.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="bankAccountHolderName">Titular de la cuenta</Label>
            <Input id="bankAccountHolderName" name="bankAccountHolderName" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bankName">Banco</Label>
            <Input id="bankName" name="bankName" required />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="routingNumber">Routing number</Label>
            <Input id="routingNumber" name="routingNumber" inputMode="numeric" autoComplete="off" required />
            {state?.fieldErrors?.routingNumber && (
              <p className="text-sm text-destructive">{state.fieldErrors.routingNumber}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="accountNumber">Número de cuenta</Label>
            <Input id="accountNumber" name="accountNumber" inputMode="numeric" autoComplete="off" required />
            {state?.fieldErrors?.accountNumber && (
              <p className="text-sm text-destructive">{state.fieldErrors.accountNumber}</p>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="bankAccountType">Tipo de cuenta</Label>
            <select
              id="bankAccountType"
              name="bankAccountType"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              required
            >
              {BANK_ACCOUNT_TYPE_VALUES.map((t) => (
                <option key={t} value={t}>
                  {BANK_ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyId">Póliza relacionada (opcional)</Label>
          <select
            id="policyId"
            name="policyId"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {policies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-4 pb-1">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isDefault" /> Predeterminado
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autopay" /> Autopay
          </label>
        </div>
      </div>

      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Dirección de facturación (opcional)
        </summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="billingAddressLine1">Dirección</Label>
            <Input id="billingAddressLine1" name="billingAddressLine1" />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2">
            <Label htmlFor="billingAddressLine2">Dirección (línea 2)</Label>
            <Input id="billingAddressLine2" name="billingAddressLine2" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="billingCity">Ciudad</Label>
            <Input id="billingCity" name="billingCity" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="billingState">Estado</Label>
            <Input id="billingState" name="billingState" maxLength={2} placeholder="FL" />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="billingZipCode">ZIP</Label>
            <Input id="billingZipCode" name="billingZipCode" />
          </div>
        </div>
      </details>

      <div className="flex flex-col gap-1">
        <Label htmlFor="comment">Comentario (solo visible para ADMIN, máx. 1,000 caracteres)</Label>
        <textarea
          id="comment"
          name="comment"
          maxLength={1000}
          rows={2}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <p className="text-xs text-destructive">
          No escriba CVV, PIN, contraseñas, SSN ni números completos de tarjeta o cuenta en este comentario.
        </p>
        {state?.fieldErrors?.comment && <p className="text-sm text-destructive">{state.fieldErrors.comment}</p>}
      </div>

      <div className="flex flex-col gap-2 rounded-md border p-3">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="consentGiven" /> El cliente autorizó conservar este método de pago.
        </label>
        <div className="flex flex-col gap-1">
          <Label htmlFor="consentUse">Uso autorizado</Label>
          <select
            id="consentUse"
            name="consentUse"
            className="h-9 w-fit rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            {PAYMENT_CONSENT_USE_VALUES.map((u) => (
              <option key={u} value={u}>
                {PAYMENT_CONSENT_USE_LABELS[u]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        El CRM no ejecutará cobros. Estos datos se usan únicamente para ayudar a configurar el pago en el portal de
        la compañía.
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={isPending} className="w-fit">
          {isPending ? "Guardando…" : "Guardar método de pago"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
