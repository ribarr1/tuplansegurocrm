# Fuentes oficiales — Conectores de leads (Fase 026)

Fecha de revisión de todas las fuentes citadas: **2026-10-02**. Las plataformas retiran versiones de API con el tiempo — **vuelve a verificar estos enlaces antes de activar en producción**, especialmente la versión de la Graph API de Meta.

## Google Ads — Lead Form Extensions (webhook)

- [Lead Form Webhook — Overview](https://developers.google.com/google-ads/webhook/docs/overview)
- [Lead Form Webhook — Implementation](https://developers.google.com/google-ads/webhook/docs/implementation)

**Mecanismo**: Google entrega leads por `POST` a una URL de webhook configurada por el anunciante dentro de la extensión de formulario de clientes potenciales, en Google Ads. No requiere un partner certificado para esto — es un mecanismo de webhook genérico documentado.

**Campos del payload** (confirmados en la documentación): `lead_id`, `user_column_data[]` (`column_id`, `column_name`, `string_value`), `api_version`, `form_id`, `campaign_id`, `adgroup_id`, `creative_id`, `gcl_id`, `google_key`, `is_test`, `asset_group_id`, `lead_stage`, `lead_submit_time`, `lead_source`.

**Autenticidad**: `google_key` es un secreto configurado por el anunciante AL CREAR el formulario — viaja en el CUERPO del POST (no en un header). Se compara contra la clave guardada en `LeadIntegrationCredential.connectorSecrets` (ver `src/lib/lead-source-mapping.ts::verifyGoogleWebhookKey`).

**Respuesta esperada** (documentada): `200` con `{}` = éxito; `4XX` con `{"message": "..."}` = fallo NO reintentable; `5XX` con `{"message": "..."}` = fallo reintentable. Deduplicación por `lead_id`: *"A single lead is not guaranteed to be delivered exactly once, hence lead handling webhook should handle duplicates gracefully."*

**Limitación documentada en este proyecto**: `user_column_data[].column_id` para preguntas ESTÁNDAR usa valores fijos (`FULL_NAME`, `PHONE_NUMBER`, `EMAIL`) — para preguntas personalizadas (ej. "Estado de residencia", "Producto de interés") Google asigna un `column_id` propio del formulario que no se puede inferir genéricamente. Esas respuestas se conservan en `formResponses`, nunca se descartan ni se adivina su mapeo — confirmar el `column_id` real contra el formulario configurado en tu cuenta antes de depender de esos campos.

**Dónde configurar la URL/clave**: dentro de Google Ads, al crear o editar la extensión de formulario de clientes potenciales → método de entrega "Webhook". La documentación revisada no detalla la ruta exacta de UI (cambia con el tiempo) — confirmar en el panel de Google Ads al momento de configurar.

## Meta (Facebook/Instagram) — Lead Ads

- [Meta Webhooks for Lead Ads — Quickstart](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration)
- [Webhooks for Leads (leadgen field)](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen)
- [Webhooks — Getting Started (verificación y firma)](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
- [Retrieving Leads (Graph API)](https://developers.facebook.com/docs/marketing-api/guides/lead-ads/retrieving)

**Mecanismo**: el webhook de Meta **nunca** entrega los datos del lead — solo un `leadgen_id`. Los datos reales se recuperan con una llamada autenticada posterior a la Graph API: `GET https://graph.facebook.com/<VERSION>/<LEAD_ID>?fields=created_time,id,ad_id,form_id,field_data&access_token=<PAGE_TOKEN>`. Versión usada en el código (`scripts/lead-webhook-worker.ts`, configurable por `META_GRAPH_API_VERSION`): **v21.0** al momento de esta revisión — **confirmar la versión vigente** antes de producción (Meta retira versiones antiguas periódicamente).

**Verificación del callback (handshake, una sola vez)**: Meta hace `GET` con `hub.mode=subscribe`, `hub.verify_token` (elegido por ti al configurar la app) y `hub.challenge` (entero) — el endpoint debe responder exactamente ese `hub.challenge` si el token coincide.

**Autenticidad de cada evento (POST)**: header `X-Hub-Signature-256: sha256=<hex>` — HMAC-SHA256 del cuerpo crudo con el **App Secret**. *"You don't have to validate the payload, but you should."* Implementado en `src/lib/lead-source-mapping.ts::verifyMetaSignature`.

**Respuesta esperada**: `200 OK` lo antes posible. Reintentos: *"retry immediately, then try a few more times with decreasing frequency over the next 36 hours"* — tras 36 h sin una respuesta reconocida, Meta deja de reintentar. Deduplicación: *"Your server should handle deduplication"* — resuelto por `LeadInboundWebhookEvent.@@unique([source, integrationCredentialId, externalEventId])`.

**Permisos MÍNIMOS requeridos** (distinguidos de los que dependen del flujo, per instrucción explícita de no pedir de más):
- `leads_retrieval` — **obligatorio**: sin él, la llamada a la Graph API para obtener `field_data` falla.
- `pages_show_list`, `pages_read_engagement` — **obligatorios**: necesarios para listar/leer la página y suscribir el webhook.
- `pages_manage_metadata` — **obligatorio**: necesario para suscribir la app a los webhooks de la página (`subscribed_apps`).
- `ads_management` — la documentación de Meta lo lista junto a los anteriores para el flujo de lead ads vía webhook; **no se solicita ningún permiso adicional de gestión de anuncios más allá de este** (no se pide, por ejemplo, acceso a facturación ni a otras páginas).

**Suscripción de la Página**: `POST` a `/<PAGE_ID>/subscribed_apps` con `subscribed_fields=leadgen` y el **Page Access Token** (no el App Token).

**Restricción a páginas/formularios configurados** (§5B): implementado comparando `page_id` del evento contra el `pageId` guardado en `connectorSecrets` de la credencial que validó la firma — un evento de otra página nunca se procesa con una credencial ajena (`src/app/api/leads/intake/meta/route.ts`).

**Nombres de campo de `field_data`**: la documentación confirma preguntas estándar (`FULL_NAME`, `EMAIL`, `PHONE` como *tipos*) pero los nombres exactos de clave en `field_data[].name` pueden variar según cómo se creó el formulario. `src/lib/lead-source-mapping.ts::mapMetaFieldDataToIntakePayload` prueba varias claves candidatas (`full_name`/`name`, `phone_number`/`phone`, `email`/`work_email`, `state`) y conserva cualquier campo no reconocido en `formResponses` — **confirmar los nombres reales contra un lead de prueba del formulario ya configurado** antes de depender de un mapeo específico en producción.

## Cola duradera — pg-boss

- [pg-boss — README (GitHub, rama master)](https://cdn.jsdelivr.net/gh/timgit/pg-boss@master/README.md)
- Paquete instalado: **pg-boss@12.35.1** (versión estable más reciente en npm al momento de esta revisión).

Requisitos confirmados en el propio paquete (`node_modules/pg-boss/dist/types.d.ts`, inspeccionado directamente): Node ≥ 22.12, PostgreSQL ≥ 13 (este proyecto usa Postgres 16 y Node 22.19 — compatible). `retryLimit` (default 2), `retryDelay` (segundos, default 0), `retryBackoff` (exponencial con jitter, default false), `expireInSeconds` (default 900 — tiempo antes de reclamar un job "activo" abandonado). Reclamo exclusivo entre instancias vía `SKIP LOCKED` de PostgreSQL — automático, sin configuración adicional.

## Por qué NO se usó un `send()` transaccional con Prisma

pg-boss expone un adaptador `fromPrisma(tx)` para encolar un trabajo dentro de una transacción de Prisma existente. Se evaluó, pero la documentación oficial (README, `pgboss.io`) no detalla con suficiente profundidad su comportamiento dentro de una transacción de aplicación ya abierta (ver intento de verificación en este mismo trabajo — la página `pgboss.io/docs/*` no resolvió, y el README no cubre el patrón). Ante esa falta de documentación clara para algo tan crítico como "nunca perder un evento", se optó por el patrón **outbox + barrido** (ver `src/lib/lead-queue.ts`), que usa únicamente la API pública bien documentada (`send`, `work`, `schedule`) y cierra la ventana de "evento guardado pero nunca encolado" con un cron de barrido cada minuto — la pérdida máxima posible es un retraso acotado, nunca una pérdida real.
