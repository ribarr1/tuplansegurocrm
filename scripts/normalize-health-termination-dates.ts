import "dotenv/config";
import { prisma } from "../src/lib/prisma";

// Fase 025.1 (Hallazgo #2 de UAT): normaliza terminationDate para
// pólizas HEALTH existentes en DEV que la tienen NULL — 31/12 del
// planYear real del Product, NUNCA el año del servidor.
//
// Alcance deliberadamente acotado:
//   - Solo ACTIVE. CANCELLED se deja intacto SIEMPRE: no hay forma de
//     distinguir "cancelación anticipada real sin fecha registrada" de
//     "nunca se le puso fecha" sin inventar un valor — reportado como
//     ambiguous, nunca corregido a ciegas (ver ficha).
//   - Solo cuando Product.planYear es conocido (o, en su defecto,
//     effectiveDate) — nunca adivina un año.
//
// Idempotente: solo toca filas con terminationDate NULL; correrlo de
// nuevo sobre las ya corregidas no hace nada.
//
// Reporta SOLO conteos, nunca nombres de clientes (CLAUDE.md §32).

function healthDefaultTerminationDate(planYear: number | null, effectiveDate: Date | null): Date | null {
  const year = planYear ?? (effectiveDate ? effectiveDate.getUTCFullYear() : null);
  if (year == null) return null;
  return new Date(Date.UTC(year, 11, 31));
}

async function main() {
  const candidates = await prisma.policy.findMany({
    where: { product: { policyType: "HEALTH" }, status: "ACTIVE", terminationDate: null },
    select: { id: true, effectiveDate: true, product: { select: { planYear: true } } },
  });

  console.log(`Candidatas (HEALTH, ACTIVE, terminationDate NULL): ${candidates.length}`);

  let normalized = 0;
  let skippedAmbiguous = 0;
  for (const policy of candidates) {
    const defaultDate = healthDefaultTerminationDate(policy.product.planYear, policy.effectiveDate);
    if (!defaultDate) {
      skippedAmbiguous++;
      continue;
    }
    await prisma.policy.update({ where: { id: policy.id }, data: { terminationDate: defaultDate } });
    normalized++;
  }

  const cancelledAmbiguous = await prisma.policy.count({
    where: { product: { policyType: "HEALTH" }, status: "CANCELLED", terminationDate: null },
  });

  console.log("---");
  console.log(`Normalizadas (ACTIVE -> 12/31/planYear): ${normalized}`);
  console.log(`Omitidas por ambiguas (sin planYear ni effectiveDate): ${skippedAmbiguous}`);
  console.log(`CANCELLED con terminationDate NULL — NUNCA tocadas, reportadas como ambiguas: ${cancelledAmbiguous}`);
}

main()
  .catch((e) => {
    console.error("Error normalizando terminationDate de pólizas HEALTH:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
