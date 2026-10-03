# Conector Web — instrucciones de instalación (fuera de este repositorio)

El formulario de tuplansegurousa.com (o quien lo opere) vive en otro repositorio/servidor, fuera del alcance de este trabajo. Esto es lo que hay que instalar **ahí**, con instrucciones concretas.

## Regla de seguridad — nunca negociable

**La credencial (`Authorization: Bearer <key>.<secret>`) NUNCA debe llegar al navegador.** Nunca en HTML, nunca en una variable `NEXT_PUBLIC_*`/`VITE_*`/similar, nunca en el `<script>` de la página, nunca en un atributo `data-*`. El envío a `/api/leads/intake` debe hacerse **desde el servidor** de la web (el backend que procesa el formulario), nunca desde JavaScript del cliente.

## Flujo correcto

```
Navegador del visitante
   │  POST /submit-formulario (al backend de la web, mismo origen)
   ▼
Backend de la web (Node/PHP/Python/lo que sea)
   │  valida el formulario normalmente
   │  POST https://<tu-dominio-crm>/api/leads/intake
   │  Header: Authorization: Bearer <credentialKey>.<secret>
   ▼
CRM TuPlanSeguro (este repositorio)
```

## Ejemplo de servidor (Node.js, cualquier framework)

```js
// Variable de entorno del SERVIDOR de la web — nunca expuesta al navegador.
const CRM_LEAD_CREDENTIAL = process.env.CRM_LEAD_WEB_CREDENTIAL; // "Bearer xxx.yyy"
const CRM_INTAKE_URL = process.env.CRM_LEAD_INTAKE_URL; // "https://<tu-dominio-crm>/api/leads/intake"

async function sendLeadToCRM(formData) {
  const response = await fetch(CRM_INTAKE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: CRM_LEAD_CREDENTIAL,
    },
    body: JSON.stringify({
      fullName: formData.fullName,
      phone: formData.phone,
      email: formData.email || undefined,
      residenceState: formData.state || undefined,
      productInterest: formData.productInterest || undefined,
      // Idempotencia: usa un ID propio del envío del formulario (ej.
      // un UUID generado al cargar la página, o el ID de tu propia
      // base de datos del formulario) — NUNCA un timestamp, que
      // cambiaría en cada reintento y rompería la deduplicación.
      idempotencyKey: formData.submissionId,
      campaignId: formData.utmCampaign || undefined,
      campaignName: formData.utmCampaignName || undefined,
      consentGiven: formData.acceptedContact === true, // solo si el formulario realmente lo pregunta explícitamente
      consentText: formData.consentCheckboxLabel || undefined,
      consentSource: "formulario web tuplansegurousa.com",
    }),
  });

  if (response.status === 409) {
    // Clave de idempotencia reutilizada con datos distintos — revisar,
    // nunca reintentar automáticamente con el mismo submissionId.
    const body = await response.json();
    console.error("Conflicto de idempotencia al enviar lead:", body.error);
    return;
  }
  if (!response.ok) {
    // 4xx/5xx — registrar para revisión manual, nunca fallar
    // silenciosamente el envío del formulario al visitante.
    console.error("Error al enviar lead al CRM:", response.status, await response.text());
  }
}
```

## Variables de entorno a configurar en el servidor de la web

| Variable | Valor | Dónde se obtiene |
|---|---|---|
| `CRM_LEAD_WEB_CREDENTIAL` | `Bearer <credentialKey>.<secret>` | Se genera UNA vez en `/settings/lead-credentials` del CRM (ADMIN), fuente **WEB** — cópialo en ese momento, no se puede volver a mostrar |
| `CRM_LEAD_INTAKE_URL` | `https://crm.tuplansegurousa.com/api/leads/intake` | URL definitiva de producción del CRM (VPS de Hostinger) |

## Atribución de campaña (anuncios que dirigen a la web)

Los clics de Google Ads/Meta que llevan a un visitante al formulario de la web (en vez de usar el formulario nativo de la plataforma) entran por **este** conector, no por los webhooks de Google/Meta — son conceptualmente distintos (formulario nativo de la plataforma vs. formulario propio alojado en la web). Para no perder la atribución, el formulario de la web debe capturar los parámetros UTM/click-id de la URL (`utm_campaign`, `gclid`, `fbclid`, etc.) y enviarlos como `campaignId`/`campaignName` — nunca confundirlos con un lead nativo de Google/Meta.

## Estado de esta integración

**API preparada + instrucciones entregadas — NO implementado en la web real.** `POST /api/leads/intake` ya está en producción (`https://crm.tuplansegurousa.com/api/leads/intake`) y probado contra el contrato descrito aquí (ver `docs/LEAD_FACTORY_UAT.md`, secciones 1–7). Lo que falta, y sigue pendiente, es: instalar el envío servidor-a-servidor de este documento en el servidor real de tuplansegurousa.com, y probarlo de extremo a extremo contra producción (un envío real del formulario de la web → lead visible en el CRM). Este repositorio no tiene acceso al código de la web — si se comparte ese acceso, se puede ayudar a implementarlo directamente; mientras tanto, estas instrucciones son el entregable completo para que el equipo de la web lo instale. **Recordatorio no negociable**: la credencial nunca debe exponerse en el navegador (ver regla de seguridad arriba).

## Contrato estricto (revisado 2026-10-02 — sin cambios de código)

La ruta no convierte tipos: `campaignId`/`campaignName`/`externalId`/`idempotencyKey` deben ser **strings** (un número devuelve `400`), y los campos opcionales vacíos deben **omitirse** (no enviar `null`; `JSON.stringify` ya omite `undefined`). `residenceState` debe ser un código de 2 letras (`FL`), `productInterest` uno de los valores del catálogo (`HEALTH`, `LIFE`, `DENTAL`…). El envío desde Postman a producción ya fue exitoso; la instalación en la web real sigue pendiente.
