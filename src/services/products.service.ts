import "server-only";
import { prisma } from "@/lib/prisma";
import type { AuthorizedUser } from "@/lib/authorization";
import { AppError, parseOrThrow } from "@/services/errors";
import {
  productIdSchema,
  createProductSchema,
  updateProductSchema,
  listProductsQuerySchema,
  IMMUTABLE_AFTER_USE_FIELDS,
} from "@/schemas/product.schema";
import { Prisma } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Política de acceso — Product (V1)
//
// Ver (listProducts / getProductById): ADMIN, AGENT, ASSISTANT — cualquier
//   usuario activo (catálogo).
// Crear / editar / activar-desactivar: solo ADMIN.
//
// Inmutabilidad tras uso (ver docs/DECISIONS.md): Product es la fuente
// de verdad histórica de carrier/policyType de cada Policy que lo
// referencia (Policy nunca duplica esos datos). Editar carrierId,
// policyType o planYear de un Product que YA tiene al menos una Policy
// asociada reescribiría silenciosamente el significado de pólizas
// pasadas. name/externalCode/isActive siguen editables siempre: el
// catálogo puede corregirse (typo, código externo, activo/inactivo)
// sin afectar esa garantía — igual que el proyecto ya distingue esto
// para HEALTH con HealthPolicyDetail.planNameSnapshot, que congela el
// nombre exacto en el momento de la póliza precisamente para no
// depender de que Product.name nunca cambie.
// ---------------------------------------------------------------------------

const productSelect = {
  id: true,
  name: true,
  policyType: true,
  planYear: true,
  externalCode: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  carrier: { select: { id: true, name: true, isActive: true } },
  _count: { select: { policies: true } },
} satisfies Prisma.ProductSelect;

function assertCanManageProducts(actor: AuthorizedUser): void {
  if (actor.role !== "ADMIN") {
    throw new AppError("FORBIDDEN", "Solo un administrador puede modificar productos.");
  }
}

async function assertCarrierExists(carrierId: string): Promise<void> {
  const carrier = await prisma.carrier.findUnique({ where: { id: carrierId }, select: { id: true } });
  if (!carrier) throw new AppError("NOT_FOUND", "Compañía no encontrada.");
}

// Fase 022 (Hallazgo #5 de UAT): identidad de producto V1 = carrierId +
// nombre normalizado + policyType + planYear. Normalización deliberadamente
// simple (trim, minúsculas, espacios redundantes colapsados a uno solo) —
// suficiente para detectar "aetna copagos 100" === "Aetna Copagos 100" ===
// "  aetna copagos 100  " sin intentar deduplicar variaciones de
// puntuación/acentos, que podrían bloquear nombres legítimamente distintos.
export function normalizeProductName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Chequeo previo con mensaje claro (mejor UX que solo esperar el P2002
// de la restricción única de la base) — la restricción única en DB
// (migración 014) sigue siendo la protección real contra condiciones de
// carrera, este chequeo nunca es la única defensa.
async function assertNoDuplicateProduct(
  carrierId: string,
  name: string,
  policyType: string,
  planYear: number | null | undefined,
  excludeId?: string
): Promise<void> {
  const nameNormalized = normalizeProductName(name);
  const existing = await prisma.product.findFirst({
    where: {
      carrierId,
      nameNormalized,
      policyType: policyType as Prisma.EnumPolicyTypeFilter["equals"],
      planYear: planYear ?? null,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(
      "CONFLICT",
      "name: Ya existe un producto con este nombre para esta compañía, tipo de seguro y año de plan."
    );
  }
}

export async function listProducts(actor: AuthorizedUser, rawQuery: unknown) {
  void actor;
  const { page, pageSize, carrierId, policyType, active } = parseOrThrow(
    listProductsQuerySchema,
    rawQuery
  );

  const where: Prisma.ProductWhereInput = {
    ...(carrierId ? { carrierId } : {}),
    ...(policyType ? { policyType } : {}),
    ...(active === undefined ? {} : { isActive: active }),
  };

  // Promise.all, no prisma.$transaction([...]) — ver docs/DECISIONS.md
  // ("Advertencia de concurrencia pg", Fase 019.6).
  const [items, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: productSelect,
      orderBy: [{ carrier: { name: "asc" } }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.product.count({ where }),
  ]);

  return { items, total, page, pageSize };
}

export async function getProductById(actor: AuthorizedUser, rawId: unknown) {
  void actor;
  const id = parseOrThrow(productIdSchema, rawId);
  const product = await prisma.product.findUnique({ where: { id }, select: productSelect });
  if (!product) throw new AppError("NOT_FOUND", "Producto no encontrado.");
  return product;
}

// K) Decisión: SÍ se permite crear un Product bajo un Carrier inactivo.
// El catálogo puede prepararse (o quedar temporalmente inactivo por la
// compañía) sin bloquear la administración del producto — lo único que
// se bloquea es USARLO en una Policy nueva (createPolicy en
// policies.service.ts ya valida Carrier.isActive además de
// Product.isActive).
export async function createProduct(actor: AuthorizedUser, rawInput: unknown) {
  assertCanManageProducts(actor);
  const input = parseOrThrow(createProductSchema, rawInput);
  await assertCarrierExists(input.carrierId);
  await assertNoDuplicateProduct(input.carrierId, input.name, input.policyType, input.planYear);

  try {
    // nameNormalized nunca se pasa manualmente — lo calcula un trigger
    // de Postgres a partir de `name` en cada INSERT/UPDATE (migración
    // 014), así funciona igual para este servicio, los scripts de seed
    // y el importador legacy, sin que ninguno necesite saberlo.
    return await prisma.product.create({
      data: input,
      select: productSelect,
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "name: Ya existe un producto con este nombre para esta compañía, tipo de seguro y año de plan."
      );
    }
    throw error;
  }
}

export async function updateProduct(actor: AuthorizedUser, rawId: unknown, rawInput: unknown) {
  assertCanManageProducts(actor);
  const id = parseOrThrow(productIdSchema, rawId);
  const input = parseOrThrow(updateProductSchema, rawInput);

  const existing = await prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      carrierId: true,
      name: true,
      policyType: true,
      planYear: true,
      _count: { select: { policies: true } },
    },
  });
  if (!existing) throw new AppError("NOT_FOUND", "Producto no encontrado.");

  const isUsed = existing._count.policies > 0;
  if (isUsed) {
    for (const field of IMMUTABLE_AFTER_USE_FIELDS) {
      if (input[field] !== undefined) {
        throw new AppError(
          "VALIDATION_ERROR",
          `${field}: Este producto ya fue usado en al menos una póliza — su compañía, tipo de seguro y año de plan no se pueden cambiar. Crea un producto nuevo si el cambio es real.`
        );
      }
    }
  }

  if (input.carrierId !== undefined) {
    await assertCarrierExists(input.carrierId);
  }

  // Fase 022 (Hallazgo #5 de UAT): revalida contra la combinación FINAL
  // (existente + lo que realmente cambia), solo cuando algún campo de
  // la identidad del producto está en juego — evita una consulta extra
  // en la edición típica que solo toca externalCode/isActive.
  const finalName = input.name ?? existing.name;
  const finalPolicyType = input.policyType ?? existing.policyType;
  const finalPlanYear = input.planYear !== undefined ? input.planYear : existing.planYear;
  if (input.name !== undefined || input.carrierId !== undefined) {
    await assertNoDuplicateProduct(existing.carrierId, finalName, finalPolicyType, finalPlanYear, id);
  }

  try {
    return await prisma.product.update({ where: { id }, data: input, select: productSelect });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        "CONFLICT",
        "name: Ya existe un producto con este nombre para esta compañía, tipo de seguro y año de plan."
      );
    }
    throw error;
  }
}

// Mismo motivo que setCarrierActive: atajo directo con boolean ya
// resuelto, sin pasar por el formato crudo de updateProduct. Nunca
// bloqueado por uso histórico — desactivar/reactivar un producto usado
// es exactamente el mecanismo previsto para retirarlo (ver
// docs/DECISIONS.md), no un cambio de identidad.
export async function setProductActive(actor: AuthorizedUser, rawId: unknown, isActive: boolean) {
  assertCanManageProducts(actor);
  const id = parseOrThrow(productIdSchema, rawId);
  const existing = await prisma.product.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new AppError("NOT_FOUND", "Producto no encontrado.");
  return prisma.product.update({ where: { id }, data: { isActive }, select: productSelect });
}
