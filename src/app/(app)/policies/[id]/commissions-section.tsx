import Link from "next/link";
import { getCommissionsForPolicy } from "@/services/commissions.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  COMMISSION_DERIVED_STATUS_LABELS,
  COMMISSION_DERIVED_STATUS_BADGE_VARIANT,
} from "@/lib/labels";

function formatMoney(amount: { toFixed: (n: number) => string }): string {
  return `$${amount.toFixed(2)}`;
}

function formatPeriod(date: Date): string {
  return new Intl.DateTimeFormat("es-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    date
  );
}

// Comisiones es FINANCIERO/RESTRINGIDO — este componente solo se
// renderiza para ADMIN/AGENT (ver policies/[id]/page.tsx); ASSISTANT
// nunca lo ve, ni siquiera esta llamada se hace para ese rol.
export async function PolicyCommissionsSection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const expectations = await getCommissionsForPolicy(actor, policyId);
  const isAdmin = actor.role === "ADMIN";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-sm font-medium text-muted-foreground">Comisiones</CardTitle>
        {isAdmin && (
          <Button
            size="sm"
            nativeButton={false}
            render={<Link href={`/commissions/new?policyId=${policyId}`} />}
          >
            Agregar comisión esperada
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {expectations.length === 0 ? (
          <p className="text-muted-foreground">No hay comisiones registradas para esta póliza.</p>
        ) : (
          expectations.map((expectation) => (
            <Link
              key={expectation.id}
              href={`/commissions/${expectation.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted/40"
            >
              <span className="font-medium">{formatPeriod(expectation.period)}</span>
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  Esperado {formatMoney(expectation.expectedAmount)} · Recibido{" "}
                  {formatMoney(expectation.receivedAmount)}
                </span>
                <Badge variant={COMMISSION_DERIVED_STATUS_BADGE_VARIANT[expectation.derivedStatus]}>
                  {COMMISSION_DERIVED_STATUS_LABELS[expectation.derivedStatus]}
                </Badge>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
