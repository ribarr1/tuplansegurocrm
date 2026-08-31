// Error de aplicación previsible (no un bug). Los servicios lanzan
// AppError para casos esperados (no encontrado, sin permiso, input
// inválido, conflicto). El código de estado ya viene resuelto para
// que la capa que llama al servicio (Server Action / Route Handler)
// no tenga que reinventar ese mapeo cada vez.
//
// Nunca exponer al usuario errores crudos de Prisma (SQL, nombres de
// constraint, stack traces) — si un servicio captura un error de
// Prisma inesperado, debe traducirlo a un AppError genérico o dejar
// que la capa superior lo trate como error interno sin detalles.

export type AppErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT";

const STATUS_BY_CODE: Record<AppErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;

  constructor(code: AppErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = STATUS_BY_CODE[code];
  }
}

type ZodLikeSchema<T> = { safeParse: (input: unknown) => { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } } };

// Traduce un error de validación de Zod a AppError, con el path del
// primer campo inválido incluido en el mensaje (útil sin exponer la
// forma interna del schema). Se usa al inicio de cada servicio, antes
// de tocar Prisma.
export function parseOrThrow<T>(schema: ZodLikeSchema<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path?.join(".") || "input";
    throw new AppError("VALIDATION_ERROR", `${field}: ${first?.message ?? "inválido"}`);
  }
  return result.data;
}
