import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listCarriers,
  getCarrierById,
  createCarrier,
  updateCarrier,
  setCarrierActive,
} from "@/services/carriers.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdCarrierIds: string[] = [];

function trackCarrier<T extends { id: string }>(c: T): T {
  createdCarrierIds.push(c.id);
  return c;
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

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-car");
  agent = await makeActor("AGENT", "agent-car");
  assistant = await makeActor("ASSISTANT", "assistant-car");
});

afterAll(async () => {
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

describe("carriers.service", () => {
  it("A) ADMIN crea Carrier", async () => {
    const name = uniqueName("Carrier A");
    const carrier = trackCarrier(await createCarrier(admin, { name }));
    expect(carrier.name).toBe(name);
    expect(carrier.isActive).toBe(true);
  });

  it("B) AGENT no crea Carrier", async () => {
    await expect(createCarrier(agent, { name: uniqueName("Carrier B") })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("C) ASSISTANT no crea Carrier", async () => {
    await expect(createCarrier(assistant, { name: uniqueName("Carrier C") })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("D) Carrier duplicado falla con CONFLICT", async () => {
    const name = uniqueName("Carrier D");
    trackCarrier(await createCarrier(admin, { name }));
    await expect(createCarrier(admin, { name })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("E) ADMIN edita Carrier", async () => {
    const carrier = trackCarrier(await createCarrier(admin, { name: uniqueName("Carrier E") }));
    const newName = uniqueName("Carrier E renombrada");
    const updated = await updateCarrier(admin, carrier.id, { name: newName });
    expect(updated.name).toBe(newName);
  });

  it("F) ADMIN desactiva Carrier", async () => {
    const carrier = trackCarrier(await createCarrier(admin, { name: uniqueName("Carrier F") }));
    const updated = await setCarrierActive(admin, carrier.id, false);
    expect(updated.isActive).toBe(false);

    const fetched = await getCarrierById(admin, carrier.id);
    expect(fetched.isActive).toBe(false);
  });

  it("listCarriers filtra por active", async () => {
    const active = trackCarrier(await createCarrier(admin, { name: uniqueName("Carrier Activa") }));
    const inactive = trackCarrier(await createCarrier(admin, { name: uniqueName("Carrier Inactiva") }));
    await setCarrierActive(admin, inactive.id, false);

    const onlyActive = await listCarriers(admin, { active: "true" });
    const ids = onlyActive.map((c) => c.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it("Carrier no encontrado", async () => {
    await expect(getCarrierById(admin, "00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
