import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson, recomputePersonContactStatus } from "@/services/people.service";
import { personIdSchema } from "@/schemas/person.schema";
import { householdIdSchema } from "@/schemas/household.schema";
import {
  policyIdSchema,
  createPolicySchema,
  updatePolicySchema,
  listPoliciesQuerySchema,
  listActiveProductsQuerySchema,
  policyMemberIdSchema,
  addPolicyMemberSchema,
  renewPolicySchema,
  cancelPolicySchema,
  policyTypeSchema,
} from "@/schemas/policy.schema";
import { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent, buildDiff } from "@/services/audit.service";
import { getTodayBusinessRange } from "@/lib/business-time";

const POLICY_AUDIT_FIELDS = [
  "policyNumber",
  "status",
  "effectiveDate",
  "terminationDate",
  "premiumAmount",
  "billingFrequency",
  "nextPaymentDueDate",
  "paymentManagementMode",
  "autopay",
  "needsPaymentAssistance",
  "paymentStatus",
  "operationType",
  "healthCoverageSource",
  "productId",
] as const;

// Fase 025 (Hallazgo #3 de UAT): paymentManagementMode es la única
// fuente de escritura; autopay/needsPaymentAssistance se conservan como
// espejo DERIVADO (nunca se leen para decidir lógica nueva) para que el
// código existente que aún filtra por esos booleanos (Dashboard,
// Primas, Reportes, CSV) siga funcionando sin reescribirse — ver
// docs/DECISIONS.md.
function deriveLegacyPaymentFlags(mode: "AUTOPAY" | "ASSISTED" | "CLIENT_MANAGED") {
  return {
    autopay: mode === "AUTOPAY",
    needsPaymentAssistance: mode === "ASSISTED",
  };
}

// Fase 025 (Hallazgo #4 de UAT, Parte D): CANCELLED/EXPIRED son estados
// puramente históricos — nunca se puede confiar solo en ocultar
// Editar/Cancelar en la UI, se rechaza también aquí server-side.
function assertPolicyIsMutable(status: string) {
  if (status === "CANCELLED" || status === "EXPIRED") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Esta póliza está cancelada o expirada y es de solo lectura — no puede editarse ni volver a cancelarse."
    );
  }
}

// ---------------------------------------------------------------------------
// Política de acceso — Policy (V1)
//
// Ver (listPolicies / getPolicyById / getPoliciesForPerson):
//   ADMIN, ASSISTANT: cualquier póliza.
//   AGENT: solo pólizas donde tiene acceso operativo (sin asignar o
//          asignado a sí mismo) al titular O a al menos un miembro
//          cubierto — misma idea que canAccessHousehold en Fase 010,
//          aplicada a "titular + miembros" en vez de "miembros del hogar".
//
// Crear: misma regla, evaluada sobre el titular elegido (todavía no hay
//        miembros cubiertos antes de crear la póliza).
// Editar: misma regla, evaluada sobre el titular + miembros ya existentes.
//
// ASSISTANT puede administrar información administrativa de la póliza
// sin la restricción de asignación de AGENT (igual que en Household,
// Fase 010) — acceso financiero/salud más fino queda para una fase
// posterior, no existe distinción todavía.
// ---------------------------------------------------------------------------

const personSummarySelect = {
  id: true,
  firstName: true,
  lastName: true,
  assignedAgentId: true,
} satisfies Prisma.PersonSelect;

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  person: { select: personSummarySelect },
} satisfies Prisma.PolicyMemberSelect;

const productSelect = {
  id: true,
  name: true,
  policyType: true,
  planYear: true,
  isActive: true,
  carrier: { select: { id: true, name: true, isActive: true } },
} satisfies Prisma.ProductSelect;

// Listado/detalle de Policy: nunca incluye HealthPolicyDetail (datos de
// salud), ni PersonProvider/PersonMedication, ni comisiones — esta fase
// es únicamente el núcleo Policy + PolicyMember.
const policySelect = {
  id: true,
  householdId: true,
  policyNumber: true,
  status: true,
  effectiveDate: true,
  terminationDate: true,
  premiumAmount: true,
  billingFrequency: true,
  nextPaymentDueDate: true,
  paymentManagementMode: true,
  autopay: true,
  needsPaymentAssistance: true,
  paymentStatus: true,
  operationType: true,
  businessSource: true,
  healthCoverageSource: true,
  createdAt: true,
  updatedAt: true,
  holder: { select: personSummarySelect },
  product: { select: productSelect },
  processedBy: { select: { id: true, name: true } },
  members: { select: memberSelect, orderBy: { createdAt: "asc" } },
} satisfies Prisma.PolicySelect;

export type PolicyAccessPersons = { assignedAgentId: string | null }[];

export function canAccessPolicy(actor: AuthorizedUser, involved: PolicyAccessPersons): boolean {
  if (actor.role === "ADMIN" || actor.role === "ASSISTANT") return true;
  if (actor.role === "AGENT") {
    return involved.some((p) => p.assignedAgentId === null || p.assignedAgentId === actor.id);
  }
  return false;
}

// Exportada para que health-policies.service.ts reutilice exactamente la
// misma política de acceso a Policy — un HealthPolicyDetail es una
// extensión de su Policy, nunca tiene una regla de acceso propia.
export function assertCanAccessPolicy(actor: AuthorizedUser, involved: PolicyAccessPersons): void {
  if (!canAccessPolicy(actor, involved)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta póliza.");
  }
}

// Exportada para que search.service.ts (Fase 019.9) reutilice
// exactamente la misma regla de scoping — nunca reimplementarla.
export function policyAgentAccessWhere(actor: AuthorizedUser): Prisma.PolicyWhereInput | null {
  if (actor.role === "ADMIN" || actor.role === "ASSISTANT") return null;
  return {
    OR: [
      { holder: { assignedAgentId: null } },
      { holder: { assignedAgentId: actor.id } },
      { members: { some: { person: { assignedAgentId: null } } } },
      { members: { some: { person: { assignedAgentId: actor.id } } } },
    ],
  };
}

// Reevalúa status/effectiveDate ya combinados (existente + lo que se está
// actualizando) — regla de aplicación, no de DB (Policy.effectiveDate es
// nullable a nivel de schema).
function assertActiveHasEffectiveDate(status: string, effectiveDate: Date | null): void {
  if (status === "ACTIVE" && !effectiveDate) {
    throw new AppError(
      "VALIDATION_ERROR",
      "effectiveDate: La fecha efectiva es requerida cuando el estado es Activa."
    );
  }
}

// Fase 019.5: se detectó en prueba funcional que se podía guardar
// terminationDate anterior a effectiveDate — nunca validado
// server-side (solo el navegador, que es trivial de saltarse). Ambas
// son @db.Date (fecha pura) — comparar los Date de JS directamente es
// seguro aquí porque Prisma las entrega ancladas a medianoche UTC del
// mismo día calendario para ambos campos, así que la comparación de
// instantes coincide con la comparación de días.
function assertTerminationNotBeforeEffective(
  effectiveDate: Date | null,
  terminationDate: Date | null
): void {
  if (effectiveDate && terminationDate && terminationDate < effectiveDate) {
    throw new AppError(
      "VALIDATION_ERROR",
      "terminationDate: La fecha de finalización no puede ser anterior a la fecha de inicio."
    );
  }
}

// Fase 022 (Hallazgo #6A de UAT): mismo principio que
// assertTerminationNotBeforeEffective, para el próximo pago — un caso
// real encontrado en UAT tenía effectiveDate 10/01/2026 con
// nextPaymentDueDate 10/01/2025 (un año ANTES de que la póliza
// siquiera empezara), nunca validado. Exportada para reutilizarse
// desde premiums.service.ts (Editar seguimiento de pago), que no
// vuelve a tocar effectiveDate pero sí necesita validar contra el ya
// existente.
export function assertNextPaymentNotBeforeEffective(
  effectiveDate: Date | null,
  nextPaymentDueDate: Date | null
): void {
  if (effectiveDate && nextPaymentDueDate && nextPaymentDueDate < effectiveDate) {
    throw new AppError(
      "VALIDATION_ERROR",
      "nextPaymentDueDate: El próximo pago no puede ser anterior a la fecha efectiva de la póliza."
    );
  }
}

// Fase 022 (Hallazgo #6B de UAT): una PERSONA (nunca "el hogar") no
// puede estar cubierta por dos pólizas de SALUD activas/operativas al
// mismo tiempo con fechas solapadas. Otros miembros del mismo hogar
// pueden tener su propia póliza de salud sin problema — la unidad real
// es la persona cubierta, no el hogar completo.
//
// Solo se comparan pólizas HEALTH con status ACTIVE ("operativas") —
// nunca CANCELLED/EXPIRED (historial, no cobertura simultánea real) ni
// PENDING (todavía no está en vigor). Dos períodos se solapan si
// start1 <= (end2 ?? infinito) AND start2 <= (end1 ?? infinito) —
// terminationDate null significa cobertura todavía abierta/vigente.
const OPEN_ENDED = new Date(8640000000000000); // Date máximo representable en JS

async function assertNoOverlappingHealthCoverage(
  db: typeof prisma | Prisma.TransactionClient,
  personId: string,
  effectiveDate: Date,
  terminationDate: Date | null,
  excludePolicyId?: string
): Promise<void> {
  const candidates = await db.policyMember.findMany({
    where: {
      personId,
      ...(excludePolicyId ? { policyId: { not: excludePolicyId } } : {}),
      policy: { status: "ACTIVE", product: { policyType: "HEALTH" } },
    },
    select: {
      policy: { select: { policyNumber: true, effectiveDate: true, terminationDate: true } },
    },
  });

  const newEnd = terminationDate ?? OPEN_ENDED;
  for (const candidate of candidates) {
    // status ACTIVE garantiza effectiveDate no-nulo (assertActiveHasEffectiveDate).
    const otherStart = candidate.policy.effectiveDate!;
    const otherEnd = candidate.policy.terminationDate ?? OPEN_ENDED;
    const overlaps = effectiveDate <= otherEnd && otherStart <= newEnd;
    if (overlaps) {
      throw new AppError(
        "VALIDATION_ERROR",
        `Esta persona ya tiene una póliza de salud (${candidate.policy.policyNumber ?? "sin número"}) que se solapa con las fechas seleccionadas.`
      );
    }
  }
}

async function assertActiveProduct(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, isActive: true, policyType: true, carrier: { select: { isActive: true } } },
  });
  if (!product) throw new AppError("NOT_FOUND", "Producto no encontrado.");
  if (!product.isActive) {
    throw new AppError("VALIDATION_ERROR", "productId: Este producto no está activo.");
  }
  // Un Product activo bajo un Carrier inactivo tampoco es elegible para
  // una Policy nueva (ver docs/DECISIONS.md, Fase 012) — desactivar una
  // compañía debe volver ineligibles todos sus productos sin tener que
  // desactivarlos uno por uno.
  if (!product.carrier.isActive) {
    throw new AppError(
      "VALIDATION_ERROR",
      "productId: La compañía de este producto está inactiva."
    );
  }
  return product;
}

// AGENT/ASSISTANT: siempre quedan como procesadores de sí mismos: no hay
// vía para que uno le "asigne" el procesamiento a otro usuario. Solo
// ADMIN puede elegir explícitamente a otro usuario (mismo patrón que
// resolveAssignedAgentIdForCreate en people.service.ts). Se restringe a
// usuarios AGENT activos — el mismo universo ya expuesto por
// listActiveAgents, evita una segunda superficie de listado de usuarios.
async function resolveProcessedByIdForCreate(
  actor: AuthorizedUser,
  requested: string | undefined
): Promise<string> {
  if (actor.role !== "ADMIN") return actor.id;
  if (!requested) return actor.id;
  const agent = await prisma.user.findUnique({
    where: { id: requested },
    select: { id: true, role: true, isActive: true },
  });
  if (!agent || !agent.isActive || (agent.role !== "AGENT" && agent.role !== "ADMIN")) {
    throw new AppError(
      "VALIDATION_ERROR",
      "processedById: Selecciona un usuario activo válido."
    );
  }
  return agent.id;
}

async function resolveProcessedByIdForUpdate(
  actor: AuthorizedUser,
  requested: string | undefined
): Promise<string | undefined> {
  if (requested === undefined) return undefined;
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo ADMIN puede reasignar quién procesó la póliza.");
  }
  const agent = await prisma.user.findUnique({
    where: { id: requested },
    select: { id: true, role: true, isActive: true },
  });
  if (!agent || !agent.isActive || (agent.role !== "AGENT" && agent.role !== "ADMIN")) {
    throw new AppError(
      "VALIDATION_ERROR",
      "processedById: Selecciona un usuario activo válido."
    );
  }
  return agent.id;
}

export async function listActiveCarriers(actor: AuthorizedUser) {
  void actor; // lectura de catálogo: cualquier usuario activo.
  return prisma.carrier.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Hallazgo #5 de UAT (Fase 024): Carrier es genérico (una compañía
// puede vender HEALTH, DENTAL, SUPPLEMENTAL, etc. bajo distintos
// Product) — Carrier NUNCA tiene su propio policyType. Qué carriers
// aparecen disponibles para un tipo de póliza se DERIVA siempre de sus
// Product activos de ese tipo, nunca de un campo propio en Carrier.
// Usado por el combo "Compañía" al crear una póliza: si el usuario ya
// eligió Tipo de seguro, este combo debe mostrar SOLO carriers que
// realmente puedan venderlo hoy.
export async function listCarriersForPolicyType(actor: AuthorizedUser, rawPolicyType: unknown) {
  void actor;
  const policyType = parseOrThrow(policyTypeSchema, rawPolicyType);
  return prisma.carrier.findMany({
    where: { isActive: true, products: { some: { isActive: true, policyType } } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

export async function listActiveProducts(actor: AuthorizedUser, rawQuery: unknown) {
  void actor;
  const { policyType, carrierId } = parseOrThrow(listActiveProductsQuerySchema, rawQuery);
  return prisma.product.findMany({
    where: {
      isActive: true,
      carrier: { isActive: true },
      ...(policyType ? { policyType } : {}),
      ...(carrierId ? { carrierId } : {}),
    },
    select: productSelect,
    orderBy: [{ carrier: { name: "asc" } }, { name: "asc" }],
  });
}

export async function listPolicies(actor: AuthorizedUser, rawQuery: unknown) {
  const { page, pageSize, search, status, policyType, carrierId, healthSource, agentId } = parseOrThrow(
    listPoliciesQuerySchema,
    rawQuery
  );

  const where: Prisma.PolicyWhereInput = {
    ...(status ? { status } : {}),
    ...(policyType ? { product: { policyType } } : {}),
    ...(carrierId ? { product: { carrierId } } : {}),
    ...(healthSource ? { healthCoverageSource: healthSource } : {}),
    ...(agentId ? { holder: { assignedAgentId: agentId } } : {}),
    ...(search
      ? {
          OR: [
            { policyNumber: { contains: search, mode: "insensitive" } },
            { holder: { firstName: { contains: search, mode: "insensitive" } } },
            { holder: { lastName: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const agentWhere = policyAgentAccessWhere(actor);
  const finalWhere: Prisma.PolicyWhereInput = agentWhere
    ? { AND: [where, agentWhere] }
    : where;

  // Promise.all, no prisma.$transaction([...]) — ver docs/DECISIONS.md
  // ("Advertencia de concurrencia pg", Fase 019.6).
  const [items, total] = await Promise.all([
    prisma.policy.findMany({
      where: finalWhere,
      select: policySelect,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.policy.count({ where: finalWhere }),
  ]);

  return { items, total, page, pageSize };
}

// "Vencen en 30 días" — Fase 019.9 (§28-§29). Solo pólizas todavía
// vigentes (ACTIVE/PENDING) con terminationDate dentro de la ventana —
// CANCELLED/EXPIRED nunca son "próximas a vencer", ya no son
// candidatas reales de renovación. Ventana en días de calendario
// (terminationDate es @db.Date, sin componente de hora), calculada
// sobre "hoy" de negocio (APP_TIME_ZONE) — mismo principio que el resto
// del Dashboard.
export async function listExpiringPolicies(actor: AuthorizedUser, windowDays = 30) {
  const { year, month, day } = getTodayBusinessRange();
  const todayUTC = new Date(Date.UTC(year, month - 1, day));
  const windowEnd = new Date(Date.UTC(year, month - 1, day + windowDays));

  const where: Prisma.PolicyWhereInput = {
    status: { in: ["ACTIVE", "PENDING"] },
    terminationDate: { gte: todayUTC, lte: windowEnd },
  };
  const agentWhere = policyAgentAccessWhere(actor);
  const finalWhere: Prisma.PolicyWhereInput = agentWhere ? { AND: [where, agentWhere] } : where;

  return prisma.policy.findMany({
    where: finalWhere,
    select: policySelect,
    orderBy: { terminationDate: "asc" },
    take: 20,
  });
}

export async function getPolicyById(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(policyIdSchema, rawId);
  const policy = await prisma.policy.findUnique({ where: { id }, select: policySelect });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");

  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);
  return policy;
}

// Pólizas donde la Person es titular O miembro cubierto — sin duplicar
// si cumple ambas condiciones a la vez (una Policy = una fila; el OR de
// Prisma no produce filas repetidas por coincidir en varias cláusulas).
export async function getPoliciesForPerson(actor: AuthorizedUser, rawPersonId: unknown) {
  const id = parseOrThrow(personIdSchema, rawPersonId);

  const person = await prisma.person.findUnique({ where: { id }, select: { id: true } });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  const where: Prisma.PolicyWhereInput = {
    OR: [{ holderId: id }, { members: { some: { personId: id } } }],
  };
  const agentWhere = policyAgentAccessWhere(actor);
  const finalWhere: Prisma.PolicyWhereInput = agentWhere ? { AND: [where, agentWhere] } : where;

  return prisma.policy.findMany({
    where: finalWhere,
    select: policySelect,
    orderBy: { createdAt: "desc" },
  });
}

// Crea Policy + PolicyMember(s) de forma atómica. Si holderCovered es
// true, el titular se agrega como PolicyMember con role=PRIMARY — nunca
// se asume esto automáticamente si holderCovered no viene explícito.
// Nunca confía en policyType/carrier enviados por el navegador: siempre
// se derivan de Product en el servidor.
export async function createPolicy(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createPolicySchema, rawInput);

  const holder = await prisma.person.findUnique({
    where: { id: input.holderId },
    select: { id: true, assignedAgentId: true },
  });
  if (!holder) throw new AppError("NOT_FOUND", "Titular no encontrado.");
  if (!canEditPerson(actor, holder)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }

  // Hallazgo #12 de UAT (Fase 019.7): la póliza necesita quedar
  // vinculada al Household del titular para poder ofrecer después
  // "miembros elegibles" al agregar cobertura (getEligibleHouseholdMembersForPolicy).
  // Solo se asigna cuando es inequívoco (el titular pertenece a
  // exactamente un hogar) — nunca se adivina cuál household usar si
  // pertenece a varios o a ninguno; esta era una omisión real (Policy.
  // householdId nunca se poblaba desde este flujo, solo desde el
  // importador legacy).
  const holderHouseholds = await prisma.householdMember.findMany({
    where: { personId: input.holderId },
    select: { householdId: true },
    distinct: ["householdId"],
  });
  const householdId = holderHouseholds.length === 1 ? holderHouseholds[0].householdId : null;

  const product = await assertActiveProduct(input.productId);
  assertActiveHasEffectiveDate(input.status, input.effectiveDate ?? null);
  assertTerminationNotBeforeEffective(input.effectiveDate ?? null, input.terminationDate ?? null);
  assertNextPaymentNotBeforeEffective(input.effectiveDate ?? null, input.nextPaymentDueDate ?? null);

  // Ningún covered member puede declarar role=PRIMARY: ese rol está
  // reservado exclusivamente para el titular cuando holderCovered=true
  // (ver docs/DECISIONS.md) — el schema de Zod ya excluye "PRIMARY" del
  // enum de coveredMembers, esto es defensa en profundidad.
  const personIds = input.coveredMembers.map((m) => m.personId);
  const uniquePersonIds = new Set(personIds);
  if (uniquePersonIds.size !== personIds.length) {
    throw new AppError("VALIDATION_ERROR", "coveredMembers: Hay una persona duplicada en la cobertura.");
  }
  if (input.holderCovered && uniquePersonIds.has(input.holderId)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "coveredMembers: El titular ya se cubre automáticamente como PRIMARY, no lo agregues también como miembro."
    );
  }

  const processedById = await resolveProcessedByIdForCreate(actor, input.processedById);

  const membersToCreate: { personId: string; role: "PRIMARY" | "SPOUSE" | "DEPENDENT" | "OTHER" }[] = [
    ...(input.holderCovered ? [{ personId: input.holderId, role: "PRIMARY" as const }] : []),
    ...input.coveredMembers,
  ];

  // Hallazgo #6B de UAT (Fase 022): solo relevante para pólizas de
  // Salud ya operativas (ACTIVE) — una PENDING/CANCELLED/EXPIRED nunca
  // representa cobertura simultánea real.
  if (product.policyType === "HEALTH" && input.status === "ACTIVE") {
    for (const member of membersToCreate) {
      await assertNoOverlappingHealthCoverage(
        prisma,
        member.personId,
        input.effectiveDate!,
        input.terminationDate ?? null
      );
    }
  }

  let policyId: string;
  try {
    policyId = await prisma.$transaction(async (tx) => {
      const created = await tx.policy.create({
        data: {
          holderId: input.holderId,
          householdId,
          productId: input.productId,
          policyNumber: input.policyNumber,
          status: input.status,
          effectiveDate: input.effectiveDate,
          terminationDate: input.terminationDate,
          premiumAmount: input.premiumAmount,
          billingFrequency: input.billingFrequency,
          nextPaymentDueDate: input.nextPaymentDueDate,
          paymentManagementMode: input.paymentManagementMode,
          ...deriveLegacyPaymentFlags(input.paymentManagementMode),
          paymentStatus: input.paymentStatus,
          operationType: input.operationType,
          processedById,
          // Solo tiene efecto real en pólizas HEALTH — para el resto se
          // ignora silenciosamente aunque venga en el input (regla de
          // aplicación, ver docs/DECISIONS.md).
          healthCoverageSource: product.policyType === "HEALTH" ? input.healthCoverageSource : null,
        },
      });
      for (const member of membersToCreate) {
        await tx.policyMember.create({
          data: { policyId: created.id, personId: member.personId, role: member.role },
        });
      }
      await recordAuditEvent(tx, {
        actor,
        entityType: "Policy",
        entityId: created.id,
        action: "POLICY_CREATE",
        policyId: created.id,
        householdId,
        contactPersonId: input.holderId,
        summary: `Póliza ${product.policyType} creada`,
      });
      // Hallazgo #2 de UAT (Fase 022): recomputar Prospecto/Cliente de
      // cada persona recién cubierta — nunca solo del titular, todos los
      // miembros cubiertos entran a la misma regla.
      for (const member of membersToCreate) {
        await recomputePersonContactStatus(tx, member.personId, actor);
      }
      return created.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        // FK inválida (personId de un covered member que no existe) —
        // la transacción completa se revierte, no queda Policy huérfana.
        throw new AppError("NOT_FOUND", "Una de las personas a cubrir no existe.");
      }
      if (error.code === "P2002") {
        throw new AppError("CONFLICT", "Hay una persona duplicada en la cobertura.");
      }
    }
    throw error;
  }

  return getPolicyById(actor, policyId);
}

// ---------------------------------------------------------------------------
// Renovación de póliza — Fase 019.9 (§3-§4). Crea una Policy NUEVA
// encadenada vía previousPolicyId, nunca modifica destructivamente la
// anterior. holder/household se heredan siempre (mismo titular/hogar);
// producto/billing/autopay/asistencia/agente se ofrecen como default en
// la UI pero el usuario los confirma/edita en el mismo formulario de
// creación (ver policy-form.tsx). policyNumber/effectiveDate/
// terminationDate/documentos/comisiones/pagos NUNCA se copian — el
// UNIQUE(previousPolicyId) en DB impide renovar la misma póliza dos
// veces (P2002 -> CONFLICT).
// ---------------------------------------------------------------------------

export async function renewPolicy(actor: AuthorizedUser, rawOldPolicyId: unknown, rawInput: unknown) {
  const oldPolicyId = parseOrThrow(policyIdSchema, rawOldPolicyId);
  const input = parseOrThrow(renewPolicySchema, rawInput);

  const oldPolicy = await prisma.policy.findUnique({
    where: { id: oldPolicyId },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      status: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!oldPolicy) throw new AppError("NOT_FOUND", "Póliza anterior no encontrada.");
  assertCanAccessPolicy(actor, [oldPolicy.holder, ...oldPolicy.members.map((m) => m.person)]);

  // Hallazgo #2 de UAT (Fase 024): una póliza CANCELLED nunca se
  // renueva — no representa cobertura vigente que continúa, es un
  // hecho cerrado. Si el cliente vuelve a contratar, el flujo correcto
  // es crear una póliza nueva (createPolicy) con su propio
  // operationType, nunca "renovar" una cancelada. Rechazado también
  // server-side (no solo ocultando el botón) para que una llamada
  // directa a la action no pueda saltarse la regla.
  if (oldPolicy.status === "CANCELLED") {
    throw new AppError(
      "VALIDATION_ERROR",
      "Esta póliza está cancelada y no puede renovarse. Crea una póliza nueva si el cliente vuelve a contratar."
    );
  }

  const product = await assertActiveProduct(input.productId);
  assertActiveHasEffectiveDate(input.status, input.effectiveDate ?? null);
  assertTerminationNotBeforeEffective(input.effectiveDate ?? null, input.terminationDate ?? null);
  assertNextPaymentNotBeforeEffective(input.effectiveDate ?? null, input.nextPaymentDueDate ?? null);

  const personIds = input.coveredMembers.map((m) => m.personId);
  const uniquePersonIds = new Set(personIds);
  if (uniquePersonIds.size !== personIds.length) {
    throw new AppError("VALIDATION_ERROR", "coveredMembers: Hay una persona duplicada en la cobertura.");
  }
  if (input.holderCovered && uniquePersonIds.has(oldPolicy.holderId)) {
    throw new AppError(
      "VALIDATION_ERROR",
      "coveredMembers: El titular ya se cubre automáticamente como PRIMARY, no lo agregues también como miembro."
    );
  }

  const processedById = await resolveProcessedByIdForCreate(actor, input.processedById);
  const membersToCreate: { personId: string; role: "PRIMARY" | "SPOUSE" | "DEPENDENT" | "OTHER" }[] = [
    ...(input.holderCovered ? [{ personId: oldPolicy.holderId, role: "PRIMARY" as const }] : []),
    ...input.coveredMembers,
  ];

  // Hallazgo #6B de UAT (Fase 022) — excluye la póliza ANTERIOR del
  // chequeo: renovar es reemplazar esa cobertura, no sumar una
  // simultánea nueva, aunque la anterior siga ACTIVE por no haberse
  // cancelado todavía.
  if (product.policyType === "HEALTH" && input.status === "ACTIVE") {
    for (const member of membersToCreate) {
      await assertNoOverlappingHealthCoverage(
        prisma,
        member.personId,
        input.effectiveDate!,
        input.terminationDate ?? null,
        oldPolicyId
      );
    }
  }

  let newPolicyId: string;
  try {
    newPolicyId = await prisma.$transaction(async (tx) => {
      const created = await tx.policy.create({
        data: {
          holderId: oldPolicy.holderId,
          householdId: oldPolicy.householdId,
          productId: input.productId,
          policyNumber: input.policyNumber,
          status: input.status,
          effectiveDate: input.effectiveDate,
          terminationDate: input.terminationDate,
          previousPolicyId: oldPolicyId,
          premiumAmount: input.premiumAmount,
          billingFrequency: input.billingFrequency,
          nextPaymentDueDate: input.nextPaymentDueDate,
          paymentManagementMode: input.paymentManagementMode,
          ...deriveLegacyPaymentFlags(input.paymentManagementMode),
          paymentStatus: input.paymentStatus,
          operationType: input.operationType,
          processedById,
          healthCoverageSource: product.policyType === "HEALTH" ? input.healthCoverageSource : null,
        },
      });
      for (const member of membersToCreate) {
        await tx.policyMember.create({
          data: { policyId: created.id, personId: member.personId, role: member.role },
        });
      }
      await recordAuditEvent(tx, {
        actor,
        entityType: "Policy",
        entityId: created.id,
        action: "POLICY_RENEW",
        policyId: created.id,
        householdId: oldPolicy.householdId,
        contactPersonId: oldPolicy.holderId,
        summary: `Póliza renovada (a partir de la póliza anterior)`,
        metadata: { previousPolicyId: oldPolicyId },
      });
      // Hallazgo #2 de UAT (Fase 022).
      for (const member of membersToCreate) {
        await recomputePersonContactStatus(tx, member.personId, actor);
      }
      return created.id;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2003") {
        throw new AppError("NOT_FOUND", "Una de las personas a cubrir no existe.");
      }
      if (error.code === "P2002") {
        throw new AppError(
          "CONFLICT",
          "Esta póliza ya tiene una renovación registrada, o hay una persona duplicada en la cobertura."
        );
      }
    }
    throw error;
  }

  return getPolicyById(actor, newPolicyId);
}

export async function updatePolicy(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(policyIdSchema, rawId);
  const input = parseOrThrow(updatePolicySchema, rawInput);

  const existing = await prisma.policy.findUnique({
    where: { id },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      status: true,
      effectiveDate: true,
      terminationDate: true,
      productId: true,
      policyNumber: true,
      premiumAmount: true,
      billingFrequency: true,
      nextPaymentDueDate: true,
      paymentManagementMode: true,
      autopay: true,
      needsPaymentAssistance: true,
      paymentStatus: true,
      operationType: true,
      healthCoverageSource: true,
      product: { select: { policyType: true } },
      holder: { select: { assignedAgentId: true } },
      members: { select: { personId: true, person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [existing.holder, ...existing.members.map((m) => m.person)]);

  // Hallazgo #4 de UAT (Parte D): una póliza CANCELLED/EXPIRED es de
  // solo lectura — a diferencia de cancelPolicy, updatePolicy nunca
  // transiciona HACIA ese estado desde otro, así que aquí siempre se
  // rechaza de plano si ya está en uno de esos dos.
  assertPolicyIsMutable(existing.status);

  const data: Prisma.PolicyUncheckedUpdateInput = {};

  if (input.productId !== undefined && input.productId !== existing.productId) {
    if (existing.status !== "PENDING") {
      throw new AppError(
        "VALIDATION_ERROR",
        "productId: Solo se puede cambiar el producto mientras la póliza está Pendiente."
      );
    }
    await assertActiveProduct(input.productId);
    data.productId = input.productId;
  }

  if (input.policyNumber !== undefined) data.policyNumber = input.policyNumber;
  if (input.status !== undefined) data.status = input.status;
  if (input.effectiveDate !== undefined) data.effectiveDate = input.effectiveDate;
  if (input.terminationDate !== undefined) data.terminationDate = input.terminationDate;
  if (input.premiumAmount !== undefined) data.premiumAmount = input.premiumAmount;
  if (input.billingFrequency !== undefined) data.billingFrequency = input.billingFrequency;
  if (input.nextPaymentDueDate !== undefined) data.nextPaymentDueDate = input.nextPaymentDueDate;
  if (input.paymentManagementMode !== undefined) {
    data.paymentManagementMode = input.paymentManagementMode;
    Object.assign(data, deriveLegacyPaymentFlags(input.paymentManagementMode));
  }
  if (input.paymentStatus !== undefined) data.paymentStatus = input.paymentStatus;
  if (input.operationType !== undefined) data.operationType = input.operationType;
  if (input.healthCoverageSource !== undefined) {
    if (existing.product.policyType !== "HEALTH") {
      throw new AppError(
        "VALIDATION_ERROR",
        "healthCoverageSource: Solo aplica a pólizas de tipo Salud."
      );
    }
    data.healthCoverageSource = input.healthCoverageSource;
  }

  const resolvedProcessedById = await resolveProcessedByIdForUpdate(actor, input.processedById);
  if (resolvedProcessedById !== undefined) data.processedById = resolvedProcessedById;

  const finalStatus = (data.status as string | undefined) ?? existing.status;
  const finalEffectiveDate =
    input.effectiveDate !== undefined ? input.effectiveDate : existing.effectiveDate;
  const finalTerminationDate =
    input.terminationDate !== undefined ? input.terminationDate : existing.terminationDate;
  const finalNextPaymentDueDate =
    input.nextPaymentDueDate !== undefined ? input.nextPaymentDueDate : existing.nextPaymentDueDate;
  assertActiveHasEffectiveDate(finalStatus, finalEffectiveDate);
  assertTerminationNotBeforeEffective(finalEffectiveDate, finalTerminationDate);
  assertNextPaymentNotBeforeEffective(finalEffectiveDate, finalNextPaymentDueDate);

  // Hallazgo #6B de UAT (Fase 022): re-validar solapamiento cuando el
  // resultado final es una póliza de Salud ACTIVE — cubre tanto
  // activarla ahora como mover sus fechas mientras ya está activa.
  if (existing.product.policyType === "HEALTH" && finalStatus === "ACTIVE" && finalEffectiveDate) {
    for (const member of existing.members) {
      await assertNoOverlappingHealthCoverage(prisma, member.personId, finalEffectiveDate, finalTerminationDate, id);
    }
  }

  const changes = buildDiff(existing, { ...input, ...data }, POLICY_AUDIT_FIELDS);
  // CANCEL es el hecho más relevante cuando la póliza pasa a CANCELLED
  // en este mismo cambio — aunque también se hayan tocado otros campos.
  const action =
    input.status === "CANCELLED" && existing.status !== "CANCELLED"
      ? "POLICY_CANCEL"
      : input.status !== undefined && input.status !== existing.status
        ? "POLICY_STATUS_CHANGE"
        : "POLICY_UPDATE";

  const statusChanged = input.status !== undefined && input.status !== existing.status;

  await prisma.$transaction(async (tx) => {
    await tx.policy.update({ where: { id }, data });
    if (changes) {
      await recordAuditEvent(tx, {
        actor,
        entityType: "Policy",
        entityId: id,
        action,
        policyId: id,
        householdId: existing.householdId,
        contactPersonId: existing.holderId,
        summary: action === "POLICY_CANCEL" ? "Póliza cancelada" : "Póliza actualizada",
        changes,
      });
    }
    // Hallazgo #2 de UAT (Fase 022): activar/desactivar/cancelar/expirar
    // una póliza puede mover a Prospecto<->Cliente al titular y a cada
    // miembro cubierto — solo tiene sentido recomputar cuando el status
    // realmente cambió (otros campos editados no afectan esta regla).
    if (statusChanged) {
      await recomputePersonContactStatus(tx, existing.holderId, actor);
      for (const member of existing.members) {
        await recomputePersonContactStatus(tx, member.personId, actor);
      }
    }
  });
  return getPolicyById(actor, id);
}

// Cancelación guiada — Fase 020 (§4). Único cambio real: status ->
// CANCELLED + terminationDate. NUNCA borra la Policy ni toca members/
// documents/healthDetail/commissionExpectations/payments/notes — esas
// relaciones ya son independientes en el schema, no requieren ninguna
// acción explícita para "preservarse". `reason` (opcional) se guarda
// en AuditEvent.metadata, nunca en Note ni en una columna nueva de
// Policy — no existe un campo apropiado en el modelo actual y agregar
// uno solo para esto no se justificó (ver docs/DECISIONS.md).
export async function cancelPolicy(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(policyIdSchema, rawId);
  const input = parseOrThrow(cancelPolicySchema, rawInput);

  const existing = await prisma.policy.findUnique({
    where: { id },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      status: true,
      effectiveDate: true,
      terminationDate: true,
      holder: { select: { assignedAgentId: true } },
      members: { select: { personId: true, person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [existing.holder, ...existing.members.map((m) => m.person)]);

  if (existing.status === "CANCELLED") {
    throw new AppError("VALIDATION_ERROR", "Esta póliza ya está cancelada.");
  }
  // Hallazgo #4 de UAT (Parte D): EXPIRED es un hecho histórico cerrado,
  // igual que CANCELLED — no se puede "cancelar" algo que ya terminó.
  if (existing.status === "EXPIRED") {
    throw new AppError("VALIDATION_ERROR", "Esta póliza ya expiró y es de solo lectura.");
  }
  assertTerminationNotBeforeEffective(existing.effectiveDate, input.terminationDate);

  const changes = buildDiff(
    existing,
    { status: "CANCELLED", terminationDate: input.terminationDate },
    ["status", "terminationDate"]
  );

  await prisma.$transaction(async (tx) => {
    await tx.policy.update({
      where: { id },
      data: { status: "CANCELLED", terminationDate: input.terminationDate },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Policy",
      entityId: id,
      action: "POLICY_CANCEL",
      policyId: id,
      householdId: existing.householdId,
      contactPersonId: existing.holderId,
      summary: "Póliza cancelada",
      changes,
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
    // Hallazgo #2 de UAT (Fase 022): cancelar quita la cobertura activa
    // — recomputar titular y cada miembro cubierto.
    await recomputePersonContactStatus(tx, existing.holderId, actor);
    for (const member of existing.members) {
      await recomputePersonContactStatus(tx, member.personId, actor);
    }
  });

  return getPolicyById(actor, id);
}

// ---------------------------------------------------------------------------
// Gestión de PolicyMember tras la creación — Fase 019.7 (hallazgo #12)
//
// HouseholdMember y PolicyMember siguen siendo conceptos separados: que
// alguien esté en el Household de la póliza NO lo cubre automáticamente
// (nunca auto-enroll) — el usuario decide explícitamente a qué póliza
// pertenece cada quien, ver docs/DECISIONS.md.
// ---------------------------------------------------------------------------

async function loadPolicyForMemberManagement(policyId: string) {
  const policy = await prisma.policy.findUnique({
    where: { id: policyId },
    select: {
      id: true,
      holderId: true,
      householdId: true,
      status: true,
      effectiveDate: true,
      terminationDate: true,
      product: { select: { policyType: true } },
      holder: { select: { assignedAgentId: true } },
      members: { select: { person: { select: { assignedAgentId: true } } } },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  return policy;
}

// Miembros cubiertos de la póliza + su filiación familiar real
// (HouseholdMember.role) cuando la póliza tiene household asociado —
// hallazgo #13 de UAT: la UI no debe volver a preguntar/inventar la
// relación familiar ("Otro" por defecto) cuando ya la conocemos vía el
// hogar. Nunca se mezcla con PolicyMemberRole (rol de cobertura) — son
// dos conceptos distintos mostrados juntos, no uno sustituyendo al otro.
export async function getPolicyMembersDetailed(actor: AuthorizedUser, rawPolicyId: unknown) {
  const id = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await prisma.policy.findUnique({
    where: { id },
    select: {
      householdId: true,
      holder: { select: { assignedAgentId: true } },
      members: {
        select: { id: true, role: true, createdAt: true, person: { select: personSummarySelect } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  const householdRoleByPersonId = new Map<string, string>();
  if (policy.householdId) {
    const householdMembers = await prisma.householdMember.findMany({
      where: { householdId: policy.householdId },
      select: { personId: true, role: true },
    });
    for (const hm of householdMembers) householdRoleByPersonId.set(hm.personId, hm.role);
  }

  return policy.members.map((m) => ({
    id: m.id,
    role: m.role,
    person: m.person,
    householdRole: householdRoleByPersonId.get(m.person.id) ?? null,
  }));
}

// Personas del Household de la póliza que todavía NO son PolicyMember —
// candidatos para "Agregar miembro". Si la póliza no tiene household
// asociado, no hay candidatos (nunca se ofrece una búsqueda global de
// personas aquí — mismo principio de simplicidad de Fase 011).
export async function getEligibleHouseholdMembersForPolicy(actor: AuthorizedUser, rawPolicyId: unknown) {
  const id = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await loadPolicyForMemberManagement(id);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  if (!policy.householdId) return [];

  const [householdMembers, existingPolicyMembers] = await Promise.all([
    prisma.householdMember.findMany({
      where: { householdId: policy.householdId },
      select: { role: true, person: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.policyMember.findMany({ where: { policyId: id }, select: { personId: true } }),
  ]);

  const alreadyCovered = new Set(existingPolicyMembers.map((m) => m.personId));
  // Fase 022 (Hallazgo #3 de UAT): el titular NUNCA debe aparecer como
  // candidato para "+ Agregar miembro" — su cobertura se administra
  // exclusivamente con la opción "¿El titular está cubierto?" al
  // crear/renovar la póliza (rol PRIMARY garantizado ahí). Agregarlo
  // por este otro camino permitía terminar con un PolicyMember del
  // titular con un rol equivocado (SPOUSE/DEPENDENT/OTHER en vez de
  // PRIMARY) — ver también el guard equivalente en addPolicyMember.
  return householdMembers
    .filter((m) => !alreadyCovered.has(m.person.id) && m.person.id !== policy.holderId)
    .map((m) => ({
      personId: m.person.id,
      firstName: m.person.firstName,
      lastName: m.person.lastName,
      householdRole: m.role,
    }));
}

// Agrega un PolicyMember a una póliza ya existente — nunca recrea la
// póliza, nunca duplica (UNIQUE(policyId, personId) ya lo protege a
// nivel de base de datos). El servicio no restringe personId a los
// candidatos del Household de la póliza (la UI sí lo hace) — mismo
// principio ya documentado para coveredMembers en createPolicy
// (Fase 011): la lista de candidatos es conveniencia de UI, no el
// límite de seguridad real.
export async function addPolicyMember(actor: AuthorizedUser, rawPolicyId: unknown, rawInput: unknown) {
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const input = parseOrThrow(addPolicyMemberSchema, rawInput);
  const policy = await loadPolicyForMemberManagement(policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  // Fase 022 (Hallazgo #3 de UAT): defensa en profundidad — el titular
  // nunca se agrega por este camino (siempre PRIMARY, vía "¿El titular
  // está cubierto?" al crear/renovar), aunque alguien manipule el
  // request directamente saltándose la lista de candidatos de la UI.
  if (input.personId === policy.holderId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "personId: El titular se administra con la opción \"¿El titular está cubierto?\", no se agrega como miembro."
    );
  }

  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true, firstName: true, lastName: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  // Hallazgo #6B de UAT (Fase 022).
  if (policy.product.policyType === "HEALTH" && policy.status === "ACTIVE" && policy.effectiveDate) {
    await assertNoOverlappingHealthCoverage(
      prisma,
      input.personId,
      policy.effectiveDate,
      policy.terminationDate,
      policyId
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      const member = await tx.policyMember.create({
        data: { policyId, personId: input.personId, role: input.role },
      });
      await recordAuditEvent(tx, {
        actor,
        entityType: "PolicyMember",
        entityId: member.id,
        action: "POLICY_ADD_MEMBER",
        policyId,
        householdId: policy.householdId,
        contactPersonId: input.personId,
        summary: `${person.firstName} ${person.lastName} agregado(a) a la póliza`,
      });
      // Hallazgo #2 de UAT (Fase 022).
      await recomputePersonContactStatus(tx, input.personId, actor);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Esta persona ya está cubierta por esta póliza.");
    }
    throw error;
  }

  return getPolicyById(actor, policyId);
}

// Quita a alguien de la cobertura de la póliza — borra únicamente la
// fila PolicyMember, nunca la Person ni su HouseholdMember (sigue en
// el hogar, solo deja de estar cubierto por ESTA póliza en particular).
export async function removePolicyMember(actor: AuthorizedUser, rawPolicyId: unknown, rawMemberId: unknown) {
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const memberId = parseOrThrow(policyMemberIdSchema, rawMemberId);
  const policy = await loadPolicyForMemberManagement(policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  const member = await prisma.policyMember.findUnique({
    where: { id: memberId },
    select: { id: true, policyId: true, personId: true, person: { select: { firstName: true, lastName: true } } },
  });
  if (!member || member.policyId !== policyId) {
    throw new AppError("NOT_FOUND", "Miembro de la póliza no encontrado.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.policyMember.delete({ where: { id: memberId } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PolicyMember",
      entityId: member.id,
      action: "POLICY_REMOVE_MEMBER",
      policyId,
      householdId: policy.householdId,
      contactPersonId: member.personId,
      summary: `${member.person.firstName} ${member.person.lastName} removido(a) de la póliza`,
    });
    // Hallazgo #2 de UAT (Fase 022): si esta era su ÚNICA cobertura
    // activa, vuelve a Prospecto — pero nunca si sigue cubierto por
    // otra póliza activa (recomputePersonContactStatus revisa TODAS
    // sus coberturas, no solo esta).
    await recomputePersonContactStatus(tx, member.personId, actor);
  });
  return getPolicyById(actor, policyId);
}

// ---------------------------------------------------------------------------
// Reparar Policy.householdId cuando quedó null — Fase 019.8 (hallazgo #17)
//
// createPolicy (Fase 019.7) solo resuelve el hogar del titular en el
// momento de crear la póliza. Si el Household se crea DESPUÉS (Flujo B
// de la ficha: contacto -> póliza -> hogar -> familiar), la póliza se
// queda con householdId=null para siempre sin este mecanismo explícito
// de reparación. Nunca se actualiza en masa/silenciosamente — el ADMIN/
// agente decide explícitamente vincular, y solo entre los hogares
// reales del titular (nunca un householdId arbitrario).
// ---------------------------------------------------------------------------

// Hogares candidatos para vincular una póliza que todavía tiene
// householdId=null. Vacío si la póliza ya está vinculada o si el
// titular no pertenece a ningún hogar.
export async function getHouseholdLinkCandidates(actor: AuthorizedUser, rawPolicyId: unknown) {
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const policy = await loadPolicyForMemberManagement(policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  if (policy.householdId) return [];

  const memberships = await prisma.householdMember.findMany({
    where: { personId: policy.holderId },
    select: {
      householdId: true,
      household: {
        select: {
          members: {
            select: { role: true, person: { select: personSummarySelect } },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  return memberships.map((m) => ({
    householdId: m.householdId,
    members: m.household.members.map((hm) => ({ role: hm.role, person: hm.person })),
  }));
}

// Vincula la póliza a UNO de los hogares reales del titular — nunca
// agrega miembros automáticamente (NO AUTO-ENROLL, solo habilita el
// universo de candidatos para "+ Agregar miembro"). Rechaza si la
// póliza ya tiene un hogar (evita pisar una vinculación existente sin
// una acción explícita de "cambiar de hogar", fuera de alcance de esta
// fase) o si el householdId dado no es un hogar real del titular.
export async function linkPolicyToHousehold(
  actor: AuthorizedUser,
  rawPolicyId: unknown,
  rawHouseholdId: unknown
) {
  const policyId = parseOrThrow(policyIdSchema, rawPolicyId);
  const householdId = parseOrThrow(householdIdSchema, rawHouseholdId);
  const policy = await loadPolicyForMemberManagement(policyId);
  assertCanAccessPolicy(actor, [policy.holder, ...policy.members.map((m) => m.person)]);

  if (policy.householdId) {
    throw new AppError("CONFLICT", "Esta póliza ya está vinculada a un hogar.");
  }

  const membership = await prisma.householdMember.findFirst({
    where: { householdId, personId: policy.holderId },
    select: { id: true },
  });
  if (!membership) {
    throw new AppError(
      "VALIDATION_ERROR",
      "householdId: El hogar seleccionado no corresponde al titular de esta póliza."
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.policy.update({ where: { id: policyId }, data: { householdId } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "Policy",
      entityId: policyId,
      action: "POLICY_LINK_HOUSEHOLD",
      policyId,
      householdId,
      contactPersonId: policy.holderId,
      summary: "Póliza vinculada a un hogar",
    });
  });
  return getPolicyById(actor, policyId);
}
