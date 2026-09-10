"use client";

import { useState, Suspense, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

// CORRECCIÓN (recuperación de contraseña) — página de destino del
// enlace nativo de Better Auth (/api/auth/reset-password/:token
// redirige aquí con ?token=... si es válido, o ?error=INVALID_TOKEN si
// no). POST directo a /api/auth/reset-password (mismo motivo que
// forgot-password/page.tsx: evita depender del nombre exacto del
// método generado por el cliente).
//
// useSearchParams() exige un límite <Suspense> (Next.js hace bail-out
// a CSR para esta página si no lo tiene) — el componente real vive
// aparte para poder envolverlo sin duplicar la UI de carga.
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const tokenError = searchParams.get("error");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (newPassword.length < 10) {
      setError("La contraseña debe tener al menos 10 caracteres.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, token }),
      });
      if (!response.ok) {
        setError("Este enlace no es válido o ya fue utilizado. Solicita uno nuevo.");
        setIsSubmitting(false);
        return;
      }
      setDone(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setError("Ocurrió un error inesperado. Intenta de nuevo.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-[var(--brand-surface)] to-background px-4">
      <Image src="/brand/logo-horizontal.png" alt="Tu Plan Seguro Usa" width={220} height={44} priority />

      <Card className="w-full max-w-sm border-border/80 shadow-sm">
        <CardHeader className="gap-1">
          <h1 className="font-heading text-xl font-semibold text-foreground">Crea una nueva contraseña</h1>
        </CardHeader>
        <CardContent>
          {!token || tokenError ? (
            <div className="flex flex-col gap-3 text-sm">
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                Este enlace no es válido o ya venció. Solicita uno nuevo.
              </p>
              <Link href="/forgot-password" className="underline">
                Solicitar un enlace nuevo
              </Link>
            </div>
          ) : done ? (
            <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
              Contraseña actualizada. Redirigiendo a iniciar sesión…
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newPassword">Nueva contraseña</Label>
                <Input
                  id="newPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmPassword">Confirma la contraseña</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {error && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Button type="submit" disabled={isSubmitting} className="w-full">
                {isSubmitting ? "Guardando…" : "Guardar contraseña"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
