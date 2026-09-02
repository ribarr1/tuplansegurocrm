import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { exportClientReportCsv } from "@/services/export.service";
import { AppError } from "@/services/errors";

// Fase 021 (§37) — respeta los filtros seleccionados en /reports/clients
// (recibidos como query params, igual que la propia página). Misma
// autorización que el reporte (visibilidad abierta de Contactos).
export async function GET(request: Request) {
  let actor;
  try {
    actor = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const csv = await exportClientReportCsv(actor, query);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="reporte-clientes.csv"',
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
