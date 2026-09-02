import { getPolicyTimeline } from "@/services/history.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HistoryTimeline } from "@/components/history-timeline";
import { formatDateTimeUS } from "@/lib/business-time";
import { loadMorePolicyHistory } from "./history-actions";

// Hallazgo #31 de UAT (Fase 019.9): mismo AuditEvent que el timeline
// del contacto, filtrado por policyId — nunca duplica eventos.
export async function PolicyHistorySection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const page = await getPolicyTimeline(actor, policyId);
  const events = page.events.map((e) => ({ ...e, createdAtDisplay: formatDateTimeUS(e.createdAt) }));
  const loadMore = loadMorePolicyHistory.bind(null, policyId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Historial</CardTitle>
      </CardHeader>
      <CardContent>
        <HistoryTimeline initialEvents={events} initialCursor={page.nextCursor} loadMore={loadMore} />
      </CardContent>
    </Card>
  );
}
