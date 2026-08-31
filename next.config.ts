import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Evita que `next dev` inyecte instrucciones para agentes de IA en CLAUDE.md,
  // que ya es nuestro archivo de contexto permanente del proyecto.
  agentRules: false,
  // Habilita forbidden()/unauthorized() (next/navigation) — necesario
  // para que ASSISTANT reciba un 403 real al navegar a /commissions,
  // no solo un redirect silencioso (ver docs/DECISIONS.md, Fase 016).
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
