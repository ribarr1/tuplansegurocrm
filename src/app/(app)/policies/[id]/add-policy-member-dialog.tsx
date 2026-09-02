"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { FormError, FieldError } from "@/components/ui/form-feedback";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { COVERED_MEMBER_ROLE_VALUES } from "@/schemas/policy.schema";
import { POLICY_MEMBER_ROLE_LABELS, HOUSEHOLD_MEMBER_ROLE_LABELS, suggestPolicyMemberRole } from "@/lib/labels";
import type { HouseholdMemberRole } from "@/generated/prisma/client";
import { addPolicyMemberAction } from "./policy-members-actions";

export type EligibleCandidate = {
  personId: string;
  firstName: string;
  lastName: string;
  householdRole: HouseholdMemberRole;
};

// Bug real encontrado en verificación manual de Fase 019.8: cada fila
// tenía su PROPIO <select name="role">, así que FormData.get("role")
// devolvía siempre el del PRIMER candidato en el DOM — nunca el de la
// persona realmente seleccionada por el radio. Se corrige levantando
// el rol elegido de cada candidato al componente padre (un solo
// <input type="hidden" name="role"> con el valor de la persona
// actualmente seleccionada) — nunca dos campos compitiendo por el
// mismo `name` en el mismo <form>.
function CandidateRow({
  candidate,
  role,
  onRoleChange,
}: {
  candidate: EligibleCandidate;
  role: string;
  onRoleChange: (role: string) => void;
}) {
  return (
    <label className="flex items-center gap-3 rounded-md border p-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary/40">
      <input type="radio" name="personId" value={candidate.personId} required />
      <span className="flex-1">
        {candidate.firstName} {candidate.lastName}
        <span className="ml-2 text-xs text-muted-foreground">
          {HOUSEHOLD_MEMBER_ROLE_LABELS[candidate.householdRole]}
        </span>
      </span>
      <select
        value={role}
        onChange={(e) => onRoleChange(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {COVERED_MEMBER_ROLE_VALUES.map((r) => (
          <option key={r} value={r}>
            {POLICY_MEMBER_ROLE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AddPolicyMemberDialog({
  policyId,
  candidates,
}: {
  policyId: string;
  candidates: EligibleCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const action = addPolicyMemberAction.bind(null, policyId);
  const [state, formAction, isPending] = useActionState(action, undefined);
  const wasPending = useRef(false);

  const [selectedPersonId, setSelectedPersonId] = useState(candidates[0]?.personId ?? "");
  const [roleByPersonId, setRoleByPersonId] = useState<Record<string, string>>(() =>
    Object.fromEntries(candidates.map((c) => [c.personId, suggestPolicyMemberRole(c.householdRole)]))
  );
  const selectedRole = roleByPersonId[selectedPersonId] ?? "";

  useEffect(() => {
    if (wasPending.current && !isPending && state?.success) setOpen(false);
    wasPending.current = isPending;
  }, [isPending, state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>+ Agregar miembro</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Agregar miembro a la póliza</DialogTitle>
          <DialogDescription>
            Selecciona a alguien del hogar del titular que todavía no esté cubierto por esta póliza.
          </DialogDescription>
        </DialogHeader>

        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No hay más miembros del hogar disponibles para agregar. Si agregaste a alguien nuevo al
            hogar hace poco, recarga esta página.
          </p>
        ) : (
          <form action={formAction} className="flex flex-col gap-3">
            <FormError message={state?.error} />
            <div className="flex flex-col gap-2" onChange={(e) => {
              const target = e.target as HTMLInputElement;
              if (target.name === "personId") setSelectedPersonId(target.value);
            }}>
              {candidates.map((c) => (
                <CandidateRow
                  key={c.personId}
                  candidate={c}
                  role={roleByPersonId[c.personId] ?? "OTHER"}
                  onRoleChange={(role) =>
                    setRoleByPersonId((prev) => ({ ...prev, [c.personId]: role }))
                  }
                />
              ))}
            </div>
            <input type="hidden" name="role" value={selectedRole} />
            <FieldError message={state?.fieldErrors?.personId} />
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Agregando…" : "Agregar a la póliza"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
