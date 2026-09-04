import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getCarrierById } from "@/services/carriers.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { CarrierForm } from "../../carrier-form";
import { updateCarrierAction } from "../../actions";

export default async function EditCarrierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

  let carrier;
  try {
    carrier = await getCarrierById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  if (actor.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">
          Solo un administrador puede editar compañías.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/carriers" />}>
          Volver
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Editar compañía — {carrier.name}</h2>
      <CarrierForm
        action={updateCarrierAction.bind(null, id)}
        defaultValues={{ name: carrier.name, isActive: carrier.isActive }}
        submitLabel="Guardar cambios"
      />
    </div>
  );
}
