"use server";

import { requireSessionUser } from "@/lib/authorization";
import { getContactTimeline, type HistoryCategory } from "@/services/history.service";
import { formatDateTimeUS } from "@/lib/business-time";

// "Mostrar más" del timeline de un contacto (Fase 019.9, §17, §25) —
// pagina desde el cliente sin recargar toda la página. Formatea
// createdAt en el servidor (business-time.ts es "server-only") antes
// de devolver al cliente.
//
// `cursor` va al final (no en medio) para poder usar
// `loadMoreContactHistory.bind(null, personId, category)` desde el
// Server Component y pasar el resultado directo como prop a
// <HistoryTimeline> — un componente cliente solo puede recibir una
// función server como prop si es literalmente una Server Action (o un
// .bind() de una), nunca un wrapper local ad-hoc definido en el
// propio Server Component.
export async function loadMoreContactHistory(
  personId: string,
  category: HistoryCategory | undefined,
  cursor: string | null
) {
  const actor = await requireSessionUser();
  const page = await getContactTimeline(actor, personId, { cursor: cursor ?? undefined, category });
  return {
    nextCursor: page.nextCursor,
    events: page.events.map((e) => ({ ...e, createdAtDisplay: formatDateTimeUS(e.createdAt) })),
  };
}
