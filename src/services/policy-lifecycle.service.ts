import "server-only";

// Reexporta la reconciliación real desde policy-lifecycle-core.ts (sin
// el guard) — ver el comentario de cabecera de ese archivo para el
// porqué de la separación. Toda la app (Server Components/Actions)
// debe seguir importando este archivo, nunca policy-lifecycle-core.ts
// directamente, salvo el job CLI (scripts/policy-lifecycle-job.ts).
export { reconcilePolicyLifecycleCore as reconcilePolicyLifecycle } from "@/services/policy-lifecycle-core";
export type { PolicyLifecycleResult } from "@/services/policy-lifecycle-core";
