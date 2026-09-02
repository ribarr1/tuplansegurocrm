import type { AuthorizedUser } from "@/lib/authorization";
import { getSensitiveIdentitySummary } from "@/services/sensitive-identity.service";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RevealableField } from "@/components/ui/revealable-field";
import { formatDateOnlyUS, toDateOnlyIso } from "@/lib/date-only";
import { IMMIGRATION_DOCUMENT_TYPE_LABELS } from "@/lib/labels";
import { ImmigrationCategoryForm } from "./immigration-category-form";
import { SensitiveValueManager } from "./sensitive-value-manager";
import { ImmigrationDocumentDialog } from "./immigration-document-dialog";
import { DeactivateDocumentButton } from "./deactivate-document-button";
import {
  revealSsnAction,
  revealUscisNumberAction,
  removeSsnAction,
  removeUscisNumberAction,
  setSsnAction,
  setUscisNumberAction,
  revealImmigrationDocumentNumberAction,
} from "./sensitive-identity-actions";

// Información migratoria e identidad sensible (SSN, USCIS/A-Number,
// documentos migratorios) — Fase 021. El Server Component NUNCA
// descifra estos valores: getSensitiveIdentitySummary solo retorna
// masked/last4/hasValue — el valor completo se pide bajo demanda
// mediante las Server Actions de reveal (ver sensitive-identity-actions.ts,
// docs/SENSITIVE_PII.md, §17 de la ficha).
export async function IdentityTab({ actor, personId }: { actor: AuthorizedUser; personId: string }) {
  void actor;
  const summary = await getSensitiveIdentitySummary(actor, personId);

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Categoría migratoria</CardTitle>
        </CardHeader>
        <CardContent>
          {summary.canReveal ? (
            <ImmigrationCategoryForm personId={personId} currentCategory={summary.immigrationCategory} />
          ) : (
            <p className="text-sm">
              {summary.immigrationCategory === "UNKNOWN" ? "No especificado" : summary.immigrationCategory}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">Identificadores</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SensitiveValueManager
            label="SSN"
            fieldName="ssn"
            placeholder="123-45-6789"
            masked={summary.ssn.masked}
            hasValue={summary.ssn.hasValue}
            canReveal={summary.canReveal}
            onReveal={revealSsnAction.bind(null, personId)}
            setAction={setSsnAction.bind(null, personId)}
            onRemove={removeSsnAction.bind(null, personId)}
          />
          <SensitiveValueManager
            label="USCIS / A-Number"
            fieldName="uscisNumber"
            placeholder="A123456789"
            masked={summary.uscisNumber.masked}
            hasValue={summary.uscisNumber.hasValue}
            canReveal={summary.canReveal}
            onReveal={revealUscisNumberAction.bind(null, personId)}
            setAction={setUscisNumberAction.bind(null, personId)}
            onRemove={removeUscisNumberAction.bind(null, personId)}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-sm font-medium text-muted-foreground">Documentos migratorios</CardTitle>
          {summary.canReveal && (
            <ImmigrationDocumentDialog personId={personId} triggerLabel="+ Agregar documento" triggerVariant="outline" />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {summary.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin documentos migratorios registrados.</p>
          ) : (
            summary.documents.map((doc) => (
              <div key={doc.id} className="flex flex-col gap-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">{IMMIGRATION_DOCUMENT_TYPE_LABELS[doc.documentType]}</span>
                  {summary.canReveal && (
                    <div className="flex items-center gap-2">
                      <ImmigrationDocumentDialog
                        personId={personId}
                        document={{
                          id: doc.id,
                          documentType: doc.documentType,
                          hasDocumentNumber: doc.hasDocumentNumber,
                          issuedDate: toDateOnlyIso(doc.issuedDate),
                          expirationDate: toDateOnlyIso(doc.expirationDate),
                        }}
                        triggerLabel="Editar"
                        triggerVariant="ghost"
                      />
                      <DeactivateDocumentButton
                        documentId={doc.id}
                        personId={personId}
                        documentLabel={IMMIGRATION_DOCUMENT_TYPE_LABELS[doc.documentType]}
                      />
                    </div>
                  )}
                </div>
                <div className="grid gap-1 text-sm sm:grid-cols-3">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Número:</span>
                    <NumberReveal
                      hasValue={doc.hasDocumentNumber}
                      masked={doc.documentNumberMasked}
                      canReveal={summary.canReveal}
                      documentId={doc.id}
                    />
                  </div>
                  <div className="flex justify-between gap-2 sm:justify-start">
                    <span className="text-muted-foreground">Emisión:</span>
                    <span>{formatDateOnlyUS(doc.issuedDate)}</span>
                  </div>
                  <div className="flex justify-between gap-2 sm:justify-start">
                    <span className="text-muted-foreground">Vence:</span>
                    <span>{formatDateOnlyUS(doc.expirationDate)}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Envuelve RevealableField con el bind del documentId — cada documento
// reutiliza la misma Server Action de reveal, parametrizada por fila.
function NumberReveal({
  hasValue,
  masked,
  canReveal,
  documentId,
}: {
  hasValue: boolean;
  masked: string | null;
  canReveal: boolean;
  documentId: string;
}) {
  return (
    <RevealableField
      masked={masked}
      hasValue={hasValue}
      canReveal={canReveal}
      onReveal={revealImmigrationDocumentNumberAction.bind(null, documentId)}
    />
  );
}
