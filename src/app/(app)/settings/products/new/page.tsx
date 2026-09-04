import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listCarriers } from "@/services/carriers.service";
import { Button } from "@/components/ui/button";
import { ProductForm } from "../product-form";
import { createProductAction } from "../actions";

export default async function NewProductPage() {
  const actor = await requireUser();

  if (actor.role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center gap-3 p-16 text-center">
        <p className="text-sm text-muted-foreground">
          Solo un administrador puede crear productos.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/products" />}>
          Volver
        </Button>
      </div>
    );
  }

  const carriers = await listCarriers(actor, {});

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Nuevo producto</h2>
      <ProductForm action={createProductAction} carriers={carriers} submitLabel="Crear producto" />
    </div>
  );
}
