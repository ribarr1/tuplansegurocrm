import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listPersonMedications,
  createPersonMedication,
  updatePersonMedication,
  deletePersonMedication,
  listPersonProviders,
  createPersonProvider,
  updatePersonProvider,
  deletePersonProvider,
} from "@/services/health-records.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Hallazgo #18 de UAT (Fase 019.8): medicamentos y proveedores/médicos
// preferidos, manuales para V1. Viven en Person, nunca en Policy.

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];

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

async function makePerson(assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  createdPersonIds.push(person.id);
  return person;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-health-rec");
  agent = await makeActor("AGENT", "agent-health-rec");
  agentB = await makeActor("AGENT", "agentb-health-rec");
  assistant = await makeActor("ASSISTANT", "assistant-health-rec");
});

afterAll(async () => {
  await prisma.personMedication.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.personProvider.deleteMany({ where: { personId: { in: createdPersonIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("health-records.service — medicamentos", () => {
  it("Q) usuario autorizado lista los medicamentos de una persona", async () => {
    const person = await makePerson();
    await createPersonMedication(admin, { personId: person.id, name: "Metformin" });
    const meds = await listPersonMedications(admin, person.id);
    expect(meds).toHaveLength(1);
    expect(meds[0].name).toBe("Metformin");
  });

  it("R) crear medicamento con todos los campos", async () => {
    const person = await makePerson();
    const med = await createPersonMedication(admin, {
      personId: person.id,
      name: "Lisinopril",
      dosage: "10 mg",
      frequency: "1 vez al día",
      notes: "Tomar en la mañana",
    });
    expect(med.dosage).toBe("10 mg");
    expect(med.frequency).toBe("1 vez al día");
    expect(med.notes).toBe("Tomar en la mañana");
  });

  it("S) actualizar medicamento", async () => {
    const person = await makePerson();
    const med = await createPersonMedication(admin, { personId: person.id, name: "Metformin" });
    const updated = await updatePersonMedication(admin, med.id, { dosage: "850 mg" });
    expect(updated.dosage).toBe("850 mg");
    expect(updated.name).toBe("Metformin");
  });

  it("T) eliminar medicamento lo saca de la lista, pero conserva la fila (isActive=false, nunca DELETE físico)", async () => {
    const person = await makePerson();
    const med = await createPersonMedication(admin, { personId: person.id, name: "Metformin" });
    await deletePersonMedication(admin, med.id);

    const meds = await listPersonMedications(admin, person.id);
    expect(meds).toHaveLength(0);

    const raw = await prisma.personMedication.findUnique({ where: { id: med.id } });
    expect(raw).not.toBeNull();
    expect(raw?.isActive).toBe(false);
  });

  it("U) name es obligatorio", async () => {
    const person = await makePerson();
    await expect(
      createPersonMedication(admin, { personId: person.id, name: "" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("V) dosage/frequency/notes son opcionales — se puede crear solo con name", async () => {
    const person = await makePerson();
    const med = await createPersonMedication(admin, { personId: person.id, name: "Aspirina" });
    expect(med.dosage).toBeNull();
    expect(med.frequency).toBeNull();
    expect(med.notes).toBeNull();
  });

  it("W) AGENT sin acceso a la persona no puede leer/crear/editar/eliminar medicamentos", async () => {
    const person = await makePerson(agentB.id);
    await expect(listPersonMedications(agent, person.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createPersonMedication(agent, { personId: person.id, name: "Metformin" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const med = await createPersonMedication(admin, { personId: person.id, name: "Metformin" });
    await expect(updatePersonMedication(agent, med.id, { dosage: "1g" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(deletePersonMedication(agent, med.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ASSISTANT tiene acceso completo, igual que ADMIN (misma política que canEditPerson)", async () => {
    const person = await makePerson();
    const med = await createPersonMedication(assistant, { personId: person.id, name: "Metformin" });
    expect(med.name).toBe("Metformin");
  });
});

describe("health-records.service — proveedores/médicos", () => {
  it("X) usuario autorizado lista los proveedores de una persona", async () => {
    const person = await makePerson();
    await createPersonProvider(admin, { personId: person.id, type: "PCP", name: "Dr. Smith" });
    const providers = await listPersonProviders(admin, person.id);
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("Dr. Smith");
    expect(providers[0].type).toBe("PCP");
  });

  it("Y) crear proveedor con todos los campos", async () => {
    const person = await makePerson();
    const provider = await createPersonProvider(admin, {
      personId: person.id,
      type: "SPECIALIST",
      name: "Dra. Gómez",
      specialty: "Cardiología",
      phone: "555-1234",
      organization: "Clínica Central",
      notes: "Prefiere citas por la tarde",
    });
    expect(provider.specialty).toBe("Cardiología");
    expect(provider.phone).toBe("555-1234");
    expect(provider.organization).toBe("Clínica Central");
  });

  it("Z) actualizar proveedor", async () => {
    const person = await makePerson();
    const provider = await createPersonProvider(admin, { personId: person.id, type: "PCP", name: "Dr. Smith" });
    const updated = await updatePersonProvider(admin, provider.id, { phone: "555-9999" });
    expect(updated.phone).toBe("555-9999");
    expect(updated.name).toBe("Dr. Smith");
  });

  it("AA) eliminar proveedor lo borra físicamente (no tiene isActive, a diferencia de medicamentos)", async () => {
    const person = await makePerson();
    const provider = await createPersonProvider(admin, { personId: person.id, type: "PCP", name: "Dr. Smith" });
    await deletePersonProvider(admin, provider.id);

    const raw = await prisma.personProvider.findUnique({ where: { id: provider.id } });
    expect(raw).toBeNull();
  });

  it("AB) AGENT sin acceso a la persona no puede leer/crear/editar/eliminar proveedores", async () => {
    const person = await makePerson(agentB.id);
    await expect(listPersonProviders(agent, person.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createPersonProvider(agent, { personId: person.id, type: "PCP", name: "Dr. Smith" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const provider = await createPersonProvider(admin, { personId: person.id, type: "PCP", name: "Dr. Smith" });
    await expect(
      updatePersonProvider(agent, provider.id, { phone: "555-0000" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(deletePersonProvider(agent, provider.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
