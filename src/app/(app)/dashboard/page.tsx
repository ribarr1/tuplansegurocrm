import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { Button } from "@/components/ui/button";

// Placeholder deliberado: sin métricas todavía. El dashboard funcional
// (tareas de hoy, cumpleaños, renovaciones, etc.) es un módulo futuro.
export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="flex flex-col items-start gap-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">Bienvenido al CRM TuPlanSeguro USA</h2>
        <p className="text-sm text-muted-foreground">Hola, {user.name}.</p>
      </div>
      <Button nativeButton={false} render={<Link href="/contacts" />}>
        Ir a Contactos
      </Button>
    </div>
  );
}
