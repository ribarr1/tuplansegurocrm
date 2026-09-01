import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTACT_STATUS_BADGE_VARIANT, CONTACT_STATUS_LABELS } from "@/lib/labels";
import type { getHouseholdById } from "@/services/households.service";
import { AddMemberDialog } from "./add-member-dialog";
import { MemberRoleForm } from "./member-role-form";
import { RemoveMemberButton } from "./remove-member-button";
import { HouseholdDetailsForm } from "./household-details-form";

type Household = Awaited<ReturnType<typeof getHouseholdById>>;

export function HouseholdCard({
  household,
  viewedPersonId,
}: {
  household: Household;
  viewedPersonId: string;
}) {
  // Household.name es un campo real pero opcional (prisma/schema.prisma).
  // Si no fue definido, se deriva un identificador visual del primer
  // miembro — nunca se almacena un nombre artificial en la base.
  const firstMember = household.members[0];
  const displayName =
    household.name ??
    (firstMember
      ? `Hogar de ${firstMember.person.firstName} ${firstMember.person.lastName}`
      : "Hogar");

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-base">{displayName}</CardTitle>
        <AddMemberDialog householdId={household.id} viewedPersonId={viewedPersonId} />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {household.members.map((member) => (
          <div
            key={member.id}
            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Link
                  href={`/contacts/${member.person.id}`}
                  className="text-sm font-medium hover:underline"
                >
                  {member.person.firstName} {member.person.lastName}
                </Link>
                <Badge variant={CONTACT_STATUS_BADGE_VARIANT[member.person.contactStatus]}>
                  {CONTACT_STATUS_LABELS[member.person.contactStatus]}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {member.person.phone ?? "—"} · {member.person.email ?? "—"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <MemberRoleForm
                householdMemberId={member.id}
                viewedPersonId={viewedPersonId}
                currentRole={member.role}
              />
              <RemoveMemberButton
                householdMemberId={member.id}
                viewedPersonId={viewedPersonId}
                personName={`${member.person.firstName} ${member.person.lastName}`}
              />
            </div>
          </div>
        ))}

        <HouseholdDetailsForm
          householdId={household.id}
          personId={viewedPersonId}
          defaults={{
            addressLine1: household.addressLine1 ?? "",
            addressLine2: household.addressLine2 ?? "",
            city: household.city ?? "",
            state: household.state ?? "",
            zipCode: household.zipCode ?? "",
            county: household.county ?? "",
            annualHouseholdIncome: household.annualHouseholdIncome?.toString() ?? "",
            incomeYear: household.incomeYear?.toString() ?? "",
          }}
        />
      </CardContent>
    </Card>
  );
}
