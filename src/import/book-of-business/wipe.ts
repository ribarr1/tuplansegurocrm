// Este módulo corre exclusivamente desde scripts/import-book-of-
// business.ts (script de Node/tsx fuera del árbol de Next) — sin
// "server-only": ese guard lanza incondicionalmente fuera de un
// bundler de Next, y este archivo nunca se importa desde una ruta de
// la aplicación.
import { prisma } from "@/lib/prisma";

// Reinicio explícito y protegido de datos de NEGOCIO en DEV/local antes
// del import real — Fase 023, Parte B. NUNCA borra User/Account/
// Session/Verification (autenticación se preserva). Requiere que el
// caller ya haya verificado explícitamente que DATABASE_URL apunta a
// un ambiente local — esta función no vuelve a verificarlo (ver
// scripts/import-book-of-business.ts, único caller autorizado).
//
// Orden FK-safe (hijo -> padre), auditado contra prisma/schema.prisma:
// primero todo lo que referencia Policy/Person/Household/Product/
// Carrier, luego esas cuatro tablas raíz de negocio.
export async function resetBusinessDataForImport(): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Conciliación de comisiones
    await tx.commissionPayment.deleteMany({});
    await tx.commissionStatementRow.deleteMany({});
    await tx.commissionStatement.deleteMany({});
    await tx.commissionExpectation.deleteMany({});
    await tx.commissionRule.deleteMany({});

    // Documentos y referencias externas de póliza
    await tx.policyDocument.deleteMany({});
    await tx.policyExternalReference.deleteMany({});
    await tx.healthPolicyDetail.deleteMany({});
    await tx.policyMember.deleteMany({});

    // Tareas/Notas (referencian Person y/o Policy)
    await tx.task.deleteMany({});
    await tx.note.deleteMany({});

    // Póliza en sí (después de todo lo que depende de ella). Primero se
    // desvincula previousPolicyId (auto-referencia @unique con
    // onDelete: Restrict) de TODAS las filas — un DELETE masivo sobre
    // una tabla auto-referenciada puede violar esa constraint fila por
    // fila si no se limpia antes, sin importar que el borrado sea
    // "completo" al final del statement.
    await tx.policy.updateMany({ data: { previousPolicyId: null } });
    await tx.policy.deleteMany({});

    // Cumpleaños/salud operativa/identidad sensible (dependen de Person)
    await tx.birthdayGreeting.deleteMany({});
    await tx.personProvider.deleteMany({});
    await tx.personMedication.deleteMany({});
    await tx.personImmigrationDocument.deleteMany({});
    await tx.personSensitiveIdentity.deleteMany({});

    // Auditoría de negocio (referencia Person/Policy/Household vía SetNull,
    // pero como las filas de negocio se están borrando por completo, se
    // limpia también el historial de negocio previo — nunca el de
    // administración de usuarios, que no lleva contactPersonId/policyId/
    // householdId).
    await tx.auditEvent.deleteMany({
      where: {
        OR: [
          { contactPersonId: { not: null } },
          { policyId: { not: null } },
          { householdId: { not: null } },
        ],
      },
    });

    // Hogares y personas
    await tx.householdMember.deleteMany({});
    await tx.household.deleteMany({});
    await tx.person.deleteMany({});

    // Catálogo ficticio de seed-dev.ts — el catálogo real de
    // carriers.json lo sustituye por completo.
    await tx.product.deleteMany({});
    await tx.carrier.deleteMany({});
  });
}
