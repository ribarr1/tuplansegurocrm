import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  intakeLead,
  createLeadManual,
  listLeads,
  getLeadById,
  assignLead,
  updateLeadFollowUpStatus,
  markLeadAsProspect,
  closeLead,
  addLeadActivity,
  convertLead,
  getLeadCounts,
  updateLeadDetails,
} from "@/services/leads.service";
import { createLeadCredential } from "@/services/lead-credentials.service";
import type { AuthorizedUser } from "@/lib/authorization";
import { Prisma } from "@/generated/prisma/client";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdLeadIds: string[] = [];
const createdCredentialIds: string[] = [];
const createdTaskIds: string[] = [];

function trackLead<T extends { id: string }>(l: T): T {
  createdLeadIds.push(l.id);
  return l;
}
function trackPerson<T extends { id: string }>(p: T): T {
  createdPersonIds.push(p.id);
  return p;
}

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function uniquePhone(): string {
  // 10 dígitos únicos — nunca colisiona con pruebas ejecutadas en paralelo.
  return `555${Date.now().toString().slice(-7)}`;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
      isAgent: role === "AGENT",
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makePerson(phone: string, assignedAgentId: string | null = null) {
  const person = await prisma.person.create({
    data: {
      firstName: "Test",
      lastName: `Person${Date.now()}${Math.random().toString(36).slice(2)}`,
      phone,
      contactStatus: "CLIENT",
      assignedAgentId,
    },
  });
  return trackPerson(person);
}

async function makeActiveProduct() {
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Lead") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Lead"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  return product;
}

async function makeWebCredential(actor: AuthorizedUser) {
  const created = await createLeadCredential(actor, { label: uniqueName("Credencial Web"), source: "WEB" });
  createdCredentialIds.push(created.id);
  return created;
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-lead");
  agent = await makeActor("AGENT", "agent-lead");
  agentB = await makeActor("AGENT", "agentb-lead");
  assistant = await makeActor("ASSISTANT", "assistant-lead");
});

afterAll(async () => {
  await prisma.task.deleteMany({ where: { OR: [{ id: { in: createdTaskIds } }, { leadId: { in: createdLeadIds } }] } });
  await prisma.leadActivity.deleteMany({ where: { leadId: { in: createdLeadIds } } });
  await prisma.leadAssignmentHistory.deleteMany({ where: { leadId: { in: createdLeadIds } } });
  await prisma.lead.deleteMany({ where: { id: { in: createdLeadIds } } });
  await prisma.leadIntegrationCredential.deleteMany({ where: { id: { in: createdCredentialIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("leads.service — recepción e idempotencia", () => {
  it("A) intakeLead crea un lead con la fuente de la credencial, no del payload", async () => {
    const credential = await makeWebCredential(admin);
    const result = await intakeLead(credential, {
      fullName: uniqueName("Lead A"),
      phone: uniquePhone(),
      externalId: `ext-${Date.now()}`,
    });
    trackLead(result.lead);
    expect(result.lead.source).toBe("WEB");
    expect(result.duplicate).toBe(false);
  });

  it("B) reenvío con el mismo externalId y los MISMOS datos no duplica lead", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `ext-dup-${Date.now()}`;
    const payload = { fullName: uniqueName("Lead B"), phone: uniquePhone(), externalId };
    const first = trackLead((await intakeLead(credential, payload)).lead);
    const second = await intakeLead(credential, payload);
    expect(second.duplicate).toBe(true);
    expect(second.lead.id).toBe(first.id);

    const count = await prisma.lead.count({ where: { integrationCredentialId: credential.id, externalId } });
    expect(count).toBe(1);
  });

  it("C) reenvío con la misma idempotencyKey y los MISMOS datos no duplica", async () => {
    const credential = await makeWebCredential(admin);
    const idempotencyKey = `idem-${Date.now()}`;
    const payload = { fullName: uniqueName("Lead C"), phone: uniquePhone(), idempotencyKey };
    const first = trackLead((await intakeLead(credential, payload)).lead);
    const second = await intakeLead(credential, payload);
    expect(second.duplicate).toBe(true);
    expect(second.lead.id).toBe(first.id);
  });

  it("C2) reutilizar el mismo externalId con datos DISTINTOS se rechaza con CONFLICT, sin devolver el registro anterior", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `ext-conflict-${Date.now()}`;
    const first = trackLead(
      (await intakeLead(credential, { fullName: uniqueName("Lead C2"), phone: uniquePhone(), externalId })).lead
    );
    await expect(
      intakeLead(credential, { fullName: "Nombre completamente distinto", phone: "9995551234", externalId })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "El externalId ya fue utilizado con otros datos. Usa un externalId nuevo para una nueva consulta.",
    });

    // El registro original NUNCA se modifica ni se duplica por el intento rechazado.
    const stillOriginal = await prisma.lead.findUnique({ where: { id: first.id } });
    expect(stillOriginal?.fullName).toBe(first.fullName);
    const count = await prisma.lead.count({ where: { integrationCredentialId: credential.id, externalId } });
    expect(count).toBe(1);
  });

  it("C3) reutilizar la misma idempotencyKey con datos DISTINTOS se rechaza con CONFLICT", async () => {
    const credential = await makeWebCredential(admin);
    const idempotencyKey = `idem-conflict-${Date.now()}`;
    const first = trackLead(
      (await intakeLead(credential, { fullName: uniqueName("Lead C3"), phone: uniquePhone(), idempotencyKey })).lead
    );
    await expect(
      intakeLead(credential, { fullName: uniqueName("Lead C3 distinto"), phone: uniquePhone(), idempotencyKey })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "La clave de idempotencia ya fue utilizada con otros datos. Usa una clave nueva para una nueva consulta.",
    });

    const count = await prisma.lead.count({ where: { integrationCredentialId: credential.id, idempotencyKey } });
    expect(count).toBe(1);
    void first;
  });

  it("C4) editar los datos del lead desde el CRM no afecta la idempotencia: reenviar el payload ORIGINAL sigue reconociéndose sin 409", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `ext-edit-${Date.now()}`;
    const originalPayload = {
      fullName: uniqueName("Lead C4 Original"),
      phone: uniquePhone(),
      email: "original@example.com",
      externalId,
    };
    const first = trackLead((await intakeLead(credential, originalPayload)).lead);

    // El agente corrige nombre/correo/teléfono desde el CRM — campos
    // editables desde "Editar datos" (Fase 026).
    await updateLeadDetails(admin, first.id, {
      fullName: "Nombre Corregido Por El Agente",
      phone: uniquePhone(),
      email: "corregido@example.com",
      residenceState: "",
      productInterest: "",
    });

    // Reenviar el payload ORIGINAL (idéntico al primero) con la misma
    // clave debe seguir devolviendo el MISMO lead sin 409 — la
    // comparación es contra la instantánea original inmutable, nunca
    // contra los campos ya editados.
    const resend = await intakeLead(credential, originalPayload);
    expect(resend.duplicate).toBe(true);
    expect(resend.lead.id).toBe(first.id);
  });

  it("C5) formResponses se compara sin depender del orden de propiedades (incluso anidadas); el orden de los arrays SÍ importa", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `ext-form-${Date.now()}`;
    const phone = uniquePhone();
    const fullName = uniqueName("Lead C5");
    const first = trackLead(
      (
        await intakeLead(credential, {
          fullName,
          phone,
          externalId,
          formResponses: { a: 1, nested: { x: 1, y: 2 }, list: [1, 2, 3] },
        })
      ).lead
    );

    const sameDataDifferentKeyOrder = await intakeLead(credential, {
      fullName,
      phone,
      externalId,
      formResponses: { nested: { y: 2, x: 1 }, a: 1, list: [1, 2, 3] },
    });
    expect(sameDataDifferentKeyOrder.duplicate).toBe(true);
    expect(sameDataDifferentKeyOrder.lead.id).toBe(first.id);

    await expect(
      intakeLead(credential, {
        fullName,
        phone,
        externalId,
        formResponses: { nested: { x: 1, y: 2 }, a: 1, list: [3, 2, 1] },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("C6) externalId e idempotencyKey que apuntan a DOS registros distintos se rechazan con CONFLICT, sin modificar ninguno", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `ext-mix-${Date.now()}`;
    const idempotencyKey = `idem-mix-${Date.now()}`;

    const leadA = trackLead(
      (await intakeLead(credential, { fullName: uniqueName("Lead C6-A"), phone: uniquePhone(), externalId })).lead
    );
    const leadB = trackLead(
      (await intakeLead(credential, { fullName: uniqueName("Lead C6-B"), phone: uniquePhone(), idempotencyKey })).lead
    );

    await expect(
      intakeLead(credential, { fullName: uniqueName("Lead C6-C"), phone: uniquePhone(), externalId, idempotencyKey })
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const freshA = await prisma.lead.findUnique({ where: { id: leadA.id } });
    const freshB = await prisma.lead.findUnique({ where: { id: leadB.id } });
    expect(freshA?.fullName).toBe(leadA.fullName);
    expect(freshB?.fullName).toBe(leadB.fullName);
  });

  it("C7) un lead sin originalPayloadSnapshot (anterior a este campo) acepta el reenvío como duplicado sin comparar datos, sin inventar su payload original", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `ext-legacy-${Date.now()}`;
    const legacy = trackLead(
      (await intakeLead(credential, { fullName: uniqueName("Lead C7"), phone: uniquePhone(), externalId })).lead
    );
    // Simula un registro creado ANTES de este campo (nunca se
    // reconstruye su payload original a partir de sus datos actuales).
    await prisma.lead.update({ where: { id: legacy.id }, data: { originalPayloadSnapshot: Prisma.JsonNull } });

    const result = await intakeLead(credential, { fullName: "Dato completamente distinto", phone: uniquePhone(), externalId });
    expect(result.duplicate).toBe(true);
    expect(result.lead.id).toBe(legacy.id);
  });

  it("D) sin externalId ni idempotencyKey falla VALIDATION_ERROR", async () => {
    const credential = await makeWebCredential(admin);
    await expect(
      intakeLead(credential, { fullName: uniqueName("Lead D"), phone: uniquePhone() })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("E) teléfono inválido (sin dígitos) falla VALIDATION_ERROR", async () => {
    const credential = await makeWebCredential(admin);
    await expect(
      intakeLead(credential, { fullName: uniqueName("Lead E"), phone: "???????", externalId: `ext-${Date.now()}` })
    ).rejects.toThrow();
  });

  it("F) dos integraciones distintas pueden compartir el mismo externalId sin colisionar", async () => {
    const credentialA = await makeWebCredential(admin);
    const credentialB = await makeWebCredential(admin);
    const externalId = `shared-${Date.now()}`;
    const leadA = trackLead((await intakeLead(credentialA, { fullName: uniqueName("Lead F-A"), phone: uniquePhone(), externalId })).lead);
    const leadB = trackLead((await intakeLead(credentialB, { fullName: uniqueName("Lead F-B"), phone: uniquePhone(), externalId })).lead);
    expect(leadA.id).not.toBe(leadB.id);
  });

  it("G) solicitudes simultáneas con el mismo externalId y los MISMOS datos producen un único lead", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `concurrent-${Date.now()}`;
    const payload = { fullName: uniqueName("Lead G"), phone: uniquePhone(), externalId };
    const [r1, r2] = await Promise.all([
      intakeLead(credential, payload),
      intakeLead(credential, payload),
    ]);
    trackLead(r1.lead);
    expect(r1.lead.id).toBe(r2.lead.id);
    const count = await prisma.lead.count({ where: { integrationCredentialId: credential.id, externalId } });
    expect(count).toBe(1);
  });

  it("G2) solicitudes simultáneas con el mismo externalId pero datos DISTINTOS: una se aplica, la otra se rechaza con CONFLICT (nunca dos leads)", async () => {
    const credential = await makeWebCredential(admin);
    const externalId = `concurrent-conflict-${Date.now()}`;
    const [r1, r2] = await Promise.allSettled([
      intakeLead(credential, { fullName: "Concurrente A", phone: uniquePhone(), externalId }),
      intakeLead(credential, { fullName: "Concurrente B (otros datos)", phone: uniquePhone(), externalId }),
    ]);

    const outcomes = [r1, r2];
    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");
    // Ambas combinaciones son válidas según cuál ganó la carrera de
    // inserción: o ambas ven el mismo dato ya existente (si la segunda
    // en llegar coincide exactamente con lo ya insertado, lo cual no
    // ocurre aquí porque los datos son distintos) o una se aplica y la
    // otra es rechazada por CONFLICT — nunca dos leads creados.
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
    if (fulfilled[0].status === "fulfilled") trackLead(fulfilled[0].value.lead);
    if (rejected[0].status === "rejected") {
      expect(rejected[0].reason).toMatchObject({ code: "CONFLICT" });
    }

    const count = await prisma.lead.count({ where: { integrationCredentialId: credential.id, externalId } });
    expect(count).toBe(1);
  });

  it("H) consentGiven ausente se guarda como null, nunca como false", async () => {
    const credential = await makeWebCredential(admin);
    const result = await intakeLead(credential, { fullName: uniqueName("Lead H"), phone: uniquePhone(), externalId: `ext-${Date.now()}` });
    trackLead(result.lead);
    expect(result.lead.consentGiven).toBeNull();
  });

  it("H2) formResponses se guarda y se expone en el detalle del lead (§ Respuestas del formulario)", async () => {
    const credential = await makeWebCredential(admin);
    const formResponses = { pregunta1: "respuesta", anidado: { a: 1, b: [1, 2, 3] } };
    const created = await intakeLead(credential, {
      fullName: uniqueName("Lead H2"),
      phone: uniquePhone(),
      externalId: `ext-${Date.now()}`,
      formResponses,
    });
    trackLead(created.lead);

    const detail = await getLeadById(admin, created.lead.id);
    expect(detail.formResponses).toEqual(formResponses);
  });
});

describe("leads.service — coincidencia por teléfono", () => {
  it("I) una sola coincidencia de Person vincula automáticamente y crea tarea sin asignar", async () => {
    const phone = uniquePhone();
    const person = await makePerson(phone, agent.id);
    const credential = await makeWebCredential(admin);
    const result = await intakeLead(credential, { fullName: uniqueName("Lead I"), phone, externalId: `ext-${Date.now()}` });
    trackLead(result.lead);

    expect(result.personMatch.matched).toBe(true);
    expect(result.personMatch.ambiguous).toBe(false);
    expect(result.lead.linkedPersonId).toBe(person.id);

    const task = await prisma.task.findFirst({ where: { leadId: result.lead.id } });
    expect(task).not.toBeNull();
    expect(task?.assignedToId).toBeNull();
    createdTaskIds.push(task!.id);
  });

  it("J) varias coincidencias de Person dejan el lead sin vincular (ambiguo)", async () => {
    const phone = uniquePhone();
    await makePerson(phone);
    await makePerson(phone);
    const credential = await makeWebCredential(admin);
    const result = await intakeLead(credential, { fullName: uniqueName("Lead J"), phone, externalId: `ext-${Date.now()}` });
    trackLead(result.lead);

    expect(result.personMatch.matched).toBe(false);
    expect(result.personMatch.ambiguous).toBe(true);
    expect(result.lead.linkedPersonId).toBeNull();

    const task = await prisma.task.findFirst({ where: { leadId: result.lead.id } });
    expect(task).toBeNull();
  });

  it("K) sin ninguna coincidencia, el lead queda sin vincular y sin tarea", async () => {
    const credential = await makeWebCredential(admin);
    const result = await intakeLead(credential, { fullName: uniqueName("Lead K"), phone: uniquePhone(), externalId: `ext-${Date.now()}` });
    trackLead(result.lead);
    expect(result.lead.linkedPersonId).toBeNull();
    const task = await prisma.task.findFirst({ where: { leadId: result.lead.id } });
    expect(task).toBeNull();
  });

  it("L) otra consulta con el mismo teléfono se reporta como relacionada", async () => {
    const phone = uniquePhone();
    const credential = await makeWebCredential(admin);
    const first = trackLead((await intakeLead(credential, { fullName: uniqueName("Lead L1"), phone, externalId: `ext-${Date.now()}-1` })).lead);
    const second = await intakeLead(credential, { fullName: uniqueName("Lead L2"), phone, externalId: `ext-${Date.now()}-2` });
    trackLead(second.lead);
    expect(second.relatedLeads.map((r) => r.id)).toContain(first.id);
  });
});

describe("leads.service — creación manual y permisos", () => {
  it("M) createLeadManual solo ADMIN", async () => {
    await expect(
      createLeadManual(agent, { fullName: uniqueName("Lead M"), phone: uniquePhone() })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("N) createLeadManual con agente inválido falla VALIDATION_ERROR", async () => {
    await expect(
      createLeadManual(admin, { fullName: uniqueName("Lead N"), phone: uniquePhone(), assignedToId: admin.id })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("O) createLeadManual con agente válido registra historial de asignación inicial", async () => {
    const result = trackLead(
      (await createLeadManual(admin, { fullName: uniqueName("Lead O"), phone: uniquePhone(), assignedToId: agent.id })).lead
    );
    expect(result.assignedTo?.id).toBe(agent.id);
    const history = await prisma.leadAssignmentHistory.findMany({ where: { leadId: result.id } });
    expect(history).toHaveLength(1);
    expect(history[0].newAgentId).toBe(agent.id);
  });

  it("P) ASSISTANT no tiene ningún acceso al módulo", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead P"), phone: uniquePhone() })).lead);
    await expect(listLeads(assistant, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getLeadById(assistant, lead.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("Q) AGENT solo ve los leads asignados a él (nunca sin asignar ni de otro agente)", async () => {
    const own = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead Q-own"), phone: uniquePhone(), assignedToId: agent.id })).lead);
    const other = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead Q-other"), phone: uniquePhone(), assignedToId: agentB.id })).lead);
    const unassigned = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead Q-unassigned"), phone: uniquePhone() })).lead);

    const { items } = await listLeads(agent, {});
    const ids = items.map((i) => i.id);
    expect(ids).toContain(own.id);
    expect(ids).not.toContain(other.id);
    expect(ids).not.toContain(unassigned.id);
  });

  it("R) AGENT bloqueado al ver el detalle de un lead ajeno", async () => {
    const other = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead R"), phone: uniquePhone(), assignedToId: agentB.id })).lead);
    await expect(getLeadById(agent, other.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("leads.service — asignación", () => {
  it("S) solo ADMIN asigna/reasigna", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead S"), phone: uniquePhone() })).lead);
    await expect(assignLead(agent, lead.id, { assignedToId: agent.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("T) reasignar registra historial y el agente anterior pierde acceso", async () => {
    const lead = trackLead(
      (await createLeadManual(admin, { fullName: uniqueName("Lead T"), phone: uniquePhone(), assignedToId: agent.id })).lead
    );
    await assignLead(admin, lead.id, { assignedToId: agentB.id });

    await expect(getLeadById(agent, lead.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const fetched = await getLeadById(agentB, lead.id);
    expect(fetched.assignedTo?.id).toBe(agentB.id);

    const history = await prisma.leadAssignmentHistory.findMany({ where: { leadId: lead.id }, orderBy: { assignedAt: "asc" } });
    expect(history.at(-1)?.previousAgentId).toBe(agent.id);
    expect(history.at(-1)?.newAgentId).toBe(agentB.id);
  });

  it("U) desasignar (assignedToId=\"\") deja el lead sin asignar", async () => {
    const lead = trackLead(
      (await createLeadManual(admin, { fullName: uniqueName("Lead U"), phone: uniquePhone(), assignedToId: agent.id })).lead
    );
    const updated = await assignLead(admin, lead.id, { assignedToId: "" });
    expect(updated?.assignedTo).toBeNull();
  });

  it("V) reassignPendingTask reasigna la tarea de atención abierta al nuevo agente", async () => {
    const phone = uniquePhone();
    await makePerson(phone);
    const credential = await makeWebCredential(admin);
    const intake = trackLead((await intakeLead(credential, { fullName: uniqueName("Lead V"), phone, externalId: `ext-${Date.now()}` })).lead);
    const task = await prisma.task.findFirst({ where: { leadId: intake.id } });
    createdTaskIds.push(task!.id);

    await assignLead(admin, intake.id, { assignedToId: agent.id, reassignPendingTask: "true" });
    const updatedTask = await prisma.task.findUnique({ where: { id: task!.id } });
    expect(updatedTask?.assignedToId).toBe(agent.id);
  });
});

describe("leads.service — etapa, seguimiento y cierre", () => {
  it("W) markLeadAsProspect solo funciona desde la etapa LEAD", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead W"), phone: uniquePhone() })).lead);
    const updated = await markLeadAsProspect(admin, lead.id);
    expect(updated.stage).toBe("PROSPECT");
    await expect(markLeadAsProspect(admin, lead.id)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("X) updateLeadFollowUpStatus rechaza CONVERTED/CLOSED (acciones dedicadas)", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead X"), phone: uniquePhone() })).lead);
    await expect(updateLeadFollowUpStatus(admin, lead.id, { followUpStatus: "CLOSED" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("Y) closeLead requiere closeReasonDetail cuando el motivo es OTHER", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead Y"), phone: uniquePhone() })).lead);
    await expect(closeLead(admin, lead.id, { closeReason: "OTHER" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const closed = await closeLead(admin, lead.id, { closeReason: "OTHER", closeReasonDetail: "Explicación requerida" });
    expect(closed.followUpStatus).toBe("CLOSED");
  });

  it("Z) no se puede cerrar un lead ya cerrado ni uno convertido", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead Z"), phone: uniquePhone() })).lead);
    await closeLead(admin, lead.id, { closeReason: "NOT_INTERESTED" });
    await expect(closeLead(admin, lead.id, { closeReason: "NOT_INTERESTED" })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("AA) addLeadActivity registra actividad y, con nextActionAt, crea una tarea adicional", async () => {
    const lead = trackLead(
      (await createLeadManual(admin, { fullName: uniqueName("Lead AA"), phone: uniquePhone(), assignedToId: agent.id })).lead
    );
    await addLeadActivity(agent, lead.id, { type: "CALL", outcome: "No contestó", nextActionAt: "2026-12-01T10:00" });
    const detail = await getLeadById(agent, lead.id);
    expect(detail.activities).toHaveLength(1);
    expect(detail.tasks.length).toBeGreaterThanOrEqual(1);
    for (const t of detail.tasks) createdTaskIds.push(t.id);
  });
});

describe("leads.service — conversión", () => {
  it("BB) convertLead con una persona nueva crea Policy PENDING y marca CLIENT/CONVERTED", async () => {
    const product = await makeActiveProduct();
    const lead = trackLead((await createLeadManual(admin, { fullName: "Carlos Nuevo", phone: uniquePhone() })).lead);

    const result = await convertLead(admin, lead.id, {
      newPerson: { firstName: "Carlos", lastName: "Nuevo", phone: lead.phone },
      policy: { productId: product.id, holderCovered: "true" },
    });
    createdPersonIds.push(result.lead.linkedPersonId!);
    createdPolicyIds.push(result.policy.id);

    expect(result.lead.stage).toBe("CLIENT");
    expect(result.lead.followUpStatus).toBe("CONVERTED");
    expect(result.policy.status).toBe("PENDING");
  });

  it("CC) convertLead vinculando una persona existente no la duplica", async () => {
    const product = await makeActiveProduct();
    const person = await makePerson(uniquePhone());
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead CC"), phone: uniquePhone() })).lead);

    const result = await convertLead(admin, lead.id, {
      personId: person.id,
      policy: { productId: product.id, holderCovered: "true" },
    });
    createdPolicyIds.push(result.policy.id);

    expect(result.lead.linkedPersonId).toBe(person.id);
    const personCount = await prisma.person.count({ where: { id: person.id } });
    expect(personCount).toBe(1);
  });

  it("DD) un lead ya convertido no se puede volver a convertir", async () => {
    const product = await makeActiveProduct();
    const person = await makePerson(uniquePhone());
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead DD"), phone: uniquePhone() })).lead);
    const first = await convertLead(admin, lead.id, { personId: person.id, policy: { productId: product.id, holderCovered: "true" } });
    createdPolicyIds.push(first.policy.id);

    await expect(
      convertLead(admin, lead.id, { personId: person.id, policy: { productId: product.id, holderCovered: "true" } })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("EE) holderCovered=false no cubre automáticamente al titular", async () => {
    const product = await makeActiveProduct();
    const person = await makePerson(uniquePhone());
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead EE"), phone: uniquePhone() })).lead);

    const result = await convertLead(admin, lead.id, {
      personId: person.id,
      policy: { productId: product.id, holderCovered: "false" },
    });
    createdPolicyIds.push(result.policy.id);

    const members = await prisma.policyMember.findMany({ where: { policyId: result.policy.id } });
    expect(members).toHaveLength(0);
  });

  it("FF) createPolicy falla por producto inexistente: NO queda Person huérfana, NO queda Policy, el lead conserva su etapa/estado anterior", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead FF"), phone: uniquePhone() })).lead);
    const uniqueFirstName = uniqueName("Huerfano");

    await expect(
      convertLead(admin, lead.id, {
        newPerson: { firstName: uniqueFirstName, lastName: "Test", phone: uniquePhone() },
        policy: { productId: "00000000-0000-4000-8000-000000000099", holderCovered: "true" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const orphanPerson = await prisma.person.findFirst({ where: { firstName: uniqueFirstName } });
    expect(orphanPerson).toBeNull();

    const freshLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(freshLead?.stage).toBe("LEAD");
    expect(freshLead?.followUpStatus).toBe("NEW");
    expect(freshLead?.convertedPolicyId).toBeNull();
  });

  it("GG) createPolicy falla al crear un covered member inválido: la Policy creada en la MISMA transacción se revierte completa (no queda parcial), y la Person nueva tampoco queda huérfana", async () => {
    const product = await makeActiveProduct();
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead GG"), phone: uniquePhone() })).lead);
    const uniqueFirstName = uniqueName("SinPolizaParcial");

    await expect(
      convertLead(admin, lead.id, {
        newPerson: { firstName: uniqueFirstName, lastName: "Test", phone: uniquePhone() },
        policy: {
          productId: product.id,
          holderCovered: "true",
          coveredMembers: [{ personId: "00000000-0000-4000-8000-000000000098", role: "SPOUSE" }],
        },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const orphanPerson = await prisma.person.findFirst({ where: { firstName: uniqueFirstName } });
    expect(orphanPerson).toBeNull();

    const freshLead = await prisma.lead.findUnique({ where: { id: lead.id } });
    expect(freshLead?.stage).toBe("LEAD");
    expect(freshLead?.convertedPolicyId).toBeNull();

    // La Policy creada DENTRO de la misma transacción (antes de fallar
    // al agregar el covered member) tampoco debe quedar en la base —
    // confirmamos que no existe ninguna policy del producto recién
    // creado para este intento fallido.
    const policiesForProduct = await prisma.policy.count({ where: { productId: product.id } });
    expect(policiesForProduct).toBe(0);
  });

  it("HH) una Person EXISTENTE elegida en una conversión que luego falla no sufre ninguna modificación", async () => {
    const person = await makePerson(uniquePhone());
    const before = await prisma.person.findUnique({ where: { id: person.id } });
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead HH"), phone: uniquePhone() })).lead);

    await expect(
      convertLead(admin, lead.id, {
        personId: person.id,
        policy: { productId: "00000000-0000-4000-8000-000000000097", holderCovered: "true" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const after = await prisma.person.findUnique({ where: { id: person.id } });
    expect(after).toEqual(before);
  });

  it("II) reintentar después de un fallo real no duplica — el segundo intento con datos válidos convierte normalmente", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead II"), phone: uniquePhone() })).lead);
    const uniqueFirstName = uniqueName("Reintento");
    const phone = uniquePhone();

    await expect(
      convertLead(admin, lead.id, {
        newPerson: { firstName: uniqueFirstName, lastName: "Test", phone },
        policy: { productId: "00000000-0000-4000-8000-000000000096", holderCovered: "true" },
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const product = await makeActiveProduct();
    const result = await convertLead(admin, lead.id, {
      newPerson: { firstName: uniqueFirstName, lastName: "Test", phone },
      policy: { productId: product.id, holderCovered: "true" },
    });
    createdPersonIds.push(result.lead.linkedPersonId!);
    createdPolicyIds.push(result.policy.id);

    expect(result.lead.stage).toBe("CLIENT");
    const matchingPeople = await prisma.person.count({ where: { firstName: uniqueFirstName } });
    expect(matchingPeople).toBe(1);
  });

  it("JJ) dos conversiones simultáneas del mismo lead nunca crean dos pólizas ni dos personas", async () => {
    const productA = await makeActiveProduct();
    const productB = await makeActiveProduct();
    const person = await makePerson(uniquePhone());
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead JJ"), phone: uniquePhone() })).lead);

    const [r1, r2] = await Promise.allSettled([
      convertLead(admin, lead.id, { personId: person.id, policy: { productId: productA.id, holderCovered: "true" } }),
      convertLead(admin, lead.id, { personId: person.id, policy: { productId: productB.id, holderCovered: "true" } }),
    ]);

    const succeeded = [r1, r2].filter((r) => r.status === "fulfilled");
    const failed = [r1, r2].filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    if (failed[0].status === "rejected") {
      expect(failed[0].reason).toMatchObject({ code: "CONFLICT" });
    }
    if (succeeded[0].status === "fulfilled") {
      createdPolicyIds.push(succeeded[0].value.policy.id);
    }

    const policiesForPerson = await prisma.policy.count({ where: { holderId: person.id } });
    expect(policiesForPerson).toBe(1);
  });
});

describe("leads.service — editar datos del lead", () => {
  it("KK) ADMIN puede editar los datos de cualquier lead", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead KK"), phone: uniquePhone() })).lead);
    const newPhone = uniquePhone();
    const result = await updateLeadDetails(admin, lead.id, {
      fullName: "Nombre Corregido",
      phone: newPhone,
      email: "corregido@example.com",
      residenceState: "FL",
      productInterest: "DENTAL",
    });
    expect(result.lead.fullName).toBe("Nombre Corregido");
    expect(result.lead.phone).toBe(newPhone);
    expect(result.lead.email).toBe("corregido@example.com");
    expect(result.lead.residenceState).toBe("FL");
    expect(result.lead.productInterest).toBe("DENTAL");
  });

  it("LL) el agente ASIGNADO puede editar su propio lead; otro agente no puede", async () => {
    const lead = trackLead(
      (await createLeadManual(admin, { fullName: uniqueName("Lead LL"), phone: uniquePhone(), assignedToId: agent.id })).lead
    );
    const updated = await updateLeadDetails(agent, lead.id, {
      fullName: "Actualizado por su agente",
      phone: lead.phone,
      email: "",
      residenceState: "",
      productInterest: "",
    });
    expect(updated.lead.fullName).toBe("Actualizado por su agente");

    await expect(
      updateLeadDetails(agentB, lead.id, { fullName: "Intento ajeno", phone: lead.phone, email: "", residenceState: "", productInterest: "" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("MM) campos opcionales se pueden borrar enviando \"\" (vuelven a null, nunca se interpretan como 'no tocar')", async () => {
    const lead = trackLead(
      (await createLeadManual(admin, {
        fullName: uniqueName("Lead MM"),
        phone: uniquePhone(),
        email: "tenia@example.com",
        residenceState: "TX",
      })).lead
    );
    const updated = await updateLeadDetails(admin, lead.id, {
      fullName: lead.fullName,
      phone: lead.phone,
      email: "",
      residenceState: "",
      productInterest: "",
    });
    expect(updated.lead.email).toBeNull();
    expect(updated.lead.residenceState).toBeNull();
    expect(updated.lead.productInterest).toBeNull();
  });

  it("NN) teléfono inválido falla VALIDATION_ERROR", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead NN"), phone: uniquePhone() })).lead);
    await expect(
      updateLeadDetails(admin, lead.id, { fullName: lead.fullName, phone: "abc", email: "", residenceState: "", productInterest: "" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("OO) cambiar el teléfono reporta coincidencias SIN vincular/desvincular automáticamente", async () => {
    const existingPersonPhone = uniquePhone();
    await makePerson(existingPersonPhone);
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead OO"), phone: uniquePhone() })).lead);

    const result = await updateLeadDetails(admin, lead.id, {
      fullName: lead.fullName,
      phone: existingPersonPhone,
      email: "",
      residenceState: "",
      productInterest: "",
    });

    expect(result.phoneChanged).toBe(true);
    expect(result.personMatches).toHaveLength(1);
    expect(result.lead.linkedPersonId).toBeNull();
  });

  it("PP) no cambiar el teléfono no dispara ninguna búsqueda de coincidencias", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead PP"), phone: uniquePhone() })).lead);
    const result = await updateLeadDetails(admin, lead.id, {
      fullName: "Solo nombre cambia",
      phone: lead.phone,
      email: "",
      residenceState: "",
      productInterest: "",
    });
    expect(result.phoneChanged).toBe(false);
    expect(result.personMatches).toHaveLength(0);
  });

  it("QQ) editar datos NUNCA toca stage/followUpStatus/assignedToId, ni los datos de una Person/Policy vinculada", async () => {
    const product = await makeActiveProduct();
    const person = await makePerson(uniquePhone());
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead QQ"), phone: uniquePhone(), assignedToId: agent.id })).lead);
    const converted = await convertLead(admin, lead.id, { personId: person.id, policy: { productId: product.id, holderCovered: "true" } });
    createdPolicyIds.push(converted.policy.id);
    // Snapshot DESPUÉS de convertir (createPolicy ya recomputó
    // contactStatus según cobertura real — eso es correcto y NO forma
    // parte de lo que esta prueba verifica) y ANTES de editar datos,
    // que es el único cambio bajo prueba aquí.
    const personBefore = await prisma.person.findUnique({ where: { id: person.id } });

    const updated = await updateLeadDetails(admin, lead.id, {
      fullName: "Nombre tras conversión",
      phone: converted.lead.phone,
      email: "",
      residenceState: "",
      productInterest: "",
    });

    expect(updated.lead.stage).toBe("CLIENT");
    expect(updated.lead.followUpStatus).toBe("CONVERTED");
    expect(updated.lead.assignedToId).toBe(agent.id);
    expect(updated.lead.linkedPersonId).toBe(person.id);
    expect(updated.lead.convertedPolicyId).toBe(converted.policy.id);

    const personAfter = await prisma.person.findUnique({ where: { id: person.id } });
    expect(personAfter).toEqual(personBefore);
  });

  it("RR) registra auditoría LEAD_UPDATE_DETAILS con los campos modificados", async () => {
    const lead = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead RR"), phone: uniquePhone() })).lead);
    await updateLeadDetails(admin, lead.id, {
      fullName: "Nombre Auditado",
      phone: lead.phone,
      email: "",
      residenceState: "",
      productInterest: "",
    });
    const event = await prisma.auditEvent.findFirst({
      where: { entityType: "Lead", entityId: lead.id, action: "LEAD_UPDATE_DETAILS" },
    });
    expect(event).not.toBeNull();
    expect(event?.actorUserId).toBe(admin.id);
    const changes = event?.changes as Record<string, { before: unknown; after: unknown }> | null;
    expect(changes?.fullName?.after).toBe("Nombre Auditado");
  });
});

describe("leads.service — contadores del dashboard", () => {
  it("EE) getLeadCounts cuenta por followUpStatus y 'sin asignar' es independiente", async () => {
    const unassigned = trackLead((await createLeadManual(admin, { fullName: uniqueName("Lead EE-1"), phone: uniquePhone() })).lead);
    const assigned = trackLead(
      (await createLeadManual(admin, { fullName: uniqueName("Lead EE-2"), phone: uniquePhone(), assignedToId: agent.id })).lead
    );

    const counts = await getLeadCounts(admin);
    expect(counts.new).toBeGreaterThanOrEqual(2);
    expect(counts.unassigned).toBeGreaterThanOrEqual(1);

    const agentCounts = await getLeadCounts(agent);
    expect(agentCounts.new).toBeGreaterThanOrEqual(1);
    void unassigned;
    void assigned;
  });
});
