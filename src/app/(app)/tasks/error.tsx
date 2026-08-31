"use client";

import { Button } from "@/components/ui/button";

// Red de seguridad genérica para errores inesperados dentro de
// /tasks. Nunca muestra el mensaje/stack del error real — eso
// podría filtrar detalles internos (Prisma, etc.).
export default function TasksError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 p-16 text-center">
      <p className="text-sm text-muted-foreground">
        Ocurrió un error inesperado. Intenta de nuevo.
      </p>
      <Button onClick={reset} variant="outline">
        Reintentar
      </Button>
    </div>
  );
}
