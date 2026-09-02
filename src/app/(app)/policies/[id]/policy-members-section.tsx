import Link from "next/link";
import { getPolicyMembersDetailed, getEligibleHouseholdMembersForPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POLICY_MEMBER_ROLE_LABELS, HOUSEHOLD_MEMBER_ROLE_LABELS } from "@/lib/labels";
import type { HouseholdMemberRole } from "@/generated/prisma/client";
import { AddPolicyMemberDialog } from "./add-policy-member-dialog";
import { RemovePolicyMemberButton } from "./remove-policy-member-button";

// Hallazgo #12 de UAT (Fase 019.7): agregar/quitar miembros de una
// póliza YA existente, sin recrearla. HouseholdMember y PolicyMember
// siguen siendo conceptos separados — estar en el hogar nunca cubre
// automáticamente (ver docs/DECISIONS.md).
export async function PolicyMembersSection({
  actor,
  policyId,
  holderIsCovered,
}: {
  actor: AuthorizedUser;
  policyId: string;
  holderIsCovered: boolean;
}) {
  const [members, candidates] = await Promise.all([
    getPolicyMembersDetailed(actor, policyId),
    getEligibleHouseholdMembersForPolicy(actor, policyId),
  ]);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">Miembros cubiertos</CardTitle>
        <AddPolicyMemberDialog policyId={policyId} candidates={candidates} />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {!holderIsCovered && (
          <p className="text-xs text-muted-foreground">El titular no está cubierto por esta póliza.</p>
        )}
        {members.length === 0 ? (
          <p className="text-muted-foreground">Nadie está cubierto todavía.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((member) => (
              <div
                key={member.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
              >
                <div className="flex flex-col gap-0.5">
                  <Link href={`/contacts/${member.person.id}`} className="underline">
                    {member.person.firstName} {member.person.lastName}
                  </Link>
                  {/* Filiación familiar real (HouseholdMember.role) — nunca
                      se inventa "Otro" cuando ya conocemos la relación
                      del hogar (hallazgo #13). Rol de póliza se muestra
                      aparte, son conceptos distintos. */}
                  <span className="text-xs text-muted-foreground">
                    {member.householdRole
                      ? HOUSEHOLD_MEMBER_ROLE_LABELS[member.householdRole as HouseholdMemberRole]
                      : "Sin hogar registrado"}
                    {" · "}
                    {POLICY_MEMBER_ROLE_LABELS[member.role]} de la póliza
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{POLICY_MEMBER_ROLE_LABELS[member.role]}</Badge>
                  <RemovePolicyMemberButton
                    policyId={policyId}
                    policyMemberId={member.id}
                    personName={`${member.person.firstName} ${member.person.lastName}`}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
