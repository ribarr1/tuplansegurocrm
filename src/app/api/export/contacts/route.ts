import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { exportContactsCsv } from "@/services/export.service";
import { AppError } from "@/services/errors";

// Fase 025.5.1 (UAT-11): reenvía los mismos query params que /contacts
// usa como filtros (q/status/assignedAgentId) — "Exportar CSV" exporta
// lo que la pantalla muestra, nunca siempre el universo completo sin
// filtrar (mismo patrón que /api/export/policies, Fase 025.5 UAT-09).
export async function GET(request: NextRequest) {
  let actor;
  try {
    actor = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const rawFilters = {
    search: sp.get("q") || undefined,
    contactStatus: sp.get("status") || undefined,
    assignedAgentId: sp.get("assignedAgentId") || undefined,
  };
  const hasAnyFilter = Object.values(rawFilters).some(Boolean);

  try {
    const csv = await exportContactsCsv(actor, hasAnyFilter ? rawFilters : undefined);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="contactos.csv"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }
}
