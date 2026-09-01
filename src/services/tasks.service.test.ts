import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listTasks,
  getTaskById,
  getTasksForPerson,
  createTask,
  updateTask,
  completeTask,
  cancelTask,
  isTaskOverdue,
} from "@/services/tasks.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdTaskIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];

function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}
function trackTask<T extends { id: string }>(t: T): T {
  createdTaskIds.push(t.id);
  return t;
}
function trackPolicy<T extends { id: string }>(p: T): T {
  createdPolicyIds.push(p.id);
  return p;
}

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string, isActive = true): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive,
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
  return trackPerson(person);
}

async function makePolicyFor(actor: AuthorizedUser, holder: { id: string }) {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Task") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Task"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await createPolicy(actor, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
  });
  return trackPolicy(policy);
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-task");
  agent = await makeActor("AGENT", "agent-task");
  agentB = await makeActor("AGENT", "agentb-task");
  assistant = await makeActor("ASSISTANT", "assistant-task");
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { id: { in: createdTaskIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("tasks.service", () => {
  it("A) crear Task OPEN", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea A") }));
    expect(task.status).toBe("OPEN");
  });

  it("B) priority default NORMAL", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea B") }));
    expect(task.priority).toBe("NORMAL");
  });

  it("C) dueAt válido se guarda correctamente", async () => {
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea C"), dueAt: "2026-09-15T14:30" })
    );
    expect(task.dueAt).not.toBeNull();
    expect(task.dueAt?.getHours()).toBe(14);
    expect(task.dueAt?.getMinutes()).toBe(30);
  });

  it("D) Task sin dueAt funciona", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea D") }));
    expect(task.dueAt).toBeNull();
  });

  it("E) crear vinculada a Person", async () => {
    const person = await makePerson();
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea E"), personId: person.id })
    );
    expect(task.person?.id).toBe(person.id);
  });

  it("F) crear vinculada a Policy", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea F"), policyId: policy.id })
    );
    expect(task.policy?.id).toBe(policy.id);
  });

  it("G) Person inexistente falla", async () => {
    await expect(
      createTask(admin, {
        title: uniqueName("Tarea G"),
        personId: "00000000-0000-4000-8000-000000000001",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("H) Policy inexistente falla", async () => {
    await expect(
      createTask(admin, {
        title: uniqueName("Tarea H"),
        policyId: "00000000-0000-4000-8000-000000000002",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("I) AGENT crea dentro de su acceso", async () => {
    const person = await makePerson(agent.id);
    const task = trackTask(
      await createTask(agent, { title: uniqueName("Tarea I"), personId: person.id })
    );
    expect(task.person?.id).toBe(person.id);
  });

  it("J) AGENT bloqueado fuera de su acceso", async () => {
    const person = await makePerson(agentB.id);
    await expect(
      createTask(agent, { title: uniqueName("Tarea J"), personId: person.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("K) ADMIN puede asignar", async () => {
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea K"), assignedToId: agent.id })
    );
    expect(task.assignedTo?.id).toBe(agent.id);
  });

  it("L) AGENT no asigna arbitrariamente a otro usuario (siempre queda asignado a sí mismo)", async () => {
    const task = trackTask(
      await createTask(agent, { title: uniqueName("Tarea L"), assignedToId: agentB.id })
    );
    expect(task.assignedTo?.id).toBe(agent.id);
  });

  it("M) ASSISTANT crea y asigna sin restricción de asignación", async () => {
    const person = await makePerson(agentB.id);
    const task = trackTask(
      await createTask(assistant, {
        title: uniqueName("Tarea M"),
        personId: person.id,
        assignedToId: agentB.id,
      })
    );
    expect(task.person?.id).toBe(person.id);
    expect(task.assignedTo?.id).toBe(agentB.id);
  });

  it("N) completeTask -> COMPLETED", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea N") }));
    const completed = await completeTask(admin, task.id);
    expect(completed.status).toBe("COMPLETED");
    expect(completed.completedAt).not.toBeNull();
  });

  it("O) cancelTask -> CANCELLED", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea O") }));
    const cancelled = await cancelTask(admin, task.id);
    expect(cancelled.status).toBe("CANCELLED");
  });

  it("P) overdue derivado correctamente", async () => {
    const past = new Date(Date.now() - 60_000);
    const overdueTask = { status: "OPEN" as const, dueAt: past };
    const futureTask = { status: "OPEN" as const, dueAt: new Date(Date.now() + 60_000) };
    expect(isTaskOverdue(overdueTask)).toBe(true);
    expect(isTaskOverdue(futureTask)).toBe(false);
  });

  it("Q) COMPLETED no aparece como overdue", async () => {
    const past = new Date(Date.now() - 60_000);
    expect(isTaskOverdue({ status: "COMPLETED", dueAt: past })).toBe(false);
    expect(isTaskOverdue({ status: "CANCELLED", dueAt: past })).toBe(false);
  });

  it("R) today filter correcto", async () => {
    const now = new Date();
    const todayAt = new Date(now.getTime() + 5 * 60_000);
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const todayTask = trackTask(
      await createTask(admin, { title: uniqueName("Tarea R Hoy"), dueAt: toLocalInput(todayAt) })
    );
    const tomorrowTask = trackTask(
      await createTask(admin, {
        title: uniqueName("Tarea R Mañana"),
        dueAt: toLocalInput(tomorrow),
      })
    );

    const { items } = await listTasks(admin, { dueToday: "true" });
    const ids = items.map((t) => t.id);
    expect(ids).toContain(todayTask.id);
    expect(ids).not.toContain(tomorrowTask.id);
  });

  it("S) status filter", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea S") }));
    await completeTask(admin, task.id);
    const { items } = await listTasks(admin, { status: "COMPLETED" });
    expect(items.map((t) => t.id)).toContain(task.id);
    const { items: openItems } = await listTasks(admin, { status: "OPEN" });
    expect(openItems.map((t) => t.id)).not.toContain(task.id);
  });

  it("T) priority filter", async () => {
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea T"), priority: "URGENT" })
    );
    const { items } = await listTasks(admin, { priority: "URGENT" });
    expect(items.map((t) => t.id)).toContain(task.id);
  });

  it("U) assignedTo filter", async () => {
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea U"), assignedToId: agent.id })
    );
    const { items } = await listTasks(admin, { assignedToId: agent.id });
    expect(items.map((t) => t.id)).toContain(task.id);
  });

  it("V) getTasksForPerson funciona", async () => {
    const person = await makePerson();
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea V"), personId: person.id })
    );
    const result = await getTasksForPerson(admin, person.id);
    expect(result.map((t) => t.id)).toContain(task.id);
  });

  it("W) Policy-related task consultable", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const task = trackTask(
      await createTask(admin, { title: uniqueName("Tarea W"), policyId: policy.id })
    );
    const fetched = await getTaskById(admin, task.id);
    expect(fetched.policy?.id).toBe(policy.id);
    const { items } = await listTasks(admin, { policyId: policy.id });
    expect(items.map((t) => t.id)).toContain(task.id);
  });

  // X) "usuario inactive bloqueado": misma razón documentada en los
  // servicios anteriores — cada función recibe un actor ya resuelto
  // por requireSessionUser()/requireSessionRole(), que ya rechaza
  // usuarios inactivos (probado en src/lib/authorization.test.ts).

  it("Y) listTasks no devuelve datos Health/Financial", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea Y") }));
    const { items } = await listTasks(admin, { search: task.title });
    const found = items.find((t) => t.id === task.id);
    expect(found).toBeDefined();
    const keys = found ? Object.keys(found) : [];
    for (const forbidden of ["healthDetail", "commissionExpectations", "providers", "medications"]) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it("reabrir una tarea COMPLETED requiere ADMIN", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea Reopen") }));
    await completeTask(admin, task.id);
    await expect(updateTask(assistant, task.id, { status: "OPEN" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const reopened = await updateTask(admin, task.id, { status: "OPEN" });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.completedAt).toBeNull();
  });

  // Bug real encontrado en pruebas manuales (Fase 014): un <form
  // method="GET"> con un <select>/<input> vacío serializa "clave=" en
  // vez de omitir la clave — listTasksQuerySchema debe tratar eso como
  // "sin filtro", no como un UUID/string inválido. Afectaba también a
  // Contactos y Pólizas; corregido en el schema compartido
  // (schemas/common.ts), no solo en este servicio.
  it("filtros vacíos (string \"\") se tratan como ausentes, no como error de validación", async () => {
    const task = trackTask(await createTask(admin, { title: uniqueName("Tarea Filtro Vacio") }));
    const { items } = await listTasks(admin, {
      search: "",
      assignedToId: "",
      personId: "",
      policyId: "",
    });
    expect(items.map((t) => t.id)).toContain(task.id);
  });

  // Fase 019.5 — regresión: status/priority/dueToday/overdueOnly no
  // usaban z.preprocess(emptyStringToUndefined, ...) antes de esta
  // fase; un <select> sin cambiar (status="") hubiera producido
  // VALIDATION_ERROR igual que el bug real encontrado en /premiums.
  it("filtros enum/booleanos vacíos de /tasks no fallan", async () => {
    await expect(
      listTasks(admin, { status: "", priority: "", dueToday: "", overdueOnly: "" })
    ).resolves.toBeDefined();
  });
});

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
