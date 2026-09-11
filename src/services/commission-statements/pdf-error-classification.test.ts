import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// Fase 025.5.4 (Paso 4) — el ADMIN nunca debe leer "tu PDF está dañado"
// cuando en realidad falló el PROCESADOR (worker de pdfjs, módulo
// faltante, error interno inesperado) — ese fue exactamente el bug
// reportado ("Setting up fake worker failed" mostrado como si el PDF
// estuviera corrupto). Estas pruebas simulan ambos escenarios
// directamente contra pdfjs-dist (sin necesitar un PDF real roto ni
// reproducir el bug del worker) para confirmar que la clasificación de
// errores en reconciliation.service.ts es correcta y estable.
// ---------------------------------------------------------------------------

function uniqueName(label: string) {
  return `${label}${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN"): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: { name: "Admin Test", email: `${uniqueName("admin-pdferr")}@test.local`, role, isActive: true },
  });
  createdUserIds.push(user.id);
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive, twoFactorEnabled: user.twoFactorEnabled };
}

const createdUserIds: string[] = [];
const createdStatementIds: string[] = [];
let admin: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN");
});

afterAll(async () => {
  await prisma.commissionPayment.deleteMany({
    where: { statementRowId: { in: await prisma.commissionStatementRow.findMany({ where: { statementId: { in: createdStatementIds } }, select: { id: true } }).then((r) => r.map((x) => x.id)) } },
  });
  await prisma.commissionStatementRow.deleteMany({ where: { statementId: { in: createdStatementIds } } });
  await prisma.commissionStatement.deleteMany({ where: { id: { in: createdStatementIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

function makePdfFile(bytes: string, name: string): File {
  return new File([new TextEncoder().encode(bytes)], name, { type: "application/pdf" });
}

describe("pdf-table-extract — clasificación de errores (Fase 025.5.4)", () => {
  it("un PDF con firma válida pero estructura corrupta se clasifica como PdfParseError (InvalidPDFException real de pdfjs)", async () => {
    const { extractPdfRows, PdfParseError, PdfInternalError } = await import("./pdf-table-extract");
    const buffer = Buffer.from("%PDF-1.4\n%not a real pdf structure\n");
    await expect(extractPdfRows(buffer)).rejects.toBeInstanceOf(PdfParseError);
    await expect(extractPdfRows(buffer)).rejects.not.toBeInstanceOf(PdfInternalError);
  });

  it("el mensaje de PdfParseError nunca contiene rutas locales ni nombres de chunk", async () => {
    const { extractPdfRows } = await import("./pdf-table-extract");
    const buffer = Buffer.from("%PDF-1.4\n%not a real pdf structure\n");
    try {
      await extractPdfRows(buffer);
      throw new Error("expected extractPdfRows to reject");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).not.toMatch(/[A-Z]:\\/); // nunca C:\...
      expect(message).not.toMatch(/\.next[/\\]/); // nunca rutas de .next
      expect(message.toLowerCase()).toContain("dañado");
    }
  });

  it("un fallo interno del procesador (no InvalidPDFException/PasswordException) se clasifica como PdfInternalError, nunca como PDF dañado", async () => {
    vi.resetModules();
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const real = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...real,
        getDocument: () => ({
          promise: Promise.reject(new Error('Setting up fake worker failed: "Cannot find module pdf.worker.mjs".')),
        }),
      };
    });
    try {
      const { extractPdfRows, PdfInternalError, PdfParseError } = await import("./pdf-table-extract");
      const buffer = Buffer.from("%PDF-1.4\nanything\n");
      await expect(extractPdfRows(buffer)).rejects.toBeInstanceOf(PdfInternalError);
      await expect(extractPdfRows(buffer)).rejects.not.toBeInstanceOf(PdfParseError);
    } finally {
      vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs");
      vi.resetModules();
    }
  });
});

describe("reconciliation.service — mensajes de error al ADMIN (Fase 025.5.4, Paso 4)", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.doUnmock("pdfjs-dist/legacy/build/pdf.mjs");
    vi.resetModules();
  });

  it("un fallo interno del procesador nunca crea un CommissionStatement, y el ADMIN recibe el mensaje genérico (nunca 'PDF dañado', nunca detalles técnicos)", async () => {
    vi.doMock("pdfjs-dist/legacy/build/pdf.mjs", async () => {
      const real = await vi.importActual<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>(
        "pdfjs-dist/legacy/build/pdf.mjs"
      );
      return {
        ...real,
        getDocument: () => ({
          promise: Promise.reject(new Error('Setting up fake worker failed: "Cannot find module pdf.worker.mjs" at C:\\Users\\example-user\\project\\.next\\dev\\server\\chunks\\123.js')),
        }),
      };
    });

    const { uploadCommissionStatement } = await import("./reconciliation.service");
    const before = await prisma.commissionStatement.count();

    const file = makePdfFile("%PDF-1.4\nanything\n", uniqueName("internal") + ".pdf");
    await expect(uploadCommissionStatement(admin, "ORANGE_OWN", file)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message:
        "file: No pudimos procesar el PDF por un error interno. El archivo no fue aplicado. Intenta nuevamente o contacta al administrador.",
    });

    const after = await prisma.commissionStatement.count();
    expect(after).toBe(before); // nunca se creó un Statement

    const errorMessage = "file: No pudimos procesar el PDF por un error interno. El archivo no fue aplicado. Intenta nuevamente o contacta al administrador.";
    expect(errorMessage).not.toMatch(/[A-Z]:\\/);
    expect(errorMessage).not.toMatch(/\.next/);
    expect(errorMessage.toLowerCase()).not.toContain("dañado");
    expect(errorMessage.toLowerCase()).not.toContain("worker");
    expect(errorMessage.toLowerCase()).not.toContain("chunk");
  });

  it("un PDF genuinamente inválido SÍ produce el mensaje de 'dañado/cifrado', distinto del mensaje de error interno", async () => {
    const { uploadCommissionStatement } = await import("./reconciliation.service");
    const file = makePdfFile("%PDF-1.4\n%not a real pdf structure\n", uniqueName("invalid") + ".pdf");
    await expect(uploadCommissionStatement(admin, "ORANGE_OWN", file)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("dañado"),
    });
  });
});
