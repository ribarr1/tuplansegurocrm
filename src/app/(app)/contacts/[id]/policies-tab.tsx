import Link from "next/link";
import { getPoliciesForPerson } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { POLICY_STATUS_BADGE_VARIANT, POLICY_STATUS_LABELS, POLICY_TYPE_LABELS } from "@/lib/labels";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("es-US", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

// Una Policy puede tener a esta Person como titular, como miembro
// cubierto, o ambas — se distingue visualmente sin duplicar la fila
// (getPoliciesForPerson ya devuelve cada Policy una sola vez).
export async function PoliciesTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const policies = await getPoliciesForPerson(actor, personId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button nativeButton={false} render={<Link href={`/policies/new?holderId=${personId}`} />}>
          + Nueva póliza
        </Button>
      </div>

      {policies.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">Esta persona no tiene pólizas todavía.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {policies.map((policy) => {
            const isHolder = policy.holder.id === personId;
            const isCoveredMember = policy.members.some((m) => m.person.id === personId);
            const relationLabel =
              isHolder && isCoveredMember
                ? "Titular + cubierto"
                : isHolder
                  ? "Titular"
                  : "Cubierto";

            return (
              <Link
                key={policy.id}
                href={`/policies/${policy.id}`}
                className="flex flex-col gap-2 rounded-md border p-4 hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{policy.policyNumber ?? "Póliza sin número"}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{relationLabel}</Badge>
                    <Badge variant={POLICY_STATUS_BADGE_VARIANT[policy.status]}>
                      {POLICY_STATUS_LABELS[policy.status]}
                    </Badge>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                  <span>{POLICY_TYPE_LABELS[policy.product.policyType]}</span>
                  <span>{policy.product.carrier.name}</span>
                  <span>Efectiva: {formatDate(policy.effectiveDate)}</span>
                  {policy.nextPaymentDueDate && (
                    <span>Próximo pago: {formatDate(policy.nextPaymentDueDate)}</span>
                  )}
                  {policy.needsPaymentAssistance && (
                    <Badge variant="secondary">Requiere asistencia</Badge>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
