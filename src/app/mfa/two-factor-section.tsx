"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  startTotpEnrollmentAction,
  confirmTotpEnrollmentAction,
  regenerateBackupCodesAction,
  disableTotpAction,
} from "./actions";

// PREPRODUCCIÓN — MFA. Componente ÚNICO reutilizado por /mfa/setup
// (enrollment forzoso del primer ADMIN pendiente) y por
// /settings/account (autoservicio voluntario para cualquier rol, y
// administración — regenerar códigos / desactivar — una vez activo).
// `forced` solo cambia el texto introductorio; la lógica es idéntica.
//
// El secreto/QR/códigos de recuperación viven ÚNICAMENTE en el estado
// de React de este componente — nunca se persisten en
// localStorage/sessionStorage ni se guarda la imagen QR en ningún
// lugar (Sección 2 de la ficha).
export function TwoFactorSection({
  twoFactorEnabled,
  forced,
  onEnrollmentCompleted,
}: {
  twoFactorEnabled: boolean;
  forced: boolean;
  onEnrollmentCompleted?: () => void;
}) {
  const [enabled, setEnabled] = useState(twoFactorEnabled);

  if (!enabled) {
    return <EnrollmentFlow forced={forced} onCompleted={() => { setEnabled(true); onEnrollmentCompleted?.(); }} />;
  }
  return <ManageMfa />;
}

function EnrollmentFlow({ forced, onCompleted }: { forced: boolean; onCompleted: () => void }) {
  const [step, setStep] = useState<"password" | "scan" | "confirm">("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpURI, setTotpURI] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const manualKey = (() => {
    try {
      return new URL(totpURI).searchParams.get("secret") ?? "";
    } catch {
      return "";
    }
  })();

  function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await startTotpEnrollmentAction(password);
      if (result.error || result.fieldErrors) {
        setError(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "No se pudo iniciar.");
        return;
      }
      if (!result.data) return;
      setTotpURI(result.data.totpURI);
      setBackupCodes(result.data.backupCodes);
      setQrDataUrl(await QRCode.toDataURL(result.data.totpURI));
      setStep("scan");
    });
  }

  function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await confirmTotpEnrollmentAction(code);
      if (result?.error || result?.fieldErrors) {
        setError(result?.error ?? Object.values(result?.fieldErrors ?? {})[0] ?? "Código incorrecto.");
        return;
      }
      setStep("confirm");
    });
  }

  if (step === "confirm") {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-lg font-semibold">MFA activado</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Guarda estos códigos de recuperación en un lugar seguro — cada uno se muestra UNA SOLA VEZ y sirve para
            entrar si pierdes acceso a tu app de autenticación. Cada código funciona una sola vez.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 font-mono text-sm">
            {backupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button
            type="button"
            onClick={() => {
              setBackupCodes([]);
              onCompleted();
            }}
          >
            Ya los guardé — continuar
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <h2 className="font-heading text-lg font-semibold">Autenticación en dos pasos</h2>
        <p className="text-sm text-muted-foreground">
          {forced
            ? "Tu cuenta de administrador requiere esta configuración antes de poder usar el CRM."
            : "Protege tu cuenta con un segundo factor usando una app como Google Authenticator, Microsoft Authenticator, Authy o 1Password."}
        </p>
      </CardHeader>
      <CardContent>
        {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
        {step === "password" ? (
          <form onSubmit={handleStart} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="mfa-password">Confirma tu contraseña</Label>
              <Input
                id="mfa-password"
                type="password"
                autoComplete="off"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Generando…" : "Continuar"}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleConfirm} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              Escanea este código QR con tu app de autenticación, o ingresa la clave manualmente.
            </p>
            {qrDataUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- data: URI generado en el cliente, nunca persistido.
              <img src={qrDataUrl} alt="Código QR para configurar MFA" width={200} height={200} className="mx-auto" />
            )}
            <div className="flex flex-col gap-1">
              <Label>Clave manual</Label>
              <code className="break-all rounded-md border bg-muted/30 p-2 text-xs">{manualKey}</code>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mfa-code">Código de 6 dígitos</Label>
              <Input
                id="mfa-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
              />
            </div>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Verificando…" : "Activar MFA"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ManageMfa() {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "regenerate" | "disable">("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [newBackupCodes, setNewBackupCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function switchMode(next: typeof mode) {
    setMode(next);
    setPassword("");
    setCode("");
    setError(null);
  }

  function handleRegenerate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await regenerateBackupCodesAction(password, code);
      if (result.error || result.fieldErrors) {
        setError(result.error ?? Object.values(result.fieldErrors ?? {})[0] ?? "No se pudo regenerar.");
        return;
      }
      setNewBackupCodes(result.data?.backupCodes ?? []);
    });
  }

  function handleDisable(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await disableTotpAction(password, code);
      if (result?.error || result?.fieldErrors) {
        setError(result?.error ?? Object.values(result?.fieldErrors ?? {})[0] ?? "No se pudo desactivar.");
        return;
      }
      router.refresh();
    });
  }

  if (newBackupCodes) {
    return (
      <Card>
        <CardHeader>
          <h2 className="font-heading text-lg font-semibold">Nuevos códigos de recuperación</h2>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Los códigos anteriores ya no funcionan. Guarda estos en un lugar seguro — se muestran una sola vez.
          </p>
          <ul className="grid grid-cols-2 gap-2 rounded-md border bg-muted/30 p-3 font-mono text-sm">
            {newBackupCodes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <Button type="button" onClick={() => { setNewBackupCodes(null); switchMode("idle"); }}>
            Listo
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="gap-1">
        <h2 className="font-heading text-lg font-semibold">Autenticación en dos pasos</h2>
        <p className="text-sm text-muted-foreground">Está activa en tu cuenta.</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {mode === "idle" && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => switchMode("regenerate")}>
              Regenerar códigos de recuperación
            </Button>
            <Button type="button" variant="outline" onClick={() => switchMode("disable")}>
              Desactivar MFA
            </Button>
          </div>
        )}

        {mode === "regenerate" && (
          <form onSubmit={handleRegenerate} className="flex flex-col gap-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <ReauthFields password={password} setPassword={setPassword} code={code} setCode={setCode} />
            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Regenerando…" : "Confirmar"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => switchMode("idle")}>
                Cancelar
              </Button>
            </div>
          </form>
        )}

        {mode === "disable" && (
          <form onSubmit={handleDisable} className="flex flex-col gap-3">
            {error && <p className="text-sm text-destructive">{error}</p>}
            <p className="text-sm text-muted-foreground">
              Esto cerrará tus demás sesiones activas. Si eres el único administrador con MFA, no podrás
              desactivarlo — configura MFA en otro administrador primero.
            </p>
            <ReauthFields password={password} setPassword={setPassword} code={code} setCode={setCode} />
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={isPending}>
                {isPending ? "Desactivando…" : "Confirmar desactivación"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => switchMode("idle")}>
                Cancelar
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function ReauthFields({
  password,
  setPassword,
  code,
  setCode,
}: {
  password: string;
  setPassword: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mfa-manage-password">Tu contraseña</Label>
        <Input
          id="mfa-manage-password"
          type="password"
          autoComplete="off"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="mfa-manage-code">Código de 6 dígitos</Label>
        <Input
          id="mfa-manage-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
        />
      </div>
    </>
  );
}
