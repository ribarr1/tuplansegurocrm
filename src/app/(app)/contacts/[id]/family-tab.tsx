import type { AuthorizedUser } from "@/lib/authorization";
import { getHouseholdsForPerson } from "@/services/households.service";
import { CreateHouseholdDialog } from "./create-household-dialog";
import { HouseholdCard } from "./household-card";

// Soporta 0, 1 o varios hogares por persona (Household es N:M — ver
// docs/DECISIONS.md). No se asume "una sola familia".
export async function FamilyTab({
  actor,
  personId,
}: {
  actor: AuthorizedUser;
  personId: string;
}) {
  const households = await getHouseholdsForPerson(actor, personId);

  if (households.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">No pertenece a ningún hogar todavía.</p>
        <CreateHouseholdDialog personId={personId} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {households.map((household) => (
        <HouseholdCard key={household.id} household={household} viewedPersonId={personId} />
      ))}
    </div>
  );
}
