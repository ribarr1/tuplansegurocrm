import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson, resolveAssignedAgentIdForCreate } from "@/services/people.service";
import { personIdSchema, createPersonSchema } from "@/schemas/person.schema";
import {
  householdIdSchema,
  householdMemberIdSchema,
  createHouseholdSchema,
  addHouseholdMemberSchema,
  updateHouseholdMemberRoleSchema,
  updateHouseholdSchema,
} from "@/schemas/household.schema";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";

// ---------------------------------------------------------------------------
// Política de acceso — Household (V1)
//
// Ver (getHouseholdsForPerson / getHouseholdById): ADMIN, AGENT, ASSISTANT
//   — cualquier usuario activo, igual que ver una Person.
//
// Crear/modificar (crear hogar, agregar/remover miembro, cambiar rol,
// crear Person + agregar):
//   ADMIN, ASSISTANT: cualquier hogar.
//   AGENT: solo si tiene acceso operativo a AL MENOS UNA persona ya
//          involucrada en ese hogar (sin asignar, o asignada a sí
//          mismo) — misma regla que canEditPerson, aplicada a los
//          miembros existentes del hogar en vez de a una sola Person.
//          Al crear un hogar nuevo desde el perfil de una Person, se
//          evalúa esa misma regla sobre esa Person (todavía no hay
//          "miembros existentes").
// ---------------------------------------------------------------------------

const memberSelect = {
  id: true,
  role: true,
  createdAt: true,
  person: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      contactStatus: true,
      assignedAgentId: true,
    },
  },
} satisfies Prisma.HouseholdMemberSelect;

const householdSelect = {
  id: true,
  name: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  zipCode: true,
  county: true,
  annualHouseholdIncome: true,
  incomeYear: true,
  createdAt: true,
  members: { select: memberSelect, orderBy: { createdAt: "asc" } },
} satisfies Prisma.HouseholdSelect;

type HouseholdMemberForAccessCheck = { person: { assignedAgentId: string | null } };

function canAccessHousehold(
  actor: AuthorizedUser,
  members: HouseholdMemberForAccessCheck[]
): boolean {
  if (actor.role === "ADMIN" || actor.role === "ASSISTANT") return true;
  if (actor.role === "AGENT") {
    return members.some(
      (m) => m.person.assignedAgentId === null || m.person.assignedAgentId === actor.id
    );
  }
  return false;
}

function assertCanAccessHousehold(
  actor: AuthorizedUser,
  members: HouseholdMemberForAccessCheck[]
): void {
  if (!canAccessHousehold(actor, members)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a este hogar.");
  }
}

async function fetchAccessMembers(householdId: string) {
  const household = await prisma.household.findUnique({
    where: { id: householdId },
    select: { members: { select: { person: { select: { assignedAgentId: true } } } } },
  });
  if (!household) throw new AppError("NOT_FOUND", "Hogar no encontrado.");
  return household.members;
}

export async function getHouseholdsForPerson(actor: AuthorizedUser, rawPersonId: unknown) {
  void actor; // ver hogares es una operación de lectura, cualquier usuario activo puede.
  const personId = parseOrThrow(personIdSchema, rawPersonId);

  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  const memberships = await prisma.householdMember.findMany({
    where: { personId },
    select: { household: { select: householdSelect } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => m.household);
}

export async function getHouseholdById(actor: AuthorizedUser, rawId: unknown) {
  void actor;
  const id = parseOrThrow(householdIdSchema, rawId);
  const household = await prisma.household.findUnique({ where: { id }, select: householdSelect });
  if (!household) throw new AppError("NOT_FOUND", "Hogar no encontrado.");
  return household;
}

// Dirección + ingreso familiar — Fase 019.5. Misma política de acceso
// que el resto de mutaciones de Household (assertCanAccessHousehold
// sobre los miembros existentes). annualHouseholdIncome/incomeYear
// nunca deben confundirse ni sincronizarse con
// HealthPolicyDetail.incomeUsed (ingreso declarado en una aplicación
// Marketplace específica) — son dos hechos distintos, ver
// docs/DECISIONS.md.
export async function updateHousehold(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(householdIdSchema, rawId);
  const input = parseOrThrow(updateHouseholdSchema, rawInput);
  const members = await fetchAccessMembers(id);
  assertCanAccessHousehold(actor, members);

  const data: Prisma.HouseholdUncheckedUpdateInput = {};
  if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
  if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2;
  if (input.city !== undefined) data.city = input.city;
  if (input.state !== undefined) data.state = input.state;
  if (input.zipCode !== undefined) data.zipCode = input.zipCode;
  if (input.county !== undefined) data.county = input.county;
  if (input.annualHouseholdIncome !== undefined) data.annualHouseholdIncome = input.annualHouseholdIncome;
  if (input.incomeYear !== undefined) data.incomeYear = input.incomeYear;

  await prisma.household.update({ where: { id }, data });
  return getHouseholdById(actor, id);
}

// Crea un Household y su primer HouseholdMember de forma atómica — no
// queremos un hogar vacío si el segundo paso fallara.
export async function createHouseholdWithInitialMember(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createHouseholdSchema, rawInput);

  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }

  const household = await prisma.$transaction(async (tx) => {
    const created = await tx.household.create({ data: { name: input.name } });
    await tx.householdMember.create({
      data: { householdId: created.id, personId: input.personId, role: input.role },
    });
    return created;
  });

  return getHouseholdById(actor, household.id);
}

export async function addHouseholdMember(
  actor: AuthorizedUser,
  rawHouseholdId: unknown,
  rawInput: unknown
) {
  const householdId = parseOrThrow(householdIdSchema, rawHouseholdId);
  const input = parseOrThrow(addHouseholdMemberSchema, rawInput);

  const members = await fetchAccessMembers(householdId);
  assertCanAccessHousehold(actor, members);

  const person = await prisma.person.findUnique({
    where: { id: input.personId },
    select: { id: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");

  try {
    await prisma.householdMember.create({
      data: { householdId, personId: input.personId, role: input.role },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Esta persona ya pertenece a este hogar.");
    }
    throw error;
  }

  return getHouseholdById(actor, householdId);
}

export async function removeHouseholdMember(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(householdMemberIdSchema, rawId);

  const member = await prisma.householdMember.findUnique({
    where: { id },
    select: {
      id: true,
      householdId: true,
      household: { select: { members: { select: { person: { select: { assignedAgentId: true } } } } } },
    },
  });
  if (!member) throw new AppError("NOT_FOUND", "Miembro de hogar no encontrado.");
  assertCanAccessHousehold(actor, member.household.members);

  // Elimina el HouseholdMember (la relación), nunca la Person.
  await prisma.householdMember.delete({ where: { id } });
  return { householdId: member.householdId };
}

export async function updateHouseholdMemberRole(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown
) {
  const id = parseOrThrow(householdMemberIdSchema, rawId);
  const input = parseOrThrow(updateHouseholdMemberRoleSchema, rawInput);

  const member = await prisma.householdMember.findUnique({
    where: { id },
    select: {
      id: true,
      householdId: true,
      household: { select: { members: { select: { person: { select: { assignedAgentId: true } } } } } },
    },
  });
  if (!member) throw new AppError("NOT_FOUND", "Miembro de hogar no encontrado.");
  assertCanAccessHousehold(actor, member.household.members);

  await prisma.householdMember.update({ where: { id }, data: { role: input.role } });
  return getHouseholdById(actor, member.householdId);
}

const createPersonAndAddSchema = createPersonSchema.extend({
  role: z.enum(["HEAD", "SPOUSE", "CHILD", "DEPENDENT", "OTHER"], "Selecciona un rol válido."),
});

// Crea una Person nueva y la agrega al hogar en una sola transacción:
// si el segundo paso fallara, no debe quedar una Person huérfana creada
// a medias.
export async function createPersonAndAddToHousehold(
  actor: AuthorizedUser,
  rawHouseholdId: unknown,
  rawInput: unknown
) {
  const householdId = parseOrThrow(householdIdSchema, rawHouseholdId);
  const input = parseOrThrow(createPersonAndAddSchema, rawInput);

  const members = await fetchAccessMembers(householdId);
  assertCanAccessHousehold(actor, members);

  const { role, ...personInput } = input;
  const assignedAgentId = await resolveAssignedAgentIdForCreate(
    actor,
    personInput.assignedAgentId
  );

  await prisma.$transaction(async (tx) => {
    const person = await tx.person.create({ data: { ...personInput, assignedAgentId } });
    await tx.householdMember.create({ data: { householdId, personId: person.id, role } });
  });

  return getHouseholdById(actor, householdId);
}
