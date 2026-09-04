import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { Button } from "@/components/ui/button";
import { CarrierForm } from "../carrier-form";
import { createCarrierAction } from "../actions";

export default async function NewCarrierPage() {
  const actor = await requireUser();

  if (actor.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">
          Solo un administrador puede crear compañías.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/carriers" />}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Nueva compañía</h2>
      <CarrierForm action={createCarrierAction} submitLabel="Crear compañía" />
    </div>
  );
}
