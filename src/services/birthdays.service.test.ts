import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listBirthdays,
  getBirthdayForPerson,
  markBirthdayGreetingSent,
  markBirthdayGreetingSkipped,
  resetBirthdayGreeting,
  computeNextOccurrence,
} from "@/services/birthdays.service";
import { getTodayBusinessRange } from "@/lib/business-time";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];

function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

// dateOfBirth es @db.Date — se construye anclado a medianoche UTC para
// representar exactamente el día calendario deseado, sin depender de
// la zona horaria del proceso que corre el test.
function dobFor(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysToParts(
  year: number,
  month: number,
  day: number,
  delta: number
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(year, month - 1, day + delta));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

async function makePerson(dateOfBirth: Date | null, assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      dateOfBirth,
      assignedAgentId,
    },
  });
  return trackPerson(person);
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

let today: { year: number; month: number; day: number };

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-bday");
  agent = await makeActor("AGENT", "agent-bday");
  agentB = await makeActor("AGENT", "agentb-bday");
  assistant = await makeActor("ASSISTANT", "assistant-bday");
  today = getTodayBusinessRange();
});

afterAll(async () => {
  await prisma.birthdayGreeting.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("birthdays.service", () => {
  it("A) Person sin dateOfBirth no aparece", async () => {
    const person = await makePerson(null);
    const results = await listBirthdays(admin, { view: "all" });
    expect(results.map((r) => r.person.id)).not.toContain(person.id);
  });

  it("B) cumpleaños de hoy aparece en view=today", async () => {
    const birthYear = today.year - 30;
    const person = await makePerson(dobFor(birthYear, today.month, today.day));
    const results = await listBirthdays(admin, { view: "today" });
    expect(results.map((r) => r.person.id)).toContain(person.id);
  });

  it("C) cumpleaños fuera de hoy no aparece en view=today", async () => {
    const tomorrow = addDaysToParts(today.year, today.month, today.day, 1);
    const person = await makePerson(dobFor(1990, tomorrow.month, tomorrow.day));
    const results = await listBirthdays(admin, { view: "today" });
    expect(results.map((r) => r.person.id)).not.toContain(person.id);
  });

  it("D) filtro mes correcto (view=month)", async () => {
    const sameMonthDay = today.day > 1 ? today.day - 1 : today.day + 1;
    const inMonth = await makePerson(dobFor(1985, today.month, sameMonthDay));
    const nextMonth = today.month === 12 ? 1 : today.month + 1;
    const outOfMonth = await makePerson(dobFor(1985, nextMonth, 15));

    const results = await listBirthdays(admin, { view: "month" });
    const ids = results.map((r) => r.person.id);
    expect(ids).toContain(inMonth.id);
    expect(ids).not.toContain(outOfMonth.id);
  });

  it("E) orden por día ascendente (view=month)", async () => {
    // Dos días válidos dentro del mes actual, distintos entre sí y de "hoy".
    const dayA = today.day <= 26 ? today.day + 2 : today.day - 2;
    const dayB = today.day <= 26 ? today.day + 4 : today.day - 4;
    const [earlier, later] = dayA < dayB ? [dayA, dayB] : [dayB, dayA];

    const personLater = await makePerson(dobFor(1980, today.month, later));
    const personEarlier = await makePerson(dobFor(1980, today.month, earlier));

    const results = await listBirthdays(admin, { view: "month" });
    const indexEarlier = results.findIndex((r) => r.person.id === personEarlier.id);
    const indexLater = results.findIndex((r) => r.person.id === personLater.id);
    expect(indexEarlier).toBeGreaterThanOrEqual(0);
    expect(indexLater).toBeGreaterThan(indexEarlier);
  });

  // Fase 024 (Hallazgo #3 de UAT): view=nextMonth.
  it("nextMonth: filtra por el mes calendario SIGUIENTE al actual", async () => {
    const nextMonth = today.month === 12 ? 1 : today.month + 1;
    const inNextMonth = await makePerson(dobFor(1985, nextMonth, 15));
    const inCurrentMonth = await makePerson(dobFor(1985, today.month, today.day));

    const results = await listBirthdays(admin, { view: "nextMonth" });
    const ids = results.map((r) => r.person.id);
    expect(ids).toContain(inNextMonth.id);
    expect(ids).not.toContain(inCurrentMonth.id);
  });

  it("nextMonth: diciembre -> enero cruza correctamente de año (función pura, fecha de referencia fija)", () => {
    // Hoy = 20 de diciembre de 2026 -> mes siguiente = enero de 2027.
    const result = computeNextOccurrence(1, 10, 2026, 12, 20);
    expect(result.occurrenceYear).toBe(2027);
    expect(result.month).toBe(1);
  });

  it("nextMonth: 29-Feb en año no bisiesto se muestra como 28-Feb (misma convención que el resto)", async () => {
    // Si hoy fuera 15 de enero de un año cuyo "mes siguiente" (febrero)
    // no es bisiesto, alguien nacido el 29 de febrero debe listarse
    // como 28. Se prueba contra la función pura para no depender de la
    // fecha real del sistema al correr el test.
    const nonLeapFebruary = computeNextOccurrence(2, 29, 2025, 1, 15);
    expect(nonLeapFebruary).toMatchObject({ occurrenceYear: 2025, month: 2, day: 28 });
    const leapFebruary = computeNextOccurrence(2, 29, 2024, 1, 15);
    expect(leapFebruary).toMatchObject({ occurrenceYear: 2024, month: 2, day: 29 });
  });

  it("F) próximos 30 días funciona", async () => {
    const within = addDaysToParts(today.year, today.month, today.day, 10);
    const outside = addDaysToParts(today.year, today.month, today.day, 40);
    const personWithin = await makePerson(dobFor(1990, within.month, within.day));
    const personOutside = await makePerson(dobFor(1990, outside.month, outside.day));

    const results = await listBirthdays(admin, { view: "upcoming" });
    const ids = results.map((r) => r.person.id);
    expect(ids).toContain(personWithin.id);
    expect(ids).not.toContain(personOutside.id);
  });

  it("G) próximos cruza diciembre -> enero correctamente (función pura, fecha de referencia fija)", () => {
    // Hoy = 20 de diciembre de 2026; cumpleaños = 5 de enero.
    const result = computeNextOccurrence(1, 5, 2026, 12, 20);
    expect(result.occurrenceYear).toBe(2027);
    expect(result.month).toBe(1);
    expect(result.day).toBe(5);
    expect(result.daysUntil).toBe(16); // 11 días restantes de diciembre + 5 de enero
  });

  it("H) edad calculada correctamente", async () => {
    const birthYear = today.year - 42;
    const person = await makePerson(dobFor(birthYear, today.month, today.day));
    const results = await listBirthdays(admin, { view: "today" });
    const found = results.find((r) => r.person.id === person.id);
    expect(found?.turningAge).toBe(42);
  });

  it("I) 29-Feb en año bisiesto -> ocurrencia 29-Feb (función pura)", () => {
    const result = computeNextOccurrence(2, 29, 2024, 2, 1);
    expect(result).toMatchObject({ occurrenceYear: 2024, month: 2, day: 29 });
  });

  it("J) 29-Feb en año no bisiesto -> convención 28-Feb (función pura)", () => {
    const result = computeNextOccurrence(2, 29, 2025, 2, 1);
    expect(result).toMatchObject({ occurrenceYear: 2025, month: 2, day: 28 });
  });

  it("K) sin greeting -> Pending derivado", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day));
    const results = await listBirthdays(admin, { view: "today" });
    const found = results.find((r) => r.person.id === person.id);
    expect(found?.greeting).toEqual({ status: "PENDING", channel: null, sentAt: null });
  });

  it("L) mark SENT crea greeting / M) requiere channel / N) genera sentAt", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day));
    const greeting = await markBirthdayGreetingSent(admin, {
      personId: person.id,
      channel: "WHATSAPP",
    });
    expect(greeting.status).toBe("SENT");
    expect(greeting.channel).toBe("WHATSAPP");
    expect(greeting.sentAt).not.toBeNull();
    expect(greeting.year).toBe(today.year);

    await expect(
      markBirthdayGreetingSent(admin, { personId: person.id })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("O) mark SKIPPED funciona / P) SKIPPED no conserva sentAt", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day));
    const greeting = await markBirthdayGreetingSkipped(admin, { personId: person.id });
    expect(greeting.status).toBe("SKIPPED");
    expect(greeting.sentAt).toBeNull();
    expect(greeting.channel).toBeNull();
  });

  it("Q) actualizar greeting existente no duplica", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day));
    const first = await markBirthdayGreetingSkipped(admin, { personId: person.id });
    const second = await markBirthdayGreetingSent(admin, { personId: person.id, channel: "SMS" });
    expect(second.id).toBe(first.id);
    expect(second.status).toBe("SENT");

    const count = await prisma.birthdayGreeting.count({
      where: { personId: person.id, year: today.year },
    });
    expect(count).toBe(1);
  });

  it("R) ADMIN ve todos", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day), agentB.id);
    const results = await listBirthdays(admin, { view: "today" });
    expect(results.map((r) => r.person.id)).toContain(person.id);
  });

  it("S) AGENT ve contacto propio (o sin asignar)", async () => {
    const own = await makePerson(dobFor(1990, today.month, today.day), agent.id);
    const unassigned = await makePerson(dobFor(1990, today.month, today.day), null);
    const results = await listBirthdays(agent, { view: "today" });
    const ids = results.map((r) => r.person.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(unassigned.id);
  });

  it("T) AGENT no ve contacto fuera de acceso", async () => {
    const othersPerson = await makePerson(dobFor(1990, today.month, today.day), agentB.id);
    const results = await listBirthdays(agent, { view: "today" });
    expect(results.map((r) => r.person.id)).not.toContain(othersPerson.id);
  });

  it("U) AGENT no puede marcar greeting fuera de acceso", async () => {
    const othersPerson = await makePerson(dobFor(1990, today.month, today.day), agentB.id);
    await expect(
      markBirthdayGreetingSent(agent, { personId: othersPerson.id, channel: "EMAIL" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("V) ASSISTANT permitido sin restricción de asignación", async () => {
    const othersPerson = await makePerson(dobFor(1990, today.month, today.day), agentB.id);
    const greeting = await markBirthdayGreetingSent(assistant, {
      personId: othersPerson.id,
      channel: "OTHER",
    });
    expect(greeting.status).toBe("SENT");
  });

  // W) "usuario inactive bloqueado": misma razón documentada en los
  // servicios anteriores — cada función recibe un actor ya resuelto
  // por requireSessionUser()/requireSessionRole(), que ya rechaza
  // usuarios inactivos (probado en src/lib/authorization.test.ts).

  it("X) listBirthdays no devuelve datos Health/Financial", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day));
    const results = await listBirthdays(admin, { view: "today" });
    const found = results.find((r) => r.person.id === person.id);
    expect(found).toBeDefined();
    const keys = found ? Object.keys(found.person) : [];
    for (const forbidden of ["dateOfBirth", "assignedAgentId", "healthDetail", "providers", "medications"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("Y) dateOfBirth DATE no cambia de día por timezone (getBirthdayForPerson)", async () => {
    const person = await makePerson(dobFor(1990, 9, 15));
    const info = await getBirthdayForPerson(admin, person.id);
    expect(info).not.toBeNull();
    expect(info?.birthMonth).toBe(9);
    expect(info?.birthDay).toBe(15);
  });

  it("AB) reset elimina el registro y vuelve a Pending derivado (solo ADMIN)", async () => {
    const person = await makePerson(dobFor(1990, today.month, today.day));
    await markBirthdayGreetingSent(admin, { personId: person.id, channel: "SMS" });

    await expect(
      resetBirthdayGreeting(assistant, { personId: person.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await resetBirthdayGreeting(admin, { personId: person.id });
    const info = await getBirthdayForPerson(admin, person.id);
    expect(info?.greeting).toEqual({ status: "PENDING", channel: null, sentAt: null });

    await expect(resetBirthdayGreeting(admin, { personId: person.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
