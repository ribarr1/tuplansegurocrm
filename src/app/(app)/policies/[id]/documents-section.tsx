import { listPolicyDocuments } from "@/services/policy-documents.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { POLICY_DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { UploadDocumentForm } from "./upload-document-form";
import { DeleteDocumentButton } from "./delete-document-button";
import { formatDateUS } from "@/lib/business-time";

const formatDate = formatDateUS;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Solo metadata — el binario nunca pasa por este componente (se sirve
// vía /api/policies/[id]/documents/[documentId], que valida
// autorización en cada request). Respeta la misma autorización de
// Policy que el resto del detalle — ver policy-documents.service.ts.
export async function PolicyDocumentsSection({
  actor,
  policyId,
}: {
  actor: AuthorizedUser;
  policyId: string;
}) {
  const documents = await listPolicyDocuments(actor, policyId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">Documentos</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <UploadDocumentForm policyId={policyId} />
        {documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay documentos cargados para esta póliza.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{doc.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {POLICY_DOCUMENT_TYPE_LABELS[doc.type]} · {formatDate(doc.createdAt)} ·{" "}
                    {formatFileSize(doc.fileSize)}
                    {doc.uploadedBy ? ` · ${doc.uploadedBy.name}` : ""}
                  </span>
                  {doc.description && (
                    <span className="text-xs text-muted-foreground">{doc.description}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/policies/${policyId}/documents/${doc.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline"
                  >
                    Ver
                  </a>
                  <a
                    href={`/api/policies/${policyId}/documents/${doc.id}?download=1`}
                    className="text-sm underline"
                  >
                    Descargar
                  </a>
                  <DeleteDocumentButton documentId={doc.id} fileName={doc.fileName} />
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
