import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  personIdSchema,
  paymentMethodIdSchema,
  createPaymentMethodSchema,
  updatePaymentMethodSchema,
  replacePaymentMethodSecretSchema,
  setDefaultPaymentMethodSchema,
  revealPaymentMethodSchema,
  revokePaymentMethodSchema,
} from "@/schemas/payment-method.schema";
import { encryptFinancial, decryptFinancial, last4 as computeLast4 } from "@/lib/financial-crypto";
import { recordAuditEvent } from "@/services/audit.service";
import { checkRateLimit } from "@/lib/rate-limit";
import { auth } from "@/lib/auth";
import type { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// AMPLIACIÓN PREPRODUCCIÓN — Métodos de pago cifrados por cliente.
//
// Autorización de UN SOLO NIVEL, más estricta que ClientPortalCredential
// (que distingue "administrar" de "revelar"): AQUÍ TODO — listar, crear,
// editar, revelar, revocar — exige role=ADMIN, sin excepción por
// asignación ni por ser además agente (nunca se relaja para AGENT ni
// ASSISTANT, ni siquiera de forma parcial).
//
// El CRM nunca ejecuta cobros con estos datos — ver docs/SECURITY.md.
// ---------------------------------------------------------------------------

function assertAdminOnly(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede administrar métodos de pago.");
  }
}

const paymentMethodSelect = {
  id: true,
  personId: true,
  policyId: true,
  type: true,
  isDefault: true,
  autopay: true,
  isActive: true,
  cardholderName: true,
  cardLast4: true,
  cardExpMonth: true,
  cardExpYear: true,
  cardBrand: true,
  bankAccountHolderName: true,
  bankName: true,
  accountLast4: true,
  bankAccountType: true,
  billingAddressLine1: true,
  billingAddressLine2: true,
  billingCity: true,
  billingState: true,
  billingZipCode: true,
  commentEncrypted: true,
  consentGiven: true,
  consentAt: true,
  consentUse: true,
  consentByUserId: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
  policy: { select: { id: true, policyNumber: true } },
  consentByUser: { select: { id: true, name: true } },
} satisfies Prisma.PaymentMethodSelect;

type RawPaymentMethod = Prisma.PaymentMethodGetPayload<{ select: typeof paymentMethodSelect }>;

const CARD_BRAND_LABELS: Record<string, string> = {
  VISA: "Visa",
  MASTERCARD: "Mastercard",
  AMEX: "Amex",
  DISCOVER: "Discover",
  OTHER: "Tarjeta",
};
const BANK_ACCOUNT_TYPE_LABELS: Record<string, string> = { CHECKING: "Checking", SAVINGS: "Savings" };

// "Visa •••• 1234" / "Checking •••• 5678" — nunca expone el número
// completo aquí, solo lo mínimo para que el ADMIN identifique CUÁL es.
function maskedLabel(row: { type: string; cardBrand: string | null; cardLast4: string | null; bankAccountType: string | null; accountLast4: string | null }): string {
  if (row.type === "BANK_ACCOUNT") {
    const kind = row.bankAccountType ? BANK_ACCOUNT_TYPE_LABELS[row.bankAccountType] : "Cuenta";
    return `${kind} •••• ${row.accountLast4 ?? "????"}`;
  }
  const brand = row.cardBrand ? CARD_BRAND_LABELS[row.cardBrand] : "Tarjeta";
  return `${brand} •••• ${row.cardLast4 ?? "????"}`;
}

// El comentario NUNCA se descifra a la ligera — solo cuando de verdad
// se va a mostrar (ADMIN ya es el único rol que llega hasta aquí,
// ver assertAdminOnly arriba). Un ciphertext corrupto nunca tumba el
// listado completo: se sustituye por un marcador de error legible.
function decryptCommentSafe(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    return decryptFinancial(ciphertext);
  } catch {
    return "(No se pudo leer el comentario)";
  }
}

function toListItem(row: RawPaymentMethod) {
  const { commentEncrypted, ...rest } = row;
  return { ...rest, maskedLabel: maskedLabel(row), comment: decryptCommentSafe(commentEncrypted) };
}

async function loadPersonOrThrow(personId: string) {
  const person = await prisma.person.findUnique({ where: { id: personId }, select: { id: true } });
  if (!person) throw new AppError("NOT_FOUND", "Persona no encontrada.");
  return person;
}

export async function listPaymentMethods(actor: AuthorizedUser, rawPersonId: unknown) {
  assertAdminOnly(actor);
  const personId = parseOrThrow(personIdSchema, rawPersonId);
  await loadPersonOrThrow(personId);

  const rows = await prisma.paymentMethod.findMany({
    where: { personId },
    select: paymentMethodSelect,
    orderBy: [{ isActive: "desc" }, { isDefault: "desc" }, { createdAt: "desc" }],
  });
  return rows.map(toListItem);
}

// Desmarca cualquier otro método predeterminado de la misma persona —
// nunca dos "isDefault=true" simultáneos (no hay constraint parcial a
// nivel de DB para esto; se garantiza aquí, siempre dentro de la MISMA
// transacción que fija el nuevo).
async function unsetOtherDefaults(tx: Prisma.TransactionClient, personId: string, exceptId?: string) {
  await tx.paymentMethod.updateMany({
    where: { personId, isDefault: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
    data: { isDefault: false },
  });
}

export async function createPaymentMethod(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(createPaymentMethodSchema, rawInput);
  await loadPersonOrThrow(input.personId);

  if (input.policyId) {
    const policy = await prisma.policy.findUnique({ where: { id: input.policyId }, select: { id: true, holderId: true } });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  }

  // Autopay implica que el cliente autorizó activamente conservar el
  // método para ese uso — nunca se activa autopay sin consentimiento
  // explícito registrado (UAT §6).
  if (input.autopay && !input.consentGiven) {
    throw new AppError(
      "VALIDATION_ERROR",
      "consentGiven: El autopay requiere que el cliente haya autorizado conservar este método de pago."
    );
  }

  const data: Prisma.PaymentMethodUncheckedCreateInput = {
    personId: input.personId,
    policyId: input.policyId,
    type: input.type,
    isDefault: input.isDefault,
    autopay: input.autopay,
    commentEncrypted: input.comment ? encryptFinancial(input.comment) : null,
    consentGiven: input.consentGiven,
    consentAt: input.consentGiven ? new Date() : null,
    consentUse: input.consentGiven ? (input.consentUse ?? null) : null,
    consentByUserId: input.consentGiven ? actor.id : null,
    billingAddressLine1: input.billingAddressLine1 ?? null,
    billingAddressLine2: input.billingAddressLine2 ?? null,
    billingCity: input.billingCity ?? null,
    billingState: input.billingState ?? null,
    billingZipCode: input.billingZipCode ?? null,
  };

  if (input.type === "BANK_ACCOUNT") {
    data.bankAccountHolderName = input.bankAccountHolderName;
    data.bankName = input.bankName;
    data.routingNumberEncrypted = encryptFinancial(input.routingNumber);
    data.accountNumberEncrypted = encryptFinancial(input.accountNumber);
    data.accountLast4 = computeLast4(input.accountNumber);
    data.bankAccountType = input.bankAccountType;
  } else {
    data.cardholderName = input.cardholderName;
    data.cardNumberEncrypted = encryptFinancial(input.cardNumber);
    data.cardLast4 = computeLast4(input.cardNumber);
    data.cardExpMonth = input.cardExpMonth;
    data.cardExpYear = input.cardExpYear;
    data.cardBrand = input.cardBrand;
  }

  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await unsetOtherDefaults(tx, input.personId);
    const created = await tx.paymentMethod.create({ data, select: paymentMethodSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PaymentMethod",
      entityId: created.id,
      contactPersonId: input.personId,
      policyId: input.policyId ?? null,
      action: "PAYMENT_METHOD_CREATED",
      // Nunca el número completo, ni siquiera el last4 combinado con
      // otros datos que pudieran ayudar a reidentificar — el resumen es
      // deliberadamente genérico.
      summary: `Método de pago agregado (${input.type === "BANK_ACCOUNT" ? "cuenta bancaria" : "tarjeta"})`,
    });
    return toListItem(created);
  });
}

async function loadForAccessCheck(id: string) {
  const existing = await prisma.paymentMethod.findUnique({
    where: { id },
    select: { id: true, personId: true, type: true, isActive: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Método de pago no encontrado.");
  return existing;
}

export async function updatePaymentMethod(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(paymentMethodIdSchema, rawId);
  const input = parseOrThrow(updatePaymentMethodSchema, rawInput);
  const existing = await loadForAccessCheck(id);
  if (!existing.isActive) {
    throw new AppError("VALIDATION_ERROR", "Este método de pago está revocado — no se puede editar.");
  }

  if (input.policyId !== undefined && input.policyId !== null) {
    const policy = await prisma.policy.findUnique({ where: { id: input.policyId }, select: { id: true } });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  }

  // CORRECCIÓN §7 — edición segura: este schema NUNCA acepta
  // cardNumber/routingNumber/accountNumber — solo metadata. Cambiar el
  // número real exige replacePaymentMethodSecret (reautenticación).
  const data: Prisma.PaymentMethodUpdateInput = {};
  if (input.cardholderName !== undefined) data.cardholderName = input.cardholderName;
  if (input.cardExpMonth !== undefined) data.cardExpMonth = input.cardExpMonth;
  if (input.cardExpYear !== undefined) data.cardExpYear = input.cardExpYear;
  if (input.cardBrand !== undefined) data.cardBrand = input.cardBrand;
  if (input.bankAccountHolderName !== undefined) data.bankAccountHolderName = input.bankAccountHolderName;
  if (input.bankName !== undefined) data.bankName = input.bankName;
  if (input.bankAccountType !== undefined) data.bankAccountType = input.bankAccountType;
  if (input.autopay !== undefined) data.autopay = input.autopay;
  if (input.comment !== undefined) data.commentEncrypted = input.comment ? encryptFinancial(input.comment) : null;
  if (input.policyId !== undefined) data.policy = input.policyId ? { connect: { id: input.policyId } } : { disconnect: true };
  if (input.billingAddressLine1 !== undefined) data.billingAddressLine1 = input.billingAddressLine1;
  if (input.billingAddressLine2 !== undefined) data.billingAddressLine2 = input.billingAddressLine2;
  if (input.billingCity !== undefined) data.billingCity = input.billingCity;
  if (input.billingState !== undefined) data.billingState = input.billingState;
  if (input.billingZipCode !== undefined) data.billingZipCode = input.billingZipCode;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.paymentMethod.update({ where: { id }, data, select: paymentMethodSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PaymentMethod",
      entityId: id,
      contactPersonId: existing.personId,
      action: "PAYMENT_METHOD_UPDATED",
      summary: "Método de pago actualizado",
    });
    return toListItem(updated);
  });
}

export async function setDefaultPaymentMethod(actor: AuthorizedUser, rawInput: unknown) {
  assertAdminOnly(actor);
  const input = parseOrThrow(setDefaultPaymentMethodSchema, rawInput);
  const existing = await prisma.paymentMethod.findUnique({
    where: { id: input.paymentMethodId },
    select: { id: true, personId: true, isActive: true },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Método de pago no encontrado.");
  if (existing.personId !== input.personId) {
    throw new AppError("VALIDATION_ERROR", "Este método de pago no pertenece a esta persona.");
  }
  if (!existing.isActive) {
    throw new AppError("VALIDATION_ERROR", "Un método de pago revocado no puede marcarse como predeterminado.");
  }

  return prisma.$transaction(async (tx) => {
    await unsetOtherDefaults(tx, input.personId, input.paymentMethodId);
    const updated = await tx.paymentMethod.update({
      where: { id: input.paymentMethodId },
      data: { isDefault: true },
      select: paymentMethodSelect,
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PaymentMethod",
      entityId: input.paymentMethodId,
      contactPersonId: input.personId,
      action: "PAYMENT_METHOD_SET_DEFAULT",
      summary: "Método de pago marcado como predeterminado",
    });
    return toListItem(updated);
  });
}

export async function revokePaymentMethod(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertAdminOnly(actor);
  const id = parseOrThrow(paymentMethodIdSchema, rawId);
  const input = parseOrThrow(revokePaymentMethodSchema, rawInput);
  const existing = await loadForAccessCheck(id);
  if (!existing.isActive) return; // idempotente — ya estaba revocado

  await prisma.$transaction(async (tx) => {
    await tx.paymentMethod.update({
      where: { id },
      data: { isActive: false, isDefault: false, autopay: false, revokedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PaymentMethod",
      entityId: id,
      contactPersonId: existing.personId,
      action: "PAYMENT_METHOD_REVOKED",
      summary: "Método de pago revocado",
      // El motivo de revocación SÍ se audita (nunca el valor del
      // método) — es una nota administrativa corta, no un secreto.
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
  });
}

// ---------------------------------------------------------------------------
// Reautenticación + revelado — CORRECCIÓN §5.
//
// La reautenticación usa el endpoint REAL de Better Auth
// (auth.api.verifyPassword, con sensitiveSessionMiddleware) — nunca una
// comparación de contraseña propia. Requiere los headers de la sesión
// actual (cookie), que el Server Action obtiene con next/headers() y
// pasa explícitamente — un servicio nunca debe leer headers por su
// cuenta (mismo criterio que getSessionUser).
//
// MFA: NO implementado todavía en este proyecto (ver docs/SECURITY.md)
// — este es el ÚNICO factor de reautenticación disponible hoy.
// Documentado explícitamente como bloqueo obligatorio antes de
// producción en el reporte final de esta fase.
// ---------------------------------------------------------------------------
async function verifyActorPassword(password: string, requestHeaders: Headers): Promise<void> {
  try {
    await auth.api.verifyPassword({ body: { password }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "password: Contraseña incorrecta.");
  }
}

const REVEAL_RATE_LIMIT = 10;
const REVEAL_RATE_WINDOW_MS = 15 * 60 * 1000;

export async function revealPaymentMethodField(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<{ value: string }> {
  assertAdminOnly(actor);
  const id = parseOrThrow(paymentMethodIdSchema, rawId);
  const input = parseOrThrow(revealPaymentMethodSchema, rawInput);

  if (!checkRateLimit(`reveal-payment-method:${actor.id}`, REVEAL_RATE_LIMIT, REVEAL_RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos de revelar — espera unos minutos.");
  }

  await verifyActorPassword(input.password, requestHeaders);

  const existing = await prisma.paymentMethod.findUnique({
    where: { id },
    select: {
      id: true,
      personId: true,
      type: true,
      isActive: true,
      cardNumberEncrypted: true,
      routingNumberEncrypted: true,
      accountNumberEncrypted: true,
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Método de pago no encontrado.");
  if (!existing.isActive) throw new AppError("VALIDATION_ERROR", "Este método de pago está revocado.");

  if (input.policyId) {
    const policy = await prisma.policy.findUnique({ where: { id: input.policyId }, select: { id: true } });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  }

  const ciphertextByField: Record<string, string | null> = {
    cardNumber: existing.cardNumberEncrypted,
    routingNumber: existing.routingNumberEncrypted,
    accountNumber: existing.accountNumberEncrypted,
  };
  const ciphertext = ciphertextByField[input.field];
  if (!ciphertext) {
    throw new AppError("VALIDATION_ERROR", "Este método de pago no tiene ese campo.");
  }

  let plaintext: string;
  try {
    plaintext = decryptFinancial(ciphertext);
  } catch {
    throw new AppError("VALIDATION_ERROR", "No se pudo recuperar el valor.");
  }

  // Auditoría COMPLETA de la revelación — usuario (actor, implícito),
  // fecha (createdAt del evento), método, póliza y motivo — NUNCA el
  // valor revelado.
  await recordAuditEvent(prisma, {
    actor,
    entityType: "PaymentMethod",
    entityId: id,
    contactPersonId: existing.personId,
    policyId: input.policyId ?? null,
    action: "PAYMENT_METHOD_REVEALED",
    summary: `Campo de método de pago revelado (${input.field})`,
    metadata: { field: input.field, reason: input.reason },
  });

  return { value: plaintext };
}

// Reemplazo COMPLETO de un secreto (número de tarjeta/routing/cuenta) —
// exige la MISMA reautenticación que revelar. Nunca acepta un valor
// parcial; nunca precarga el valor anterior (el formulario de reemplazo
// siempre arranca vacío, ver el componente cliente).
export async function replacePaymentMethodSecret(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown,
  requestHeaders: Headers
) {
  assertAdminOnly(actor);
  const id = parseOrThrow(paymentMethodIdSchema, rawId);
  const input = parseOrThrow(replacePaymentMethodSecretSchema, rawInput);

  if (!checkRateLimit(`replace-payment-method:${actor.id}`, REVEAL_RATE_LIMIT, REVEAL_RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos — espera unos minutos.");
  }

  await verifyActorPassword(input.password, requestHeaders);

  const existing = await loadForAccessCheck(id);
  if (!existing.isActive) {
    throw new AppError("VALIDATION_ERROR", "Este método de pago está revocado — no se puede editar.");
  }

  const isCardField = input.field === "cardNumber";
  const isBankField = input.field === "routingNumber" || input.field === "accountNumber";
  if (isCardField && existing.type === "BANK_ACCOUNT") {
    throw new AppError("VALIDATION_ERROR", "Este método de pago es una cuenta bancaria, no una tarjeta.");
  }
  if (isBankField && existing.type !== "BANK_ACCOUNT") {
    throw new AppError("VALIDATION_ERROR", "Este método de pago es una tarjeta, no una cuenta bancaria.");
  }

  // Validación de formato reutilizando exactamente las mismas reglas
  // que al crear (nunca una versión más permisiva aquí).
  const digitsOnly = input.value.replace(/[\s-]/g, "");
  if (input.field === "cardNumber" && !/^\d{12,19}$/.test(digitsOnly)) {
    throw new AppError("VALIDATION_ERROR", "value: Número de tarjeta inválido.");
  }
  if (input.field === "routingNumber" && !/^\d{9}$/.test(digitsOnly)) {
    throw new AppError("VALIDATION_ERROR", "value: El routing number debe tener exactamente 9 dígitos.");
  }
  if (input.field === "accountNumber" && !/^\d{4,17}$/.test(digitsOnly)) {
    throw new AppError("VALIDATION_ERROR", "value: Número de cuenta inválido.");
  }

  const data: Prisma.PaymentMethodUpdateInput = {};
  if (input.field === "cardNumber") {
    data.cardNumberEncrypted = encryptFinancial(digitsOnly);
    data.cardLast4 = computeLast4(digitsOnly);
  } else if (input.field === "routingNumber") {
    data.routingNumberEncrypted = encryptFinancial(digitsOnly);
  } else {
    data.accountNumberEncrypted = encryptFinancial(digitsOnly);
    data.accountLast4 = computeLast4(digitsOnly);
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.paymentMethod.update({ where: { id }, data, select: paymentMethodSelect });
    await recordAuditEvent(tx, {
      actor,
      entityType: "PaymentMethod",
      entityId: id,
      contactPersonId: existing.personId,
      action: "PAYMENT_METHOD_SECRET_REPLACED",
      summary: `Número de método de pago reemplazado (${input.field})`,
      metadata: { field: input.field },
    });
    return toListItem(updated);
  });
}
