import "server-only";
import { AppError } from "@/services/errors";

// ---------------------------------------------------------------------------
// CORRECCIÓN (activación de usuarios / recuperación de contraseña) —
// interfaz de envío de correo DESACOPLADA del proveedor real. Antes de
// esta fase el proyecto no tenía ninguna capacidad de envío de correo
// (confirmado por búsqueda exhaustiva) — este módulo es el único punto
// por donde cualquier email sale del sistema, para nunca duplicar
// lógica de configuración/errores entre los distintos flujos que lo
// necesitan (invitación, reenvío, "olvidé mi contraseña").
//
// Proveedor: Resend, vía su API REST directa (fetch) — se eligió NO
// agregar el SDK npm "resend" para mantener el footprint de
// dependencias mínimo; la API es un POST JSON simple. Configurado
// exclusivamente por variables de entorno (RESEND_API_KEY, EMAIL_FROM)
// — nunca credenciales inventadas ni hardcodeadas. Si no está
// configurado, NUNCA se simula un envío exitoso: se lanza un
// SERVICE_UNAVAILABLE claro para que el ADMIN vea un error real en vez
// de creer que el correo salió.
// ---------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<void>;
}

class ResendTransport implements EmailTransport {
  async send(message: EmailMessage): Promise<void> {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) {
      throw new AppError(
        "SERVICE_UNAVAILABLE",
        "El envío de correo no está configurado (falta RESEND_API_KEY y/o EMAIL_FROM) — no se pudo enviar el mensaje."
      );
    }

    const replyTo = process.env.EMAIL_REPLY_TO?.trim() || undefined;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(replyTo ? { reply_to: replyTo } : {}),
      }),
    });

    if (!response.ok) {
      // Nunca se incluye el cuerpo de la respuesta del proveedor en el
      // mensaje al usuario (podría incluir detalles internos) — solo
      // se registra que falló.
      throw new AppError("SERVICE_UNAVAILABLE", "No se pudo enviar el correo. Intenta de nuevo en unos minutos.");
    }
  }
}

// Fase de pruebas: nunca se hace una llamada de red real — se
// reemplaza este transport por un doble de prueba con
// setEmailTransportForTests (vitest.setup.ts instala un no-op global
// por defecto; un archivo de test individual puede instalar el suyo
// propio para inspeccionar los mensajes "enviados" y restaurar el
// no-op después, nunca el transport real).
let transport: EmailTransport = new ResendTransport();

export function setEmailTransportForTests(fake: EmailTransport): void {
  transport = fake;
}

// Nunca vuelve al transport REAL (ResendTransport) — un test que
// "restaura" por error terminaría intentando una llamada de red real.
// Usar esto (o el propio no-op de vitest.setup.ts) para volver a un
// estado seguro entre pruebas.
export function createNoopEmailTransportForTests(): EmailTransport {
  return { async send() {} };
}

// Nunca loguear el contenido del mensaje (puede incluir un token/enlace
// de un solo uso) — el caller es responsable de auditar solo hechos
// (ej. "invitación enviada"), nunca el cuerpo del correo.
export async function sendEmail(message: EmailMessage): Promise<void> {
  await transport.send(message);
}
