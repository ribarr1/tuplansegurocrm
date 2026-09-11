import "server-only";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — MFA (Sección 10: "Evitar replay dentro de la misma
// ventana TOTP si el framework permite registrar el último paso
// utilizado"). La verificación TOTP nativa de Better Auth
// (@better-auth/utils/otp::verifyTOTP) solo compara el código contra
// una ventana de tiempo — nunca registra qué código ya se usó, así que
// un mismo código de 6 dígitos sigue siendo "válido" para OTRA llamada
// mientras dure su ventana (~90s con window=1). Para el step-up
// financiero (donde un mismo código exitoso NUNCA debe poder revelar
// dos métodos de pago distintos) esta guarda cierra ese hueco: una vez
// que un código se usó con éxito para un actor, se marca consumido
// hasta que su ventana expira. En memoria (misma justificación que
// src/lib/rate-limit.ts — una sola instancia, sin Redis).
//
// NO se usa en el desafío de login (auth.api.verifyTOTP vía el propio
// endpoint de Better Auth): ahí, reutilizar el código dentro de los
// mismos ~90s solo podría volver a iniciar sesión como el MISMO
// usuario legítimo — no hay escalamiento de privilegio ni acceso a un
// recurso distinto, y ya existe rate limiting + bloqueo de cuenta
// nativo (TwoFactor.failedVerificationCount/lockedUntil) para intentos
// repetidos. Documentado en docs/DECISIONS.md como riesgo residual
// aceptado, no ignorado.
// ---------------------------------------------------------------------------

const usedCodes = new Map<string, number>();
const TOTP_WINDOW_MS = 90 * 1000;

function sweepExpired(now: number): void {
  if (usedCodes.size < 500) return;
  for (const [key, expiresAt] of usedCodes) {
    if (expiresAt <= now) usedCodes.delete(key);
  }
}

// Devuelve true y consume el código si es la primera vez que se usa
// para este actor dentro de la ventana; false si ya se usó (replay).
export function consumeTotpCodeOnce(actorId: string, code: string): boolean {
  const now = Date.now();
  sweepExpired(now);
  const key = `${actorId}:${code}`;
  const expiresAt = usedCodes.get(key);
  if (expiresAt && expiresAt > now) return false;
  usedCodes.set(key, now + TOTP_WINDOW_MS);
  return true;
}

// Solo para pruebas.
export function resetTotpReplayGuardForTests(): void {
  usedCodes.clear();
}
