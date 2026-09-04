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
        {/* Hallazgo #4 de UAT (Fase 024): <a> nativo a propósito, NUNCA
            next/link aquí. El servidor SIEMPRE filtró bien (confirmado
            navegando de forma completa a la misma URL); el bug real
            era client-side — el Link de Next dejaba el árbol
            (incluyendo este mismo bloque de pills, que no tiene estado
            propio) visualmente congelado en el filtro anterior al
            navegar solo por searchParams, ni prefetch={false} ni una
            key en el padre lo resolvían de forma confiable. Una
            navegación completa (recarga real de página) es la única
            forma verificada de que el filtro se refleje siempre —
            aceptable para un filtro de uso ocasional como este. */}
        <a
          href={`/contacts/${personId}?tab=historial`}
          className={
            !category
              ? "rounded-full bg-secondary px-3 py-1 text-xs font-medium"
              : "rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
          }
        >
          Todos
        </a>
        {HISTORY_CATEGORY_VALUES.map((c) => (
          <a
            key={c}
            href={`/contacts/${personId}?tab=historial&category=${c}`}
            className={
              category === c
                ? "rounded-full bg-secondary px-3 py-1 text-xs font-medium"
                : "rounded-full px-3 py-1 text-xs text-muted-foreground hover:bg-muted"
            }
          >
            {CATEGORY_LABELS[c]}
          </a>
        ))}
      </div>

      {/* key: HistoryTimeline usa useState(initialEvents) para poder
          agregar páginas con "Mostrar más" sin perderlas — pero eso
          significa que React SOLO lee initialEvents en el primer
          mount. Sin una key ligada al filtro activo, cambiar de
          categoría re-renderiza el Server Component padre con una
          lista `events` distinta, pero React reconcilia
          HistoryTimeline como "la misma instancia" (mismo tipo, misma
          posición) y el estado interno viejo gana — la lista se veía
          congelada en el filtro anterior. Este es el bug real detrás
          del Hallazgo #4 de UAT (Fase 024); no era un problema de
          caché de Next ni del servidor (que sí filtraba bien). */}
      <HistoryTimeline
        key={category ?? "all"}
        initialEvents={events}
        initialCursor={page.nextCursor}
        loadMore={loadMore}
      />
    </div>
  );
}
