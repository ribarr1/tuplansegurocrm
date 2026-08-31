// "server-only" lanza intencionalmente fuera del compilador de Next.js
// (su propósito es impedir que un módulo servidor termine en el bundle
// cliente). Bajo Vitest no hay bundler de Next, así que se reemplaza
// por un no-op solo para las pruebas — ver vitest.config.ts.
export {};
