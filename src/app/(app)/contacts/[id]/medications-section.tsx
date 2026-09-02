import { listPersonMedications } from "@/services/health-records.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MedicationDialog } from "./medication-dialog";
import { DeleteMedicationButton } from "./delete-medication-button";

// Hallazgo #18 de UAT (Fase 019.8): vive en Person, nunca en Policy —
// una persona puede cambiar de póliza y sus medicamentos deben
// permanecer (ver docs/DECISIONS.md). Nunca se usa Note como
// sustituto.
export async function MedicationsSection({
  actor,
  personId,
}: {
  actor: AuthorizedUser;
  personId: string;
}) {
  const medications = await listPersonMedications(actor, personId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="text-sm font-medium text-muted-foreground">Medicamentos</CardTitle>
        <MedicationDialog personId={personId} triggerLabel="+ Agregar medicamento" />
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {medications.length === 0 ? (
          <p className="text-muted-foreground">Sin medicamentos registrados.</p>
        ) : (
          medications.map((med) => (
            <div
              key={med.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{med.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[med.dosage, med.frequency].filter(Boolean).join(" · ") || "—"}
                </span>
                {med.notes && <span className="text-xs text-muted-foreground">{med.notes}</span>}
              </div>
              <div className="flex items-center gap-2">
                <MedicationDialog
                  personId={personId}
                  medication={med}
                  triggerLabel="Editar"
                  triggerVariant="outline"
                />
                <DeleteMedicationButton
                  medicationId={med.id}
                  personId={personId}
                  medicationName={med.name}
                />
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
