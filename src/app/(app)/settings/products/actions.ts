"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
import { AppError } from "@/services/errors";
import { createProduct, updateProduct, setProductActive } from "@/services/products.service";
import { formDataToProductInput, toProductFormState, type ProductFormState } from "./form-helpers";

export type { ProductFormState };

export async function createProductAction(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const actor = await requireSessionUser();
  const values = formDataToProductInput(formData);

  let created;
  try {
    created = await createProduct(actor, values);
  } catch (error) {
    return toProductFormState(error, values);
  }

  revalidatePath("/settings/products");
  redirect(`/settings/products/${created.id}/edit`);
}

export async function updateProductAction(
  id: string,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const actor = await requireSessionUser();
  const values = formDataToProductInput(formData);

  try {
    await updateProduct(actor, id, values);
  } catch (error) {
    return toProductFormState(error, values);
  }

  revalidatePath("/settings/products");
  redirect("/settings/products");
}

// Retorna el error en vez de lanzarlo — invocado "fire and forget" vía
// useTransition, sin useActionState.
export async function toggleProductActiveAction(
  id: string,
  isActive: boolean
): Promise<{ error?: string }> {
  const actor = await requireSessionUser();
  try {
    await setProductActive(actor, id, isActive);
    revalidatePath("/settings/products");
    return {};
  } catch (error) {
    if (error instanceof AppError) return { error: error.message };
    return { error: "Ocurrió un error inesperado. Intenta de nuevo." };
  }
}
