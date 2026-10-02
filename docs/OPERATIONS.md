# Operación: jobs automáticos (Fase 025)

Referencia para correr manualmente los jobs de mantenimiento del CRM. Ver también `docs/DECISIONS.md` (razonamiento de diseño) y `docs/AUDIT_TRAIL.md` (eventos auditados).

## Reconciliación del ciclo de vida de pólizas

**Qué hace**: aplica automáticamente las transiciones de estado que no requieren una decisión humana:

- `PENDING` → `ACTIVE` cuando `effectiveDate <= día de negocio actual`.
- `ACTIVE` → `EXPIRED` cuando `terminationDate < día de negocio actual` (una póliza con `terminationDate = 12/31` sigue `ACTIVE` el 12/31 mismo; pasa a `EXPIRED` a partir del 1/1).
- `CANCELLED` y `EXPIRED` **nunca** se reactivan automáticamente, sea cual sea su fecha.

Cada cambio genera un `AuditEvent` con actor `SYSTEM` (`POLICY_AUTO_ACTIVATED` / `POLICY_AUTO_EXPIRED`) y recomputa Prospecto/Cliente (`recomputePersonContactStatus`) para el titular y cada miembro cubierto — la misma regla que ya aplica cuando un agente cambia el estado manualmente.

**El "día de negocio" siempre viene de `APP_TIME_ZONE`** (variable de entorno, identificador IANA — ej. `America/Chicago`), nunca de la zona horaria del navegador ni de la del proceso Node. Si `APP_TIME_ZONE` falta o es inválido, el job falla de inmediato con un mensaje claro, antes de tocar ninguna fila.

### Correr manualmente

```bash
npm run jobs:policy-lifecycle
```

Salida esperada (segura para logs — nunca nombres de clientes ni otro PII, solo conteos):

```
[policy-lifecycle] Zona horaria de negocio: America/Chicago
[policy-lifecycle] Día de negocio: 2026-09-04
[policy-lifecycle] Pólizas activadas (PENDING -> ACTIVE): 2
[policy-lifecycle] Pólizas expiradas (ACTIVE -> EXPIRED): 0
[policy-lifecycle] Reconciliación completada.
```

Código de salida `0` en éxito, `1` si ocurre un error (variable de entorno faltante, error de base de datos, etc.) — apto para monitoreo externo (ej. alertar si un cron falla).

### Idempotencia

Correr el job varias veces el mismo día no duplica nada: cada consulta interna solo selecciona filas que **todavía** están en el estado de origen (`PENDING`/`ACTIVE`), así que una póliza ya procesada deja de coincidir en la siguiente corrida. Es seguro reintentar tras un fallo a mitad de ejecución (cada póliza se actualiza en su propia transacción).

### Troubleshooting

- **"APP_TIME_ZONE no está configurado"**: definir la variable en `.env` (ej. `APP_TIME_ZONE=America/Chicago`) antes de correr el job.
- **"APP_TIME_ZONE inválido"**: el valor no es un identificador de zona horaria IANA reconocido — verificar contra la [lista de la tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
- **El job corre pero no activa/expira nada esperado**: revisar que las pólizas en cuestión realmente tengan `effectiveDate`/`terminationDate` poblados — una `PENDING` sin `effectiveDate` nunca se activa automáticamente (le faltan los datos requeridos para ser `ACTIVE`, ver `docs/DECISIONS.md`); esto es intencional, no un bug.
- Para investigar qué cambió una corrida específica, filtrar `AuditEvent` por `action IN ('POLICY_AUTO_ACTIVATED', 'POLICY_AUTO_EXPIRED')` y `actorType = 'SYSTEM'`.

### Futuro: cron en producción (NO configurado todavía)

Este job **no** tiene una tarea programada en producción — correrlo hoy es exclusivamente manual. Cuando se autorice, el ejemplo conceptual (VPS con Docker, hora de negocio 06:00) sería:

```cron
# 06:00 hora de negocio — ajustar la hora del contenedor/host o usar
# TZ=America/Chicago explícito según cómo se despliegue.
0 6 * * * cd /app && npm run jobs:policy-lifecycle >> /var/log/tuplanseguro/policy-lifecycle.log 2>&1
```

Antes de activar esto en producción: confirmar backups de la base de datos, y que el log destino no se llene sin rotación (`logrotate` u equivalente). **NO PRODUCCIÓN. NO DEPLOY** hasta autorización explícita — ver CLAUDE.md.

# Fábrica de leads — operación en producción (Fase 026)

**Contexto real**: el CRM ya corre en un VPS de Hostinger (aplicación + PostgreSQL en el mismo VPS), detrás de `https://crm.tuplansegurousa.com`, con un script de despliegue que vive únicamente en el VPS (no en este repositorio). Esta sección documenta cómo encajan los cambios de Fase 026 (migraciones 028–031, el worker, la clave de cifrado de conectores) con esa realidad — **sin prescribir un procedimiento de despliegue alternativo ni asumir qué hace el script existente**. Nada de esta sección se ha ejecutado contra producción; es el procedimiento a seguir cuando se autorice, no un registro de algo ya hecho.

## 1. Recuperación sin pérdida de datos

**Regla general: nunca usar `DROP TABLE`/`DROP COLUMN` de lo agregado en Fase 026 como procedimiento de rollback.** Las migraciones 028–031 son puramente ADITIVAS (nuevas tablas/columnas, nunca se modifica ni se borra nada existente — confirmado leyendo cada migración en `prisma/migrations/`), y una vez que el conector esté activo en producción, esas tablas nuevas (`LeadInboundWebhookEvent`, `LeadRateLimitWindow`, el schema `lead_queue` de pg-boss) contendrán **datos de negocio reales** (leads entrantes, su historial de procesamiento) que un `DROP` destruiría de forma irreversible — exactamente lo que CLAUDE.md §31 prohíbe sin análisis previo.

Jerarquía de recuperación, en el orden en que debe intentarse:

1. **Rollback de la aplicación (código), nunca de las migraciones, cuando la versión anterior es compatible con el schema ya migrado.** Como las migraciones 028–031 solo agregan columnas/tablas nuevas (nunca quitan ni renombran algo que el código anterior usara), una versión de la app anterior a Fase 026 sigue funcionando normalmente contra una base ya migrada — simplemente ignora las tablas/columnas nuevas. Esto cubre el caso típico: "el código nuevo tiene un bug, pero el schema está bien" → revertir el despliegue de la app (lo que haga el script del VPS para eso), dejar la base como está.
2. **Reparación hacia adelante (forward-fix), cuando el problema es un bug de código y no algo que un rollback de versión resuelva mejor.** Ej.: el worker tiene un error de mapeo para un formulario específico → se corrige `lead-source-mapping.ts` o el `customFieldMapping` de esa credencial (§6, vía UI, sin deploy) y se reprocesa el evento con el botón "Reintentar" en `/settings/lead-credentials` — nunca se necesita tocar el schema para esto.
3. **Restauración desde backup — ÚLTIMO recurso, y solo con un procedimiento que contemple los datos recibidos DESPUÉS del backup.** Un backup de Postgres es una foto fija: restaurarlo sin más **borraría silenciosamente** cualquier lead/evento/credencial recibido o modificado entre el momento del backup y el momento de la restauración — una pérdida de datos de negocio reales (leads de clientes potenciales), no solo un problema técnico. Antes de restaurar:
   - Tomar un backup adicional del estado ACTUAL (pre-restauración) — aunque esté "roto", puede contener leads que nunca se guardaron en el backup antiguo.
   - Identificar qué filas de `Lead`, `LeadInboundWebhookEvent`, `LeadIntegrationCredential` y `LeadRateLimitWindow` tienen `createdAt`/`receivedAt` posteriores al backup que se va a restaurar (`SELECT ... WHERE "createdAt" > '<fecha del backup>'`).
   - Si existen filas posteriores con datos de negocio reales (leads, no solo ventanas de rate limiting vencidas): **no restaurar directamente** — en su lugar, restaurar el backup antiguo en una base TEMPORAL separada, y migrar/reinsertar manualmente las filas posteriores identificadas hacia la base real, en vez de perderlas.
   - Confirmar que la clave `PII_ENCRYPTION_KEY` vigente en el momento de la restauración es la MISMA que estaba vigente cuando se cifraron los `connectorSecrets` del backup (ver §2) — si no lo es, esos secretos de conector quedarán indescifrables tras restaurar, aunque las filas existan.

**No se ha ejecutado ninguna reversión real como parte de este trabajo** — lo anterior es el procedimiento verificado por lectura de las migraciones y el código, no una prueba ejecutada contra una base real restaurada.

## 2. Clave de cifrado (`PII_ENCRYPTION_KEY`)

- **Secreto raíz**: una única variable de entorno, `PII_ENCRYPTION_KEY` (32 bytes en base64) — la MISMA que ya usan `pii-crypto-core.ts` (SSN/USCIS/credenciales de portal) y `financial-crypto.ts` (métodos de pago). Fase 026 **no introduce una variable nueva**; reutiliza esta exactamente, por instrucción explícita (nunca una clave nueva que administrar).
- **Derivación de la subclave de conectores**: `src/lib/lead-connector-crypto.ts::deriveConnectorSubkey()` deriva, vía HKDF-SHA256 (`node:crypto.hkdfSync`, RFC 5869 — primitiva estándar, no cifrado propio) a partir de `PII_ENCRYPTION_KEY`, con `info = "tuplanseguro-lead-connector-v1"` (fijo en el código, nunca generado al vuelo) y `salt` vacío. **Esto es 100% determinístico**: la misma `PII_ENCRYPTION_KEY` produce exactamente la misma subclave siempre, en cualquier arranque del proceso, en la app o en el worker — nunca una clave distinta cada vez que arranca. El resultado se cachea en memoria del proceso (`cachedSubkey`) solo para no recalcular el HKDF en cada operación, no porque la derivación en sí dependa de cuándo arrancó.
- **Configuración necesaria — app Y worker**: ambos procesos (`npm start`/el proceso Next.js, y `npm run worker:leads`) deben tener la MISMA `PII_ENCRYPTION_KEY` en su entorno. Si alguno la tiene distinta (ej. el worker configurado con un valor diferente al de la app por error), ese proceso derivará una subclave DIFERENTE y fallará al descifrar cualquier `connectorSecrets` cifrado por el otro — no es un fallo silencioso, ver el punto siguiente.
- **Comportamiento si falta o es incorrecta**: `readMasterKey()` lanza un `Error` síncrono e inmediato ("PII_ENCRYPTION_KEY no está configurado..." o "...inválido: no es base64 válido"/"...debe decodificar a 32 bytes...") en el momento en que se intenta cifrar/descifrar — nunca continúa silenciosamente ni guarda un secreto de conector sin cifrar. Si la variable está simplemente AUSENTE en el worker, cualquier evento META fallará al intentar descifrar sus `connectorSecrets` y quedará `FAILED`/`DEAD_LETTER` con ese error visible en `/settings/lead-credentials` — nunca se pierde el evento, pero tampoco se procesa hasta corregir la variable.
- **Persistencia entre despliegues y restauraciones**: `PII_ENCRYPTION_KEY` vive en la configuración del entorno del VPS (fuera del repositorio, fuera de la base de datos) — un despliegue de código NO la toca ni la regenera. Una restauración de backup de Postgres tampoco la toca (vive fuera de la base) — pero ver la advertencia del punto anterior sobre restaurar un backup cifrado con una clave distinta a la vigente.
- **Procedimiento de rotación**: **no existe hoy un mecanismo de re-cifrado/rotación en el código** (ni para `pii-crypto`, ni para `financial-crypto`, ni para `lead-connector-crypto`) — rotar significa generar una `PII_ENCRYPTION_KEY` nueva y configurarla. Antes de hacerlo en cualquier entorno con datos reales, se necesitaría escribir un script de re-cifrado (descifrar todo con la clave vieja, volver a cifrar con la nueva) para los tres dominios que la usan — **trabajo no implementado, fuera del alcance de este ticket**.
- **Efecto de rotar la clave EXISTENTE sobre los `connectorSecrets` ya almacenados**: dado que no hay re-cifrado automático, rotar `PII_ENCRYPTION_KEY` sin antes descifrar y volver a cifrar cada `LeadIntegrationCredential.connectorSecrets` existente los deja **permanentemente indescifrables** (la subclave derivada de la clave nueva nunca podrá abrir un ciphertext cifrado con la subclave de la clave vieja) — el worker fallaría al procesar cualquier evento META con el error de descifrado, y habría que volver a configurar el App Secret/Page Access Token/Verify Token de cada credencial META desde cero vía `/settings/lead-credentials`. Mismo efecto, por extensión, sobre cualquier otro dato cifrado con esta misma clave maestra en el sistema (SSN, métodos de pago, etc.) — **rotar esta clave en producción es una operación de alto impacto que requiere su propio plan, no se cubre aquí**.

## 3. Migraciones y esquema de `lead_queue`

**No se aplica ninguna migración a producción ni se configura ningún proceso en el VPS como parte de este trabajo** — lo siguiente es el procedimiento de verificación y la información de configuración, a ejecutar/aplicar en un paso futuro autorizado.

### Verificar el estado REAL de las migraciones antes de asumir nada

```bash
npx prisma migrate status
```

corrido con el `DATABASE_URL` de producción (nunca el de dev/test) — reporta exactamente qué migraciones ya están aplicadas en esa base y cuáles faltan. **No asumir que ninguna de las migraciones de Fase 026 (`028_lead_factory`, `029_lead_original_payload_snapshot`, `030_lead_connectors_production_prep`, `031_lead_custom_field_mapping`) está o no está aplicada** — depende de qué se haya desplegado ya en el VPS hasta ahora, algo que solo esta verificación confirma. Si el script de despliegue del VPS ya corre `npx prisma migrate deploy` (o equivalente) como parte de su flujo habitual, probablemente ya las aplicó en el último despliegue de código que incluyera este branch — **se confirmará leyendo el script cuando se provea, no se asume aquí**.

### Esquema `lead_queue` (pg-boss)

- Se crea/actualiza SOLO (`CREATE SCHEMA IF NOT EXISTS "lead_queue"` + sus tablas internas) la PRIMERA VEZ que `getLeadQueue()` se llama (`PgBoss.start()`), es decir, la primera vez que corre `npm run worker:leads` contra esa base — **no es parte de las migraciones de Prisma**, es responsabilidad exclusiva de pg-boss, y ocurre automáticamente sin ningún script manual.
- **Permisos de PostgreSQL necesarios**: el usuario de `DATABASE_URL` necesita poder crear un schema nuevo (`CREATE` a nivel de base de datos) la primera vez, y después privilegios normales de lectura/escritura sobre las tablas de ese schema. Si el usuario de producción NO tiene permiso de `CREATE SCHEMA` (común en configuraciones restringidas), el primer arranque del worker fallará al intentar crear `lead_queue` — se resuelve otorgando el permiso una vez (`GRANT CREATE ON DATABASE <db> TO <user>;`) o pre-creando el schema manualmente con un usuario con más privilegios.
- **Compatibilidad al volver a una versión anterior del worker**: pg-boss gestiona su propio versionado de schema internamente (tabla `lead_queue.version`) y migra su esquema interno hacia adelante automáticamente al iniciar una versión más nueva de la librería — pero **no está documentado que soporte ejecutar una versión de pg-boss MÁS VIEJA contra un schema ya migrado por una más nueva**. En la práctica, esto rara vez importa aquí porque el `package.json` fija `pg-boss@12.35.1` exacto y un rollback de la app (ver §1.1) normalmente no cambia esa dependencia; si llegara a hacerlo, confirmar la compatibilidad del schema antes de asumir que un worker más viejo puede volver a correr contra él.
- **Nada de esto se aplicó a producción** — verificado únicamente contra la base local de desarrollo (`tuplanseguro_crm`) en este trabajo, consultando `lead_queue.queue`/`lead_queue.schedule` vía `psql` tras correr el worker localmente.

### Qué necesita el worker para correr como proceso persistente en el VPS

El worker (`npm run worker:leads`, equivalente a `node --require ./scripts/server-only-shim.cjs --import tsx scripts/lead-webhook-worker.ts`) es un proceso Node de **vida larga** (nunca termina por sí solo) — necesita:

- El mismo `DATABASE_URL` de la app (usa el mismo Postgres, crea su propio schema `lead_queue` dentro de esa misma base).
- `PII_ENCRYPTION_KEY` (§2) — idéntica a la de la app.
- `META_GRAPH_API_VERSION` (opcional, default `v21.0` si se omite) — verificar que la versión siga vigente antes de producción, ver `docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md`.
- Un supervisor de proceso que lo reinicie si cae (`systemd`, `pm2`, el propio mecanismo que el script de despliegue del VPS ya use para la app Next.js, lo que sea) — **qué supervisor usar se decide al revisar el script de despliegue real del VPS, no se prescribe aquí ni se instala nada todavía**. Importa únicamente que el reinicio le dé tiempo al apagado ordenado existente (`SIGTERM`/`SIGINT` → `boss.stop({graceful: true, timeout: 30_000})`, ya implementado) antes de forzar un `SIGKILL`.
- Puede correr en el mismo VPS que la app (no necesita su propio servidor) — es un proceso Node adicional, sin puerto HTTP propio, sin necesidad de Nginx/proxy.

## 4. Alcance real del conector Web (§5)

El conector Web **NO está instalado en el servidor de la web real** — lo que existe es: (a) `POST /api/leads/intake` en este CRM, ya en producción y probado contra el mismo contrato que las secciones 1–7 del UAT verifican, y (b) `docs/WEB_CONNECTOR_INSTRUCTIONS.md`, instrucciones + ejemplo de código servidor-a-servidor entregados para que se instalen en el servidor de la página web de TuPlanSeguro USA. **La instalación de ese envío en el servidor web real, y su prueba completa de extremo a extremo, siguen pendientes** — no se declaran hechas en ningún reporte de este trabajo. La credencial de ese conector (`CRM_LEAD_WEB_CREDENTIAL`) **nunca debe exponerse en el navegador** — vive únicamente en el entorno del servidor que hace el `POST`, nunca en código/HTML/JS servido al cliente, reiterado también en `docs/WEB_CONNECTOR_INSTRUCTIONS.md`.
