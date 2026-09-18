import "dotenv/config";
import { assertTestDatabase } from "@/lib/test-db-guard";
import { setEmailTransportForTests, createNoopEmailTransportForTests } from "@/lib/email";

// Fase 1.1 — BLOQUEANTE DE SEGURIDAD (ver src/lib/test-db-guard.ts):
// se ejecuta ANTES que cualquier test corra un solo deleteMany.
// vitest.config.mts ya carga .env.test con override:true, así que en
// una ejecución normal esto siempre pasa — este assert es la red de
// seguridad para cuando algo (config editada a mano, variables de
// entorno heredadas del shell, etc.) intente saltárselo.
assertTestDatabase();

// CORRECCIÓN (activación de usuarios / recuperación de contraseña) —
// ningún test debe intentar una llamada de red real a un proveedor de
// correo (ni siquiera indirectamente, vía createUser/resendInvitation/
// el sendResetPassword de auth.ts). Un archivo de test que necesite
// inspeccionar los mensajes "enviados" instala su propio transport de
// prueba y lo restaura a este no-op al terminar — nunca al transport
// real (ver createNoopEmailTransportForTests en src/lib/email.ts).
setEmailTransportForTests(createNoopEmailTransportForTests());
