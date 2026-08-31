"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HOUSEHOLD_MEMBER_ROLE_VALUES } from "@/schemas/household.schema";
import { CONTACT_STATUS_VALUES } from "@/schemas/person.schema";
import { HOUSEHOLD_MEMBER_ROLE_LABELS, CONTACT_STATUS_LABELS } from "@/lib/labels";
import {
  searchPeopleAction,
  addHouseholdMemberAction,
  createPersonAndAddAction,
} from "../household-actions";

function useCloseOnSuccess(isPending: boolean, success: boolean | undefined, onClose: () => void) {
  const wasPending = useRef(false);
  useEffect(() => {
    if (wasPending.current && !isPending && success) onClose();
    wasPending.current = isPending;
  }, [isPending, success, onClose]);
}

function SearchExistingForm({
  householdId,
  viewedPersonId,
  onClose,
}: {
  householdId: string;
  viewedPersonId: string;
  onClose: () => void;
}) {
  const [searchState, searchAction, isSearching] = useActionState(searchPeopleAction, undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const boundAdd = addHouseholdMemberAction.bind(null, householdId, viewedPersonId);
  const [addState, addAction, isAdding] = useActionState(boundAdd, undefined);
  useCloseOnSuccess(isAdding, addState?.success, onClose);

  return (
    <div className="flex flex-col gap-4">
      <form action={searchAction} className="flex items-end gap-2">
        <div className="flex flex-1 flex-col gap-1">
          <Label htmlFor="search">Buscar persona</Label>
          <Input id="search" name="search" placeholder="Nombre, teléfono o correo" />
        </div>
        <Button type="submit" variant="secondary" disabled={isSearching}>
          {isSearching ? "Buscando…" : "Buscar"}
        </Button>
      </form>

      {searchState?.searched && searchState.results.length === 0 && (
        <p className="text-sm text-muted-foreground">Sin resultados.</p>
      )}

      {searchState && searchState.results.length > 0 && (
        <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1">
          {searchState.results.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => setSelectedId(person.id)}
              className={`flex flex-col rounded px-2 py-1.5 text-left text-sm ${
                selectedId === person.id ? "bg-secondary" : "hover:bg-muted"
              }`}
            >
              <span className="font-medium">
                {person.firstName} {person.lastName}
              </span>
              <span className="text-xs text-muted-foreground">
                {person.phone ?? "—"} · {person.email ?? "—"}
              </span>
            </button>
          ))}
        </div>
      )}

      {selectedId && (
        <form action={addAction} className="flex flex-col gap-3 border-t pt-3">
          <input type="hidden" name="personId" value={selectedId} />
          {addState?.error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {addState.error}
            </p>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="add-role">Rol en el hogar</Label>
            <select
              id="add-role"
              name="role"
              defaultValue="OTHER"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              {HOUSEHOLD_MEMBER_ROLE_VALUES.map((role) => (
                <option key={role} value={role}>
                  {HOUSEHOLD_MEMBER_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={isAdding} className="w-fit">
            {isAdding ? "Agregando…" : "Agregar al hogar"}
          </Button>
        </form>
      )}
    </div>
  );
}

function CreateNewForm({
  householdId,
  viewedPersonId,
  onClose,
}: {
  householdId: string;
  viewedPersonId: string;
  onClose: () => void;
}) {
  const boundCreate = createPersonAndAddAction.bind(null, householdId, viewedPersonId);
  const [state, formAction, isPending] = useActionState(boundCreate, undefined);
  useCloseOnSuccess(isPending, state?.success, onClose);

  const values = state?.values ?? {};
  const formKey = state ? "retry" : "initial";

  return (
    <form key={formKey} action={formAction} className="flex flex-col gap-3">
      {state?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="firstName">Nombre</Label>
          <Input id="firstName" name="firstName" defaultValue={values.firstName} required />
          {state?.fieldErrors?.firstName && (
            <p className="text-xs text-destructive">{state.fieldErrors.firstName}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lastName">Apellido</Label>
          <Input id="lastName" name="lastName" defaultValue={values.lastName} required />
          {state?.fieldErrors?.lastName && (
            <p className="text-xs text-destructive">{state.fieldErrors.lastName}</p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="phone">Teléfono</Label>
          <Input id="phone" name="phone" defaultValue={values.phone ?? ""} />
          {state?.fieldErrors?.phone && (
            <p className="text-xs text-destructive">{state.fieldErrors.phone}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" defaultValue={values.email ?? ""} />
          {state?.fieldErrors?.email && (
            <p className="text-xs text-destructive">{state.fieldErrors.email}</p>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="contactStatus">Estado</Label>
        <select
          id="contactStatus"
          name="contactStatus"
          defaultValue={values.contactStatus ?? "PROSPECT"}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {CONTACT_STATUS_VALUES.map((status) => (
            <option key={status} value={status}>
              {CONTACT_STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="new-role">Rol en el hogar</Label>
        <select
          id="new-role"
          name="role"
          defaultValue={values.role ?? "CHILD"}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          {HOUSEHOLD_MEMBER_ROLE_VALUES.map((role) => (
            <option key={role} value={role}>
              {HOUSEHOLD_MEMBER_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Creando…" : "Crear y agregar"}
      </Button>
    </form>
  );
}

export function AddMemberDialog({
  householdId,
  viewedPersonId,
}: {
  householdId: string;
  viewedPersonId: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"search" | "create">("search");
  const close = () => setOpen(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setMode("search");
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>Agregar miembro</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar miembro al hogar</DialogTitle>
          <DialogDescription>
            Busca un contacto existente o crea uno nuevo directamente en este hogar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-1 border-b">
          <button
            type="button"
            onClick={() => setMode("search")}
            className={`px-3 py-2 text-sm ${mode === "search" ? "border-b-2 border-foreground font-medium" : "text-muted-foreground"}`}
          >
            Buscar existente
          </button>
          <button
            type="button"
            onClick={() => setMode("create")}
            className={`px-3 py-2 text-sm ${mode === "create" ? "border-b-2 border-foreground font-medium" : "text-muted-foreground"}`}
          >
            Crear nuevo contacto
          </button>
        </div>

        {mode === "search" ? (
          <SearchExistingForm
            householdId={householdId}
            viewedPersonId={viewedPersonId}
            onClose={close}
          />
        ) : (
          <CreateNewForm
            householdId={householdId}
            viewedPersonId={viewedPersonId}
            onClose={close}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
