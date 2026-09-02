"use server";

import { requireSessionUser } from "@/lib/authorization";
import { getPolicyTimeline } from "@/services/history.service";
import { formatDateTimeUS } from "@/lib/business-time";

// "Mostrar más" del timeline de una póliza (Fase 019.9, §17, §25, §31).
export async function loadMorePolicyHistory(policyId: string, cursor: string | null) {
  const actor = await requireSessionUser();
  const page = await getPolicyTimeline(actor, policyId, { cursor: cursor ?? undefined });
  return {
    nextCursor: page.nextCursor,
    events: page.events.map((e) => ({ ...e, createdAtDisplay: formatDateTimeUS(e.createdAt) })),
  };
}
