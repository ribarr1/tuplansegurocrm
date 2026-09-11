import { redirect } from "next/navigation";
import Image from "next/image";
import { requireUserAllowMfaPending } from "@/lib/authorization";
import { MfaSetupClient } from "./setup-client";

// PREPRODUCCIÓN — MFA. Único destino fuera de (app)/ para un ADMIN
// pendiente de configurar MFA (ver (app)/layout.tsx → requireUser()).
// requireUserAllowMfaPending() en vez de requireUser(): esta es
// exactamente la página que un ADMIN pendiente SÍ debe poder ver.
//
// Si el usuario YA tiene MFA activo (llegó aquí por error, o por un
// enlace viejo), no hay nada que forzar — se le manda al dashboard.
export default async function MfaSetupPage() {
  const user = await requireUserAllowMfaPending();
  if (user.twoFactorEnabled) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gradient-to-b from-[var(--brand-surface)] to-background px-4">
      <Image src="/brand/logo-horizontal.png" alt="Tu Plan Seguro Usa" width={220} height={44} priority />
      <div className="w-full max-w-md">
        <MfaSetupClient />
      </div>
    </div>
  );
}
