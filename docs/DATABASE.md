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
