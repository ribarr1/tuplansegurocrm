"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { requestPasswordResetAction } from "./actions";

// PREPRODUCCIÓN — pasa por requestPasswordResetAction (Server Action
// que envuelve el endpoint NATIVO de Better Auth vía
// password-recovery.service.ts) en vez de golpear
// /api/auth/request-password-reset directamente — la envoltura agrega
// la elegibilidad (cuenta activa/ya activada) y el límite de tasa
// propio que la ficha exige, ninguno de los dos cubierto por el
// endpoint nativo por sí solo.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("submitting");
    try {
      const result = await requestPasswordResetAction(email);
      // Respuesta SIEMPRE genérica — nunca revela si el correo existe,
      // está pendiente de activación o inactivo. "rate_limited" es la
      // ÚNICA señal distinta permitida (throttling, no existencia).
      if (result.status === "rate_limited") {
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
              Si existe una cuenta activa asociada a ese correo, recibirás instrucciones para restablecer tu
              contraseña.
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
