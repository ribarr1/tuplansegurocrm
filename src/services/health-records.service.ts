import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import { canEditPerson } from "@/services/people.service";
import { personIdSchema } from "@/schemas/person.schema";
import {
  personMedicationIdSchema,
  personProviderIdSchema,
  createPersonMedicationSchema,
  updatePersonMedicationSchema,
  createPersonProviderSchema,
  updatePersonProviderSchema,
} from "@/schemas/health-record.schema";
import type { Prisma } from "@/generated/prisma/client";
import { recordAuditEvent } from "@/services/audit.service";

// ---------------------------------------------------------------------------
// Medicamentos y proveedores/médicos preferidos — Fase 019.8 (hallazgo
// #18 de UAT).
//
// Viven en Person, NUNCA en Policy — una persona puede cambiar de
// póliza y su historial de medicamentos/proveedores debe permanecer
// intacto (ver docs/DECISIONS.md). Misma autorización que editar
// cualquier otro dato del contacto (canEditPerson: ADMIN/ASSISTANT sin
// restricción, AGENT solo si tiene acceso al contacto) — deliberadamente
// más estricta que ver el perfil básico de un contacto (Fase 008,
// abierto a cualquier usuario activo), porque esta es información
// operacional de salud, más sensible que el resto del CRM (ver
// docs/SECURITY.md). Nunca se usa Note como sustituto — Note sigue
// siendo operativo/general, esto es la fuente de verdad real.
// ---------------------------------------------------------------------------

async function loadPersonForAccessCheck(personId: string) {
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, assignedAgentId: true },
  });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  return person;
}

function assertCanAccessHealthRecords(
  actor: AuthorizedUser,
  person: { assignedAgentId: string | null }
): void {
  if (!canEditPerson(actor, person)) {
    throw new AppError("FORBIDDEN", "No tienes acceso a esta persona.");
  }
}

// ---------------------------------------------------------------------------
// Medicamentos
// ---------------------------------------------------------------------------

const medicationSelect = {
  id: true,
  name: true,
  dosage: true,
  frequency: true,
  notes: true,
  isActive: true,
  createdAt: true,
} satisfies Prisma.PersonMedicationSelect;

// Solo medicamentos activos — "Eliminar" en la UI marca isActive=false
// en vez de borrar la fila (ver createPersonMedication más abajo: el
// campo existe desde la migración 005 exactamente para esto, permitir
// discontinuar conservando el historial). Para efectos del usuario se
// ve igual que un borrado real; para el sistema, el historial persiste.
export async function listPersonMedications(actor: AuthorizedUser, rawPersonId: unknown) {
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await loadPersonForAccessCheck(personId);
  assertCanAccessHealthRecords(actor, person);

  return prisma.personMedication.findMany({
    where: { personId, isActive: true },
    select: medicationSelect,
    orderBy: { createdAt: "asc" },
  });
}

export async function createPersonMedication(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createPersonMedicationSchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanAccessHealthRecords(actor, person);

  return prisma.$transaction(async (tx) => {
    const created = await tx.personMedication.create({
      data: {
        personId: input.personId,
        name: input.name,
        dosage: input.dosage ?? null,
        frequency: input.frequency ?? null,
        notes: input.notes ?? null,
      },
      select: medicationSelect,
    });
    // Nunca se guarda name/dosage/frequency/notes en el audit log —
    // información operacional de salud, minimización de PII/PHI (ver
    // docs/SECURITY.md y ficha §14-§15). El resumen genérico ya es
    // suficiente para el timeline del contacto.
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonMedication",
      entityId: created.id,
      action: "MEDICATION_CREATE",
      contactPersonId: input.personId,
      summary: "Medicamento agregado",
    });
    return created;
  });
}

async function loadMedicationForAccessCheck(medicationId: string) {
  const medication = await prisma.personMedication.findUnique({
    where: { id: medicationId },
    select: { id: true, personId: true, person: { select: { assignedAgentId: true } } },
  });
  if (!medication) throw new AppError("NOT_FOUND", "Medicamento no encontrado.");
  return medication;
}

export async function updatePersonMedication(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown
) {
  const id = parseOrThrow(personMedicationIdSchema, rawId);
  const input = parseOrThrow(updatePersonMedicationSchema, rawInput);
  const medication = await loadMedicationForAccessCheck(id);
  assertCanAccessHealthRecords(actor, medication.person);

  const data: Prisma.PersonMedicationUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.dosage !== undefined) data.dosage = input.dosage;
  if (input.frequency !== undefined) data.frequency = input.frequency;
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.personMedication.update({ where: { id }, data, select: medicationSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonMedication",
      entityId: id,
      action: "MEDICATION_UPDATE",
      contactPersonId: medication.personId,
      summary: "Medicamento actualizado",
    });
    return updated;
  });
}

// "Eliminar" desde la UI — nunca DELETE físico, marca isActive=false
// (ver comentario de listPersonMedications). No requiere schema nuevo:
// isActive ya existe desde la migración 005.
export async function deletePersonMedication(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(personMedicationIdSchema, rawId);
  const medication = await loadMedicationForAccessCheck(id);
  assertCanAccessHealthRecords(actor, medication.person);

  await prisma.$transaction(async (tx) => {
    await tx.personMedication.update({ where: { id }, data: { isActive: false } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonMedication",
      entityId: id,
      action: "MEDICATION_DEACTIVATE",
      contactPersonId: medication.personId,
      summary: "Medicamento eliminado",
    });
  });
  return { personId: medication.personId };
}

// ---------------------------------------------------------------------------
// Proveedores / médicos preferidos
// ---------------------------------------------------------------------------

const providerSelect = {
  id: true,
  type: true,
  name: true,
  specialty: true,
  phone: true,
  organization: true,
  notes: true,
  createdAt: true,
} satisfies Prisma.PersonProviderSelect;

export async function listPersonProviders(actor: AuthorizedUser, rawPersonId: unknown) {
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  const person = await loadPersonForAccessCheck(personId);
  assertCanAccessHealthRecords(actor, person);

  return prisma.personProvider.findMany({
    where: { personId },
    select: providerSelect,
    orderBy: { createdAt: "asc" },
  });
}

export async function createPersonProvider(actor: AuthorizedUser, rawInput: unknown) {
  const input = parseOrThrow(createPersonProviderSchema, rawInput);
  const person = await loadPersonForAccessCheck(input.personId);
  assertCanAccessHealthRecords(actor, person);

  return prisma.$transaction(async (tx) => {
    const created = await tx.personProvider.create({
      data: {
        personId: input.personId,
        type: input.type,
        name: input.name,
        specialty: input.specialty ?? null,
        phone: input.phone ?? null,
        organization: input.organization ?? null,
        notes: input.notes ?? null,
      },
      select: providerSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonProvider",
      entityId: created.id,
      action: "PROVIDER_CREATE",
      contactPersonId: input.personId,
      summary: "Proveedor preferido agregado",
    });
    return created;
  });
}

async function loadProviderForAccessCheck(providerId: string) {
  const provider = await prisma.personProvider.findUnique({
    where: { id: providerId },
    select: { id: true, personId: true, person: { select: { assignedAgentId: true } } },
  });
  if (!provider) throw new AppError("NOT_FOUND", "Proveedor no encontrado.");
  return provider;
}

export async function updatePersonProvider(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  const id = parseOrThrow(personProviderIdSchema, rawId);
  const input = parseOrThrow(updatePersonProviderSchema, rawInput);
  const provider = await loadProviderForAccessCheck(id);
  assertCanAccessHealthRecords(actor, provider.person);

  const data: Prisma.PersonProviderUpdateInput = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.name !== undefined) data.name = input.name;
  if (input.specialty !== undefined) data.specialty = input.specialty;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.organization !== undefined) data.organization = input.organization;
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.personProvider.update({ where: { id }, data, select: providerSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonProvider",
      entityId: id,
      action: "PROVIDER_UPDATE",
      contactPersonId: provider.personId,
      summary: "Proveedor preferido actualizado",
    });
    return updated;
  });
}

// PersonProvider no tiene isActive (a diferencia de PersonMedication) —
// no se evaluó necesario para V1, así que "Eliminar" aquí sí es un
// DELETE físico real.
export async function deletePersonProvider(actor: AuthorizedUser, rawId: unknown) {
  const id = parseOrThrow(personProviderIdSchema, rawId);
  const provider = await loadProviderForAccessCheck(id);
  assertCanAccessHealthRecords(actor, provider.person);

  await prisma.$transaction(async (tx) => {
    await tx.personProvider.delete({ where: { id } });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PersonProvider",
      entityId: id,
      action: "PROVIDER_DELETE",
      contactPersonId: provider.personId,
      summary: "Proveedor preferido eliminado",
    });
  });
  return { personId: provider.personId };
}
