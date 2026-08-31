import Link from "next/link";
import { Button } from "@/components/ui/button";

// Se renderiza cuando una página llama a forbidden() (next/navigation)
// — actualmente solo el módulo de Comisiones, para que ASSISTANT
// reciba un 403 real en vez de un redirect silencioso.
export default function Forbidden() {
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <h1 className="text-lg font-semibold">Acceso no autorizado</h1>
      <p className="text-sm text-muted-foreground">
        No tienes permiso para acceder a esta sección.
      </p>
      <Button variant="outline" nativeButton={false} render={<Link href="/dashboard" />}>
        Volver al Dashboard
      </Button>
    </div>
  );
}
