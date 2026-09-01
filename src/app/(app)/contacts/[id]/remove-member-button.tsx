"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-feedback";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { removeHouseholdMemberAction } from "../household-actions";

export function RemoveMemberButton({
  householdMemberId,
  viewedPersonId,
  personName,
}: {
  householdMemberId: string;
  viewedPersonId: string;
  personName: string;
}) {
  const action = removeHouseholdMemberAction.bind(null, householdMemberId, viewedPersonId);
  const [state, formAction, isPending] = useActionState(action, undefined);

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        Remover
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover del hogar</AlertDialogTitle>
          <AlertDialogDescription>
            Esta acción quitará a {personName} del hogar. El contacto no será eliminado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FormError message={state?.error} />
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <form action={formAction}>
            <AlertDialogAction type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Removiendo…" : "Remover"}
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
