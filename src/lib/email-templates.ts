import "server-only";

// ---------------------------------------------------------------------------
// PREPRODUCCIÓN — Correos, invitaciones y recuperación de acceso.
//
// Plantilla HTML reutilizable ÚNICA para todos los correos transaccionales
// del CRM — antes de esta fase cada flujo (invitación, reset de
// contraseña) construía su propio HTML suelto, sin marca ni estilo
// consistente. Nunca incluye datos sensibles del cliente (pólizas, pagos,
// SSN, EAD, información médica) — por diseño, solo recibe el texto/botón
// que cada flujo de autenticación necesita mostrar.
//
// TODO el contenido dinámico (nombre, motivo, etc.) pasa por escapeHtml()
// antes de interpolarse en el HTML — nunca se permite que un nombre con
// caracteres HTML (ej. "<script>") se inyecte sin escapar. La versión de
// texto plano nunca necesita escapado (no es HTML), pero tampoco debe
// contener el texto ya escapado (evita mostrar "&amp;" literal en un
// cliente de correo de solo texto) — por eso cada builder recibe el
// valor CRUDO y decide cómo tratarlo en cada versión.
// ---------------------------------------------------------------------------

const BRAND_BLUE = "#1d4ed8";
const BRAND_ORANGE = "#f97316";
const BRAND_NAME = "Tu Plan Seguro USA";

// Nunca usar dangerouslySetInnerHTML/interpolación sin escapar en el
// resto del proyecto (esto es un correo, no un componente React) — este
// es el único punto que decide qué caracteres son seguros de interpolar
// directamente en el HTML del mensaje.
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface TransactionalEmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface TransactionalEmailOptions {
  subject: string;
  /** Ya debe venir con cualquier interpolación de usuario pasada por escapeHtml(). */
  bodyHtml: string;
  /** Versión de texto plano del mismo cuerpo — NUNCA HTML escapado. */
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string;
  /** Aviso mostrado siempre — por defecto, el estándar "ignora este correo si no lo solicitaste". */
  ignoreNotice?: string;
}

const DEFAULT_IGNORE_NOTICE =
  "Si no solicitaste esta acción, puedes ignorar este correo de forma segura — no se realizó ningún cambio en tu cuenta.";

// Diseño simple, responsive (una sola columna, ancho máximo), colores
// azul/naranja de la marca — deliberadamente sin CSS externo ni
// imágenes remotas (mejor entregabilidad, sin dependencias de red para
// que el correo se vea bien).
export function renderTransactionalEmail(options: TransactionalEmailOptions): TransactionalEmailContent {
  const ignoreNotice = options.ignoreNotice ?? DEFAULT_IGNORE_NOTICE;
  const ctaHtml =
    options.ctaLabel && options.ctaUrl
      ? `
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;">
          <tr>
            <td style="border-radius:6px;background-color:${BRAND_BLUE};">
              <a href="${escapeHtml(options.ctaUrl)}" style="display:inline-block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:6px;">
                ${escapeHtml(options.ctaLabel)}
              </a>
            </td>
          </tr>
        </table>
        <p style="font-size:13px;color:#475569;word-break:break-all;">
          Si el botón no funciona, copia y pega esta dirección completa en tu navegador:<br />
          <a href="${escapeHtml(options.ctaUrl)}" style="color:${BRAND_BLUE};">${escapeHtml(options.ctaUrl)}</a>
        </p>`
      : "";

  const html = `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="background-color:${BRAND_BLUE};padding:20px 24px;border-top:4px solid ${BRAND_ORANGE};">
                <span style="font-size:18px;font-weight:700;color:#ffffff;">${escapeHtml(BRAND_NAME)}</span>
              </td>
            </tr>
            <tr>
              <td style="padding:24px;color:#0f172a;font-size:15px;line-height:1.5;">
                ${options.bodyHtml}
                ${ctaHtml}
                <p style="font-size:13px;color:#64748b;margin-top:24px;border-top:1px solid #e2e8f0;padding-top:16px;">
                  ${escapeHtml(ignoreNotice)}
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;background-color:#f8fafc;font-size:12px;color:#94a3b8;">
                ${escapeHtml(BRAND_NAME)} — Este es un mensaje automático, no respondas directamente a menos que se indique lo contrario.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const textParts = [options.bodyText];
  if (options.ctaLabel && options.ctaUrl) {
    textParts.push(`${options.ctaLabel}: ${options.ctaUrl}`);
  }
  textParts.push(ignoreNotice);
  const text = textParts.join("\n\n");

  return { subject: options.subject, html, text };
}
