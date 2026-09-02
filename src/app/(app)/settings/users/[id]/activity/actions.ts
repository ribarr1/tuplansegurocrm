"use server";

import { requireSessionUser } from "@/lib/authorization";
import { getUserActivity } from "@/services/history.service";
import { formatDateTimeUS } from "@/lib/business-time";

export async function loadMoreUserActivity(userId: string, cursor: string | null) {
  const actor = await requireSessionUser();
  const page = await getUserActivity(actor, userId, { cursor: cursor ?? undefined });
  return {
    nextCursor: page.nextCursor,
    events: page.events.map((e) => ({ ...e, createdAtDisplay: formatDateTimeUS(e.createdAt) })),
  };
}
