import Link from "next/link";
import { getPoliciesForPerson } from "@/services/policies.service";
import { getCommissionsForPolicy } from "@/services/commissions.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import {
  COMMISSION_DERIVED_STATUS_LABELS,
  COMMISSION_DERIVED_STATUS_BADGE_VARIANT,
} from "@/lib/labels";

function formatMoney(amount: { toFixed: (n: number) => string }): string {
  return `$${amount.toFixed(2)}`;
}

function formatPeriod(date: Date): string {
  return new Intl.DateTimeFormat("es-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

// Comisiones asociadas a las pólizas del contacto — nunca duplica
// lógica financiera, reutiliza commissions.service.ts tal cual. Esta
// pestaña nunca se renderiza para ASSISTANT (ver contacts/[id]/page.tsx).
export async function CommissionsTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  const policies = await getPoliciesForPerson(actor, personId);
  const perPolicy = await Promise.all(policies.map((p) => getCommissionsForPolicy(actor, p.id)));
  const expectations = perPolicy.flat();

  if (expectations.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">
          No hay comisiones registradas para las pólizas de este contacto.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {expectations.map((exp) => (
        <Link
          key={exp.id}
          href={`/commissions/${exp.id}`}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm hover:bg-muted/40"
        >
          <div className="flex flex-col">
            <span className="font-medium">{formatPeriod(exp.period)}</span>
            <span className="text-xs text-muted-foreground">
              {exp.policy.product.carrier.name} · {exp.policy.policyNumber ?? "sin número"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Esperado {formatMoney(exp.expectedAmount)} · Recibido {formatMoney(exp.receivedAmount)}
            </span>
            <Badge variant={COMMISSION_DERIVED_STATUS_BADGE_VARIANT[exp.derivedStatus]}>
              {COMMISSION_DERIVED_STATUS_LABELS[exp.derivedStatus]}
            </Badge>
          </div>
        </Link>
      ))}
    </div>
  );
}
