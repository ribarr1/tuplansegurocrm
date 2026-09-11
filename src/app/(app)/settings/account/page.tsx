import { requireUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChangePasswordForm } from "./change-password-form";
import { ChangeEmailForm } from "./change-email-form";

// PREPRODUCCIÓN — "Mi cuenta": autoservicio de seguridad para CUALQUIER
// usuario autenticado (ADMIN/AGENT/ASSISTANT), a diferencia del resto de
// /settings (mayormente ADMIN-only). Cambiar la propia contraseña exige
// la actual; cambiar el propio correo exige la contraseña actual Y
// confirmación desde la dirección nueva antes de aplicarse — ver
// src/services/account-security.service.ts para el detalle completo.
export default async function AccountSecurityPage() {
  const actor = await requireUser();

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Mi cuenta</h2>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Cambiar contraseña</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Cambiar correo</CardTitle>
        </CardHeader>
        <CardContent>
          <ChangeEmailForm currentEmail={actor.email} />
        </CardContent>
      </Card>
    </div>
  );
}
