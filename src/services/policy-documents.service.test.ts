import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  listPolicyDocuments,
  uploadPolicyDocument,
  getPolicyDocumentForDownload,
  deletePolicyDocument,
} from "@/services/policy-documents.service";
import { createPolicy } from "@/services/policies.service";
import type { AuthorizedUser } from "@/lib/authorization";

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdCarrierIds: string[] = [];
const createdProductIds: string[] = [];
const createdPolicyIds: string[] = [];

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

async function makePolicyFor(actor: AuthorizedUser, holder: { id: string }) {
  const carrier = await prisma.carrier.create({ data: { name: `Carrier Doc ${Date.now()}${Math.random()}` } });
  createdCarrierIds.push(carrier.id);
  const product = await prisma.product.create({
    data: { carrierId: carrier.id, name: "Plan Doc Test", policyType: "HEALTH" },
  });
  createdProductIds.push(product.id);
  const policy = await createPolicy(actor, { holderId: holder.id, productId: product.id, holderCovered: "false" });
  createdPolicyIds.push(policy.id);
  return policy;
}

// Bytes reales mínimos (magic bytes válidos) — nunca contenido real.
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const EXE_BYTES = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // "MZ" (cabecera real de un .exe)

function makeFile(bytes: Uint8Array, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

let admin: AuthorizedUser;
let agent: AuthorizedUser;
let agentB: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-docs");
  agent = await makeActor("AGENT", "agent-docs");
  agentB = await makeActor("AGENT", "agentb-docs");
});

afterAll(async () => {
  // Limpia también los archivos físicos de private-storage/ (dev-only,
  // gitignored) que quedaron de las subidas de prueba — el
  // deleteMany() de Prisma no toca el storage por sí solo.
  const leftoverDocs = await prisma.policyDocument.findMany({
    where: { policyId: { in: createdPolicyIds } },
    select: { storageKey: true },
  });
  const { fileStorage } = await import("@/lib/storage");
  await Promise.all(leftoverDocs.map((d) => fileStorage.delete(d.storageKey).catch(() => {})));

  await prisma.policyDocument.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policyMember.deleteMany({ where: { policyId: { in: createdPolicyIds } } });
  await prisma.policy.deleteMany({ where: { id: { in: createdPolicyIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.carrier.deleteMany({ where: { id: { in: createdCarrierIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("policy-documents.service", () => {
  it("V) sube un PDF válido", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const doc = await uploadPolicyDocument(
      admin,
      { policyId: policy.id, type: "BROCHURE" },
      makeFile(PDF_BYTES, "brochure.pdf", "application/pdf")
    );
    expect(doc.mimeType).toBe("application/pdf");
    expect(doc.fileName).toBe("brochure.pdf");
  });

  it("W) sube una imagen válida (PNG)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const doc = await uploadPolicyDocument(
      admin,
      { policyId: policy.id, type: "MEMBER_CARD" },
      makeFile(PNG_BYTES, "card.png", "image/png")
    );
    expect(doc.mimeType).toBe("image/png");
  });

  it("X) rechaza un ejecutable (magic bytes reales, no solo extensión)", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    await expect(
      uploadPolicyDocument(
        admin,
        { policyId: policy.id, type: "OTHER" },
        makeFile(EXE_BYTES, "malware.pdf", "application/pdf")
      )
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Y) rechaza un archivo que supera el tamaño máximo", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const big = new Uint8Array(16 * 1024 * 1024);
    big.set(PDF_BYTES);
    await expect(
      uploadPolicyDocument(admin, { policyId: policy.id, type: "OTHER" }, makeFile(big, "big.pdf", "application/pdf"))
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("Z) acceso a documento sin autorización se rechaza", async () => {
    const holder = await makePerson(agentB.id);
    const policy = await makePolicyFor(admin, holder);
    const doc = await uploadPolicyDocument(
      admin,
      { policyId: policy.id, type: "OTHER" },
      makeFile(PDF_BYTES, "x.pdf", "application/pdf")
    );
    await expect(getPolicyDocumentForDownload(agent, doc.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("AA) storageKey generado nunca permite path traversal", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const doc = await uploadPolicyDocument(
      admin,
      { policyId: policy.id, type: "OTHER" },
      makeFile(PDF_BYTES, "../../etc/passwd.pdf", "application/pdf")
    );
    expect(doc.fileName).not.toContain("/");
    // storageKey no es un campo expuesto por documentSelect en la
    // respuesta pública, pero verificamos indirectamente que la
    // descarga funciona (lo que confirma que el storageKey generado es
    // válido y contenido dentro del directorio de storage).
    const { data } = await getPolicyDocumentForDownload(admin, doc.id);
    expect(data.length).toBeGreaterThan(0);
    await deletePolicyDocument(admin, doc.id);
  });

  it("listar y eliminar documentos funciona", async () => {
    const holder = await makePerson();
    const policy = await makePolicyFor(admin, holder);
    const doc = await uploadPolicyDocument(
      admin,
      { policyId: policy.id, type: "OTHER" },
      makeFile(PDF_BYTES, "temp.pdf", "application/pdf")
    );
    let docs = await listPolicyDocuments(admin, policy.id);
    expect(docs.some((d) => d.id === doc.id)).toBe(true);

    await deletePolicyDocument(admin, doc.id);
    docs = await listPolicyDocuments(admin, policy.id);
    expect(docs.some((d) => d.id === doc.id)).toBe(false);
  });
});
