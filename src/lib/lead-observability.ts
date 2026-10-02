// Observabilidad mínima de la Fábrica de leads — Fase 026,
// Preparación para producción (§7D). El proyecto no tiene todavía un
// sistema de logging estructurado (ver docs/ARCHITECTURE.md) — esto es
// `console.log` con un formato JSON consistente, fácil de ingerir
// después por cualquier colector sin introducir una dependencia nueva
// ("no introduzcas una consola amplia si basta con una operación y
// documentación simples").
//
// NUNCA se registra: el payload recibido, nombre/teléfono/correo del
// lead, secretos de credenciales/conectores, tokens, ni el cuerpo de
// un error (solo su `code`/categoría). Ver docs/SECURITY.md.
type LeadIntakeLogSource = "WEB_API" | "GOOGLE" | "META" | "WEB";

export function logLeadIntakeEvent(entry: {
  correlationId: string;
  source: LeadIntakeLogSource | string;
  result: string;
  durationMs: number;
  errorCategory?: string;
}): void {
  console.log(
    JSON.stringify({
      component: "lead-intake",
      correlationId: entry.correlationId,
      source: entry.source,
      result: entry.result,
      durationMs: entry.durationMs,
      errorCategory: entry.errorCategory,
      at: new Date().toISOString(),
    })
  );
}

export function logLeadWebhookEvent(entry: {
  correlationId: string;
  source: "GOOGLE" | "META";
  eventId?: string;
  result: string;
  durationMs: number;
  errorCategory?: string;
}): void {
  console.log(
    JSON.stringify({
      component: "lead-webhook",
      correlationId: entry.correlationId,
      source: entry.source,
      eventId: entry.eventId,
      result: entry.result,
      durationMs: entry.durationMs,
      errorCategory: entry.errorCategory,
      at: new Date().toISOString(),
    })
  );
}

export function logLeadWorkerEvent(entry: {
  jobId?: string;
  eventId?: string;
  source?: string;
  result: string;
  durationMs?: number;
  attempts?: number;
  errorCategory?: string;
}): void {
  console.log(
    JSON.stringify({
      component: "lead-worker",
      jobId: entry.jobId,
      eventId: entry.eventId,
      source: entry.source,
      result: entry.result,
      durationMs: entry.durationMs,
      attempts: entry.attempts,
      errorCategory: entry.errorCategory,
      at: new Date().toISOString(),
    })
  );
}
