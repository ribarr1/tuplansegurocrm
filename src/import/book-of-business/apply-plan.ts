import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
// Fase 021's EXACT AES-256-GCM implementation, vía el núcleo sin el
// guard "server-only" (ver src/lib/pii-crypto-core.ts) — este módulo
// corre como script de Node/tsx (scripts/import-book-of-business.ts),
// fuera del árbol de Next, donde "server-only" lanza incondicionalmente.
import { encryptPii } from "@/lib/pii-crypto-core";
import { last4 } from "@/lib/sensitive-identity-format";
import { normalizeCarrierName, comparePolicyChronology } from "./normalize";
import type { ImportPlan, PolicyPlanEntry } from "./types";

// assertNoOverlappingHealthCoverage / assertNextPaymentNotBeforeEffective
// (policies.service.ts) y recomputePersonContactStatus
// (people.service.ts) NO se importan aquí — ambos archivos tienen
// "server-only" en la cabecera (directa o transitivamente vía
// audit.service.ts/authorization.ts), que lanza fuera del árbol de
// Next. Se reimplementan abajo, IDÉNTICOS en su regla de negocio a los
// originales (mismo criterio ya usado por el importador legacy,
// src/import/apply.ts, Fase 019: los scripts de import escriben
// directo contra Prisma en vez de reusar la capa de servicio orientada
// a un actor/request HTTP). Si esa regla cambia en policies.service.ts
// en el futuro, esta copia debe actualizarse junto con ella.

const OPEN_ENDED = new Date(8640000000000000);

async function assertNoOverlappingHealthCoverage(
  tx: Prisma.TransactionClient,
  personId: string,
  effectiveDate: Date,
  terminationDate: Date | null,
  excludePolicyId?: string
): Promise<void> {
  const candidates = await tx.policyMember.findMany({
    where: {
      personId,
      ...(excludePolicyId ? { policyId: { not: excludePolicyId } } : {}),
      policy: { status: "ACTIVE", product: { policyType: "HEALTH" } },
    },
    select: { policy: { select: { policyNumber: true, effectiveDate: true, terminationDate: true } } },
  });
  const newEnd = terminationDate ?? OPEN_ENDED;
  for (const candidate of candidates) {
    const otherStart = candidate.policy.effectiveDate!;
    const otherEnd = candidate.policy.terminationDate ?? OPEN_ENDED;
    const overlaps = effectiveDate <= otherEnd && otherStart <= newEnd;
    if (overlaps) {
      throw new Error(
        `Esta persona ya tiene una póliza de salud (${candidate.policy.policyNumber ?? "sin número"}) que se solapa con las fechas seleccionadas.`
      );
    }
  }
}

function assertNextPaymentNotBeforeEffective(effectiveDate: Date | null, nextPaymentDueDate: Date | null): void {
  if (effectiveDate && nextPaymentDueDate && nextPaymentDueDate < effectiveDate) {
    throw new Error("nextPaymentDueDate: El próximo pago no puede ser anterior a la fecha efectiva de la póliza.");
  }
}

const AUTO_MANAGED_CONTACT_STATUSES = ["PROSPECT", "CLIENT"] as const;

async function recomputePersonContactStatus(tx: Prisma.TransactionClient, personId: string): Promise<void> {
  const person = await tx.person.findUnique({ where: { id: personId }, select: { id: true, contactStatus: true } });
  if (!person) return;
  if (!(AUTO_MANAGED_CONTACT_STATUSES as readonly string[]).includes(person.contactStatus)) return;
  const activeCoverage = await tx.policyMember.findFirst({
    where: { personId, policy: { status: "ACTIVE" } },
    select: { id: true },
  });
  const nextStatus = activeCoverage ? "CLIENT" : "PROSPECT";
  if (nextStatus === person.contactStatus) return;
  await tx.person.update({ where: { id: personId }, data: { contactStatus: nextStatus } });
  await tx.auditEvent.create({
    data: {
      actorType: "SYSTEM",
      entityType: "Person",
      entityId: personId,
      action: "CONTACT_STATUS_CHANGE",
      contactPersonId: personId,
      summary:
        nextStatus === "CLIENT"
          ? "Contacto actualizado automáticamente a Cliente (cobertura activa) — import libro de negocio"
          : "Contacto actualizado automáticamente a Prospecto (sin cobertura activa) — import libro de negocio",
      changes: { contactStatus: { before: person.contactStatus, after: nextStatus } },
    },
  });
}

export type ApplyResult = {
  personsCreated: number;
  personsMatched: number;
  householdsCreated: number;
  policiesCreated: number;
  policiesSkippedOverlap: number;
  policyMembersCreated: number;
  carriersCreated: number;
  productsCreated: number;
  sensitiveIdentitiesImported: number;
  uscisImported: number;
  notesImported: number;
  overlapBlocked: { sourceIndex: string; reason: string }[];
};

function amount(value: number | null): Prisma.Decimal | null {
  return value === null ? null : new Prisma.Decimal(value);
}

// Aplica un ImportPlan ya validado (readyToImport=true) a la base de
// datos — SOLO debe llamarse después del wipe (scripts/import-book-of-
// business.ts es el único caller autorizado). Una sola transacción
// interactiva con awaits SECUENCIALES (nunca Promise.all dentro de
// ella — ver docs/DECISIONS.md, bug de Fase 020) — volumen pequeño
// (~50 filas fuente), mismo patrón ya usado en src/import/apply.ts.
export async function applyImportPlan(
  plan: ImportPlan,
  carrierCatalogNames: string[]
): Promise<ApplyResult> {
  if (!plan.readyToImport) {
    throw new Error("El plan tiene errores BLOCKING — no se puede aplicar.");
  }

  return prisma.$transaction(
    async (tx) => {
      const result: ApplyResult = {
        personsCreated: 0,
        personsMatched: 0,
        householdsCreated: 0,
        policiesCreated: 0,
        policiesSkippedOverlap: 0,
        policyMembersCreated: 0,
        carriersCreated: 0,
        productsCreated: 0,
        sensitiveIdentitiesImported: 0,
        uscisImported: 0,
        notesImported: 0,
        overlapBlocked: [],
      };

      // --- 1) Carriers reales (reemplazan el catálogo ficticio del seed) ---
      const carrierIdByName = new Map<string, string>();
      for (const name of carrierCatalogNames) {
        const existing = await tx.carrier.findUnique({ where: { name }, select: { id: true } });
        if (existing) {
          carrierIdByName.set(name, existing.id);
        } else {
          const created = await tx.carrier.create({ data: { name }, select: { id: true } });
          carrierIdByName.set(name, created.id);
          result.carriersCreated++;
        }
      }

      // --- 2) Productos únicos derivados de las pólizas del plan ---
      const productIdByKey = new Map<string, string>();
      for (const pol of plan.policies) {
        const carrierId = carrierIdByName.get(pol.carrierName);
        if (!carrierId) continue; // no debería pasar: carrierName ya viene del catálogo
        const key = `${pol.carrierName}::${normalizeCarrierName(pol.planName)}::${pol.planYear}`;
        if (productIdByKey.has(key)) continue;
        const existing = await tx.product.findFirst({
          where: { carrierId, name: { equals: pol.planName, mode: "insensitive" }, policyType: "HEALTH", planYear: pol.planYear },
          select: { id: true },
        });
        if (existing) {
          productIdByKey.set(key, existing.id);
        } else {
          const created = await tx.product.create({
            data: { carrierId, name: pol.planName, policyType: "HEALTH", planYear: pol.planYear },
            select: { id: true },
          });
          productIdByKey.set(key, created.id);
          result.productsCreated++;
        }
      }

      // --- 3) Personas (crear o reutilizar por matchKey) ---
      const personIdByKey = new Map<string, string>();
      for (const p of plan.persons) {
        if (p.outcome === "MATCHED_EXISTING" && p.existingPersonId) {
          personIdByKey.set(p.matchKey, p.existingPersonId);
          result.personsMatched++;
          continue;
        }
        const created = await tx.person.create({
          data: {
            firstName: p.data.firstName,
            lastName: p.data.lastName,
            dateOfBirth: p.data.dateOfBirth,
            sex: p.data.sex,
            email: p.data.email,
            phone: p.data.phone,
            contactStatus: "PROSPECT", // Hallazgo #2 de Fase 022: nunca CLIENT directo, recomputePersonContactStatus decide después
          },
          select: { id: true },
        });
        personIdByKey.set(p.matchKey, created.id);
        result.personsCreated++;

        // --- Identidad sensible: cifrado inmediato, nunca texto plano en DB/logs ---
        if (p.sensitive.ssn || p.sensitive.uscisNumber || p.sensitive.immigrationCategory) {
          await tx.personSensitiveIdentity.create({
            data: {
              personId: created.id,
              immigrationCategory: p.sensitive.immigrationCategory ?? "UNKNOWN",
              ssnEncrypted: p.sensitive.ssn ? encryptPii(p.sensitive.ssn) : null,
              ssnLast4: p.sensitive.ssn ? last4(p.sensitive.ssn) : null,
              uscisNumberEncrypted: p.sensitive.uscisNumber ? encryptPii(p.sensitive.uscisNumber) : null,
              uscisNumberLast4: p.sensitive.uscisNumber ? last4(p.sensitive.uscisNumber) : null,
            },
          });
          if (p.sensitive.ssn) result.sensitiveIdentitiesImported++;
          if (p.sensitive.uscisNumber) result.uscisImported++;
        }
        // Documento migratorio: SOLO si el mapping trae un documentType Y
        // el source realmente incluye un número de documento — Hallazgo
        // §31 de la ficha: nunca crear PermanentResidentCard/EAD sin
        // documentNumber real. Este book NO trae número de documento
        // físico (solo USCIS#), así que en la práctica esto nunca se
        // ejecuta para este import — se deja implementado por si un
        // futuro import sí lo trae, sin violar el Hallazgo #1 de UAT de
        // esta misma fase (documentNumber ahora es obligatorio a nivel
        // de schema para creación vía UI/servicio).
      }

      // --- 4) Households + miembros ---
      const householdIdByHolderKey = new Map<string, string>();
      for (const h of plan.households) {
        const holderId = personIdByKey.get(h.holderMatchKey);
        if (!holderId) continue;
        const existingMembership = await tx.householdMember.findFirst({
          where: { personId: holderId, role: "HEAD" },
          select: { householdId: true },
        });
        let householdId: string;
        if (existingMembership) {
          householdId = existingMembership.householdId;
        } else {
          const created = await tx.household.create({
            data: {
              addressLine1: h.addressLine1,
              county: h.county,
              state: h.state,
              annualHouseholdIncome: amount(h.annualHouseholdIncome),
              incomeYear: h.incomeYear,
            },
            select: { id: true },
          });
          householdId = created.id;
          result.householdsCreated++;
        }
        householdIdByHolderKey.set(h.holderMatchKey, householdId);

        for (const member of h.members) {
          const memberPersonId = personIdByKey.get(member.matchKey);
          if (!memberPersonId) continue;
          const exists = await tx.householdMember.findUnique({
            where: { personId_householdId: { personId: memberPersonId, householdId } },
            select: { id: true },
          });
          if (!exists) {
            await tx.householdMember.create({ data: { personId: memberPersonId, householdId, role: member.role } });
          }
        }
      }

      // --- 5) Pólizas, en orden cronológico por titular (para que la
      //     cadena de renovación y el chequeo de solapamiento tengan
      //     sentido) ---
      const policiesByHolder = new Map<string, PolicyPlanEntry[]>();
      for (const p of plan.policies) {
        const list = policiesByHolder.get(p.holderMatchKey) ?? [];
        list.push(p);
        policiesByHolder.set(p.holderMatchKey, list);
      }

      const policyDbIdBySourceIndex = new Map<string, string>();

      for (const [holderKey, list] of policiesByHolder) {
        const holderId = personIdByKey.get(holderKey);
        if (!holderId) continue;
        const householdId = householdIdByHolderKey.get(holderKey) ?? null;
        const sorted = [...list].sort(comparePolicyChronology);

        for (const pol of sorted) {
          const productId = productIdByKey.get(`${pol.carrierName}::${normalizeCarrierName(pol.planName)}::${pol.planYear}`);
          if (!productId) continue;

          const previousPolicyId = pol.previousPolicySourceIndex
            ? policyDbIdBySourceIndex.get(pol.previousPolicySourceIndex) ?? undefined
            : undefined;

          // Fecha de próximo pago: nunca se infiere desde effectiveDate
          // (§38 de la ficha) — este book no la trae de forma confiable,
          // se deja null. assertNextPaymentNotBeforeEffective se llama
          // de todas formas por coherencia con el resto de la app,
          // aunque con null es un no-op.
          assertNextPaymentNotBeforeEffective(pol.effectiveDate, null);

          // Validación de solapamiento de salud (Hallazgo #6B, Fase
          // 022) — SOLO si esta póliza quedará ACTIVE. Se excluye la
          // póliza anterior de la cadena de renovación (mismo criterio
          // que renewPolicy en policies.service.ts): una renovación NO
          // es una cobertura simultánea nueva, es continuidad.
          if (pol.status === "ACTIVE") {
            const membersToCheck = [
              ...(pol.holderCovered ? [holderId] : []),
              ...pol.coveredMembers.map((m) => personIdByKey.get(m.matchKey)).filter((x): x is string => !!x),
            ];
            let blocked = false;
            for (const personId of membersToCheck) {
              try {
                await assertNoOverlappingHealthCoverage(tx, personId, pol.effectiveDate, pol.terminationDate, previousPolicyId);
              } catch (error) {
                blocked = true;
                result.overlapBlocked.push({
                  sourceIndex: pol.sourceIndex,
                  reason: error instanceof Error ? error.message : "Solapamiento de cobertura de salud.",
                });
                break;
              }
            }
            if (blocked) {
              result.policiesSkippedOverlap++;
              continue; // nunca se crea esta póliza — se reporta y se sigue con las demás
            }
          }

          const created = await tx.policy.create({
            data: {
              holderId,
              householdId,
              productId,
              status: pol.status,
              effectiveDate: pol.effectiveDate,
              terminationDate: pol.terminationDate,
              previousPolicyId,
              premiumAmount: amount(pol.premiumAmount),
              paymentManagementMode: pol.paymentManagementMode,
              // Espejo derivado (nunca fuente de escritura nueva) —
              // mismo criterio que policies.service.ts, duplicado aquí
              // porque ese módulo es "server-only" y este archivo corre
              // también vía tsx (ver docs/DECISIONS.md, Fase 023).
              autopay: pol.paymentManagementMode === "AUTOPAY",
              needsPaymentAssistance: pol.paymentManagementMode === "ASSISTED",
              operationType: pol.operationType,
              healthCoverageSource: pol.healthCoverageSource,
            },
            select: { id: true },
          });
          policyDbIdBySourceIndex.set(pol.sourceIndex, created.id);
          result.policiesCreated++;

          await tx.policyExternalReference.create({
            data: {
              policyId: created.id,
              source: "book_of_business_import",
              type: "source_index",
              externalId: pol.sourceIndex,
            },
          });

          if (pol.holderCovered) {
            await tx.policyMember.create({ data: { policyId: created.id, personId: holderId, role: "PRIMARY" } });
            result.policyMembersCreated++;
          }
          for (const member of pol.coveredMembers) {
            const memberPersonId = personIdByKey.get(member.matchKey);
            if (!memberPersonId) continue;
            await tx.policyMember.create({ data: { policyId: created.id, personId: memberPersonId, role: member.role } });
            result.policyMembersCreated++;
          }

          const hasHealthData =
            pol.marketplaceState || pol.deductible !== null || pol.outOfPocketMax !== null || pol.incomeUsed !== null || pol.taxCredit !== null;
          if (hasHealthData) {
            await tx.healthPolicyDetail.create({
              data: {
                policyId: created.id,
                marketplaceState: pol.marketplaceState,
                planNameSnapshot: pol.planName,
                deductibleIndividual: amount(pol.deductible),
                outOfPocketIndividual: amount(pol.outOfPocketMax),
                incomeUsed: amount(pol.incomeUsed),
                taxCreditAmount: amount(pol.taxCredit),
              },
            });
          }

          if (pol.note) {
            await tx.note.create({ data: { policyId: created.id, personId: holderId, content: pol.note } });
            result.notesImported++;
          }
        }
      }

      // --- 6) Recompute de ContactStatus real (nunca importado a mano) ---
      for (const personId of new Set(personIdByKey.values())) {
        await recomputePersonContactStatus(tx, personId);
      }

      return result;
    },
    { timeout: 60_000 }
  );
}
