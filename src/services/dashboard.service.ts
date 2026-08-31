import "server-only";
import type { AuthorizedUser } from "@/lib/authorization";
import { getTodayBusinessRange } from "@/lib/business-time";
import { listTasks, isTaskOverdue } from "@/services/tasks.service";
import { listPremiumTracking } from "@/services/premiums.service";
import { listBirthdays } from "@/services/birthdays.service";
import { listPolicies } from "@/services/policies.service";
import { listCommissionExpectations } from "@/services/commissions.service";
import { TASK_CLOSED_STATUSES } from "@/schemas/task.schema";
import { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Dashboard — Fase 018
//
// Este servicio NO implementa ninguna regla de negocio propia. Compone
// (nunca duplica) las reglas ya implementadas y probadas en cada
// servicio de módulo: acceso de Task/Policy/Person, "hoy" de negocio
// (APP_TIME_ZONE), vencido de Task/Premium, estado derivado de
// Comisiones. Si una regla de acceso o de vencimiento cambia en su
// servicio de origen, el Dashboard la hereda automáticamente sin tocar
// este archivo.
//
// Cada bloque del DTO se arma con varias consultas pequeñas y
// existentes (no una consulta monolítica) — ver docs/ARCHITECTURE.md
// para el detalle de por qué se prefirió así en V1.
// ---------------------------------------------------------------------------

const TASK_PRIORITY_RANK: Record<string, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const MAX_PRIORITY_TASKS = 5;
const MAX_URGENT_PREMIUMS = 5;
const MAX_UPCOMING_BIRTHDAYS = 5;

type PriorityTaskItem = {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueAt: Date | null;
  isOverdue: boolean;
  personId: string | null;
  policyId: string | null;
};

async function getTasksBlock(actor: AuthorizedUser) {
  const [todayResult, overdueResult, openResult, inProgressResult] = await Promise.all([
    listTasks(actor, { dueToday: "true", pageSize: 1 }),
    listTasks(actor, { overdueOnly: "true", pageSize: 1 }),
    listTasks(actor, { status: "OPEN", pageSize: 20 }),
    listTasks(actor, { status: "IN_PROGRESS", pageSize: 20 }),
  ]);

  const activeTasks = [...openResult.items, ...inProgressResult.items].filter(
    (t) => !(TASK_CLOSED_STATUSES as readonly string[]).includes(t.status)
  );

  const priorityItems: PriorityTaskItem[] = activeTasks
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      dueAt: t.dueAt,
      isOverdue: isTaskOverdue(t),
      personId: t.person?.id ?? null,
      policyId: t.policy?.id ?? null,
    }))
    .sort((a, b) => {
      const overdueDiff = Number(a.isOverdue ? 0 : 1) - Number(b.isOverdue ? 0 : 1);
      if (overdueDiff !== 0) return overdueDiff;
      const rankDiff = TASK_PRIORITY_RANK[a.priority] - TASK_PRIORITY_RANK[b.priority];
      if (rankDiff !== 0) return rankDiff;
      const aTime = a.dueAt ? a.dueAt.getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.dueAt ? b.dueAt.getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    })
    .slice(0, MAX_PRIORITY_TASKS);

  return {
    todayCount: todayResult.total,
    overdueCount: overdueResult.total,
    priorityItems,
  };
}

type UrgentPremiumItem = {
  id: string;
  policyNumber: string | null;
  holderName: string;
  carrierName: string;
  nextPaymentDueDate: Date | null;
  paymentStatus: string | null;
  isOverdue: boolean;
  needsPaymentAssistance: boolean;
};

async function getPremiumsBlock(actor: AuthorizedUser) {
  const [overdueResult, dueTodayResult, dueSoonResult, assistanceResult, overdueItems, dueSoonItems] =
    await Promise.all([
      listPremiumTracking(actor, { overdueOnly: "true", pageSize: 1 }),
      listPremiumTracking(actor, { dueToday: "true", pageSize: 1 }),
      listPremiumTracking(actor, { next7Days: "true", pageSize: 1 }),
      listPremiumTracking(actor, { needsAssistance: "true", pageSize: 1 }),
      listPremiumTracking(actor, { overdueOnly: "true", pageSize: MAX_URGENT_PREMIUMS }),
      listPremiumTracking(actor, { next7Days: "true", pageSize: MAX_URGENT_PREMIUMS }),
    ]);

  const seen = new Set<string>();
  const urgentItems: UrgentPremiumItem[] = [...overdueItems.items, ...dueSoonItems.items]
    .filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    })
    .sort((a, b) => {
      const aTime = a.nextPaymentDueDate ? a.nextPaymentDueDate.getTime() : Number.POSITIVE_INFINITY;
      const bTime = b.nextPaymentDueDate ? b.nextPaymentDueDate.getTime() : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    })
    .slice(0, MAX_URGENT_PREMIUMS)
    .map((p) => ({
      id: p.id,
      policyNumber: p.policyNumber,
      holderName: `${p.holder.firstName} ${p.holder.lastName}`,
      carrierName: p.product.carrier.name,
      nextPaymentDueDate: p.nextPaymentDueDate,
      paymentStatus: p.paymentStatus,
      isOverdue: p.isOverdue,
      needsPaymentAssistance: p.needsPaymentAssistance,
    }));

  return {
    overdueCount: overdueResult.total,
    dueTodayCount: dueTodayResult.total,
    dueSoonCount: dueSoonResult.total,
    assistanceCount: assistanceResult.total,
    urgentItems,
  };
}

type UpcomingBirthdayItem = {
  personId: string;
  firstName: string;
  lastName: string;
  occurrenceMonth: number;
  occurrenceDay: number;
  turningAge: number;
  daysUntil: number;
  greetingStatus: string;
};

async function getBirthdaysBlock(actor: AuthorizedUser) {
  const [todayResults, upcomingResults] = await Promise.all([
    listBirthdays(actor, { view: "today" }),
    listBirthdays(actor, { view: "upcoming" }),
  ]);

  const upcoming: UpcomingBirthdayItem[] = upcomingResults.slice(0, MAX_UPCOMING_BIRTHDAYS).map((b) => ({
    personId: b.person.id,
    firstName: b.person.firstName,
    lastName: b.person.lastName,
    occurrenceMonth: b.occurrenceMonth,
    occurrenceDay: b.occurrenceDay,
    turningAge: b.turningAge,
    daysUntil: b.daysUntil,
    greetingStatus: b.greeting.status,
  }));

  return { todayCount: todayResults.length, upcoming };
}

async function getPoliciesBlock(actor: AuthorizedUser) {
  const [activeResult, pendingResult] = await Promise.all([
    listPolicies(actor, { status: "ACTIVE", pageSize: 1 }),
    listPolicies(actor, { status: "PENDING", pageSize: 1 }),
  ]);
  return { activeCount: activeResult.total, pendingCount: pendingResult.total };
}

// Comisiones es FINANCIERO/RESTRINGIDO — ASSISTANT nunca llega a esta
// función (getDashboard ni siquiera la invoca para ese rol, ver más
// abajo), y listCommissionExpectations vuelve a validar por su cuenta
// de todas formas (defensa en profundidad).
//
// hasData distingue "sin expectativas registradas este mes" de
// "expectedAmount realmente es 0" (ver docs/DECISIONS.md) — nunca se
// muestra $0 como si fuera un hecho contable confirmado cuando en
// realidad no hay ningún registro.
async function getCommissionsBlock(actor: AuthorizedUser) {
  const { year, month } = getTodayBusinessRange();
  const period = `${year}-${String(month).padStart(2, "0")}`;

  const { items } = await listCommissionExpectations(actor, { period, pageSize: 100 });
  if (items.length === 0) {
    return { hasData: false as const, period: new Date(Date.UTC(year, month - 1, 1)) };
  }

  const expected = items.reduce(
    (sum, i) => sum.plus(new Prisma.Decimal(i.expectedAmount)),
    new Prisma.Decimal(0)
  );
  const received = items.reduce((sum, i) => sum.plus(i.receivedAmount), new Prisma.Decimal(0));

  return {
    hasData: true as const,
    period: new Date(Date.UTC(year, month - 1, 1)),
    expected,
    received,
    difference: expected.minus(received),
  };
}

export async function getDashboard(actor: AuthorizedUser) {
  const [tasks, premiums, birthdays, policies] = await Promise.all([
    getTasksBlock(actor),
    getPremiumsBlock(actor),
    getBirthdaysBlock(actor),
    getPoliciesBlock(actor),
  ]);

  // ASSISTANT no tiene ningún acceso a Comisiones (Fase 016) — el
  // Dashboard respeta exactamente la misma regla: para ese rol, la
  // clave "commissions" ni siquiera se agrega al DTO (no se pone en
  // null, se omite por completo), mismo criterio que la redacción de
  // campos financieros de HealthPolicyDetail para ASSISTANT.
  if (actor.role === "ASSISTANT") {
    return { tasks, premiums, birthdays, policies };
  }

  const commissions = await getCommissionsBlock(actor);
  return { tasks, premiums, birthdays, policies, commissions };
}

export type DashboardData = Awaited<ReturnType<typeof getDashboard>>;
