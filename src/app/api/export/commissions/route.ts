import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { exportCommissionsCsv } from "@/services/export.service";
import { AppError } from "@/services/errors";

// ASSISTANT nunca exporta Comisiones — exportCommissionsCsv rechaza
// explícitamente (FORBIDDEN), mismo criterio que el resto del módulo.
export async function GET() {
  let actor;
  try {
    actor = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const csv = await exportCommissionsCsv(actor);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="comisiones.csv"',
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
