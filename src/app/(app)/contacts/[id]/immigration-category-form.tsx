"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-feedback";
import { IMMIGRATION_CATEGORY_LABELS } from "@/lib/labels";
import { IMMIGRATION_CATEGORY_VALUES } from "@/schemas/sensitive-identity.schema";
import { updateImmigrationCategoryAction } from "./sensitive-identity-actions";

export function ImmigrationCategoryForm({
  personId,
  currentCategory,
}: {
  personId: string;
  currentCategory: (typeof IMMIGRATION_CATEGORY_VALUES)[number];
}) {
  const action = updateImmigrationCategoryAction.bind(null, personId);
  const [state, formAction, isPending] = useActionState(action, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      <select
        name="immigrationCategory"
        defaultValue={currentCategory}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        {IMMIGRATION_CATEGORY_VALUES.map((c) => (
          <option key={c} value={c}>
            {IMMIGRATION_CATEGORY_LABELS[c]}
          </option>
        ))}
      </select>
      <Button type="submit" variant="outline" size="sm" disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar"}
      </Button>
      <FormError message={state?.error} />
    </form>
  );
}
