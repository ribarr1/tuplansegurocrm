# Base de datos

Modelo relacional en PostgreSQL, gestionado con Prisma Migrate. Sin `db push`: todo cambio de esquema pasa por una migración versionada en `prisma/migrations/`.

## Migración 001 — Core Identity

Primera migración real del dominio. Establece la identidad central del CRM, antes de pólizas, tareas o comisiones.

### Tablas

- **`users`** — Usuario/agente interno. Sin credenciales todavía (sin password, sesiones ni MFA); se agregarán al diseñar autenticación.
- **`people`** — Identidad central del CRM. Una persona nunca se duplica al pasar de prospecto a cliente: ese cambio se refleja en `contactStatus`, no en una fila nueva.
- **`households`** — Hogar/familia. Entidad mínima, sin datos duplicados de sus miembros.
- **`household_members`** — Relación N:M entre `people` y `households`, con el rol de cada persona en ese hogar (`HEAD`, `SPOUSE`, `CHILD`, `DEPENDENT`, `OTHER`). Una persona puede pertenecer a más de un hogar.
- **`carriers`** — Aseguradoras, administrables como datos (nunca hardcodeadas en código).
- **`products`** — Plan/producto de un carrier. Es la **fuente de verdad** del tipo de seguro (`policyType`) y del carrier asociado; las pólizas (fase futura) no duplicarán estos datos.

### Enums

- `UserRole`: ADMIN, AGENT, ASSISTANT
- `ContactStatus`: PROSPECT, CLIENT, FORMER_CLIENT, OTHER
- `HouseholdMemberRole`: HEAD, SPOUSE, CHILD, DEPENDENT, OTHER
- `PolicyType`: HEALTH, LIFE, SUPPLEMENTAL, DENTAL, FINAL_EXPENSE

### Constraints e índices

- `users.email` — UNIQUE
- `carriers.name` — UNIQUE
- `household_members(personId, householdId)` — UNIQUE (evita duplicar la misma persona en el mismo hogar)
- `people.lastName`, `people.phone`, `people.email` — índices de búsqueda (sin unicidad forzada; una familia puede compartir teléfono/email, y datos migrados del Excel pueden tener duplicados legítimos)
- `products(carrierId, policyType, planYear)` — índice compuesto para búsquedas de catálogo

### Identificadores

Todas las tablas usan `UUID` (tipo nativo `uuid` de PostgreSQL) como clave primaria, generado con `@default(uuid())`. Se prefirió sobre autoincrement para no exponer información secuencial (cantidad/orden de registros) y sobre CUID2 por ser un estándar más universal sin dependencias adicionales.

### Fuera de alcance de esta migración

`Policy`, `PolicyMember`, `HealthPolicyDetail`, `Task`, `Note`, `BirthdayGreeting`, `CommissionExpectation`, `CommissionPayment`, `PersonProvider`, `PersonMedication`, `PaymentMethodReference`, `Opportunity`, `Application`/`Quote`, autenticación. Ver [DECISIONS.md](./DECISIONS.md) para el razonamiento detrás del modelo completo.

## Migración 002 — Policies

Agrega las pólizas y su cobertura efectiva sobre la base de identidad de la migración 001.

### Tablas

- **`policies`** — Póliza emitida y su historial. No almacena `carrierId` ni `policyType` propios: se derivan siempre vía `productId → product.carrierId / product.policyType`. Las renovaciones no sobrescriben: se crea una nueva fila de `Policy` encadenada mediante `previousPolicyId` (self-relation 1:1, única) hacia la póliza anterior.
- **`policy_members`** — Cobertura efectiva de una póliza emitida. Una fila = una persona realmente cubierta. Si el titular (`Policy.holderId`) está cubierto, también tiene su propia fila aquí con `role = PRIMARY` — `policy_members` es siempre la única fuente de verdad de cobertura, nunca se infiere comparando con `holderId`.
- **`health_policy_details`** — Extensión 1:1 de `policies`, solo para pólizas cuyo producto es de tipo `HEALTH`. Incluye `planNameSnapshot`, que congela el nombre del plan al momento de la póliza (el catálogo `products` es mutable; el historial de una póliza no debe cambiar si el catálogo se renombra o desactiva después).

### Enums

- `PolicyStatus`: PENDING, ACTIVE, CANCELLED, EXPIRED, RENEWED
- `PolicyOperationType`: NEW_ENROLLMENT, RENEWAL, PLAN_CHANGE
- `PolicyMemberRole`: PRIMARY, SPOUSE, DEPENDENT, OTHER
- `BillingFrequency`: MONTHLY, QUARTERLY, SEMIANNUAL, ANNUAL, OTHER
- `PaymentStatus`: CURRENT, DUE, PAST_DUE (nullable en `Policy`: `null` = no se ha determinado, no existe un valor `UNKNOWN`)

### Constraints e índices

- `policies.previousPolicyId` — UNIQUE (cada póliza histórica solo puede tener una renovación apuntándole; evita cadenas ramificadas)
- `policy_members(policyId, personId)` — UNIQUE (una persona no puede aparecer dos veces como miembro de la misma póliza)
- `health_policy_details.policyId` — UNIQUE (relación 1:1)
- `policies.holderId`, `policies.productId`, `policies.status`, `policies.effectiveDate`, `policies.policyNumber` — índices de búsqueda/filtrado
- `policy_members.personId` — índice (necesario aparte del índice único compuesto, que no sirve para buscar solo por `personId`)
- `health_policy_details.marketplaceApplicationId` — índice de búsqueda
- `policyNumber` **sin** constraint de unicidad: la unicidad real es por carrier, pero `Policy` no almacena `carrierId` directamente por diseño; forzarlo habría requerido denormalizar ese dato solo para el constraint.

### Dinero y fechas

Todos los montos usan `Decimal(12,2)` (nunca `Float`): `premiumAmount`, `taxCreditAmount`, `incomeUsed`, deducibles y out-of-pocket. `effectiveDate`, `terminationDate` y `nextPaymentDueDate` son `DATE`; `createdAt`/`updatedAt` son `TIMESTAMP`.

### Fuera de alcance de esta migración

`Task`, `Note`, `BirthdayGreeting`, `CommissionExpectation`, `CommissionPayment`, `PersonProvider`, `PersonMedication`, `PaymentMethodReference`, `Opportunity`, `Application`/`Quote`, autenticación, dashboard/UI. Ver [DECISIONS.md](./DECISIONS.md).

## Migración 003 — Operations

Agrega trabajo operativo (tareas, notas, cumpleaños), sin comisiones, datos médicos ni autenticación.

### Tablas

- **`tasks`** — Trabajo pendiente o completado. Se relaciona con `people`/`policies` mediante FKs explícitas y opcionales (`personId`, `policyId`), sin polimorfismo. Distingue `assignedToId` (quién debe ejecutarla) de `createdById` (quién la creó); ambos nullable y con `onDelete: SetNull` porque todavía no hay autenticación real.
- **`notes`** — Nota operativa en texto plano, ligada opcionalmente a persona y/o póliza. No es un sustituto de auditoría técnica (`AuditLog`, futura): registra contexto de negocio, no cambios estructurados del sistema.
- **`birthday_greetings`** — Gestión de la tarjeta de cumpleaños de una persona en un año específico. `people.dateOfBirth` sigue siendo la única fuente de la fecha de nacimiento; esta tabla no la duplica, solo registra el proceso comercial (pendiente/enviada/omitida) por año.

### Enums

- `TaskStatus`: OPEN, IN_PROGRESS, COMPLETED, CANCELLED (sin `OVERDUE` — es un estado derivado, ver Decisiones)
- `TaskPriority`: LOW, NORMAL, HIGH, URGENT
- `BirthdayGreetingStatus`: PENDING, SENT, SKIPPED
- `BirthdayGreetingChannel`: WHATSAPP, SMS, EMAIL, OTHER (nullable, solo aplica una vez enviada)

### Constraints e índices

- `birthday_greetings(personId, year)` — UNIQUE
- `tasks(assignedToId, status, dueAt)` — índice compuesto para la consulta más común del dashboard futuro ("mis tareas abiertas por vencimiento"); evita crear tres índices sueltos redundantes
- `tasks.personId`, `tasks.policyId` — índices independientes (no cubiertos por el prefijo del compuesto anterior)
- `notes.personId`, `notes.policyId` — índices de búsqueda
- `birthday_greetings(year, status)` — índice para "tarjetas pendientes de este año" (no cubierto por el UNIQUE, cuyo prefijo es `personId`)
- `people.dateOfBirth` **sigue sin índice** — a este volumen, consultar cumpleaños por mes/día sin índice funcional es viable; se difiere hasta tener evidencia real de necesidad

### Fechas

`tasks.dueAt` y `tasks.completedAt` son `TIMESTAMP`, no `DATE` — permite ordenar tareas del mismo día por hora y admitir horarios específicos ("llamar mañana a las 3 PM"), sin lógica de timezone custom en esta fase.

### Fuera de alcance de esta migración

`CommissionExpectation`, `CommissionPayment`, `PersonProvider`, `PersonMedication`, `PaymentMethodReference`, `Opportunity`, `Application`/`Quote`, `ActivityLog`, `AuditLog`, autenticación, UI funcional. Ver [DECISIONS.md](./DECISIONS.md).

## Migración 004 — Financial

Agrega el modelo de comisiones: cuánto esperamos recibir por póliza/mes y los movimientos reales contra esa expectativa.

### Tablas

- **`commission_expectations`** — Cuánto se espera recibir por una póliza en un período (mes). No almacena carrier: se deriva vía `policyId → policy.productId → product.carrierId`. `status` (`ACTIVE`/`CANCELLED`) es un hecho de negocio propio — si la agencia sigue esperando ese dinero o no — y **no** intenta representar cuánto se ha cobrado; eso se calcula.
- **`commission_payments`** — Movimiento real contra una expectativa: pago, chargeback o ajuste. `amount` puede ser positivo o negativo. Un chargeback **es** un `CommissionPayment` con `amount` negativo y `type = CHARGEBACK` — no existe una tabla `Chargeback` separada. Los pagos no se editan ni se borran: cada corrección es una fila nueva, preservando el historial completo de movimientos.

### Enums

- `CommissionExpectationStatus`: ACTIVE, CANCELLED (sin `PARTIAL`/`PAID` — se calculan, ver Cálculos)
- `CommissionPaymentType`: PAYMENT, CHARGEBACK, ADJUSTMENT

### Convención de `period`

`commission_expectations.period` es `DATE` y **siempre representa el primer día del mes de comisión**: `2026-08-01` = agosto 2026. No se usan columnas `year`/`month` separadas ni un string `"2026-08"`.

### Cálculos (no almacenados)

```
totalReceived = SUM(CommissionPayment.amount) WHERE commissionExpectationId = X
difference    = CommissionExpectation.expectedAmount - totalReceived

UNPAID  si totalReceived = 0
PARTIAL si 0 < totalReceived < expectedAmount
PAID    si totalReceived >= expectedAmount
```

Un chargeback posterior puede volver a bajar `totalReceived` por debajo de `expectedAmount` — por eso este estado nunca se almacena, siempre se calcula en el momento de la consulta.

### Constraints e índices

- `commission_expectations(policyId, period)` — UNIQUE (una única expectativa por póliza/mes en V1)
- `commission_expectations.expectedAmount` — **CHECK `>= 0`** (agregado manualmente al SQL de la migración; Prisma no tiene todavía sintaxis declarativa estable para CHECK en `schema.prisma`, se editó el archivo de migración generado con `--create-only` antes de aplicarlo)
- `commission_expectations.period`, `commission_expectations(agentId, period)` — índices para reportes mensuales/por agente (CLAUDE.md §14)
- `commission_payments.commissionExpectationId`, `commission_payments.receivedAt` — índices (FK no se indexa automáticamente en Postgres; `receivedAt` para conciliación por fecha)
- `commission_payments.externalReference` — sin índice todavía, sin necesidad demostrada

### Dinero

`expectedAmount` y `amount` usan `Decimal(12,2)` (verificado como `numeric(12,2)` en PostgreSQL), nunca `Float`.

### Fuera de alcance de esta migración

`PersonProvider`, `PersonMedication`, `PaymentMethodReference`, `Opportunity`, `Application`/`Quote`, `AuditLog`, autenticación, UI funcional, importación automática de archivos de carriers. Ver [DECISIONS.md](./DECISIONS.md).

## Migración 005 — Health Operational Data

Agrega información médica operativa **mínima** para atender al cliente. El CRM no es un sistema clínico — ver [SECURITY.md](./SECURITY.md) para los controles de acceso previstos sobre estas dos tablas.

### Tablas

- **`person_providers`** — Médico/proveedor conocido asociado a una persona (PCP o especialista). Una persona puede tener cero, uno o varios.
- **`person_medications`** — Medicamento informado por el cliente. `isActive` permite discontinuarlo conservando su historial, sin borrar la fila (igual patrón que `contactStatus` en `Person`, no `deletedAt`).

### Enums

- `ProviderType`: PCP, SPECIALIST, OTHER

### Constraints e índices

- **Sin constraints de unicidad** — una persona puede tener dos proveedores con el mismo nombre, o historial de medicamentos repetidos con distinta dosis/período; forzar unicidad sería artificial.
- `person_providers.personId`, `person_medications.personId` — índices de acceso principal
- `person_medications(personId, isActive)` — índice compuesto para el caso de uso principal: "medicamentos activos de esta persona"
- Sin índices sobre `name`/`specialty` todavía, sin necesidad demostrada

### Alcance de `notes`

`notes` en ambas tablas es de uso **estrictamente operativo** (ej. preferencias de horario, cambios de contacto del proveedor, "el cliente ya no ve a este especialista"). **Nunca** diagnósticos, condiciones médicas, resultados de laboratorio o narrativa clínica.

### Campos deliberadamente excluidos

`diagnosis`, `condition`, códigos ICD, historial médico, resultados de laboratorio, alergias, cirugías, historial de hospitalización, información de embarazo, historial de salud mental, detalles de discapacidad, documentos de recetas. Ninguno de estos pertenece a esta migración ni al alcance actual del CRM.

### Fuera de alcance de esta migración

`PaymentMethodReference`, `Opportunity`, `Application`/`Quote`, `AuditLog`, autenticación, documentos médicos, claims, recetas electrónicas, UI funcional. Ver [DECISIONS.md](./DECISIONS.md) y [SECURITY.md](./SECURITY.md).

## Migración 006 — Model Hardening

Sin entidades nuevas. Corrige invariantes detectados en la auditoría integral del modelo V1 (Core Identity → Health Operational Data) antes de comenzar Auth/UI. Todos los cambios son aditivos o correctivos sobre tablas existentes.

### Cambios de esquema

- **`PolicyStatus.RENEWED` eliminado.** Enum final: `PENDING`, `ACTIVE`, `CANCELLED`, `EXPIRED`. "Renovada" se deriva de la relación `previousPolicyId` (`renewedInto != null` en la póliza anterior) — nunca se vuelve a almacenar como status. Ver [DECISIONS.md](./DECISIONS.md).
- **`Policy.effectiveDate` ahora nullable.** Una póliza `PENDING` puede existir antes de conocer su fecha efectiva definitiva. Regla de aplicación (no DB): requerida cuando `status = ACTIVE`.

### Constraints nuevos

- `CHECK (id <> previousPolicyId)` en `policies` — impide que una póliza se marque como renovación de sí misma. Ciclos de más de un nivel (`A → B → A`) se validan en aplicación, no en DB (desproporcionado implementarlo como trigger para un caso solo alcanzable por bug de servicio).
- Índice único parcial `ON policy_members(policyId) WHERE role = 'PRIMARY'` — como máximo un `PolicyMember` con `role = PRIMARY` por póliza. Que ese `PRIMARY` coincida con `Policy.holderId` sigue siendo responsabilidad de la aplicación (requeriría trigger cross-tabla).
- `CHECK (personId IS NOT NULL OR policyId IS NOT NULL)` en `notes` — una nota debe estar asociada a persona y/o póliza, nunca a ninguna de las dos. No aplica a `Task` (las tareas generales internas sí pueden carecer de ambas).
- Dos `CHECK` en `birthday_greetings`: `status <> 'SENT' OR (channel IS NOT NULL AND sentAt IS NOT NULL)` y `status = 'SENT' OR sentAt IS NULL` — `SENT` siempre tiene canal y fecha de envío; cualquier otro estado nunca tiene fecha de envío.

### Índices nuevos

- `people.assignedAgentId` — "clientes asignados a este agente".
- `household_members.householdId` — "miembros de este hogar" (el índice único existente `(personId, householdId)` no servía esta consulta por la regla del prefijo izquierdo).
- `policies.householdId` — "pólizas de este hogar".

### Nota técnica sobre esta migración

`prisma migrate dev --create-only` no funciona en modo no interactivo cuando hay una advertencia de pérdida de datos potencial (eliminar un valor de enum). Se generó el SQL con `prisma migrate diff` (comparando la base actual contra el schema objetivo), se creó manualmente la carpeta de migración con ese SQL, se agregaron los `CHECK`/índice parcial (no expresables en `schema.prisma`) editando el archivo, y se aplicó con `prisma migrate deploy`. El SQL de cambio de enum sigue el patrón estándar y seguro de Prisma (crear tipo nuevo, castear con `USING`, eliminar el tipo viejo) — sin riesgo real porque la base estaba vacía en el momento de aplicarla.

### Fuera de alcance de esta migración

`Address` (en cualquiera de sus formas), `sex`, `preferredLanguage`, `countryOfOrigin`, `Opportunity`, `Application`/`Quote`, `PaymentMethodReference`, `AuditLog`, autenticación, UI. Ver [DECISIONS.md](./DECISIONS.md).

## Migración 009 — Household, Health Source, Documents, Commission Rules

Primera migración desde la 006 (la 007/007b agregaron las tablas técnicas de Better Auth; no hubo migración 008). Fase 019.5: correcciones y extensiones surgidas de la primera prueba funcional real del CRM.

### Cambios de esquema

- **`households`** gana 7 columnas: `addressLine1`, `addressLine2` (nullable), `city`, `state` (`@db.VarChar(2)`), `zipCode`, `county` (todos `String?`), `annualHouseholdIncome` (`Decimal(12,2)?`), `incomeYear` (`Int?`). Dirección del hogar asegurado, distinta de `HealthPolicyDetail.incomeUsed` (ver [DECISIONS.md](./DECISIONS.md)).
- **`policies`** gana `healthCoverageSource` (`HealthCoverageSource?`) — solo tiene sentido cuando el producto es `HEALTH`, reforzado en el servicio, no con un CHECK cross-tabla.

### Tablas nuevas

- **`policy_documents`** — Metadata de un archivo asociado a una póliza (`type`, `fileName`, `storageKey` único, `mimeType`, `fileSize`, `description?`, `uploadedById?`). El binario nunca vive aquí — ver `FileStorage` en [DECISIONS.md](./DECISIONS.md) y [SECURITY.md](./SECURITY.md).
- **`commission_rules`** — Cómo se calcula una comisión (`method`, `base`, montos/porcentajes iniciales y residuales, periodicidades, `residualStartYear`), a nivel `Product` (`policyId = null`) o como override de una `Policy` específica.

### Enums nuevos

- `HealthCoverageSource`: MARKETPLACE, PRIVATE
- `PolicyDocumentType`: PLAN_SUMMARY, BROCHURE, FORMULARY, PROVIDER_DIRECTORY, MEMBER_CARD, APPLICATION, OTHER
- `CommissionMethod`: FIXED_AMOUNT, PERCENTAGE
- `CommissionBase`: PREMIUM_MONTHLY, PREMIUM_ANNUALIZED, PER_MEMBER, FIXED, OTHER
- `CommissionPeriodicity`: ONE_TIME, MONTHLY, ANNUAL

### Constraints e índices

- `policy_documents.storageKey` — UNIQUE (el key generado nunca se reutiliza)
- `policy_documents.policyId` — índice
- `policy_documents → policies` — `onDelete: Cascade` (documentos sin sentido sin su póliza); `policy_documents → users` (`uploadedById`) — `onDelete: SetNull`, mismo patrón que el resto de referencias hacia `User`
- `commission_rules.productId`, `commission_rules.policyId` — índices
- `commission_rules → products` — `onDelete: Restrict` (no se puede borrar un producto con reglas configuradas sin limpiarlas antes); `commission_rules → policies` — `onDelete: Cascade`

### Dinero

`annualHouseholdIncome`, `initialAmount`, `initialPercentage`, `residualAmount`, `residualPercentage` usan `Decimal(12,2)`/`Decimal(5,2)` según corresponda — nunca `Float`, mismo principio que el resto del schema.

### Fuera de alcance de esta migración

`Address` como entidad separada, dirección propia de `Person` (sigue viviendo en `Household`), adapter de almacenamiento S3 real (solo la interfaz `FileStorage`), `AuditLog`. Ver [DECISIONS.md](./DECISIONS.md).

## Migración 010 — Commission Expectation Override Tracking

Fase 019.7 (UAT hallazgos #12-#15). El nombre de carpeta de la migración menciona "household_state_catalog" porque ese fue el alcance inicialmente previsto, pero el catálogo de estados (`US_STATES`, Hallazgo #15) terminó siendo puramente TypeScript (`src/lib/us-states.ts`), sin ningún cambio de schema — no se renombró la carpeta ya aplicada para no desincronizar `_prisma_migrations` con el historial real. El único cambio de base de datos real de esta fase es la extensión de `commission_expectations` para Hallazgo #14.

### Cambios de esquema

- **`commission_expectations`** gana 6 columnas: `calculatedAmount` (`Decimal(12,2)?`, congelado — lo que produjo `CommissionRule` al generar la fila, nunca se recalcula retroactivamente), `generatedByRuleId` (`String? @db.Uuid`, trazabilidad de qué regla generó la fila, nullable porque una expectativa creada a mano desde Fase 016 no tiene regla), `isManualOverride` (`Boolean @default(false)`), `overriddenById` (`String? @db.Uuid`), `overriddenAt` (`DateTime?`), `overrideReason` (`String?`).

### Constraints e índices

- `commission_expectations.generatedByRuleId` — índice
- `commission_expectations → commission_rules` (`generatedByRuleId`) — `onDelete: SetNull` (borrar una regla nunca debe borrar el historial de expectativas que generó)
- `commission_expectations → users` (`overriddenById`) — `onDelete: SetNull`, mismo patrón que el resto de referencias hacia `User`

### Dinero

`calculatedAmount` usa `Decimal(12,2)`, igual que `expectedAmount` — nunca `Float`.

### Fuera de alcance de esta migración

Catálogo de Ciudad/Condado/ZIP en base de datos (diferido explícitamente, ver [DECISIONS.md](./DECISIONS.md) — requiere decidir sobre registro USPS CRID/Mailer ID u otra fuente). Ningún cambio en `households.state` a nivel de columna (sigue siendo `String? @db.VarChar(2)`; la validación del catálogo `US_STATES` vive en `stateCodeSchema`, capa de aplicación).

## Migración 011 — Audit Trail & Client History

Fase 019.9. Detalle completo del diseño y uso en [AUDIT_TRAIL.md](./AUDIT_TRAIL.md) — aquí solo el schema.

### Tablas nuevas

- **`audit_events`** — log append-only de acciones de negocio (ver `AUDIT_TRAIL.md`). Nunca se actualiza ni se borra desde código de aplicación.

### Columnas

`id` (uuid, PK), `actorUserId` (uuid?, FK a `users`), `actorType` (`AuditActorType`: `USER`/`SYSTEM`, default `USER`), `entityType` (string — "Person", "Policy", "PersonMedication", etc., nunca un enum de DB, ver `AUDIT_TRAIL.md`), `entityId` (uuid), `action` (string — catálogo completo en `AUDIT_TRAIL.md`), `contactPersonId` (uuid?, FK a `people`), `policyId` (uuid?, FK a `policies`), `householdId` (uuid?, FK a `households`), `summary` (string), `changes` (jsonb?), `metadata` (jsonb?), `createdAt` (timestamp, default now).

### Enum nuevo

- `AuditActorType`: `USER`, `SYSTEM`.

### Cambio adicional en esta migración

- **`PolicyOperationType` gana el valor `REPLACEMENT`** (además de `NEW_ENROLLMENT`/`RENEWAL`/`PLAN_CHANGE` ya existentes) — usado por el flujo "Renovar póliza" (hallazgo #3/#4 de UAT) cuando el usuario indica que en realidad es un reemplazo de póliza (ej. cambio de carrier), no una renovación pura. `ALTER TYPE ... ADD VALUE`, sin afectar filas existentes.

### Constraints e índices

- `audit_events → users` (`actorUserId`) — `onDelete: SetNull` (el evento sobrevive aunque el usuario se desactive/elimine en el futuro).
- `audit_events → people` (`contactPersonId`), `audit_events → policies` (`policyId`), `audit_events → households` (`householdId`) — todos `onDelete: SetNull`, mismo principio: el historial nunca debe bloquear ni desaparecer si la entidad relacionada cambia, y estas entidades (`Person`/`Policy`/`Household`) de todas formas nunca se borran físicamente en este sistema (ver CLAUDE.md §31).
- Índices: `[contactPersonId, createdAt]`, `[policyId, createdAt]`, `[householdId, createdAt]`, `[entityType, entityId, createdAt]`, `[actorUserId, createdAt]` — cubren exactamente las consultas reales (timeline de contacto, timeline de póliza, historial de una entidad puntual, actividad de un usuario), sin índices especulativos.

### Fuera de alcance de esta migración

Retención/expiración automática de `audit_events` (ver `AUDIT_TRAIL.md`, "Retención"). Generación de eventos durante el import legacy (diferido). Un enum de Postgres para `action` (decisión deliberada de mantenerlo como string libre, ver `AUDIT_TRAIL.md`).

## Migración 012 — Conciliación de comisiones (Fase 020)

Detalle funcional completo en `docs/COMMISSION_RECONCILIATION.md`; aquí solo el schema.

### `commission_payments` — columna nueva

- `statementRowId` (uuid?, `@unique`, FK a `commission_statement_rows`, `onDelete: SetNull`) — un pago que provino de un reporte de conciliación queda vinculado a la fila exacta que lo generó. `@unique` es la protección estructural contra duplicados: `applyCommissionStatement` no puede crear dos pagos desde la misma fila.

### `policy_external_references` (nueva)

`id` (uuid, PK), `policyId` (uuid, FK a `policies`, `onDelete: Cascade`), `source` (string — ej. `"ORANGE_OSCAR"`), `type` (string — ej. `"MEMBER_ID"`), `externalId` (string), `createdAt`. `@@unique([source, type, externalId])` — un identificador externo dado solo puede apuntar a una póliza. `@@index([policyId])`. Nunca se asume que un identificador externo (ej. "Member ID" de un reporte) equivale a `Policy.policyNumber` — ver `COMMISSION_RECONCILIATION.md`.

### Enums nuevos

- `CommissionStatementStatus`: `PREVIEW`, `APPLIED`, `DUPLICATE_BLOCKED`.
- `CommissionStatementRowMatchStatus`: `MATCHED`, `UNMATCHED`, `AMBIGUOUS`, `IGNORED`, `APPLIED`.

### `commission_statements` (nueva)

`id`, `source` (string, catálogo abierto igual que `AuditEvent.action`), `fileName`, `fingerprint` (string, `@unique` — hash de idempotencia, ver `COMMISSION_RECONCILIATION.md`), `statementPeriod` (date?), `uploadedById` (uuid?, FK a `users`, `onDelete: SetNull`), `uploadedAt`, `status` (default `PREVIEW`), `totalRows`/`matchedRows`/`unmatchedRows`/`ambiguousRows`/`appliedRows` (int, contadores denormalizados recalculados en cada cambio de estado de fila), `receivedTotal` (decimal 12,2), `appliedAt` (timestamp?). `@@index([source, uploadedAt])`.

### `commission_statement_rows` (nueva)

`id`, `statementId` (uuid, FK a `commission_statements`, `onDelete: Cascade`), `rowNumber` (int), `externalId` (string?), `displayName` (string?), `receivedAmount` (decimal 12,2), `effectiveDate` (date?), `paidAt` (date?), `matchStatus` (default `UNMATCHED`), `matchedPolicyId` (uuid?, FK a `policies`, `onDelete: SetNull`), `matchedExpectationId` (uuid?, FK a `commission_expectations`, `onDelete: SetNull`), `errorCode` (string?), `metadata` (jsonb?). Índices en `statementId`, `matchedPolicyId`, `matchedExpectationId`.

### Fuera de alcance de esta migración

Persistencia del archivo binario original del reporte (usaría `FileStorage`, no `Postgres`, si se agrega en el futuro). Un modelo para chargebacks/ajustes (el adaptador actual solo produce pagos).

## Migración 013 — Identidad sensible del contacto (Fase 021)

Detalle funcional completo en `docs/SENSITIVE_PII.md`; aquí solo el schema. Ningún campo de esta migración se agregó a `Person` directamente — ver `docs/DECISIONS.md` para el razonamiento de mantenerlos en modelos 1:1/1:N separados.

### Enum nuevo: `ImmigrationCategory`

`US_CITIZEN`, `LAWFUL_PERMANENT_RESIDENT`, `EMPLOYMENT_AUTHORIZATION`, `OTHER`, `UNKNOWN` (default). Información administrativa, nunca una determinación legal — ver `docs/SENSITIVE_PII.md`.

### `person_sensitive_identities` (nueva, 1:1 con `people`)

`id`, `personId` (uuid, `@unique`, FK a `people`, `onDelete: Cascade`), `immigrationCategory` (default `UNKNOWN`), `ssnEncrypted` (text?), `ssnLast4` (varchar(4)?), `uscisNumberEncrypted` (text?), `uscisNumberLast4` (varchar(4)?), `createdAt`, `updatedAt`. Los campos `*Encrypted` guardan el formato versionado de `src/lib/pii-crypto.ts` (`v1:<iv>:<authTag>:<ciphertext>`, AES-256-GCM) — **nunca** el valor en claro. `*Last4` es la única parte que se guarda en claro, exclusivamente para poder enmascarar (`***-**-6789`) sin tener que descifrar.

### Enum nuevo: `ImmigrationDocumentType`

`PERMANENT_RESIDENT_CARD`, `EMPLOYMENT_AUTHORIZATION_DOCUMENT`, `OTHER`.

### `person_immigration_documents` (nueva, 1:N con `people`)

`id`, `personId` (uuid, FK a `people`, `onDelete: Restrict`), `documentType`, `documentNumberEncrypted` (text?), `documentNumberLast4` (varchar(4)?), `issuedDate` (date?), `expirationDate` (date?), `isActive` (default true), `createdAt`, `updatedAt`. `onDelete: Restrict` (no `Cascade`) — mismo criterio que `PersonProvider`/`PersonMedication`: una persona con documentos migratorios registrados nunca debería poder eliminarse físicamente sin resolver primero esas filas (en la práctica, `Person` nunca se borra físicamente en este sistema, ver CLAUDE.md §31). Índices en `personId` y `[personId, isActive]` — misma forma que `person_medications`.

### Fuera de alcance de esta migración

Persistencia de un escaneo/foto del documento físico (solo se registra el número, cifrado). Rotación de `PII_ENCRYPTION_KEY`/KMS (el formato versionado lo permite después). Import real de los valores del Excel legacy (`src/import/sensitive.ts` sigue excluyendo esas columnas).

## Migración 014 — UAT integrity fixes (Fase 022)

Detalle funcional/decisiones completas en `docs/DECISIONS.md` ("UAT final, ciclo Prospecto/Cliente e identidad corporativa"); aquí solo el schema.

### `products.nameNormalized` + índice único compuesto

Columna nueva `nameNormalized` (`String`, `@default("")` a nivel Prisma — solo para que el tipo generado marque el campo opcional en `create()`, el valor real siempre lo decide el trigger de abajo). Backfill con `lower(regexp_replace(trim(name), '\s+', ' ', 'g'))` para las filas existentes; los duplicados detectados en ese backfill se desambiguan agregando un sufijo `-dup-<8charid>` al `nameNormalized` de las filas más nuevas (por `createdAt`), **nunca se borra ninguna fila**. Índice único: `@@unique([carrierId, nameNormalized, policyType, planYear])`.

### Trigger `products_set_name_normalized()` / `products_name_normalized_trigger`

`BEFORE INSERT OR UPDATE OF name ON products` — recalcula `nameNormalized` a partir de `name` en cada insert/update, sin importar qué valor (si alguno) haya mandado el caller para esa columna. Elegido en vez de exigir que cada `prisma.product.create({...})` del proyecto (20+ call sites: tests, `scripts/seed-dev.ts`, `src/import/apply.ts`) calculara `nameNormalized` explícitamente — ningún call site existente necesitó cambiar.

### Sin cambios de columnas para las demás correcciones de esta fase

La validación de fechas reales (`dateOnlySchema`), el ciclo Prospecto↔Cliente (`recomputePersonContactStatus`), el bug de titular-cubierto, el solapamiento de cobertura de salud, y el reset de contraseña de usuario son todos cambios de lógica de aplicación (schemas Zod / servicios) — no requirieron ninguna migración adicional.

## Migración 015 — Person.sex (Fase 024)

Detalle funcional completo en `docs/DECISIONS.md` ("UAT final, sexo del contacto y filtrado de catálogo").

### Enum nuevo: `PersonSex`

`MALE`, `FEMALE`, `OTHER`, `UNKNOWN` (default). Dato administrativo simple, nunca una determinación clínica.

### `people.sex` (nueva columna en `Person`)

`PersonSex NOT NULL DEFAULT 'UNKNOWN'` — el default garantiza que ninguna fila existente ni ningún `prisma.person.create({...})` que todavía no conozca este campo se rompa. Nunca se infiere de otro dato (nombre, etc.); solo se fija explícitamente por el usuario o por el importador cuando el source lo trae.
