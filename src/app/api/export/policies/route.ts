import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { exportPoliciesCsv } from "@/services/export.service";
import { AppError } from "@/services/errors";

// Fase 025.5 (UAT-09): reenvía los mismos query params que /policies
// usa como filtros (search/status/policyType/carrierId/healthSource/
// agentId/businessSource) — "Exportar CSV" exporta lo que la pantalla
// muestra, nunca siempre el universo completo sin filtrar.
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
    status: sp.get("status") || undefined,
    policyType: sp.get("policyType") || undefined,
    carrierId: sp.get("carrierId") || undefined,
    healthSource: sp.get("healthSource") || undefined,
    agentId: sp.get("agentId") || undefined,
    businessSource: sp.get("businessSource") || undefined,
  };
  const hasAnyFilter = Object.values(rawFilters).some(Boolean);

  try {
    const csv = await exportPoliciesCsv(actor, hasAnyFilter ? rawFilters : undefined);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="polizas.csv"',
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
