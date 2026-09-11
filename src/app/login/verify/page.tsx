"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// PREPRODUCCIÓN — MFA. Segundo paso del login: la contraseña ya fue
// correcta (LoginPage llegó aquí porque authClient.signIn.email
// respondió twoFactorRedirect:true — ver src/lib/auth-client.ts). NO
// hay una sesión completa todavía en este punto — Better Auth
// identifica el intento pendiente por su propia cookie de 2FA (de un
// solo uso, corta duración), nunca por algo que esta página gestione.
//
// Deliberadamente NO existe una opción "confiar en este dispositivo":
// la ficha exige que, en producción, un ADMIN NUNCA tenga período de
// gracia para el segundo factor — activar trustDevice (que el plugin
// sí soporta) crearía exactamente ese hueco.
export default function LoginVerifyPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const { error: verifyError } =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({ code })
        : await authClient.twoFactor.verifyBackupCode({ code });

    setIsSubmitting(false);

    if (verifyError) {
      // Mensaje genérico deliberado: nunca distingue código vencido,
      // ya usado o simplemente incorrecto (Sección 4 de la ficha).
      setError(mode === "totp" ? "Código incorrecto." : "Código de recuperación incorrecto o ya usado.");
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-[var(--brand-surface)] to-background px-4">
      <Image src="/brand/logo-horizontal.png" alt="Tu Plan Seguro Usa" width={220} height={44} priority />

      <Card className="w-full max-w-sm border-border/80 shadow-sm">
        <CardHeader className="gap-1">
          <h1 className="font-heading text-xl font-semibold text-foreground">Verificación en dos pasos</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "totp"
              ? "Ingresa el código de 6 dígitos de tu app de autenticación."
              : "Ingresa uno de tus códigos de recuperación (un solo uso cada uno)."}
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="code">{mode === "totp" ? "Código de 6 dígitos" : "Código de recuperación"}</Label>
              <Input
                id="code"
                inputMode={mode === "totp" ? "numeric" : "text"}
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={mode === "totp" ? "123456" : "abcde-fghij"}
              />
            </div>

            {error && (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Verificando…" : "Verificar"}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 w-full text-center text-sm text-muted-foreground underline"
            onClick={() => {
              setMode(mode === "totp" ? "backup" : "totp");
              setCode("");
              setError(null);
            }}
          >
            {mode === "totp" ? "Usar un código de recuperación en su lugar" : "Usar la app de autenticación en su lugar"}
          </button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">Tu Plan Seguro Usa — uso interno</p>
    </div>
  );
}
