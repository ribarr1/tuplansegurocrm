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
  // Fase 025.5.4 — pdfjs-dist resuelve su worker en Node con una ruta
  // relativa propia ("./pdf.worker.mjs", relativa al archivo pdf.mjs
  // dentro de node_modules) que solo funciona si el paquete se ejecuta
  // TAL CUAL desde disco. Si Next lo empaqueta (comportamiento por
  // defecto para dependencias del servidor, tanto en `next dev` como en
  // build), esa ruta relativa termina apuntando a un chunk generado en
  // .next/.../chunks que nunca contiene el worker real, y pdfjs falla
  // con "Setting up fake worker failed: Cannot find module
  // pdf.worker.mjs". Declarar el paquete como externo hace que Next lo
  // deje intacto en node_modules (require() normal en tiempo de
  // ejecución) tanto en desarrollo como en producción — sin copiar
  // archivos a mano, sin rutas absolutas del entorno local, y sin tocar
  // la versión instalada (ver docs/COMMISSION_RECONCILIATION.md).
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
