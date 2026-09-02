import Link from "next/link";
import { getContactTimeline, HISTORY_CATEGORY_VALUES, type HistoryCategory } from "@/services/history.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { HistoryTimeline } from "@/components/history-timeline";
import { formatDateTimeUS } from "@/lib/business-time";
import { loadMoreContactHistory } from "./history-actions";

const CATEGORY_LABELS: Record<HistoryCategory, string> = {
  CONTACT: "Contacto",
  FAMILY: "Familia",
  POLICIES: "Pólizas",
  HEALTH: "Salud",
  TASKS: "Tareas",
  NOTES: "Notas",
  PREMIUMS: "Primas",
  COMMISSIONS: "Comisiones",
  DOCUMENTS: "Documentos",
};

// Hallazgo #8-#9 de UAT (Fase 019.9): Historial = eventos generados
// automáticamente por el sistema, nunca texto manual del agente (eso
// es Notes, tab aparte). ASSISTANT nunca ve eventos de Comisiones aquí
// — history.service.ts ya lo filtra, esta vista no necesita lógica
// adicional de ocultamiento.
export async function HistoryTab({
  actor,
  personId,
  category,
}: {
  actor: AuthorizedUser;
  personId: string;
  category?: HistoryCategory;
}) {
  const page = await getContactTimeline(actor, personId, { category });
  const events = page.events.map((e) => ({ ...e, createdAtDisplay: formatDateTimeUS(e.createdAt) }));
  const loadMore = loadMoreContactHistory.bind(null, personId, category);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1">
        <Link
          href={`/contacts/${personId}?tab=historial`}
          className={
            !category
              ? "rounded-full bg-secondary px-3 py-1 text-xs font-medium"
              : "rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          }
        >
          Todos
        </Link>
        {HISTORY_CATEGORY_VALUES.map((c) => (
          <Link
            key={c}
            href={`/contacts/${personId}?tab=historial&category=${c}`}
            className={
              category === c
                ? "rounded-full bg-secondary px-3 py-1 text-xs font-medium"
                : "rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </div>

      <HistoryTimeline initialEvents={events} initialCursor={page.nextCursor} loadMore={loadMore} />
    </div>
  );
}
