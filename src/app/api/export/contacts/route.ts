import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { exportContactsCsv } from "@/services/export.service";
import { AppError } from "@/services/errors";

// Fase 020 (§1) — CSV UTF-8 estándar. Autorización idéntica a la
// visibilidad de Contactos ya existente (ver docs/DECISIONS.md) —
// nunca una regla nueva paralela.
export async function GET() {
  let actor;
  try {
    actor = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const csv = await exportContactsCsv(actor);
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
