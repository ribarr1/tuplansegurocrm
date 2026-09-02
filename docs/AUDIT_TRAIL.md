# Auditoría y Historial — Fase 019.9

Referencia central del sistema de auditoría (`AuditEvent`) y del Historial/Timeline visible en Contact Detail y Policy Detail. Ver también `docs/DATABASE.md` (schema), `docs/SECURITY.md` (redacción/autorización) y `docs/ARCHITECTURE.md` (cómo se integra en cada servicio).

## Qué es y qué NO es

- **AuditEvent es un log append-only generado automáticamente por el sistema** cuando ocurre un cambio de negocio real — nunca lo escribe un humano directamente, nunca se edita ni se borra desde código de aplicación (no existe `updateAuditEvent`/`deleteAuditEvent` en `audit.service.ts`, y no hay ninguna UI para editar/borrar un evento).
- **Nunca se confunde con `Note`.** `Note` es texto libre escrito manualmente por un agente ("Cliente pidió que lo llamemos después de las 5"). `AuditEvent` es la traza automática de un cambio estructurado ("Teléfono actualizado de X a Y"). Crear una nota SÍ genera su propio `AuditEvent` (`NOTE_CREATE`), pero ese evento nunca contiene el texto de la nota.
- **No es un log técnico de requests/errores.** No registra cada `GET`, ni excepciones inesperadas — solo acciones de negocio explícitamente auditadas (ver lista más abajo).

## Modelo (`prisma/schema.prisma`, migración 011)

```prisma
model AuditEvent {
  id              String         @id @default(uuid()) @db.Uuid
  actorUserId     String?        @db.Uuid
  actorType       AuditActorType @default(USER)   // USER | SYSTEM
  entityType      String                          // "Person", "Policy", "PersonMedication", ...
  entityId        String         @db.Uuid
  action          String                          // "CONTACT_CREATE", "POLICY_CANCEL", ...
  contactPersonId String?        @db.Uuid          // clave de agregación: timeline del contacto
  policyId        String?        @db.Uuid          // clave de agregación: timeline de la póliza
  householdId     String?        @db.Uuid          // clave de agregación: eventos a nivel de hogar
  summary         String                           // texto legible, ej. "Contacto actualizado"
  changes         Json?                            // { campo: { before, after } } — solo lo permitido
  metadata        Json?                            // datos auxiliares no sensibles (ej. previousPolicyId)
  createdAt       DateTime       @default(now())
}
```

`entityType`/`entityId` identifican la fila real que cambió. `contactPersonId`/`policyId`/`householdId` son claves DENORMALIZADAS que permiten armar el timeline de un contacto o de una póliza con un solo índice — un evento puede (y normalmente debe) llevar más de una. Ej.: "agregar miembro a una póliza" lleva `policyId` + `contactPersonId` (la persona agregada) + `householdId` (si la póliza está vinculada a un hogar).

`action` es un string libre, no un enum de Postgres — el catálogo de acciones crece con cada módulo nuevo y un enum de DB exigiría una migración por cada acción. La lista de valores usados está documentada más abajo; la validación real vive en cada servicio (siempre pasa un literal conocido, nunca input del usuario).

## `audit.service.ts` — servicio central

- **`recordAuditEvent(db, input)`** — único punto de escritura. `db` acepta `prisma` o un `Prisma.TransactionClient`, para poder llamarse dentro de la MISMA transacción que la escritura real (ver "Transaccionalidad" abajo). `actor: AuthorizedUser | null` — `null` explícito cuando el evento lo genera el sistema (`actorType` pasa a `SYSTEM`, `actorUserId` queda `null`); nunca se inventa un actor humano para una acción del sistema.
- **`buildDiff(before, after, fields)`** — compara `before`/`after` **solo** en los campos de `fields` (allowlist explícita — nunca un diff genérico sobre el objeto completo, así un campo sensible que no se pase ahí nunca puede terminar en el log por accidente). Omite campos sin cambio real y campos ausentes en `after` (edición parcial). Serializa `Decimal` a string (nunca pierde precisión pasando por `number`) y `Date` a `YYYY-MM-DD` (mismo principio que `date-only.ts`: nunca getters locales sobre una columna `@db.Date`). Retorna `undefined` si no hubo ningún cambio real — el caller usa eso para decidir si generar el evento.

## Acciones auditadas (`action`) por módulo

| Módulo | Acciones |
|---|---|
| Contact (`Person`) | `CONTACT_CREATE`, `CONTACT_UPDATE`, `CONTACT_STATUS_CHANGE`, `CONTACT_ASSIGN_AGENT` |
| Household | `HOUSEHOLD_CREATE`, `HOUSEHOLD_UPDATE`, `HOUSEHOLD_ADD_MEMBER`, `HOUSEHOLD_REMOVE_MEMBER`, `HOUSEHOLD_ROLE_CHANGE` |
| Policy | `POLICY_CREATE`, `POLICY_UPDATE`, `POLICY_STATUS_CHANGE`, `POLICY_CANCEL`, `POLICY_RENEW`, `POLICY_LINK_HOUSEHOLD`, `POLICY_ADD_MEMBER`, `POLICY_REMOVE_MEMBER` |
| Health (`HealthPolicyDetail`) | `HEALTH_UPDATE_HEALTH_DETAILS` |
| Medicamentos (`PersonMedication`) | `MEDICATION_CREATE`, `MEDICATION_UPDATE`, `MEDICATION_DEACTIVATE` |
| Proveedores (`PersonProvider`) | `PROVIDER_CREATE`, `PROVIDER_UPDATE`, `PROVIDER_DELETE` |
| Task | `TASK_CREATE`, `TASK_UPDATE`, `TASK_COMPLETE`, `TASK_CANCEL`, `TASK_REOPEN` |
| Note | `NOTE_CREATE` (no existe update/delete de Note en V1 — nada que auditar ahí todavía) |
| Premium tracking | `PREMIUM_UPDATE_TRACKING`, `PREMIUM_STATUS_CHANGE` |
| Comisiones | `COMMISSION_RULE_CREATE`, `COMMISSION_RULE_UPDATE`, `COMMISSION_EXPECTATION_CREATE`, `COMMISSION_EXPECTATION_UPDATE`, `COMMISSION_EXPECTATION_OVERRIDE`, `COMMISSION_PAYMENT`, `COMMISSION_CHARGEBACK`, `COMMISSION_ADJUSTMENT` |
| Documentos (`PolicyDocument`) | `DOCUMENT_UPLOAD`, `DOCUMENT_DELETE` |
| Usuarios (`User`) | `USER_CREATE`, `USER_ACTIVATE`, `USER_DEACTIVATE` (no existe `ROLE_CHANGE` ni `PASSWORD_RESET` como acciones separadas en V1 — el rol se fija al crear y no hay flujo de reset de password todavía, ver docs/DECISIONS.md) |
| Exportación CSV (Fase 020) | `EXPORT_CONTACTS`, `EXPORT_POLICIES`, `EXPORT_COMMISSIONS` — `entityId` es un UUID nuevo generado en el momento (nunca `actor.id`: no hay una fila real que identifique, es una acción efímera), `changes` siempre `null`, `metadata` guarda solo filtros seguros y un conteo aproximado — nunca el contenido exportado (ver `docs/COMMISSION_RECONCILIATION.md`/`docs/SECURITY.md`) |
| Conciliación de comisiones (Fase 020) | `COMMISSION_STATEMENT_UPLOAD`, `COMMISSION_STATEMENT_MATCH`, `COMMISSION_STATEMENT_APPLY`, `COMMISSION_PAYMENT_FROM_STATEMENT` — nunca guardan el archivo original ni montos en texto libre fuera de los campos ya permitidos de `CommissionPayment` (ver `docs/COMMISSION_RECONCILIATION.md`) |

`TASK_REOPEN` es un caso de `updateTask` (reabrir una tarea COMPLETED/CANCELLED) — se detecta comparando `existing.status`/`input.status`, no es una función de servicio separada.

## Datos que NUNCA se guardan en `changes`/`summary`

- Password, hash de password, tokens de sesión/verificación (ninguna de estas tablas se audita — `User` solo audita `name`/`role` en el summary, nunca credenciales).
- `incomeUsed`/`taxCreditAmount` de `HealthPolicyDetail` — financiero personal sensible (ver docs/SECURITY.md). `HEALTH_DETAIL_AUDIT_FIELDS` en `health-policies.service.ts` los excluye explícitamente de la allowlist de `buildDiff`.
- Nombre/dosis/frecuencia/notas de `PersonMedication`, y nombre/especialidad/notas de `PersonProvider` — información operacional de salud. Estos eventos **nunca llevan `changes`**, solo un `summary` genérico ("Medicamento agregado", "Proveedor preferido actualizado").
- Montos de `CommissionExpectation`/`CommissionPayment` (`expectedAmount`, `calculatedAmount`, montos de pago/chargeback/ajuste) — financiero restringido (Fase 016). El override de una expectativa audita QUE hubo una corrección manual (`COMMISSION_EXPECTATION_OVERRIDE`), nunca el monto antes/después.
- Contenido de archivos subidos — solo `fileName` (metadata), nunca los bytes del documento.
- Texto de `Note` — el evento (`NOTE_CREATE`) nunca incluye `content`.

## Autorización del timeline (`history.service.ts`)

- **Contact timeline**: misma regla que editar el contacto (`canEditPerson` — ADMIN/ASSISTANT sin restricción, AGENT solo con acceso), más estricta que solo ver el perfil básico (abierto a cualquier usuario desde Fase 008) — consistente con el resto de información sensible del contacto (Salud, Fase 019.8).
- **Policy timeline**: misma regla que ver la póliza (`assertCanAccessPolicy`).
- **ASSISTANT nunca ve eventos de Comisiones**, ni en el timeline de un contacto/póliza al que sí tiene acceso al resto de la información — filtrado por `entityType` (`CommissionRule`/`CommissionExpectation`/`CommissionPayment`), misma exclusión ya establecida para el módulo de Comisiones (Fase 016).
- El timeline de un contacto también incluye eventos a nivel de `Household` (ej. "Dirección actualizada") vía una segunda condición OR sobre los `householdId` de los hogares del contacto — evita duplicar el mismo evento una vez por cada miembro del hogar.

## Filtros y paginación (UI)

- Filtros simples por categoría (`HISTORY_CATEGORIES` en `history.service.ts`): Todos, Contacto, Familia, Pólizas, Salud, Tareas, Notas, Primas, Comisiones, Documentos — mapeo directo a `entityType`, no un sistema de reporting.
- Paginación por cursor (`nextCursor`), 25 eventos por página (máx. 50). "Mostrar más" en el cliente (`src/components/history-timeline.tsx`) llama a un Server Action (`loadMoreContactHistory`/`loadMorePolicyHistory`) que reutiliza `getContactTimeline`/`getPolicyTimeline` con el cursor — nunca carga miles de eventos de una vez.
- Orden: `createdAt DESC` (más reciente primero) en ambas consultas.

## Transaccionalidad

Cuando una operación modifica DB + genera un `AuditEvent`, ambos ocurren en la **misma transacción** (`prisma.$transaction(async (tx) => { ...; await recordAuditEvent(tx, ...); })`) — si el audit event fallara, la escritura real se revierte también, nunca queda un cambio sin su evento. Dentro de esas transacciones interactivas, las queries son siempre **secuenciales** (`await` uno tras otro), nunca `Promise.all` — ver el hallazgo de concurrencia de `pg` documentado en Fase 019.6: el array-form de `$transaction` (o `Promise.all` dentro de una transacción interactiva) fija las queries a una sola conexión y puede disparar el warning real de `pg` cuando alguna de ellas selecciona relaciones.

## Generación automática (actor `SYSTEM`)

`autoGenerateCurrentPeriodExpectation(policyId, actor?)` (Fase 019.7/019.9) acepta un `actor` opcional — cuando se invoca desde una Server Action (crear/activar póliza, agregar miembro, cambiar prima, asignar regla) se le pasa el actor real de esa acción, así que el `COMMISSION_EXPECTATION_CREATE` resultante queda atribuido a esa persona. Si algún día se invocara sin actor conocido (ej. un futuro job en segundo plano), el evento queda como `actorType: SYSTEM` — nunca se inventa un actor humano.

## Import legacy

El pipeline de importación (`docs/IMPORTING_LEGACY_DATA.md`) **no genera un `AuditEvent` por cada fila importada** — fabricar miles de eventos simulando "quién hizo qué" históricamente sería inventar información que no existe en el Excel origen. Si se considera útil, el import puede agregar como máximo un evento `SYSTEM` agregado ("Datos importados desde sistema legacy") — no implementado todavía en V1, no bloquea nada.

## Retención

Ningún borrado automático de `AuditEvent` en V1. El backup de producción (cuando exista, ver `docs/DECISIONS.md`) debe incluir la tabla `audit_events`. No se implementó ninguna política de retención automática — decisión explícita para no perder historial antes de tener una razón real (regulatoria o de volumen) para limitarlo.
