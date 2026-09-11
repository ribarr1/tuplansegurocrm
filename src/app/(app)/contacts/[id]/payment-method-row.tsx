"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  revealPaymentMethodFullAction,
  copyPaymentMethodFieldAction,
  replacePaymentMethodSecretAction,
  setDefaultPaymentMethodAction,
  revokePaymentMethodAction,
  updatePaymentMethodAction,
} from "./payment-methods-actions";
import type { RevealedPaymentMethod } from "@/services/payment-methods.service";

// Los datos revelados NUNCA se persisten — viven solo en estado de
// React y se ocultan automáticamente a los 20s, y también al cerrar la
// ventana (onOpenChange(false) → reset()).
const AUTO_HIDE_MS = 20_000;

type SecretField = "cardNumber" | "routingNumber" | "accountNumber";

export function PaymentMethodRow({
  personId,
  paymentMethodId,
  maskedLabel,
  isDefault,
  autopay,
  isActive,
  comment,
  policyId,
  policies,
  secretFields,
}: {
  personId: string;
  paymentMethodId: string;
  maskedLabel: string;
  isDefault: boolean;
  autopay: boolean;
  isActive: boolean;
  comment: string;
  policyId: string | null;
  policies: { id: string; label: string }[];
  secretFields: { field: SecretField; label: string }[];
}) {
  const [isPending, startTransition] = useTransition();
  const [actionError, setActionError] = useState<string | null>(null);

  function handleSetDefault() {
    setActionError(null);
    startTransition(async () => {
      const result = await setDefaultPaymentMethodAction(personId, paymentMethodId);
      if (result.error) setActionError(result.error);
    });
  }

  function handleRevoke() {
    if (!confirm("¿Desactivar este método de pago? Esto no elimina la auditoría.")) return;
    const reason = prompt("Motivo (opcional):") ?? undefined;
    setActionError(null);
    startTransition(async () => {
      const result = await revokePaymentMethodAction(paymentMethodId, personId, reason);
      if (result.error) setActionError(result.error);
    });
  }

  function handleToggleAutopay() {
    setActionError(null);
    startTransition(async () => {
      const result = await updatePaymentMethodAction(paymentMethodId, personId, { autopay: !autopay });
      if (result.error) setActionError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono font-medium">{maskedLabel}</span>
          {isDefault && <Badge variant="outline">Predeterminado</Badge>}
          {autopay && <Badge variant="outline">Autopay</Badge>}
          {!isActive && <Badge variant="outline">Revocado</Badge>}
        </div>
        {isActive && (
          <div className="flex flex-wrap gap-2">
            {!isDefault && (
              <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleSetDefault}>
                Predeterminar
              </Button>
            )}
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleToggleAutopay}>
              {autopay ? "Quitar autopay" : "Activar autopay"}
            </Button>
            <RevealFullDialog paymentMethodId={paymentMethodId} policies={policies} />
            {secretFields.map(({ field, label }) => (
              <ReplaceSecretDialog
                key={field}
                paymentMethodId={paymentMethodId}
                personId={personId}
                field={field}
                label={label}
              />
            ))}
            <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleRevoke}>
              Desactivar
            </Button>
          </div>
        )}
      </div>
      {policyId && (
        <p className="text-xs text-muted-foreground">
          Póliza: {policies.find((p) => p.id === policyId)?.label ?? policyId}
        </p>
      )}
      {comment && <p className="text-xs text-muted-foreground">Comentario: {comment}</p>}
      {actionError && <p className="text-xs text-destructive">{actionError}</p>}
    </div>
  );
}

const CARD_BRAND_LABELS: Record<string, string> = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  AMEX: "Amex",
  DISCOVER: "Discover",
  OTHER: "Otra",
};
const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = { CHECKING: "Checking", SAVINGS: "Savings" };

// Ventana ÚNICA de revelado — CORRECCIÓN: una sola reautenticación
// muestra el conjunto COMPLETO de datos del método (antes: un campo a
// la vez, insuficiente para completar un pago real en el portal de la
// aseguradora, que necesita nombre + número + vencimiento juntos, o
// routing + cuenta juntos). Cada campo tiene su propio botón de copiar
// individual — nunca un botón de "copiar todo".
function RevealFullDialog({
  paymentMethodId,
  policies,
}: {
  paymentMethodId: string;
  policies: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [reason, setReason] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [revealed, setRevealed] = useState<RevealedPaymentMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  function reset() {
    setPassword("");
    setTotpCode("");
    setReason("");
    setPolicyId("");
    setRevealed(null);
    setError(null);
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await revealPaymentMethodFullAction(paymentMethodId, {
        password,
        totpCode,
        reason,
        policyId: policyId || undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setRevealed(result.data ?? null);
      hideTimer.current = setTimeout(() => setRevealed(null), AUTO_HIDE_MS);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Ocultar automáticamente también al cerrar la ventana, no
        // solo al expirar el temporizador.
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Ver detalles completos</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Detalles completos del método de pago</DialogTitle>
          <DialogDescription>
            Requiere reautenticación y un motivo. Los datos se ocultan automáticamente en unos segundos o al cerrar
            esta ventana.
          </DialogDescription>
        </DialogHeader>
        {revealed ? (
          <RevealedDetails paymentMethodId={paymentMethodId} revealed={revealed} />
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col gap-1">
              <Label htmlFor="reveal-password">Tu contraseña</Label>
              <Input
                id="reveal-password"
                type="password"
                autoComplete="off"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reveal-totp">Código de tu app de autenticación</Label>
              <Input
                id="reveal-totp"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                placeholder="123456"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reveal-reason">Motivo</Label>
              <Input
                id="reveal-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ej. configurar autopay en el portal del carrier"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="reveal-policy">Póliza relacionada (opcional)</Label>
              <select
                id="reveal-policy"
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={policyId}
                onChange={(e) => setPolicyId(e.target.value)}
              >
                <option value="">—</option>
                {policies.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Verificando…" : "Revelar todo"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function billingAddressLines(revealed: RevealedPaymentMethod): string | null {
  const parts = [
    revealed.billingAddressLine1,
    revealed.billingAddressLine2,
    [revealed.billingCity, revealed.billingState].filter(Boolean).join(", "),
    revealed.billingZipCode,
  ].filter((p) => p && p.trim() !== "");
  return parts.length > 0 ? parts.join(" — ") : null;
}

function RevealedDetails({
  paymentMethodId,
  revealed,
}: {
  paymentMethodId: string;
  revealed: RevealedPaymentMethod;
}) {
  const billing = billingAddressLines(revealed);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">Este panel se ocultará automáticamente en unos segundos.</p>
      {revealed.type === "BANK_ACCOUNT" ? (
        <>
          <CopyableField paymentMethodId={paymentMethodId} field="bankAccountHolderName" label="Titular" value={revealed.bankAccountHolderName} />
          <CopyableField paymentMethodId={paymentMethodId} field="bankName" label="Banco" value={revealed.bankName} />
          <CopyableField paymentMethodId={paymentMethodId} field="routingNumber" label="Routing number" value={revealed.routingNumber} mono />
          <CopyableField paymentMethodId={paymentMethodId} field="accountNumber" label="Número de cuenta" value={revealed.accountNumber} mono />
          <StaticField label="Tipo" value={revealed.bankAccountType ? BANK_ACCOUNT_TYPE_LABELS[revealed.bankAccountType] ?? revealed.bankAccountType : null} />
        </>
      ) : (
        <>
          <CopyableField paymentMethodId={paymentMethodId} field="cardholderName" label="Nombre impreso" value={revealed.cardholderName} />
          <CopyableField paymentMethodId={paymentMethodId} field="cardNumber" label="Número de tarjeta" value={revealed.cardNumber} mono />
          <CopyableField
            paymentMethodId={paymentMethodId}
            field="cardExpiry"
            label="Vencimiento"
            value={
              revealed.cardExpMonth && revealed.cardExpYear
                ? `${String(revealed.cardExpMonth).padStart(2, "0")}/${revealed.cardExpYear}`
                : null
            }
          />
          <StaticField
            label="Marca / tipo"
            value={`${revealed.cardBrand ? CARD_BRAND_LABELS[revealed.cardBrand] ?? revealed.cardBrand : "—"} · ${
              revealed.type === "DEBIT_CARD" ? "Débito" : "Crédito"
            }`}
          />
        </>
      )}
      {billing && <CopyableField paymentMethodId={paymentMethodId} field="billingAddress" label="Dirección de facturación" value={billing} />}
      {revealed.comment && <CopyableField paymentMethodId={paymentMethodId} field="comment" label="Comentario" value={revealed.comment} />}
    </div>
  );
}

function StaticField({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

function CopyableField({
  paymentMethodId,
  field,
  label,
  value,
  mono = false,
}: {
  paymentMethodId: string;
  field: string;
  label: string;
  value: string | null;
  mono?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value as string);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Si el portapapeles falla, el usuario todavía puede seleccionar
      // el texto manualmente — no hay nada más que hacer aquí.
    }
    // Fire-and-forget: la copia real ya ocurrió del lado del cliente —
    // el audit nunca debe bloquear ni poder "fallar" la copia, y nunca
    // recibe el valor copiado.
    void copyPaymentMethodFieldAction(paymentMethodId, field);
  }

  return (
    <div className="flex items-center gap-3">
      <span className="w-36 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-sm" : "text-sm"}>{value}</span>
      <Button type="button" variant="ghost" size="sm" onClick={handleCopy}>
        {copied ? "Copiado" : "Copiar"}
      </Button>
    </div>
  );
}

function ReplaceSecretDialog({
  paymentMethodId,
  personId,
  field,
  label,
}: {
  paymentMethodId: string;
  personId: string;
  field: SecretField;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function reset() {
    setPassword("");
    setValue("");
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await replacePaymentMethodSecretAction(paymentMethodId, personId, { password, field, value });
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Reemplazar {label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reemplazar {label}</DialogTitle>
          <DialogDescription>
            El valor completo se reemplaza — no es posible editar solo una parte. Requiere reautenticación.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col gap-1">
            <Label htmlFor="replace-password">Tu contraseña</Label>
            <Input
              id="replace-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="replace-value">Nuevo {label}</Label>
            <Input
              id="replace-value"
              inputMode="numeric"
              autoComplete="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Guardando…" : "Reemplazar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
