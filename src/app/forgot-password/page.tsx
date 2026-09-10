"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// CORRECCIÓN (recuperación de contraseña) — usa el endpoint NATIVO de
// Better Auth (/api/auth/request-password-reset, ver auth.ts) vía
// fetch directo en vez del cliente generado, para no depender de
// adivinar el nombre exacto del método (forgetPassword/
// requestPasswordReset) — el endpoint mismo es la fuente de verdad.
//
// `redirectTo` es SIEMPRE esta misma ruta interna fija, nunca un valor
// que venga del usuario/URL — así se evita cualquier redirección
// externa (ver "Validar URLs de retorno" en la corrección).
const REDIRECT_TO = "/reset-password";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    try {
      const response = await fetch("/api/auth/request-password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTo: REDIRECT_TO }),
      });
      // Respuesta SIEMPRE genérica — nunca revela si el correo existe o
      // no (mismo comportamiento nativo de Better Auth, ver
      // node_modules/better-auth/dist/api/routes/password.mjs).
      if (response.status === 429) {
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-[var(--brand-surface)] to-background px-4">
      <Image src="/brand/logo-horizontal.png" alt="Tu Plan Seguro Usa" width={220} height={44} priority />

      <Card className="w-full max-w-sm border-border/80 shadow-sm">
        <CardHeader className="gap-1">
          <h1 className="font-heading text-xl font-semibold text-foreground">¿Olvidaste tu contraseña?</h1>
          <p className="text-sm text-muted-foreground">
            Escribe tu correo y te enviaremos instrucciones para crear una nueva.
          </p>
        </CardHeader>
        <CardContent>
          {status === "done" ? (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              Si existe una cuenta con ese correo, recibirás instrucciones.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email">Correo electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              {status === "error" && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Demasiados intentos — espera unos minutos e intenta de nuevo.
                </p>
              )}

              <Button type="submit" disabled={status === "submitting"} className="w-full">
                {status === "submitting" ? "Enviando…" : "Enviar instrucciones"}
              </Button>
            </form>
          )}

          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link href="/login" className="underline">
              Volver a iniciar sesión
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
