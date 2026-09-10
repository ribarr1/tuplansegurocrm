import Image from "next/image";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ActivateForm } from "./activate-form";

// Pública (sin sesión) — la persona todavía no tiene contraseña. El
// uid/token vienen del enlace del correo de invitación (ver
// user-invitations.service.ts); la validación REAL (existe, no venció,
// coincide con el hash guardado) ocurre siempre en el servidor al
// enviar el formulario (activateAccountAction), nunca aquí — esta
// página nunca confía en que un uid/token con "forma válida" sea
// realmente válido.
export default async function ActivatePage({
  searchParams,
}: {
  searchParams: Promise<{ uid?: string; token?: string }>;
}) {
  const { uid, token } = await searchParams;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-[var(--brand-surface)] to-background px-4">
      <Image src="/brand/logo-horizontal.png" alt="Tu Plan Seguro Usa" width={220} height={44} priority />

      <Card className="w-full max-w-sm border-border/80 shadow-sm">
        <CardHeader className="gap-1">
          <h1 className="font-heading text-xl font-semibold text-foreground">Activa tu cuenta</h1>
          <p className="text-sm text-muted-foreground">Crea tu contraseña para empezar a usar el CRM.</p>
        </CardHeader>
        <CardContent>
          {uid && token ? (
            <ActivateForm userId={uid} token={token} />
          ) : (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Este enlace de activación no es válido. Pide a un administrador que te reenvíe la
              invitación.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
