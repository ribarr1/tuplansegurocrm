// Shim para ejecutar scripts operacionales standalone (con `tsx`, fuera
// del build de Next.js) que importan, transitivamente, algún módulo de
// src/services/** marcado con `import "server-only"` (ej.
// commission-payment-linking.ts, audit.service.ts).
//
// NUNCA modifica ni elimina `import "server-only"` de ningún archivo
// real del proyecto — ese guard sigue protegiendo esos módulos contra
// una importación accidental desde un Client Component, exactamente
// igual que antes, dentro de Next.js. Este shim solo actúa cuando se
// pasa explícitamente vía `node --require`, nunca durante `next dev`/
// `next build`/`next start` — el comportamiento normal de Next.js no
// cambia en absoluto.
//
// Motivo técnico: el paquete `server-only` lanza un error incondicional
// al importarse fuera del bundler de Next.js (ver
// node_modules/server-only/index.js). `tsx`, al ejecutar un script
// standalone, resuelve ese import vía CommonJS `require()` (confirmado
// por el stack trace real: Module._compile -> tsx register -> require) —
// nunca vía un resolve hook de ESM (`module.register()`), que por eso
// NO intercepta este caso. Este archivo parchea `Module._load` para que
// CUALQUIER `require("server-only")` dentro del proceso de este script
// devuelva un módulo vacío en vez de lanzar — inocuo, porque el propio
// paquete no exporta nada real de todos modos (ver su código fuente).
//
// Uso (ver el encabezado de cada script operacional que lo necesite):
//   node --require ./scripts/server-only-shim.cjs --import tsx scripts/<script>.ts [flags]
const Module = require("node:module");
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};
