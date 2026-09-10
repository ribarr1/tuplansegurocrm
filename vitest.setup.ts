import "dotenv/config";
import { setEmailTransportForTests, createNoopEmailTransportForTests } from "@/lib/email";

// CORRECCIÓN (activación de usuarios / recuperación de contraseña) —
// ningún test debe intentar una llamada de red real a un proveedor de
// correo (ni siquiera indirectamente, vía createUser/resendInvitation/
// el sendResetPassword de auth.ts). Un archivo de test que necesite
// inspeccionar los mensajes "enviados" instala su propio transport de
// prueba y lo restaura a este no-op al terminar — nunca al transport
// real (ver createNoopEmailTransportForTests en src/lib/email.ts).
setEmailTransportForTests(createNoopEmailTransportForTests());
