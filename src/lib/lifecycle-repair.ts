// Fase 025.2 — incidente de datos real: un test de integración
// (policy-lifecycle.service.test.ts) llamaba a la reconciliación real
// SIN acotar su scope, expirando prematuramente pólizas HEALTH 2026
// genuinas en DEV (ver scripts/repair-lifecycle-incident-2026-09.ts).
//
// Este módulo aísla el CRITERIO de reparación (nunca la reparación en
// sí, que es un script de un solo uso) para poder probarlo: una
// póliza EXPIRED solo se restaura a ACTIVE si hay evidencia clara
// (un AuditEvent POLICY_AUTO_EXPIRED) de que un job automático la
// expiró, Y su terminationDate real (ya corregida si aplicaba) sigue
// siendo hoy o en el futuro respecto al businessDate real — nunca por
// el solo hecho de tener el evento faulty, y nunca una CANCELLED ni
// una EXPIRED legítima (sin ese evento, ej. HEALTH 2025).
export function shouldRestoreExpiredPolicyToActive(
  policy: { status: string; terminationDate: Date | null; hasAutoExpiredEvent: boolean },
  businessDateUtc: Date
): boolean {
  if (policy.status !== "EXPIRED") return false;
  if (!policy.hasAutoExpiredEvent) return false;
  if (!policy.terminationDate) return false;
  return policy.terminationDate >= businessDateUtc;
}
