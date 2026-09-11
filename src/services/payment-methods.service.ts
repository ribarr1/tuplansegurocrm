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
  revealPaymentMethodFullSchema,
  copyPaymentMethodFieldSchema,
  revokePaymentMethodSchema,
} from "@/schemas/payment-method.schema";
import { encryptFinancial, decryptFinancial, last4 as computeLast4 } from "@/lib/financial-crypto";
import { recordAuditEvent } from "@/services/audit.service";
import { checkRateLimit } from "@/lib/rate-limit";
import { consumeTotpCodeOnce } from "@/lib/totp-replay-guard";
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
// Reautenticación + revelado — CORRECCIÓN §5, reforzada por
// PREPRODUCCIÓN — MFA §6 (step-up financiero).
//
// La reautenticación usa los endpoints REALES de Better Auth
// (auth.api.verifyPassword con sensitiveSessionMiddleware, y
// auth.api.verifyTOTP ya con sesión activa — la misma rama de
// verify-totp que usa el propio plugin para "confirmar código sin
// iniciar nada nuevo", ver node_modules/better-auth/dist/plugins/
// two-factor/totp/index.mjs) — nunca una comparación propia. Requiere
// los headers de la sesión actual (cookie), que el Server Action
// obtiene con next/headers() y pasa explícitamente — un servicio nunca
// debe leer headers por su cuenta (mismo criterio que getSessionUser).
//
// Por qué no se acepta un booleano del cliente como prueba de MFA: el
// código TOTP se reverifica en ESTA misma llamada, contra el secreto
// real del actor — nunca se confía en que el cliente ya "pasó" un
// desafío anterior. Como todo ADMIN tiene MFA obligatorio para poder
// usar el CRM (requireSessionUser ya lo garantiza antes de llegar
// aquí), este código siempre se exige, sin rama alternativa.
// ---------------------------------------------------------------------------
async function verifyActorPassword(password: string, requestHeaders: Headers): Promise<void> {
  try {
    await auth.api.verifyPassword({ body: { password }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "password: Contraseña incorrecta.");
  }
}

// PREPRODUCCIÓN — MFA §6. `auth.api.verifyTOTP` con una sesión YA
// activa no crea nada ni cierra sesiones (isSignIn=false en el propio
// endpoint) — solo confirma que el código es válido en este instante.
// `consumeTotpCodeOnce` cierra el hueco de reuso dentro de la misma
// ventana de 30s (ver src/lib/totp-replay-guard.ts): un código que ya
// reveló UN método de pago no puede reutilizarse para revelar otro
// dentro de esa ventana — hay que esperar al siguiente código real de
// la app autenticadora.
async function verifyActorTotp(actor: AuthorizedUser, code: string, requestHeaders: Headers): Promise<void> {
  try {
    await auth.api.verifyTOTP({ body: { code }, headers: requestHeaders });
  } catch {
    throw new AppError("VALIDATION_ERROR", "totpCode: Código incorrecto.");
  }
  if (!consumeTotpCodeOnce(actor.id, code)) {
    throw new AppError("VALIDATION_ERROR", "totpCode: Este código ya se usó — espera el siguiente de tu app de autenticación.");
  }
}

const REVEAL_RATE_LIMIT = 10;
const REVEAL_RATE_WINDOW_MS = 15 * 60 * 1000;

const fullRevealSelect = {
  id: true,
  personId: true,
  type: true,
  isActive: true,
  cardholderName: true,
  cardNumberEncrypted: true,
  cardExpMonth: true,
  cardExpYear: true,
  cardBrand: true,
  bankAccountHolderName: true,
  bankName: true,
  routingNumberEncrypted: true,
  accountNumberEncrypted: true,
  bankAccountType: true,
  billingAddressLine1: true,
  billingAddressLine2: true,
  billingCity: true,
  billingState: true,
  billingZipCode: true,
  commentEncrypted: true,
} satisfies Prisma.PaymentMethodSelect;

type RevealedCardPaymentMethod = {
  type: "CREDIT_CARD" | "DEBIT_CARD";
  cardholderName: string | null;
  cardNumber: string;
  cardExpMonth: number | null;
  cardExpYear: number | null;
  cardBrand: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZipCode: string | null;
  comment: string | null;
};
type RevealedBankPaymentMethod = {
  type: "BANK_ACCOUNT";
  bankAccountHolderName: string | null;
  bankName: string | null;
  routingNumber: string;
  accountNumber: string;
  bankAccountType: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZipCode: string | null;
  comment: string | null;
};
export type RevealedPaymentMethod = RevealedCardPaymentMethod | RevealedBankPaymentMethod;

// CORRECCIÓN — revelado de métodos de pago: reautenticación ÚNICA que
// revela el CONJUNTO COMPLETO de datos necesarios para completar un
// pago en el portal de la aseguradora (antes: un campo por vez, lo que
// obligaba a repetir la reautenticación para ver, por ejemplo, el
// número de tarjeta Y su vencimiento por separado). Nunca se descifra
// nada ANTES de validar rate limit + contraseña — ver el orden de las
// operaciones abajo.
export async function revealPaymentMethodFull(
  actor: AuthorizedUser,
  rawId: unknown,
  rawInput: unknown,
  requestHeaders: Headers
): Promise<RevealedPaymentMethod> {
  assertAdminOnly(actor);
  const id = parseOrThrow(paymentMethodIdSchema, rawId);
  const input = parseOrThrow(revealPaymentMethodFullSchema, rawInput);

  if (!checkRateLimit(`reveal-payment-method:${actor.id}`, REVEAL_RATE_LIMIT, REVEAL_RATE_WINDOW_MS)) {
    throw new AppError("VALIDATION_ERROR", "Demasiados intentos de revelar — espera unos minutos.");
  }

  // Reautenticación ANTES de tocar cualquier ciphertext — ningún valor
  // cifrado se descifra hasta que esto no lance. Contraseña Y TOTP,
  // ambas frescas, ambas verificadas por Better Auth en esta misma
  // llamada (PREPRODUCCIÓN — MFA §6).
  await verifyActorPassword(input.password, requestHeaders);
  await verifyActorTotp(actor, input.totpCode, requestHeaders);

  const existing = await prisma.paymentMethod.findUnique({ where: { id }, select: fullRevealSelect });
  if (!existing) throw new AppError("NOT_FOUND", "Método de pago no encontrado.");
  if (!existing.isActive) throw new AppError("VALIDATION_ERROR", "Este método de pago está revocado.");

  if (input.policyId) {
    const policy = await prisma.policy.findUnique({ where: { id: input.policyId }, select: { id: true } });
    if (!policy) throw new AppError("NOT_FOUND", "Póliza no encontrada.");
  }

  function decryptSecret(ciphertext: string | null, label: string): string {
    if (!ciphertext) throw new AppError("VALIDATION_ERROR", `Este método de pago no tiene ${label}.`);
    try {
      return decryptFinancial(ciphertext);
    } catch {
      throw new AppError("VALIDATION_ERROR", "No se pudo recuperar el valor.");
    }
  }

  const comment = decryptCommentSafe(existing.commentEncrypted);
  const billing = {
    billingAddressLine1: existing.billingAddressLine1,
    billingAddressLine2: existing.billingAddressLine2,
    billingCity: existing.billingCity,
    billingState: existing.billingState,
    billingZipCode: existing.billingZipCode,
  };

  // Metadata de auditoría: SOLO nombres de campo realmente presentes en
  // este método (nunca valores) — permite reconstruir "qué se mostró"
  // sin exponer nada sensible.
  const revealedFieldNames: string[] = [];
  let revealed: RevealedPaymentMethod;

  if (existing.type === "BANK_ACCOUNT") {
    const routingNumber = decryptSecret(existing.routingNumberEncrypted, "routing number");
    const accountNumber = decryptSecret(existing.accountNumberEncrypted, "número de cuenta");
    revealedFieldNames.push("bankAccountHolderName", "bankName", "routingNumber", "accountNumber", "bankAccountType");
    if (Object.values(billing).some(Boolean)) revealedFieldNames.push("billingAddress");
    if (comment) revealedFieldNames.push("comment");
    revealed = {
      type: "BANK_ACCOUNT",
      bankAccountHolderName: existing.bankAccountHolderName,
      bankName: existing.bankName,
      routingNumber,
      accountNumber,
      bankAccountType: existing.bankAccountType,
      comment,
      ...billing,
    };
  } else {
    const cardNumber = decryptSecret(existing.cardNumberEncrypted, "número de tarjeta");
    revealedFieldNames.push("cardholderName", "cardNumber", "cardExpiry", "cardBrand");
    if (Object.values(billing).some(Boolean)) revealedFieldNames.push("billingAddress");
    if (comment) revealedFieldNames.push("comment");
    revealed = {
      type: existing.type as "CREDIT_CARD" | "DEBIT_CARD",
      cardholderName: existing.cardholderName,
      cardNumber,
      cardExpMonth: existing.cardExpMonth,
      cardExpYear: existing.cardExpYear,
      cardBrand: existing.cardBrand,
      comment,
      ...billing,
    };
  }

  // Auditoría COMPLETA de la revelación — usuario (actor, implícito),
  // fecha (createdAt del evento), método, póliza, motivo y QUÉ campos
  // se revelaron — NUNCA los valores revelados.
  await recordAuditEvent(prisma, {
    actor,
    entityType: "PaymentMethod",
    entityId: id,
    contactPersonId: existing.personId,
    policyId: input.policyId ?? null,
    action: "PAYMENT_METHOD_REVEALED",
    summary: "Detalles completos de método de pago revelados",
    metadata: { fields: revealedFieldNames, reason: input.reason },
  });

  return revealed;
}

// Audita que el ADMIN copió un campo individual desde la ventana de
// revelado — NUNCA recibe ni registra el valor copiado, solo el
// nombre del campo (la copia real ya ocurrió del lado del cliente
// mediante navigator.clipboard, ver payment-method-row.tsx). Mismo
// patrón que recordClientPortalCredentialCopy (Fase 025, Parte J).
export async function recordPaymentMethodFieldCopy(
  actor: AuthorizedUser,
  rawId: unknown,
  rawField: unknown
): Promise<void> {
  assertAdminOnly(actor);
  const id = parseOrThrow(paymentMethodIdSchema, rawId);
  const field = parseOrThrow(copyPaymentMethodFieldSchema, rawField);
  const existing = await loadForAccessCheck(id);

  await recordAuditEvent(prisma, {
    actor,
    entityType: "PaymentMethod",
    entityId: id,
    contactPersonId: existing.personId,
    action: "PAYMENT_METHOD_FIELD_COPIED",
    summary: `Campo de método de pago copiado (${field})`,
    metadata: { field },
  });
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
