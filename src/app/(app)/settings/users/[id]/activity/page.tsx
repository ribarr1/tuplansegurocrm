import Link from "next/link";
import { notFound, forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getUserById } from "@/services/users.service";
import { getUserActivity } from "@/services/history.service";
import { AppError } from "@/services/errors";
import { HistoryTimeline } from "@/components/history-timeline";
import { formatDateTimeUS } from "@/lib/business-time";
import { loadMoreUserActivity } from "./actions";

// "Ver actividad" — Fase 020 (§2). ADMIN only.
export default async function UserActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();
  if (actor.role !== "ADMIN") forbidden();

  let user;
  try {
    user = await getUserById(actor, id);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  const page = await getUserActivity(actor, id);
  const events = page.events.map((e) => ({ ...e, createdAtDisplay: formatDateTimeUS(e.createdAt) }));
  const loadMore = loadMoreUserActivity.bind(null, id);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Actividad de {user.name}</h2>
        <Link href="/settings/users" className="text-sm underline">
          Volver a Usuarios
        </Link>
      </div>
      <HistoryTimeline
        initialEvents={events}
        initialCursor={page.nextCursor}
        loadMore={loadMore}
        emptyMessage="Este usuario todavía no tiene actividad registrada."
      />
    </div>
  );
}
