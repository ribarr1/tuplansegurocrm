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
  revealPaymentMethodFieldAction,
  replacePaymentMethodSecretAction,
  setDefaultPaymentMethodAction,
  revokePaymentMethodAction,
  updatePaymentMethodAction,
} from "./payment-methods-actions";

// El valor revelado NUNCA se persiste — vive solo en estado de React y
// se oculta automáticamente a los 20s (Sección 5, punto 4 del ticket:
// "Ocultar automáticamente después de un tiempo corto"). Tampoco se
// ofrece botón de copiar (punto 5: "No permitir copiar desde listados
// generales").
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
            {secretFields.map(({ field, label }) => (
              <span key={field} className="flex gap-2">
                <RevealDialog paymentMethodId={paymentMethodId} field={field} label={label} policies={policies} />
                <ReplaceSecretDialog
                  paymentMethodId={paymentMethodId}
                  personId={personId}
                  field={field}
                  label={label}
                />
              </span>
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

function RevealDialog({
  paymentMethodId,
  field,
  label,
  policies,
}: {
  paymentMethodId: string;
  field: SecretField;
  label: string;
  policies: { id: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [policyId, setPolicyId] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
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
      const result = await revealPaymentMethodFieldAction(paymentMethodId, {
        password,
        field,
        reason,
        policyId: policyId || undefined,
      });
      if (result.error) {
        setError(result.error);
        return;
      }
      setRevealed(result.value ?? null);
      hideTimer.current = setTimeout(() => setRevealed(null), AUTO_HIDE_MS);
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
      <DialogTrigger render={<Button type="button" variant="ghost" size="sm" />}>Revelar {label}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revelar {label}</DialogTitle>
          <DialogDescription>
            Requiere reautenticación y un motivo. El valor se oculta automáticamente y no puede copiarse desde aquí.
          </DialogDescription>
        </DialogHeader>
        {revealed ? (
          <div className="flex flex-col gap-2">
            <p className="font-mono text-base">{revealed}</p>
            <p className="text-xs text-muted-foreground">Este valor se ocultará automáticamente en unos segundos.</p>
          </div>
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
                {isPending ? "Verificando…" : "Revelar"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
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
