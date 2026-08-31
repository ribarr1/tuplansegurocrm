import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Evita que `next dev` inyecte instrucciones para agentes de IA en CLAUDE.md,
  // que ya es nuestro archivo de contexto permanente del proyecto.
  agentRules: false,
};

export default nextConfig;
