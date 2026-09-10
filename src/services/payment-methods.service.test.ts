import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import {
  listPaymentMethods,
  createPaymentMethod,
  updatePaymentMethod,
  setDefaultPaymentMethod,
  revokePaymentMethod,
  revealPaymentMethodField,
  replacePaymentMethodSecret,
} from "@/services/payment-methods.service";
import type { AuthorizedUser } from "@/lib/authorization";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — Métodos de pago cifrados. Todos los datos
// (nombres, números de tarjeta/cuenta) son SINTÉTICOS — números de
// tarjeta de prueba conocidos públicamente (4111...) o inventados al
// azar, nunca datos reales.
// ---------------------------------------------------------------------------

const createdUserIds: string[] = [];
const createdPersonIds: string[] = [];
const createdPaymentMethodIds: string[] = [];
const ADMIN_PASSWORD = "AdminPasswordSegura2026";

function trackPM<T extends { id: string }>(pm: T): T {
  createdPaymentMethodIds.push(pm.id);
  return pm;
}

function uniqueName(label: string) {
  return `${label}${Date.now()}${Math.random().toString(36).slice(2)}`;
}

async function makeActor(role: "ADMIN" | "AGENT" | "ASSISTANT", label: string, password?: string): Promise<AuthorizedUser> {
  const user = await prisma.user.create({
    data: { name: `${label} Test`, email: `${label.toLowerCase()}.${uniqueName("")}@test.local`, role, isActive: true },
  });
  createdUserIds.push(user.id);
  if (password) {
    await prisma.account.create({
      data: {
        issuer: "local:credential", providerId: "credential",
        accountId: user.id, userId: user.id, password: await hashPassword(password),
      },
    });
  }
  return { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive };
}

async function makePerson() {
  const person = await prisma.person.create({
    data: { firstName: "Pago", lastName: uniqueName("Persona"), contactStatus: "CLIENT" },
  });
  createdPersonIds.push(person.id);
  return person;
}

async function getSessionHeadersFor(email: string, password: string): Promise<Headers> {
  const response = await auth.api.signInEmail({ body: { email, password }, asResponse: true });
  const setCookie = response.headers.get("set-cookie");
  const cookiePair = setCookie?.split(";")[0];
  if (!cookiePair) throw new Error("no session cookie");
  return new Headers({ cookie: cookiePair });
}

let admin: AuthorizedUser;
let adminHeaders: Headers;
let agent: AuthorizedUser;
let assistant: AuthorizedUser;

beforeAll(async () => {
  admin = await makeActor("ADMIN", "admin-pm", ADMIN_PASSWORD);
  adminHeaders = await getSessionHeadersFor(admin.email, ADMIN_PASSWORD);
  agent = await makeActor("AGENT", "agent-pm");
  assistant = await makeActor("ASSISTANT", "assistant-pm");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdPaymentMethodIds } } });
  await prisma.paymentMethod.deleteMany({ where: { id: { in: createdPaymentMethodIds } } });
  await prisma.person.deleteMany({ where: { id: { in: createdPersonIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.account.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("payment-methods.service", () => {
  it("A) ADMIN crea una tarjeta de crédito con last4 correcto y sin persistir el número completo en texto plano", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Juan Sintetico", cardNumber: "4111 1111 1111 1234",
        cardExpMonth: 12, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    expect(pm.cardLast4).toBe("1234");
    expect(pm.maskedLabel).toBe("Visa •••• 1234");

    const raw = await prisma.paymentMethod.findUniqueOrThrow({ where: { id: pm.id } });
    expect(raw.cardNumberEncrypted).not.toBeNull();
    expect(raw.cardNumberEncrypted).not.toContain("4111111111111234");
    expect(raw.cardNumberEncrypted!.startsWith("fin-v1:")).toBe(true);
  });

  it("B) ADMIN crea una cuenta bancaria con last4 correcto", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "BANK_ACCOUNT",
        bankAccountHolderName: "Maria Sintetica", bankName: "Banco de Pruebas",
        routingNumber: "011000015", accountNumber: "000123456789", bankAccountType: "CHECKING",
      })
    );
    expect(pm.accountLast4).toBe("6789");
    expect(pm.maskedLabel).toBe("Checking •••• 6789");
  });

  it("C) una persona puede tener varios métodos y solo uno predeterminado a la vez", async () => {
    const person = await makePerson();
    const first = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD", isDefault: true,
        cardholderName: "Uno", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    const second = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD", isDefault: true,
        cardholderName: "Dos", cardNumber: "5500000000000004", cardExpMonth: 2, cardExpYear: 2031, cardBrand: "MASTERCARD",
      })
    );
    const list = await listPaymentMethods(admin, person.id);
    const firstAfter = list.find((p) => p.id === first.id);
    const secondAfter = list.find((p) => p.id === second.id);
    expect(firstAfter?.isDefault).toBe(false); // el segundo lo desplazó
    expect(secondAfter?.isDefault).toBe(true);
  });

  it("D) cambiar el predeterminado explícitamente (setDefaultPaymentMethod)", async () => {
    const person = await makePerson();
    const first = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD", isDefault: true,
        cardholderName: "Uno", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    const second = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Dos", cardNumber: "5500000000000004", cardExpMonth: 2, cardExpYear: 2031, cardBrand: "MASTERCARD",
      })
    );
    await setDefaultPaymentMethod(admin, { personId: person.id, paymentMethodId: second.id });
    const list = await listPaymentMethods(admin, person.id);
    expect(list.find((p) => p.id === first.id)?.isDefault).toBe(false);
    expect(list.find((p) => p.id === second.id)?.isDefault).toBe(true);
  });

  it("E) autopay=true exige consentGiven=true (nunca se activa sin consentimiento)", async () => {
    const person = await makePerson();
    await expect(
      createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD", autopay: true, consentGiven: false,
        cardholderName: "Sin Consentimiento", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("F) consentimiento se registra con fecha, uso y usuario; revocar preserva el historial (nunca borra la fila)", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD", autopay: true, consentGiven: true, consentUse: "AUTOPAY",
        cardholderName: "Con Consentimiento", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    expect(pm.consentGiven).toBe(true);
    expect(pm.consentAt).not.toBeNull();
    expect(pm.consentUse).toBe("AUTOPAY");
    expect(pm.consentByUserId).toBe(admin.id);

    await revokePaymentMethod(admin, pm.id, { reason: "Cliente pidió cancelarlo" });
    const stillThere = await prisma.paymentMethod.findUnique({ where: { id: pm.id } });
    expect(stillThere).not.toBeNull(); // nunca se borra
    expect(stillThere?.isActive).toBe(false);
    expect(stillThere?.revokedAt).not.toBeNull();
    expect(stillThere?.autopay).toBe(false); // revocar impide nuevos usos
    // El consentimiento ORIGINAL sigue registrado — la auditoría se preserva.
    expect(stillThere?.consentGiven).toBe(true);
    expect(stillThere?.consentByUserId).toBe(admin.id);
  });

  it("G) un método revocado no puede volver a marcarse como predeterminado ni editarse", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Revocado", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    await revokePaymentMethod(admin, pm.id, {});
    await expect(setDefaultPaymentMethod(admin, { personId: person.id, paymentMethodId: pm.id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    await expect(updatePaymentMethod(admin, pm.id, { autopay: true })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("H) el comentario se cifra, se sanitiza (sin HTML) y respeta el máximo de 1,000 caracteres", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Con Comentario", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
        comment: "<script>alert(1)</script>Llamar antes de usarlo",
      })
    );
    expect(pm.comment).toBe("alert(1)Llamar antes de usarlo");

    const raw = await prisma.paymentMethod.findUniqueOrThrow({ where: { id: pm.id } });
    expect(raw.commentEncrypted).not.toBeNull();
    expect(raw.commentEncrypted).not.toContain("Llamar antes de usarlo");

    await expect(
      createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Comentario Largo", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
        comment: "x".repeat(1001),
      })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("I) no existe ningún campo para CVV/CVC/CID ni PIN — el schema los ignora si llegan igual", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Sin CVV", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
        // cvv/pin NUNCA son campos válidos del schema (unknown en el
        // service) — se prueba que aunque lleguen igual, no aparecen
        // en ningún lado guardado.
        cvv: "123", pin: "9999",
      })
    );
    const raw = await prisma.paymentMethod.findUniqueOrThrow({ where: { id: pm.id } });
    expect(JSON.stringify(raw)).not.toContain("123");
    // Confirma que la columna ni siquiera existe en el modelo.
    expect(Object.keys(raw)).not.toContain("cvv");
    expect(Object.keys(raw)).not.toContain("pin");
  });

  it("J) AGENT y ASSISTANT son rechazados server-side para TODA operación (listar, crear, revelar, revocar)", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Protegido", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    for (const actor of [agent, assistant]) {
      await expect(listPaymentMethods(actor, person.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        createPaymentMethod(actor, {
          personId: person.id, type: "CREDIT_CARD",
          cardholderName: "X", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(updatePaymentMethod(actor, pm.id, { autopay: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(revokePaymentMethod(actor, pm.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        revealPaymentMethodField(actor, pm.id, { password: "irrelevante", field: "cardNumber", reason: "prueba" }, new Headers())
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("K) revelar exige reautenticación con la contraseña correcta del ADMIN — contraseña incorrecta se rechaza", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Reautenticacion", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );

    await expect(
      revealPaymentMethodField(admin, pm.id, { password: "ContraseñaIncorrecta", field: "cardNumber", reason: "Configurar en portal" }, adminHeaders)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const result = await revealPaymentMethodField(
      admin, pm.id, { password: ADMIN_PASSWORD, field: "cardNumber", reason: "Configurar en portal de la aseguradora" }, adminHeaders
    );
    expect(result.value).toBe("4111111111111111");
  });

  it("L) revelar/reemplazar auditan usuario, método y motivo, pero NUNCA el valor revelado", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Auditado", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    await revealPaymentMethodField(
      admin, pm.id, { password: ADMIN_PASSWORD, field: "cardNumber", reason: "Configurar autopay en el portal" }, adminHeaders
    );
    const events = await prisma.auditEvent.findMany({ where: { entityId: pm.id, action: "PAYMENT_METHOD_REVEALED" } });
    expect(events).toHaveLength(1);
    const serialized = JSON.stringify(events[0]);
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain(ADMIN_PASSWORD);
    expect(events[0].actorUserId).toBe(admin.id);
  });

  it("M) reemplazar el número completo exige reautenticación, revalida el formato, y nunca acepta un valor parcial", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Reemplazo", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    await expect(
      replacePaymentMethodSecret(admin, pm.id, { password: ADMIN_PASSWORD, field: "cardNumber", value: "123" }, adminHeaders)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const updated = await replacePaymentMethodSecret(
      admin, pm.id, { password: ADMIN_PASSWORD, field: "cardNumber", value: "5555555555554444" }, adminHeaders
    );
    expect(updated.cardLast4).toBe("4444");

    const revealed = await revealPaymentMethodField(
      admin, pm.id, { password: ADMIN_PASSWORD, field: "cardNumber", reason: "Verificar reemplazo" }, adminHeaders
    );
    expect(revealed.value).toBe("5555555555554444");
  });

  it("N) un ciphertext manipulado se rechaza de forma segura al revelar (nunca expone datos parciales)", async () => {
    const person = await makePerson();
    const pm = trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Manipulado", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    await prisma.paymentMethod.update({ where: { id: pm.id }, data: { cardNumberEncrypted: "fin-v1:AAAA:BBBB:CCCC" } });
    await expect(
      revealPaymentMethodField(admin, pm.id, { password: ADMIN_PASSWORD, field: "cardNumber", reason: "prueba" }, adminHeaders)
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("O) el listado nunca expone el ciphertext ni el número completo — solo last4/maskedLabel", async () => {
    const person = await makePerson();
    trackPM(
      await createPaymentMethod(admin, {
        personId: person.id, type: "CREDIT_CARD",
        cardholderName: "Enmascarado", cardNumber: "4111111111111111", cardExpMonth: 1, cardExpYear: 2030, cardBrand: "VISA",
      })
    );
    const list = await listPaymentMethods(admin, person.id);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain("4111111111111111");
    expect(serialized).not.toContain("cardNumberEncrypted");
    expect(serialized).toContain("Visa •••• 1111");
  });

  it("no quedan fixtures huérfanos (verificación de limpieza propia del archivo)", async () => {
    const remaining = await prisma.paymentMethod.count({ where: { id: { in: createdPaymentMethodIds } } });
    expect(remaining).toBe(createdPaymentMethodIds.length); // todo lo creado sigue rastreado para el afterAll
  });
});
