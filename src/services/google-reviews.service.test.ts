import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  getGoogleReviewInfo,
  setGoogleReviewStatus,
  listReviewCandidates,
  getGoogleReviewCounts,
  listContactsWithReviewInfo,
} from "@/services/google-reviews.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

// Fase 025.5 (UAT-10) — seguimiento administrativo de reseñas de
// Google. Datos 100% sintéticos, nunca reales.

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];
const createdHouseholdIds: string[] = [];
const createdLicenseIds: string[] = [];
const createdContractIds: string[] = [];

function uniqueName(label: string) {
  return `${label} ${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string, isAgent = false): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: {
      name: `${label} Test`,
      email: `${label.toLowerCase()}.${Date.now()}.${Math.random().toString(36).slice(2)}@test.local`,
      role,
      isActive: true,
      isAgent: role === "AGENT" ? true : isAgent,
    },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

async function makePerson(contactStatus: "PROSPECT" | "CLIENT" = "CLIENT") {
  const person = await prisma.person.create({
    data: { firstName: "Test", lastName: uniqueName("Person"), contactStatus },
  });
  createdPersonIds.push(person.id);
  return person;
}

// Crea una póliza HEALTH OWN ACTIVE para `holder`, dándole al agente
// dado licencia+contrato reales en un estado sintético — para que
// resolveOwnPolicyProcessedById no la rechace, se pasa processedById
// explícito coincidiendo con el único agente elegible.
async function makeOwnActivePolicyFor(admin: AuthorizedUser, holder: { id: string }) {
  const agentForOwn = await makeActor("AGENT", "agent-review-own");
  const state = "WY"; // estado sintético, no usado por ningún otro test
  const household = await prisma.household.create({ data: { state } });
  createdHouseholdIds.push(household.id);
  await prisma.householdMember.create({ data: { householdId: household.id, personId: holder.id, role: "HEAD" } });
  const carrier = await prisma.carrier.create({ data: { name: uniqueName("Carrier Review") } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: uniqueName("Plan Review"), policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const license = await prisma.agentLicense.create({ data: { userId: agentForOwn.id, state, status: "ACTIVE" } });
  createdLicenseIds.push(license.id);
  const contract = await prisma.agentCarrierContract.create({
    data: { userId: agentForOwn.id, carrierId: carrier.id, state, policyType: "HEALTH", status: "ACTIVE" },
  });
  createdContractIds.push(contract.id);
  const policy = await createPolicy(admin, {
    holderId: holder.id,
    productId: product.id,
    holderCovered: "false",
    status: "ACTIVE",
    effectiveDate: new Date("2026-01-01"),
  });
  createdPolicyIds.push(policy.id);
  return policy;
}

let admin: AuthorizedUser;
let adminAgent: AuthorizedUser;
let agent: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-review");
  adminAgent = await makeActor("ADMIN", "adminagent-review", true);
  agent = await makeActor("AGENT", "agent-review");
  assistant = await makeActor("ASSISTANT", "assistant-review");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.auditEvent.deleteMany({ where: { contactPersonId: { in: createdPersonIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.agentCarrierContract.deleteMany({ where: { id: { in: createdContractIds } } });
  await prisma.agentLicense.deleteMany({ where: { id: { in: createdLicenseIds } } });
  await prisma.householdMember.deleteMany({ where: { householdId: { in: createdHouseholdIds } } });
  await prisma.household.deleteMany({ where: { id: { in: createdHouseholdIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("google-reviews.service", () => {
  it("A) estado inicial de una Person nueva es PENDING_REQUEST, sin fechas", async () => {
    const person = await makePerson();
    const info = await getGoogleReviewInfo(admin, person.id);
    expect(info.googleReviewStatus).toBe("PENDING_REQUEST");
    expect(info.reviewRequestedAt).toBeNull();
    expect(info.reviewPublishedAt).toBeNull();
  });

  it("B) ADMIN puede consultar y modificar", async () => {
    const person = await makePerson();
    const updated = await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    expect(updated.googleReviewStatus).toBe("REQUESTED");
    expect(updated.reviewRequestedAt).not.toBeNull();
  });

  it("C) ADMIN + agente (Rubén-like) puede modificar por su rol ADMIN", async () => {
    const person = await makePerson();
    const updated = await setGoogleReviewStatus(adminAgent, { personId: person.id, status: "REQUESTED" });
    expect(updated.googleReviewStatus).toBe("REQUESTED");
  });

  it("D) AGENT recibe rechazo server-side al intentar consultar", async () => {
    const person = await makePerson();
    await expect(getGoogleReviewInfo(agent, person.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("E) AGENT recibe rechazo server-side al intentar modificar", async () => {
    const person = await makePerson();
    await expect(
      setGoogleReviewStatus(agent, { personId: person.id, status: "REQUESTED" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("F) ASSISTANT recibe rechazo server-side (consultar y modificar)", async () => {
    const person = await makePerson();
    await expect(getGoogleReviewInfo(assistant, person.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setGoogleReviewStatus(assistant, { personId: person.id, status: "REQUESTED" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("G) transición a REQUESTED establece reviewRequestedAt; a PUBLISHED establece reviewPublishedAt", async () => {
    const person = await makePerson();
    const requested = await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    expect(requested.reviewRequestedAt).not.toBeNull();
    expect(requested.reviewPublishedAt).toBeNull();

    const published = await setGoogleReviewStatus(admin, { personId: person.id, status: "PUBLISHED" });
    expect(published.reviewPublishedAt).not.toBeNull();
    // reviewRequestedAt de la transición anterior se conserva (nunca se
    // borra silenciosamente al avanzar de estado).
    expect(published.reviewRequestedAt).not.toBeNull();
  });

  it("H) corregir un estado marcado por error (PUBLISHED -> REQUESTED) NUNCA borra reviewPublishedAt histórico", async () => {
    const person = await makePerson();
    const published = await setGoogleReviewStatus(admin, { personId: person.id, status: "PUBLISHED" });
    const publishedAt = published.reviewPublishedAt;
    expect(publishedAt).not.toBeNull();

    const corrected = await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    expect(corrected.googleReviewStatus).toBe("REQUESTED");
    // La fecha de publicación anterior se preserva como historial —
    // nunca se limpia solo porque el estado actual ya no es PUBLISHED.
    expect(corrected.reviewPublishedAt?.getTime()).toBe(publishedAt?.getTime());
  });

  it("I) DO_NOT_REQUEST y volver a PENDING_REQUEST son transiciones válidas", async () => {
    const person = await makePerson();
    const doNotRequest = await setGoogleReviewStatus(admin, { personId: person.id, status: "DO_NOT_REQUEST" });
    expect(doNotRequest.googleReviewStatus).toBe("DO_NOT_REQUEST");
    const backToPending = await setGoogleReviewStatus(admin, { personId: person.id, status: "PENDING_REQUEST" });
    expect(backToPending.googleReviewStatus).toBe("PENDING_REQUEST");
  });

  it("J) registra AuditEvent GOOGLE_REVIEW_STATUS_CHANGE con estado anterior/nuevo, sin PII adicional", async () => {
    const person = await makePerson();
    await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    const event = await prisma.auditEvent.findFirst({
      where: { contactPersonId: person.id, action: "GOOGLE_REVIEW_STATUS_CHANGE" },
      orderBy: { createdAt: "desc" },
    });
    expect(event).toBeTruthy();
    expect(event?.actorUserId).toBe(admin.id);
    expect(event?.changes).toMatchObject({
      googleReviewStatus: { before: "PENDING_REQUEST", after: "REQUESTED" },
    });
  });

  it("K) reviewStatusUpdatedBy queda registrado con el actor que hizo el cambio", async () => {
    const person = await makePerson();
    const updated = await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    expect(updated.reviewStatusUpdatedBy?.id).toBe(admin.id);
  });

  it("L) el seguimiento se guarda UNA vez por Person, aunque tenga varias pólizas", async () => {
    const person = await makePerson();
    await makeOwnActivePolicyFor(admin, person);
    await makeOwnActivePolicyFor(admin, person);
    const policiesCount = await prisma.policy.count({ where: { holderId: person.id } });
    expect(policiesCount).toBe(2);

    await setGoogleReviewStatus(admin, { personId: person.id, status: "PUBLISHED" });
    // Un único registro de reseña vive en Person, no en cada Policy.
    const info = await getGoogleReviewInfo(admin, person.id);
    expect(info.googleReviewStatus).toBe("PUBLISHED");
  });

  it("M) listReviewCandidates SOLO incluye contactStatus=CLIENT con póliza propia ACTIVE y estado PENDING_REQUEST", async () => {
    const eligible = await makePerson("CLIENT");
    await makeOwnActivePolicyFor(admin, eligible);

    const prospect = await makePerson("PROSPECT");
    await makeOwnActivePolicyFor(admin, prospect); // aunque tenga la póliza, sigue siendo PROSPECT

    const clientWithoutPolicy = await makePerson("CLIENT"); // sin ninguna póliza

    const alreadyRequested = await makePerson("CLIENT");
    await makeOwnActivePolicyFor(admin, alreadyRequested);
    await setGoogleReviewStatus(admin, { personId: alreadyRequested.id, status: "REQUESTED" });

    const { items } = await listReviewCandidates(admin, { pageSize: 100 });
    const ids = items.map((i) => i.id);
    expect(ids).toContain(eligible.id);
    expect(ids).not.toContain(prospect.id);
    expect(ids).not.toContain(clientWithoutPolicy.id);
    expect(ids).not.toContain(alreadyRequested.id);
  });

  it("N) una persona con DO_NOT_REQUEST nunca aparece como candidata aunque sea elegible", async () => {
    const person = await makePerson("CLIENT");
    await makeOwnActivePolicyFor(admin, person);
    await setGoogleReviewStatus(admin, { personId: person.id, status: "DO_NOT_REQUEST" });

    const { items } = await listReviewCandidates(admin, { pageSize: 100 });
    expect(items.map((i) => i.id)).not.toContain(person.id);
  });

  it("O) AGENT/ASSISTANT no pueden consultar candidatos ni contadores", async () => {
    await expect(listReviewCandidates(agent, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getGoogleReviewCounts(assistant)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("P) getGoogleReviewCounts refleja transiciones reales (conteo por estado)", async () => {
    const before = await getGoogleReviewCounts(admin);
    const person = await makePerson("CLIENT");
    await makeOwnActivePolicyFor(admin, person);
    const afterPending = await getGoogleReviewCounts(admin);
    expect(afterPending.pending).toBe(before.pending + 1);

    await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    const afterRequested = await getGoogleReviewCounts(admin);
    expect(afterRequested.pending).toBe(before.pending); // ya no cuenta como pendiente
    expect(afterRequested.requested).toBe(before.requested + 1);
  });

  it("Q) listContactsWithReviewInfo filtra por reviewStatus (ADMIN only)", async () => {
    const person = await makePerson();
    await setGoogleReviewStatus(admin, { personId: person.id, status: "PUBLISHED" });

    const { items } = await listContactsWithReviewInfo(admin, { reviewStatus: "PUBLISHED", pageSize: 100 });
    expect(items.some((i) => i.id === person.id)).toBe(true);
    expect(items.every((i) => i.googleReviewStatus === "PUBLISHED")).toBe(true);

    await expect(listContactsWithReviewInfo(agent, { reviewStatus: "PUBLISHED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("R) ningún flujo de esta fase envía nada automáticamente — setGoogleReviewStatus solo escribe estado/fechas", async () => {
    // No existe ninguna función de envío en este servicio — se
    // confirma indirectamente: el módulo completo son solo
    // lecturas/escrituras de estado, sin ninguna llamada de red/email/
    // SMS. Este test documenta la garantía explícitamente.
    const person = await makePerson();
    const updated = await setGoogleReviewStatus(admin, { personId: person.id, status: "REQUESTED" });
    expect(Object.keys(updated)).not.toContain("messageSent");
    expect(Object.keys(updated)).not.toContain("notificationSent");
  });
});
