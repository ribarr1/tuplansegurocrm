import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getProductById } from "@/services/products.service";
import { listCarriers } from "@/services/carriers.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { ProductForm } from "../../product-form";
import { updateProductAction } from "../../actions";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const actor = await requireUser();

  let product;
  try {
    product = await getProductById(actor, id);
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
          Solo un administrador puede editar productos.
        </p>
        <Button variant="outline" nativeButton={false} render={<Link href="/settings/products" />}>
          Volver
        </Button>
      </div>
    );
  }

  const carriers = await listCarriers(actor, {});
  const isUsed = product._count.policies > 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="text-lg font-semibold">Editar producto — {product.name}</h2>
      <ProductForm
        action={updateProductAction.bind(null, id)}
        defaultValues={{
          carrierId: product.carrier.id,
          name: product.name,
          policyType: product.policyType,
          planYear: product.planYear ? String(product.planYear) : undefined,
          externalCode: product.externalCode ?? undefined,
          isActive: product.isActive,
        }}
        carriers={carriers}
        isUsed={isUsed}
        submitLabel="Guardar cambios"
      />
    </div>
  );
}
