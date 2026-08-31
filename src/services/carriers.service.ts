import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  carrierIdSchema,
  createCarrierSchema,
  updateCarrierSchema,
  listCarriersQuerySchema,
} from "@/schemas/carrier.schema";
import { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Política de acceso — Carrier (V1)
//
// Ver (listCarriers / getCarrierById): ADMIN, AGENT, ASSISTANT — cualquier
//   usuario activo (catálogo, no dato de negocio sensible).
// Crear / editar / activar-desactivar: solo ADMIN.
// ---------------------------------------------------------------------------

const carrierSelect = {
  id: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: true } },
} satisfies Prisma.CarrierSelect;

function assertCanManageCarriers(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede modificar compañías.");
  }
}

export async function listCarriers(actor: AuthorizedUser, rawQuery: unknown) {
  void actor;
  const { active } = parseOrThrow(listCarriersQuerySchema, rawQuery);
  return prisma.carrier.findMany({
    where: active === undefined ? {} : { isActive: active },
    select: carrierSelect,
    orderBy: { name: "asc" },
  });
}

export async function getCarrierById(actor: AuthorizedUser, rawId: unknown) {
  void actor;
  const id = parseOrThrow(carrierIdSchema, rawId);
  const carrier = await prisma.carrier.findUnique({ where: { id }, select: carrierSelect });
  if (!carrier) throw new AppError("NOT_FOUND", "Compañía no encontrada.");
  return carrier;
}

export async function createCarrier(actor: AuthorizedUser, rawInput: unknown) {
  assertCanManageCarriers(actor);
  const input = parseOrThrow(createCarrierSchema, rawInput);

  try {
    return await prisma.carrier.create({ data: input, select: carrierSelect });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Ya existe una compañía con ese nombre.");
    }
    throw error;
  }
}

export async function updateCarrier(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertCanManageCarriers(actor);
  const id = parseOrThrow(carrierIdSchema, rawId);
  const input = parseOrThrow(updateCarrierSchema, rawInput);

  const existing = await prisma.carrier.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Compañía no encontrada.");

  try {
    return await prisma.carrier.update({ where: { id }, data: input, select: carrierSelect });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError("CONFLICT", "Ya existe una compañía con ese nombre.");
    }
    throw error;
  }
}

// Atajo directo (boolean ya resuelto) para el botón de activar/desactivar
// de la lista — no reutiliza updateCarrier porque ese espera el mismo
// formato de input crudo (string "true"/"false") que llega de un
// formulario; aquí el llamador ya tiene un boolean real.
export async function setCarrierActive(actor: AuthorizedUser, rawId: unknown, isActive: boolean) {
  assertCanManageCarriers(actor);
  const id = parseOrThrow(carrierIdSchema, rawId);
  const existing = await prisma.carrier.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Compañía no encontrada.");
  return prisma.carrier.update({ where: { id }, data: { isActive }, select: carrierSelect });
}
