import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/authorization";

// Endpoint de verificación para esta fase: confirma que la autorización
// server-side funciona incluso si alguien conoce la URL directamente.
// No forma parte del CRM funcional.
export async function GET() {
  const user = await getSessionUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado" }, { status: 401 });
  }

  if (user.role !== "ADMIN") {
    return NextResponse.json({ error: "Requiere rol ADMIN" }, { status: 403 });
  }

  return NextResponse.json({ ok: true, role: user.role });
}
