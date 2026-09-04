import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import { getTodayBusinessRange } from "@/lib/business-time";
import { getDateOnlyParts, effectiveBirthdayForYear } from "@/lib/date-only";
import { personIdSchema } from "@/schemas/person.schema";
import {
  listBirthdaysQuerySchema,
  markBirthdaySentSchema,
  markBirthdaySkippedSchema,
  resetBirthdayGreetingSchema,
} from "@/schemas/birthday.schema";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Política de acceso — Birthdays (V1)
//
// Person.dateOfBirth es la única fuente de verdad del cumpleaños — nunca
// se duplica en otra tabla. BirthdayGreeting es un registro SPARSE de
// gestión anual: la ausencia de fila para (persona, año) se interpreta
// como "Pendiente", nunca se crea una fila para todas las personas al
// empezar el año (ver docs/DECISIONS.md).
//
// A diferencia de listPeople (donde CUALQUIER usuario activo puede ver
// la lista completa de contactos — Fase 008), /birthdays restringe a
// AGENT a solo los contactos a los que ya tiene acceso operativo
// (sin asignar o asignados a sí mismo) — surfacear cumpleaños es
// surfacear datos personales (teléfono, email, DOB) de forma
// escaneable, y el negocio pidió explícitamente que un AGENT no pueda
// "descubrir" contactos fuera de su cartera por esta vía. ADMIN y
// ASSISTANT ven todos. Marcar SENT/SKIPPED reutiliza canEditPerson —
// mismo límite que editar cualquier otro dato del contacto.
// ---------------------------------------------------------------------------

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  phone: true,
  email: true,
  contactStatus: true,
  dateOfBirth: true,
  assignedAgentId: true,
} satisfies Prisma.PersonSelect;

const greetingSelect = {
  id: true,
  personId: true,
  year: true,
  status: true,
  channel: true,
  sentAt: true,
} satisfies Prisma.BirthdayGreetingSelect;

function agentAccessWhere(actor: AuthorizedUser): Prisma.PersonWhereInput | null {
  if (actor.role !== "AGENT") return null;
  return { OR: [{ assignedAgentId: null }, { assignedAgentId: actor.id }] };
}

function daysBetweenUtc(
  y1: number,
  m1: number,
  d1: number,
  y2: number,
  m2: number,
  d2: number
): number {
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

type PersonRow = Prisma.PersonGetPayload<{ select: typeof personSelect }>;

type BirthdayComputation = {
  person: PersonRow;
  birthMonth: number;
  birthDay: number;
  birthYear: number;
  currentYearOccurrence: { month: number; day: number };
  ageAtCurrentYearOccurrence: number;
  nextOccurrenceYear: number;
  nextOccurrenceMonth: number;
  nextOccurrenceDay: number;
  daysUntilNext: number;
  ageAtNextOccurrence: number;
};

// Extraída como función pura exportada (sin tocar Prisma/Person) para
// poder probar el cruce diciembre -> enero de forma determinista, sin
// depender de la fecha real del sistema en el momento de correr los
// tests.
export function computeNextOccurrence(
  birthMonth: number,
  birthDay: number,
  todayYear: number,
  todayMonth: number,
  todayDay: number
): { occurrenceYear: number; month: number; day: number; daysUntil: number } {
  let occurrenceYear = todayYear;
  let occ = effectiveBirthdayForYear(birthMonth, birthDay, occurrenceYear);
  let daysUntil = daysBetweenUtc(todayYear, todayMonth, todayDay, occurrenceYear, occ.month, occ.day);
  if (daysUntil < 0) {
    occurrenceYear = todayYear + 1;
    occ = effectiveBirthdayForYear(birthMonth, birthDay, occurrenceYear);
    daysUntil = daysBetweenUtc(todayYear, todayMonth, todayDay, occurrenceYear, occ.month, occ.day);
  }
  return { occurrenceYear, month: occ.month, day: occ.day, daysUntil };
}

function computeBirthday(
  person: PersonRow,
  todayYear: number,
  todayMonth: number,
  todayDay: number
): BirthdayComputation {
  const { year: birthYear, month: birthMonth, day: birthDay } = getDateOnlyParts(person.dateOfBirth!);
  const currentYearOccurrence = effectiveBirthdayForYear(birthMonth, birthDay, todayYear);
  const next = computeNextOccurrence(birthMonth, birthDay, todayYear, todayMonth, todayDay);

  return {
    person,
    birthMonth,
    birthDay,
    birthYear,
    currentYearOccurrence,
    ageAtCurrentYearOccurrence: todayYear - birthYear,
    nextOccurrenceYear: next.occurrenceYear,
    nextOccurrenceMonth: next.month,
    nextOccurrenceDay: next.day,
    daysUntilNext: next.daysUntil,
    ageAtNextOccurrence: next.occurrenceYear - birthYear,
  };
}

const UPCOMING_WINDOW_DAYS = 30;

// Fase 024 (Hallazgo #3 de UAT): mes calendario siguiente al de hoy,
// según APP_TIME_ZONE (nunca el timezone del navegador) — nunca
// simplemente "todayMonth + 1" sin envolver diciembre -> enero, y el
// AÑO de esa ocurrencia cambia junto con el mes (diciembre de 2026 ->
// enero de 2027, no de 2026).
function nextCalendarMonth(todayYear: number, todayMonth: number): { year: number; month: number } {
  return todayMonth === 12 ? { year: todayYear + 1, month: 1 } : { year: todayYear, month: todayMonth + 1 };
}

export async function listBirthdays(actor: AuthorizedUser, rawQuery: unknown) {
  const { view, search, status } = parseOrThrow(listBirthdaysQuerySchema, rawQuery);

  const agentWhere = agentAccessWhere(actor);
  const where: Prisma.PersonWhereInput = {
    dateOfBirth: { not: null },
    ...(search
      ? {
          OR: [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
    ...(agentWhere ?? {}),
  };

  const people = await prisma.person.findMany({ where, select: personSelect });
  const { year: todayYear, month: todayMonth, day: todayDay } = getTodayBusinessRange();
  const nextMonthTarget = nextCalendarMonth(todayYear, todayMonth);

  const computed = people.map((p) => computeBirthday(p, todayYear, todayMonth, todayDay));

  // "Mes siguiente": ocurrencia calculada para el AÑO del mes siguiente
  // (relevante en diciembre -> enero, donde ese año ya no es todayYear)
  // — nunca currentYearOccurrence (siempre calculada sobre todayYear).
  const nextMonthOccurrence = new Map(
    computed.map((e) => [e.person.id, effectiveBirthdayForYear(e.birthMonth, e.birthDay, nextMonthTarget.year)])
  );

  let filtered: BirthdayComputation[];
  if (view === "today") {
    filtered = computed.filter((e) => e.daysUntilNext === 0);
  } else if (view === "month") {
    filtered = computed
      .filter((e) => e.currentYearOccurrence.month === todayMonth)
      .sort((a, b) => a.currentYearOccurrence.day - b.currentYearOccurrence.day);
  } else if (view === "nextMonth") {
    filtered = computed
      .filter((e) => nextMonthOccurrence.get(e.person.id)!.month === nextMonthTarget.month)
      .sort((a, b) => nextMonthOccurrence.get(a.person.id)!.day - nextMonthOccurrence.get(b.person.id)!.day);
  } else if (view === "upcoming") {
    filtered = computed
      .filter((e) => e.daysUntilNext >= 0 && e.daysUntilNext <= UPCOMING_WINDOW_DAYS)
      .sort((a, b) => a.daysUntilNext - b.daysUntilNext);
  } else {
    filtered = [...computed].sort(
      (a, b) =>
        a.currentYearOccurrence.month - b.currentYearOccurrence.month ||
        a.currentYearOccurrence.day - b.currentYearOccurrence.day
    );
  }

  // Resuelve año/mes/día/edad de la ocurrencia relevante SEGÚN la vista
  // activa — "upcoming" usa la próxima ocurrencia real (puede caer en
  // el año siguiente); "nextMonth" usa la ocurrencia calculada para el
  // año del mes calendario siguiente (idem, relevante en diciembre);
  // el resto usa el año actual.
  function occurrenceFor(e: BirthdayComputation) {
    if (view === "upcoming") {
      return { year: e.nextOccurrenceYear, month: e.nextOccurrenceMonth, day: e.nextOccurrenceDay, age: e.ageAtNextOccurrence };
    }
    if (view === "nextMonth") {
      const occ = nextMonthOccurrence.get(e.person.id)!;
      return { year: nextMonthTarget.year, month: occ.month, day: occ.day, age: nextMonthTarget.year - e.birthYear };
    }
    return { year: todayYear, month: e.currentYearOccurrence.month, day: e.currentYearOccurrence.day, age: e.ageAtCurrentYearOccurrence };
  }

  const personIds = filtered.map((e) => e.person.id);
  const relevantYears = Array.from(new Set(filtered.map((e) => occurrenceFor(e).year)));
  const greetings = personIds.length
    ? await prisma.birthdayGreeting.findMany({
        where: { personId: { in: personIds }, year: { in: relevantYears } },
        select: greetingSelect,
      })
    : [];
  const greetingMap = new Map(greetings.map((g) => [`${g.personId}:${g.year}`, g]));

  const results = filtered.map((e) => {
    const occ = occurrenceFor(e);
    const greetingYear = occ.year;
    const found = greetingMap.get(`${e.person.id}:${greetingYear}`);
    const turningAge = occ.age;
    const occurrenceMonth = occ.month;
    const occurrenceDay = occ.day;

    return {
      person: {
        id: e.person.id,
        firstName: e.person.firstName,
        lastName: e.person.lastName,
        phone: e.person.phone,
        email: e.person.email,
        contactStatus: e.person.contactStatus,
      },
      birthMonth: e.birthMonth,
      birthDay: e.birthDay,
      occurrenceMonth,
      occurrenceDay,
      occurrenceYear: greetingYear,
      turningAge,
      daysUntil: e.daysUntilNext,
      greeting: found
        ? { status: found.status, channel: found.channel, sentAt: found.sentAt }
        : { status: "PENDING" as const, channel: null, sentAt: null },
    };
  });

  return status ? results.filter((r) => r.greeting.status === status) : results;
}

export async function getBirthdayForPerson(actor: AuthorizedUser, rawPersonId: unknown, rawYear?: unknown) {
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, dateOfBirth: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }
  if (!person.dateOfBirth) return null;

  const { year: todayYear } = getTodayBusinessRange();
  const year = typeof rawYear === "number" ? rawYear : todayYear;

  const { month, day } = getDateOnlyParts(person.dateOfBirth);
  const greeting = await prisma.birthdayGreeting.findUnique({
    where: { personId_year: { personId, year } },
    select: greetingSelect,
  });

  return {
    birthMonth: month,
    birthDay: day,
    year,
    greeting: greeting
      ? { status: greeting.status, channel: greeting.channel, sentAt: greeting.sentAt }
      : { status: "PENDING" as const, channel: null, sentAt: null },
  };
}

async function assertAccessForGreeting(actor: AuthorizedUser, personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }
}

// upsert sobre la unique (personId, year): marcar SENT/SKIPPED sobre un
// año que ya tiene registro actualiza ese registro en vez de violar la
// constraint o duplicar — nunca se expone un P2002 al llamador.
export async function markBirthdayGreetingSent(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(markBirthdaySentSchema, rawInput);
  await assertAccessForGreeting(actor, input.personId);

  const { year: todayYear } = getTodayBusinessRange();
  const year = input.year ?? todayYear;

  return prisma.birthdayGreeting.upsert({
    where: { personId_year: { personId: input.personId, year } },
    create: { personId: input.personId, year, status: "SENT", channel: input.channel, sentAt: new Date() },
    update: { status: "SENT", channel: input.channel, sentAt: new Date() },
    select: greetingSelect,
  });
}

export async function markBirthdayGreetingSkipped(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(markBirthdaySkippedSchema, rawInput);
  await assertAccessForGreeting(actor, input.personId);

  const { year: todayYear } = getTodayBusinessRange();
  const year = input.year ?? todayYear;

  return prisma.birthdayGreeting.upsert({
    where: { personId_year: { personId: input.personId, year } },
    create: { personId: input.personId, year, status: "SKIPPED", channel: null, sentAt: null },
    update: { status: "SKIPPED", channel: null, sentAt: null },
    select: greetingSelect,
  });
}

// Restablecer (Fase 015 §20): elimina el registro de gestión de un
// (persona, año) específico, devolviendo el estado a "Pendiente"
// derivado. No contradice la regla general de "nunca hard delete" del
// proyecto — BirthdayGreeting es un registro de tracking anual, no una
// entidad de negocio con historial que deba preservarse (a diferencia
// de Policy/Task/Household). Solo ADMIN: corrige un clic accidental,
// no es una acción de uso diario para AGENT/ASSISTANT.
export async function resetBirthdayGreeting(actor: AuthorizedUser, rawInput: unknown) {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede restablecer una felicitación.");
  }
  const input = parseOrThrow(resetBirthdayGreetingSchema, rawInput);

  const { year: todayYear } = getTodayBusinessRange();
  const year = input.year ?? todayYear;

  const existing = await prisma.birthdayGreeting.findUnique({
    where: { personId_year: { personId: input.personId, year } },
    select: { id: true },
  });
  if (!existing) {
    throw new AppError("NOT_FOUND", "No hay una felicitación registrada para esa persona y año.");
  }
  await prisma.birthdayGreeting.delete({ where: { id: existing.id } });
}
