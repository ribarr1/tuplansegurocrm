# Fábrica de leads — Guía UAT (Fase 026)

Guía breve para probar el módulo en local. Requiere `npm run dev` corriendo y, para los casos de Postman, una credencial creada en `/settings/lead-credentials` (ADMIN).

## 0. Preparación

1. `npm run dev`
2. Inicia sesión como ADMIN → `/settings/lead-credentials` → "Crear credencial" (fuente WEB) → copia el valor `Authorization: Bearer <key>.<secret>` que se muestra. **Solo se muestra una vez.**
3. Importa `docs/postman/lead-factory.postman_collection.json` y `docs/postman/lead-factory.postman_environment.json` en Postman. Pega el valor copiado en la variable `webAuthorization` del entorno.

## 1. Recepción por Postman

| Paso | Esperado |
|---|---|
| Ejecuta "1. Lead nuevo — WEB" | `201 Created`, cuerpo con `stage: "LEAD"`, `followUpStatus: "NEW"`, `duplicate: false` |
| Ejecuta "3. Campos opcionales ausentes" (solo nombre+teléfono) | `201 Created` — ningún campo opcional ausente bloquea la recepción |
| Ejecuta "4a. Teléfono inválido" y "4b. Nombre ausente" | Ambos `400`, con mensaje de validación |
| Ejecuta "5a. Credencial ausente" y "5b. Credencial inválida" | Ambos `401` |
| En la app, ve a `/leads` (ADMIN o AGENT con el lead asignado) | El lead recién recibido aparece en el listado, columna "Fuente" = Formulario web |

## 2. Duplicados / idempotencia

| Paso | Esperado |
|---|---|
| Ejecuta "6. Reenvío del mismo externalId, MISMOS datos" (cuerpo idéntico a la petición 1) | `200 OK` (no `201`), `duplicate: true`, mismo `id` que el primero |
| En `/leads`, cuenta cuántas filas tienen ese nombre | Exactamente 1 — el reenvío no creó un segundo lead ni una segunda tarea |
| Ejecuta "6b. Reutilizar el mismo externalId con OTROS datos" | `409 Conflict`, mensaje "El externalId ya fue utilizado con otros datos..." — **nunca** devuelve el lead original como si fuera un reenvío normal, y no lo modifica |
| Repite el mismo caso con `idempotencyKey` en vez de `externalId` (payload sin `externalId`, mismo `idempotencyKey` pero otro nombre/teléfono) | `409 Conflict`, mensaje "La clave de idempotencia ya fue utilizada con otros datos..." |
| Recibe un lead, **edita sus datos desde `/leads/[id]` → "Editar datos"** (cambia nombre/teléfono/correo) y luego reenvía el payload **ORIGINAL** (el de antes de editar) con la misma clave | `200 OK`, `duplicate: true`, mismo `id` — la edición NUNCA afecta la comparación de idempotencia (se compara contra la instantánea original, no contra los datos editables) |
| Envía un payload con un `externalId` que ya existe y una `idempotencyKey` que corresponde a OTRO lead distinto | `409 Conflict` — ninguno de los dos leads se modifica |
| (Opcional, verificado automáticamente) Reenvíos simultáneos con los mismos datos, y con datos distintos | Cubierto por las pruebas automatizadas `leads.service.test.ts::G` y `::G2` — Postman no dispara solicitudes concurrentes de forma nativa |

## 2b. Respuestas del formulario

| Paso | Esperado |
|---|---|
| Envía un lead (Postman) con `formResponses` anidado, ej. `{"a":1,"nested":{"x":1},"list":[1,2,3]}` | `201 Created` |
| Abre el lead en `/leads/[id]` | Sección "Respuestas del formulario" muestra el contenido de forma legible (listas anidadas), **nunca** como HTML interpretado — solo texto |

## 3. Coincidencias por teléfono

| Paso | Esperado |
|---|---|
| Anota el teléfono de un Contacto existente en `/contacts` | — |
| Envía un lead (Postman) con ese mismo teléfono y un `externalId` nuevo | `201 Created`, `personMatch.matched: true` en la respuesta |
| Abre el lead en `/leads/[id]` | Sección "Contacto vinculado" muestra el contacto real y su agente actual; se creó una tarea de atención **sin asignar** (visible en `/tasks` o en la sección "Tareas vinculadas" del lead) |
| Envía un lead con un teléfono compartido por 2+ contactos | `201 Created`, `personMatch.ambiguous: true`; el detalle del lead muestra "Coincidencia ambigua" con ambos candidatos, sin vincular ninguno |

## 4. Asignación

| Paso | Esperado |
|---|---|
| Como ADMIN, en `/leads/[id]` de un lead sin asignar, elige un agente y clic "Asignar" | El lead pasa a mostrar ese agente; aparece en el historial de asignaciones |
| Inicia sesión como ESE agente → `/leads` | El lead aparece en su listado |
| Inicia sesión como OTRO agente → intenta `/leads/[id]` con el mismo ID directo en la URL | "No tienes acceso a este lead" (nunca un error genérico) |
| Como ADMIN, reasigna el lead a un tercer agente | El agente anterior, al refrescar `/leads/[id]`, pierde el acceso inmediatamente |
| Marca la casilla "Reasignar también la tarea pendiente" al reasignar (si el lead tiene una tarea de atención abierta) | La tarea en `/tasks` también cambia de responsable |

## 5. Seguimiento

| Paso | Esperado |
|---|---|
| En `/leads/[id]`, clic "Confirmar interés (pasar a Prospecto)" | Etapa cambia a "Prospecto"; el botón desaparece (solo aplica una vez, desde LEAD) |
| Cambia el selector "Estado de seguimiento" | Se guarda inmediatamente (sin recargar la página) |
| Registra una actividad (Llamada/WhatsApp/Email/Nota) con una "Próxima acción" con fecha | Aparece en "Historial de actividades"; se crea una tarea nueva con esa fecha de vencimiento (ver `/tasks`) |
| Intenta cerrar sin elegir motivo | Error de validación en el campo "motivo" |
| Cierra con motivo "Otro" sin escribir el detalle | Error de validación pidiendo el detalle |
| Cierra con un motivo válido | Estado pasa a "Cerrado"; las acciones de etapa/seguimiento quedan deshabilitadas (estado final) |

## 6. Conversión

| Paso | Esperado |
|---|---|
| En un lead sin convertir, baja a la sección "Convertir en cliente" | Si hay coincidencias de contacto, aparecen como opción "Vincular a un contacto existente"; siempre existe la opción "Crear un contacto nuevo" |
| Elige "¿El titular queda cubierto?" = No, completa producto, clic "Convertir" | Se crea la póliza PENDING; el titular NO aparece como miembro cubierto (puedes confirmarlo en `/policies/[id]`); el lead pasa a Etapa "Cliente" / Estado "Convertido" |
| Intenta convertir el mismo lead otra vez | Error "Este lead ya fue convertido" |
| Elige un producto inexistente/inactivo a propósito (para probar atomicidad) | Error de validación; **ningún** contacto nuevo queda creado (revisa `/contacts` — no aparece); el lead sigue en su etapa/estado anterior |

## 7. Dashboard

| Paso | Esperado |
|---|---|
| Como ADMIN o AGENT, abre `/dashboard` | Sección "Leads" con contadores: Nuevos, Sin asignar, En seguimiento, Contactados, Cotización enviada, Pendientes de decisión, Convertidos, Cerrados |
| Clic en cualquier contador | Lleva a `/leads` ya filtrado por ese estado (o `assignedToId=unassigned` para "Sin asignar") |
| Como ASSISTANT | La sección "Leads" NO aparece en el dashboard; `/leads` devuelve "Acceso no autorizado" |
| Compara el contador "Sin asignar" con filtrar leads por estado "Nuevo" | Son conteos independientes — un lead sin asignar puede estar en cualquier estado, no se duplica como categoría propia |

## 8. Conectores — Google, Meta, Web (Preparación para producción)

Cada fuente se prueba en tres niveles, nunca mezclados. **El nivel 3 (prueba real) no se declara aprobado en este trabajo** — requiere cuentas/credenciales que no están disponibles aquí.

### 8.A Google

1. **Automatizada**: `src/lib/lead-source-mapping.test.ts` (mapeo de campos estándar + preguntas personalizadas a `formResponses`, verificación de `google_key`) — ya ejecutada, en verde.
2. **Simulación local**: con `npm run dev` + `npm run worker:leads` corriendo, configura una credencial GOOGLE en `/settings/lead-credentials` con una `verificationKey` de prueba, luego usa la petición Postman "Google — Simulación de webhook" (nueva, ver colección) con ese mismo valor como `google_key`. Resultado esperado: `200 {}`, y el lead aparece en `/leads` segundos después (el worker lo recoge de la cola).
3. **Real** (pendiente — requiere tu cuenta de Google Ads): configurar la extensión de formulario de clientes potenciales con método de entrega "Webhook", apuntando a `https://<dominio-público-https>/api/leads/intake/google`, con la `verificationKey` configurada en el CRM. **Requiere un dominio público con HTTPS** — no es posible desde `localhost`. Ver §9 para opciones de túnel temporal.

### 8.B Meta

1. **Automatizada**: `src/lib/lead-source-mapping.test.ts` (verificación de firma y mapeo de `field_data`) + `src/services/lead-webhook-events.service.test.ts` (dedupe del evento, idempotencia procesamiento/creación tras "caída" simulada, DEAD_LETTER, reintento autorizado) — ya ejecutadas, en verde.
2. **Simulación local**: configura una credencial META en `/settings/lead-credentials` (App Secret/Page Access Token/Verify Token/Page ID de prueba). Prueba el handshake con la petición Postman "Meta — Verificación de webhook (GET)". Prueba un evento con "Meta — Simulación de evento leadgen (POST)" — su script de Postman calcula la firma `X-Hub-Signature-256` automáticamente a partir del App Secret configurado en el entorno. Como no hay un Page Access Token real, la llamada del worker a la Graph API fallará — eso es ESPERADO en este nivel: confirma que el evento queda registrado en `LeadInboundWebhookEvent` (estado `FAILED` tras el primer intento) y visible en "Eventos de webhook fallidos" en `/settings/lead-credentials`, con un botón "Reintentar".
3. **Real** (pendiente — requiere tu app de Meta for Developers, página y permisos revisados): suscribir el webhook, con URL `https://<dominio-público-https>/api/leads/intake/meta`. Ver configuración exacta y permisos mínimos en `docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md`.

### 8.C Web

1. **Automatizada**: cubierta por las pruebas existentes de `/api/leads/intake` (sin cambios de contrato).
2. **Simulación local**: usa la colección Postman existente (casos 1–9) contra `http://localhost:3000` — ya es exactamente el mismo mecanismo que usará el servidor de la web real.
3. **Real** (pendiente — fuera de este repositorio): ver `docs/WEB_CONNECTOR_INSTRUCTIONS.md` para el código/instrucciones a instalar en el servidor de la web.

## 9. Reinicios, concurrencia y fallos del worker

| Paso | Esperado |
|---|---|
| Con el worker corriendo, detenlo con Ctrl+C mientras procesa un evento | Log "SIGINT recibido — apagado ordenado...", espera el trabajo en curso, termina limpio |
| Corre `npm run worker:leads` en dos terminales a la vez, envía 5 eventos | Ningún evento se procesa dos veces (revisa `attempts`/`status` en la tabla — pg-boss reclama cada uno exclusivamente) |
| Detén Postgres unos segundos mientras llega un webhook | La ruta responde `503`/`5XX` (nunca `200` sin guardar) — la plataforma reintentará |
| Fuerza un fallo (Page Access Token inválido) | El evento pasa a `FAILED`, luego `DEAD_LETTER` tras agotar los reintentos configurados — visible y reintentable desde `/settings/lead-credentials` |
| Reintenta un evento `DEAD_LETTER` ya asociado a un lead creado (simulado en `lead-webhook-events.service.test.ts::C`) | No se crea un segundo lead — `intakeLead` reconoce el `externalId` ya usado |
| Revoca la credencial mientras un evento suyo sigue `PENDING`/sin procesar | El worker lo marca `DEAD_LETTER` de inmediato (`"La credencial de integración fue revocada."`), **sin** llamar a la API externa ni crear un lead — ver `scripts/lead-webhook-worker.test.ts::E` |

Automatizadas en `scripts/lead-webhook-worker.test.ts` (llaman `processWebhookEvent` directamente, el mismo código que corre `npm run worker:leads`, sin pasar por pg-boss para poder controlar cada escenario de forma determinista):

| Caso | Qué prueba |
|---|---|
| A | Lead creado exactamente una vez a partir de un evento META válido |
| B | Reenviar un evento ya `PROCESSED` no reprocesa ni vuelve a llamar la Graph API |
| C | Evento dejado en `PROCESSING` (worker "caído" a medias) — el reintento nunca duplica el lead |
| D | Fallo de la Graph API (503) → el evento queda `FAILED` con el error registrado, sin lead creado; un reintento posterior con la API ya recuperada sí lo procesa |
| E | Credencial revocada con el evento pendiente → `DEAD_LETTER` inmediato, sin llamada externa |
| F | Evento inexistente (fila borrada entre encolar y procesar) → no lanza, no hace nada |

## 10. Verificación de operación contra las URLs definitivas de producción (§4) — **NO EJECUTADO, solo el procedimiento**

Las secciones 8–9 cubren pruebas automatizadas y simulaciones LOCALES únicamente. Ningún paso de esta sección 10 se ha ejecutado contra `https://crm.tuplansegurousa.com` ni contra las plataformas reales — se documenta el procedimiento para cuando el VPS tenga el worker desplegado y las credenciales de producción configuradas, y se ejecutará como un paso explícito y separado, nunca asumido como "ya probado" por haber pasado las secciones 8–9.

URLs definitivas (reemplazan `http://localhost:3000` de las secciones 1–9):

- `https://crm.tuplansegurousa.com/api/leads/intake` (Web — formulario propio)
- `https://crm.tuplansegurousa.com/api/leads/intake/google`
- `https://crm.tuplansegurousa.com/api/leads/intake/meta`

Un `curl -I` contra estas rutas solo confirma que el proceso Next.js responde — NO confirma autenticación, persistencia del evento, ni procesamiento. Procedimiento real (requiere el worker corriendo en el VPS, ver §3 de `docs/OPERATIONS.md`):

| # | Verificación | Cómo confirmarla (no solo `curl -I`) |
|---|---|---|
| 1 | Recepción autenticada | `POST` real (Postman contra la URL de producción, con una credencial de producción real) devuelve `200`/`401` según corresponda — nunca `200` sin credencial válida |
| 2 | Evento almacenado | Tras el `POST`, existe una fila nueva en `LeadInboundWebhookEvent` (consultar vía `psql` en el VPS, o un endpoint ADMIN de solo lectura si se agrega) con el `externalEventId` esperado |
| 3 | Procesamiento por el worker | La fila pasa de `PENDING`/`PROCESSING` a `PROCESSED` (o `FAILED`/`DEAD_LETTER` si corresponde) sin intervención manual, en los segundos siguientes |
| 4 | Lead creado una sola vez | Existe exactamente un `Lead` con ese `externalId` — nunca dos, sin importar cuántas veces se reintente |
| 5 | Reenvío sin duplicación | Reenviar el mismo evento (mismo `externalEventId`) desde la plataforma (o reenviar el mismo Postman request) no crea una segunda fila de evento ni un segundo lead |
| 6 | Worker detenido a mitad de proceso | Detener `npm run worker:leads` (vía su supervisor en el VPS) mientras un evento está `PROCESSING`, reiniciarlo, confirmar que ese evento se completa (nunca queda huérfano) |
| 7 | Error de recuperación externa + reintento | Con un Page Access Token de Meta temporalmente inválido, confirmar que el evento queda `FAILED`/`DEAD_LETTER` con el error visible en `/settings/lead-credentials`, y que corregir el token + reintentar (botón "Reintentar") sí completa el lead |
| 8 | Credencial revocada con trabajos pendientes | Revocar la credencial con un evento aún sin procesar, confirmar `DEAD_LETTER` inmediato con el mensaje `"La credencial de integración fue revocada."`, sin lead creado |

Separación explícita que debe mantenerse en cualquier reporte futuro: los puntos 1–8 de esta sección son pruebas REALES contra producción (pendientes); las secciones 8–9 de este documento y la suite automatizada son pruebas LOCALES/simuladas (ya ejecutadas). Nunca declarar "producción verificada" citando solo las segundas.

## Notas

- Los pasos 4–7 (asignar, convertir, cerrar, actividades) usan sesión de usuario normal (cookies), no la API de Postman — pruébalos siempre desde la app.
- Ningún paso de esta guía debe tocar producción. Los pasos 8–9 requieren `npm run worker:leads` corriendo además de `npm run dev`.

## 11. Google — payload real de la prueba (`is_test`) y recuperación del evento (2026-10-02)

**Estado de verificación (sin ambigüedad):**

| Qué | Estado |
|---|---|
| Fallo de Google con el payload recibido DESDE la plataforma (`campaignId: expected string, received number`, evento `8b77c063-75fe-4aca-b52f-68bff1c9bd53`) | **Error confirmado en producción** |
| Corrección + regresión con el payload completo de esa prueba (fixture con `google_key` placeholder) en `src/lib/lead-source-adapters.regression.test.ts` (P–V), `scripts/lead-webhook-worker.regression.test.ts` (G1–G5) y `src/app/api/leads/intake/webhooks.routes.test.ts` (R1–R3) | Ejecutado, en verde, **solo local/base aislada** — aún no confirmado en producción |
| Meta: tipos numéricos de `leadgen_id`/`page_id`, `state` fuera de catálogo, falla/reintento de Graph API | **Simulado** (mock de `fetch`; sin credenciales ni cuentas reales): `webhooks.routes.test.ts` (R4–R6), `lead-webhook-worker.regression.test.ts` (M1–M2) |
| WEB: lead recibido desde Postman en producción | Exitoso (reportado por el negocio) — la ruta y `intakeLead` **no se modificaron** |
| Meta desde la cuenta real | **Pendiente** |
| Formulario web real (instalación del envío servidor-a-servidor y prueba) | **Pendiente** |

**Comportamiento explícito con ese payload:**
- `is_test=true` se procesa **como un lead normal** (se crea un Lead de fuente Google). Es la forma de comprobar la tubería completa con la prueba oficial. El lead de prueba (`FirstName LastName`) se cierra manualmente desde `/leads` (motivo "Datos inválidos") una vez verificado; no hay filtro automático de pruebas.
- Nombre, correo y teléfono se mapean; `campaignId` se guarda como texto (`"23729418209"`).
- **`REGION="California"` NO llena `residenceState`.** `REGION` no es un campo estándar mapeado, así que `Region`, `City` y `Postal Code` quedan visibles en "Respuestas del formulario". Aunque se configure el mapeo (en `/settings/lead-credentials` > credencial GOOGLE > "Mapear preguntas personalizadas" > Estado de residencia = `REGION`), `"California"` es un nombre completo y el CRM solo acepta códigos de dos letras (`CA`): **seguiría sin mapearse** (queda en las respuestas; no se inventa la traducción). Solo un valor ya en código (`CA`) se mapearía. No se amplió el alcance con una tabla de traducción de nombres.
- No hay consentimiento en el payload: `consentGiven` queda sin informar (`null`), nunca `true`/`false` inventado.
- `google_key` no aparece en lead, `formResponses`, logs ni respuestas; para eventos nuevos tampoco en `rawPayload` (queda `"[REDACTED]"`).

**Validación real pendiente**: tras desplegar, usar "Enviar datos de prueba" de Google Ads de nuevo (nuevo `lead_id`) y confirmar `PROCESSED` + un solo lead. Esa prueba real no se ha ejecutado.
