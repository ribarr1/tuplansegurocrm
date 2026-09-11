"use server";

import { headers } from "next/headers";
import { requestPasswordReset } from "@/services/password-recovery.service";

export type RequestPasswordResetResult = { status: "sent" | "rate_limited" | "error" };

// PREPRODUCCIÓN — envuelve requestPasswordReset (que a su vez envuelve
// el endpoint NATIVO de Better Auth) para agregar la elegibilidad
// (cuenta activa y ya activada) y el límite de tasa propio que Better
// Auth no cubre para esta ruta específica — ver
// password-recovery.service.ts para el detalle completo. La respuesta
// hacia el cliente es SIEMPRE genérica salvo por "demasiadas
// solicitudes" (una señal de throttling, nunca de existencia de cuenta).
export async function requestPasswordResetAction(email: string): Promise<RequestPasswordResetResult> {
  try {
    const result = await requestPasswordReset(email, await headers());
    return { status: result.status };
  } catch {
    // Un error de validación de correo (formato inválido) tampoco debe
    // filtrar detalle interno — se trata igual que "enviado" desde la
    // perspectiva del mensaje mostrado (el formulario ya valida
    // type="email" del lado del cliente de todas formas).
    return { status: "sent" };
  }
}
