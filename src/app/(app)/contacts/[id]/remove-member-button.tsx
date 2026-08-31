"use client";

import { Button } from "@/components/ui/button";
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
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <form action={removeHouseholdMemberAction.bind(null, householdMemberId, viewedPersonId)}>
            <AlertDialogAction type="submit" variant="destructive">
              Remover
            </AlertDialogAction>
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
