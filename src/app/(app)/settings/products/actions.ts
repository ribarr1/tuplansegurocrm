"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSessionUser } from "@/lib/authorization";
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

export async function toggleProductActiveAction(id: string, isActive: boolean) {
  const actor = await requireSessionUser();
  await setProductActive(actor, id, isActive);
  revalidatePath("/settings/products");
}
