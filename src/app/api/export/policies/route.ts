import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { exportPoliciesCsv } from "@/services/export.service";
import { AppError } from "@/services/errors";

export async function GET() {
  let actor;
  try {
    actor = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const csv = await exportPoliciesCsv(actor);
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
