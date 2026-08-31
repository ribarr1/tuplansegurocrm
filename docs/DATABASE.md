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
