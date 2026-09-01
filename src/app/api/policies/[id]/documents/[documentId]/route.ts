import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/authorization";
import { getPolicyDocumentForDownload } from "@/services/policy-documents.service";
import { AppError } from "@/services/errors";

// Única puerta de acceso al contenido de un PolicyDocument — nunca una
// URL pública permanente. Verifica sesión + autorización sobre la
// Policy dueña en cada request (getPolicyDocumentForDownload reutiliza
// assertCanAccessPolicy); "conocer" el id del documento nunca alcanza
// por sí solo.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  const { documentId } = await params;

  let actor;
  try {
    actor = await requireSessionUser();
  } catch {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  try {
    const { doc, data } = await getPolicyDocumentForDownload(actor, documentId);
    const url = new URL(request.url);
    const forceDownload = url.searchParams.has("download");

    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `${forceDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(doc.fileName)}"`,
        "Content-Length": String(doc.fileSize),
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
