This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Manual de Usuario

¿Buscas cómo usar el CRM en el día a día (sin conocimientos técnicos)? Ve al [Manual de Usuario](docs/MANUAL_USUARIO.md). El resto de este README es documentación técnica del proyecto.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Desarrollo local

Este proyecto usa PostgreSQL en Docker Compose (no requiere instalar PostgreSQL en tu sistema) y Prisma como ORM.

```bash
# 1. Instalar dependencias
npm install

# 2. Copiar el archivo de variables de entorno
cp .env.example .env

# 3. Levantar PostgreSQL
docker compose up -d

# 4. Comprobar estado (debe mostrar "healthy")
docker compose ps

# 5. Generar el cliente de Prisma
npx prisma generate

# 6. Iniciar la app
npm run dev
```

Cuando el modelo de datos del CRM esté definido, las migraciones se aplican con:

```bash
npx prisma migrate dev
```

Para detener PostgreSQL (conserva los datos):

```bash
docker compose down
```

## Autenticación

El login usa email + contraseña (Better Auth), con sesiones respaldadas por base de datos. No hay registro público — está deshabilitado incluso a nivel de Better Auth (`emailAndPassword.disableSignUp`), no solo sin enlace en la UI. El primer usuario ADMIN se crea con un script de bootstrap; usuarios posteriores se crean desde **Configuración → Usuarios** (solo ADMIN, ver más abajo).

### Crear el primer administrador local

```bash
npm run create-admin
```

Pide nombre, correo y contraseña por terminal (contraseña oculta, mínimo 10 caracteres). También puedes pasarlos por variable de entorno de proceso, sin escribirlos en ningún archivo:

```bash
ADMIN_NAME="Tu Nombre" ADMIN_EMAIL="tu@correo.com" ADMIN_PASSWORD="una-contraseña-segura" npm run create-admin
```

El script rechaza correos duplicados o inválidos y contraseñas demasiado cortas, y usa la misma función de hash que el resto de la aplicación (`better-auth/crypto::hashPassword` — no reinventa criptografía).

### Iniciar sesión

Con el servidor corriendo (`npm run dev`), entra a [http://localhost:3000/login](http://localhost:3000/login) con el correo/contraseña del administrador creado. Tras iniciar sesión llegas a `/dashboard`.

### Cómo funciona la autorización

- **Autenticación** (¿quién eres?): sesión de Better Auth, cookie `HttpOnly`.
- **Autorización** (¿qué puedes hacer?): server-side, vía `requireUser()`/`requireRole(...)` en [src/lib/authorization.ts](src/lib/authorization.ts). Cada request protegido vuelve a consultar `User.isActive`/`role` en la base de datos — un usuario desactivado pierde acceso en su siguiente petición, aunque su cookie siga siendo válida.
- Un usuario con `isActive = false` no puede usar el sistema aunque su sesión/password sean válidos.

### Variables de entorno nuevas

Ver `.env.example`: `BETTER_AUTH_SECRET` (genera el tuyo con `npx @better-auth/cli secret`) y `BETTER_AUTH_URL`.

### Zona horaria de negocio

`APP_TIME_ZONE` (ver `.env.example`) — identificador IANA (ej. `America/Chicago`) usado para calcular "hoy"/"este mes" en Tareas y Cumpleaños de forma consistente, sin importar en qué zona horaria corre el servidor. **Obligatoria**: si falta o es inválida, la aplicación falla con un mensaje claro en cuanto se usa, en vez de continuar con una zona adivinada. Sin soporte multi-timezone por usuario en V1 — TuPlanSeguro USA opera en una sola zona horaria.

### Cifrado de identidad sensible (SSN / USCIS / documentos migratorios)

`PII_ENCRYPTION_KEY` (ver `.env.example`) — clave AES-256-GCM (32 bytes, base64) usada para cifrar/descifrar SSN, USCIS/A-Number y números de documento migratorio (ver [docs/SENSITIVE_PII.md](docs/SENSITIVE_PII.md)). **Obligatoria y nunca reutilizable entre entornos** — genera la tuya con `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Sin esta clave, esos valores cifrados en la base de datos no son recuperables.

## Capa de servicios

La lógica de negocio vive en `src/services/*.service.ts`, no directamente en páginas/Route Handlers. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para el flujo completo (UI → autorización → servicio → Prisma).

## Rutas del CRM

| Ruta | Descripción |
|---|---|
| `/login` | Login (email + contraseña) |
| `/dashboard` | Centro de trabajo de hoy: tareas, pagos, cumpleaños, cartera y comisiones (según rol) |
| `/contacts` | Lista de contactos: búsqueda, filtro por estado, paginación |
| `/contacts/new` | Crear contacto |
| `/contacts/[id]` | Detalle de contacto (datos personales + resumen de pólizas/tareas/notas) |
| `/contacts/[id]/edit` | Editar contacto (sujeto a la política de permisos por rol) |
| `/contacts/[id]?tab=familia` | Tab "Familia": hogares de la persona, agregar/quitar miembros, cambiar rol |
| `/contacts/[id]?tab=polizas` | Tab "Pólizas": pólizas donde la persona es titular y/o miembro cubierto |
| `/policies` | Lista de pólizas: búsqueda, filtro por estado/tipo/compañía, paginación |
| `/policies/new?holderId=<id>` | Nueva póliza (titular preseleccionado, cambiable) |
| `/policies/[id]` | Detalle de póliza: resumen, fechas/pago, personas cubiertas |
| `/policies/[id]/edit` | Editar póliza (campos administrativos; producto solo si está Pendiente) |
| `/policies/[id]/health` | Agregar/editar información de salud (solo pólizas tipo Salud) |
| `/settings` | Configuración: acceso a Usuarios, Compañías y Productos |
| `/settings/users` | Lista de usuarios; crear (rol + contraseña temporal), activar/desactivar (solo ADMIN) |
| `/settings/carriers` | Lista de compañías; crear/editar/activar-desactivar (solo ADMIN) |
| `/settings/products` | Lista de productos: filtro por compañía/tipo/estado; crear/editar/activar-desactivar (solo ADMIN); incluye configuración de reglas de comisión del producto |
| `/contacts/[id]?tab=tareas` | Tab "Tareas": tareas de la persona |
| `/tasks` | Lista de tareas: vistas rápidas (Hoy, Vencidas, Pendientes, Completadas) + filtros |
| `/tasks/new?personId=<id>` / `?policyId=<id>` | Nueva tarea (contexto de contacto/póliza preseleccionado) |
| `/tasks/[id]` | Detalle de tarea: completar, cancelar, editar |
| `/tasks/[id]/edit` | Editar tarea (reabrir una tarea completada/cancelada requiere ADMIN) |
| `/birthdays` | Cumpleaños: vistas rápidas (Hoy, Este mes, Próximos, Todos), marcar enviada/omitida |
| `/commissions` | Lista de comisiones esperadas: búsqueda, filtro por período/agente/compañía/estado, paginación (ASSISTANT: sin acceso) |
| `/commissions/new?policyId=<id>` | Nueva comisión esperada (solo ADMIN, desde el detalle de una póliza) |
| `/commissions/[id]` | Detalle de comisión: montos, movimientos, editar/registrar pago/cancelar (solo ADMIN); AGENT ve la misma información en solo lectura |
| `/premiums` | Lista de seguimiento de pago: vistas rápidas (Vence hoy, Próximos 7/30 días, Vencidas) + filtros |
| `/policies/[id]/premium` | Editar seguimiento de pago de una póliza (prima, frecuencia, próximo vencimiento, autopay, asistencia, estado de pago) |

No existe eliminación de contactos, pólizas, compañías, productos ni tareas (no hay borrado físico en el CRM — las tareas se cierran con estado `COMPLETED`/`CANCELLED`, el resto se retira con `isActive`/`inactivo`). La única excepción es "Restablecer felicitación" (solo ADMIN), que sí borra el registro anual de `BirthdayGreeting` — es un tracking, no una entidad de negocio con historial (ver docs/DECISIONS.md).

### Tareas / Seguimiento

`Task` es la base operativa del CRM ("¿qué tengo que hacer hoy?"). Puede vincularse a un `Person`, a una `Policy`, a ambas, o a ninguna (tarea general/administrativa).

- **"Vencida" no es un estado guardado** — se deriva de `dueAt` en el pasado + estado todavía activo (`OPEN`/`IN_PROGRESS`). Una tarea completada o cancelada nunca aparece como vencida, aunque su fecha ya haya pasado.
- **Responsable (`assignedToId`)**: un AGENT siempre queda asignado a sí mismo al crear una tarea y nunca puede reasignarla — ADMIN y ASSISTANT pueden asignar a cualquier agente activo o dejarla sin asignar.
- **Reabrir una tarea completada o cancelada requiere ADMIN.**
- La fecha/hora de vencimiento se interpreta según `APP_TIME_ZONE` (ver arriba), no la zona horaria del proceso — corregido en Fase 015. La UI captura la fecha en MM/DD/AAAA y la hora en formato 12h + AM/PM (`USDateTimeInput`, Fase 020) — nunca un `<input type="datetime-local">` nativo, cuyo formato visual depende del navegador/SO.

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/DECISIONS.md](docs/DECISIONS.md).

### Cumpleaños

`Person.dateOfBirth` es la única fuente de verdad del cumpleaños — nunca se duplica en otra tabla. `BirthdayGreeting` registra únicamente la gestión anual (enviada/omitida), y permanece sparse a propósito: la ausencia de registro para (persona, año) se interpreta como "Pendiente", nunca se crean filas para todas las personas al empezar el año.

- Vistas rápidas en `/birthdays`: Hoy, Este mes, Próximos (30 días, cruza diciembre → enero), Todos.
- **Nacidos el 29 de febrero**: en un año no bisiesto, su cumpleaños operativo se celebra el 28 de febrero (convención V1) — `dateOfBirth` nunca se modifica.
- **"Marcar como enviada" no envía ningún mensaje.** Solo registra que el agente ya lo hizo por fuera del CRM (WhatsApp/SMS/email reales quedan para una integración futura).
- **AGENT solo ve cumpleaños de contactos a los que tiene acceso** (sin asignar o asignados a sí mismo) — más restrictivo que la vista general de Contactos, porque `/birthdays` expone datos personales de forma escaneable.
- **"Restablecer felicitación" (solo ADMIN)** corrige un clic accidental, borrando el registro de ese año específico — vuelve al estado "Pendiente" derivado.

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/DECISIONS.md](docs/DECISIONS.md).

### Familia / Hogares

Una `Person` puede pertenecer a cero, uno o varios hogares (`Household`) — la relación es N:M vía `HouseholdMember`, nunca 1:N. Desde el tab "Familia" de un contacto se puede:

- Crear un hogar con esa persona como primer miembro (rol elegido en el momento, no inferido).
- Agregar un miembro existente (buscador) o crear un contacto nuevo directamente dentro del hogar — ambos casos son operaciones atómicas (transacción), nunca dos pasos separados que puedan dejar datos huérfanos.
- Cambiar el rol de un miembro (`HEAD`/`SPOUSE`/`CHILD`/`DEPENDENT`/`OTHER`).
- Quitar a alguien del hogar — esto borra solo la membresía, **nunca** el contacto.

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) y [docs/DECISIONS.md](docs/DECISIONS.md).

### Pólizas

Núcleo `Policy` + `PolicyMember` sobre el catálogo `Carrier`/`Product` ya existente. Ideas clave:

- **Titular (`holderId`) y miembro cubierto (`PolicyMember`) son conceptos distintos.** El titular no está cubierto automáticamente — el formulario pregunta explícitamente "¿El titular está cubierto?"; solo si la respuesta es sí se crea su `PolicyMember` con `role = PRIMARY`.
- **`Policy` nunca guarda `carrierId` ni `policyType` propios** — siempre se derivan de `Policy → Product → Carrier`.
- Crear una póliza (titular + miembros cubiertos) es una operación atómica (transacción) — nunca dos pasos separados.
- Una póliza `ACTIVE` siempre requiere `effectiveDate` (regla de aplicación, no de base de datos).
- El producto de una póliza solo puede cambiarse mientras está `PENDING`.

Catálogo de desarrollo (Carrier/Product ficticios, para poder probar el flujo sin datos reales):

```bash
npm run seed:dev
```

Idempotente (se puede correr varias veces sin duplicar), no se ejecuta automáticamente en ningún flujo, y no crea personas/hogares/pólizas — solo el catálogo, con nombres claramente marcados `(Dev Seed)`.

`seed:dev` es solo para desarrollo. La administración real del catálogo (crear compañías/productos, editarlos, activarlos/desactivarlos) se hace desde **Configuración → Compañías / Productos** (`/settings/carriers`, `/settings/products`), solo ADMIN puede crear/editar/desactivar — AGENT/ASSISTANT pueden consultar el catálogo pero no modificarlo. Un producto que ya fue usado en al menos una póliza no puede cambiar de compañía, tipo de seguro ni año de plan (protege el significado histórico de pólizas ya emitidas); desactivar una compañía vuelve inelegibles todos sus productos para pólizas nuevas, sin afectar las ya emitidas.

### Renovación de póliza

Desde Policy Detail, botón "Renovar póliza" (`/policies/[id]/renew`) — crea una **póliza nueva** vinculada a la anterior vía `previousPolicyId`, nunca modifica la póliza original. Prefila producto, tipo de cobertura, facturación, autopay, asistencia de pago, agente procesador y miembros cubiertos como *defaults editables*; número de póliza y fechas siempre se capturan de nuevo. Una póliza solo puede renovarse una vez (constraint único en `previousPolicyId`).

### Cancelación guiada de póliza

Desde Policy Detail, botón "Cancelar póliza" abre un diálogo pidiendo fecha de terminación (requerida, MM/DD/AAAA) y motivo (opcional, texto libre) — nunca borra la `Policy` ni sus relaciones (miembros, documentos, detalle de salud, historial de comisiones, pagos, notas, auditoría se conservan intactos). No permite cancelar una póliza ya `CANCELLED`, ni una fecha de terminación anterior a la fecha efectiva. El motivo, si se escribe, se guarda solo en el `AuditEvent.metadata` de `POLICY_CANCEL` — nunca en un campo nuevo del schema ni como una `Note`.

### Buscador global

Caja de búsqueda en el header (siempre visible) y página `/search` — busca Contactos por nombre/teléfono/email y Pólizas por número de póliza/producto/compañía, resultados agrupados. Ver [docs/DECISIONS.md](docs/DECISIONS.md) sobre por qué Contactos usa la misma visibilidad abierta ya establecida desde Fase 008 (no una restricción nueva por agente), mientras que Pólizas sí respeta el scoping real por agente ya existente.

### Historial y auditoría

Cada contacto y cada póliza tienen una pestaña/sección "Historial" — timeline de eventos generados automáticamente por el sistema (crear/actualizar/cancelar una póliza, agregar un miembro, actualizar el hogar, registrar un pago, etc.), con filtros por categoría y "Ver cambios" (antes/después). Distinto de Notas (texto manual del agente). Detalle completo en [docs/AUDIT_TRAIL.md](docs/AUDIT_TRAIL.md), incluyendo qué se audita, qué nunca se guarda en claro (montos financieros, credenciales, contenido de notas/medicamentos) y las reglas de autorización (ASSISTANT nunca ve eventos de Comisiones).

### Pólizas de salud

`HealthPolicyDetail` es una extensión 1:1 de `Policy`, solo para pólizas con producto de tipo Salud. No se crea automáticamente al crear la póliza — desde `/policies/[id]` aparece la sección "Información del plan de salud" con un botón para agregarla cuando todavía no existe.

- Marketplace (Application ID, estado de 2 letras), nombre del plan (snapshot histórico, editable pero no se resincroniza si el producto cambia de nombre después), financiero de Marketplace (crédito fiscal, ingreso utilizado) y cost sharing (deducibles y out-of-pocket individual/familiar).
- **`incomeUsed` y `taxCreditAmount` son información financiera personal sensible.** ASSISTANT nunca los ve ni puede modificarlos — el servidor los omite de la respuesta y rechaza cualquier intento de escritura, no es solo un campo oculto en el formulario. Ver [docs/SECURITY.md](docs/SECURITY.md).
- Nunca aparece en listados generales de pólizas — solo se consulta explícitamente desde el detalle de una póliza de Salud.
- **Tipo de cobertura**: cada póliza de Salud se clasifica explícitamente como Marketplace o Privada (`Policy.healthCoverageSource`) al crearla — nunca se infiere del nombre de la compañía, porque un mismo carrier puede vender ambos tipos.

### Medicamentos y proveedores/médicos preferidos

Desde la tab "Salud" de un contacto (siempre visible, incluso sin pólizas de Salud): "+ Agregar medicamento" (nombre obligatorio, dosis/frecuencia/notas opcionales) y "+ Agregar proveedor" (tipo PCP/Especialista/Otro, nombre obligatorio, especialidad/teléfono/organización/notas opcionales). Viven en `Person`, nunca en `Policy` — persisten aunque el cliente cambie de póliza. "Eliminar" un medicamento lo desactiva (conserva el historial); "Eliminar" un proveedor sí lo borra. Mismo control de acceso que editar cualquier otro dato del contacto (ver [docs/SECURITY.md](docs/SECURITY.md)). Catálogo de medicamentos/posologías queda explícitamente diferido — V1 es manual.

### Identidad sensible (SSN, información migratoria)

Tab "Identidad" en Contact Detail: categoría migratoria, SSN, USCIS/A-Number y documentos migratorios (tarjeta de residente permanente, EAD, otro). SSN/USCIS/A-Number/número de documento se guardan **cifrados y recuperables** (AES-256-GCM, nunca hash) y se muestran **enmascarados por defecto** (`***-**-6789`) — un botón "Mostrar" los revela bajo demanda (con "Copiar" para pegarlos en Marketplace/Get Covered), y "Ocultar"/recargar la página vuelve a enmascarar. Editar nunca precarga el valor completo — solo "Reemplazar".

- **Autorización más estricta que el resto del contacto**: ADMIN y AGENT-con-acceso pueden registrar/editar/revelar/copiar; **ASSISTANT solo puede ver los valores enmascarados, nunca revelar nada de este módulo** (ni siquiera cambiar la categoría migratoria) — un usuario que puede abrir un contacto no necesariamente puede descifrar sus identificadores. Ver [docs/SENSITIVE_PII.md](docs/SENSITIVE_PII.md).
- **`ImmigrationCategory` es información administrativa, nunca una conclusión legal** — el CRM no determina estatus migratorio ni elegibilidad de Marketplace/subsidio/Medicaid a partir de este campo.
- Cada "Mostrar"/reemplazo/eliminación queda auditado en el Historial del contacto, **nunca con el valor en claro** — ver [docs/AUDIT_TRAIL.md](docs/AUDIT_TRAIL.md).
- Nunca aparece en Búsqueda global ni en ningún CSV exportado (ver [docs/SECURITY.md](docs/SECURITY.md)).

Detalle completo: [docs/SENSITIVE_PII.md](docs/SENSITIVE_PII.md).

### Documentos de póliza

Desde el detalle de una póliza, sección "Documentos": subir/ver/descargar/eliminar archivos (resumen del plan, brochure, listado de medicamentos, directorio de proveedores, tarjeta/ID, solicitud, otro).

- **El binario nunca se guarda en PostgreSQL** — solo metadata. En desarrollo se almacena localmente fuera de `/public`; producción requiere un adapter de almacenamiento compatible con S3 (S3, Cloudflare R2, Backblaze B2, etc.), todavía no contratado ni implementado — solo la interfaz está lista.
- **Nunca hay una URL pública permanente.** La descarga siempre pasa por una ruta protegida que vuelve a verificar que el usuario tiene acceso a esa póliza.
- **Tipos permitidos: PDF, PNG, JPG/JPEG, WEBP** (máx. 15MB), verificados por el contenido real del archivo (firma binaria), no por la extensión ni por lo que declare el navegador — un ejecutable renombrado a `.pdf` se rechaza.
- **No es información financiero-restringida como Comisiones** — ASSISTANT puede administrar documentos en cualquier póliza a la que ya tenga acceso.

Detalle de seguridad: [docs/SECURITY.md](docs/SECURITY.md).

### Comisiones

`CommissionExpectation` (cuánto se espera recibir por una póliza en un período/mes) y `CommissionPayment` (pagos, chargebacks y ajustes reales) son entidades distintas — el total recibido y la diferencia **nunca se almacenan**, siempre se calculan a partir de `SUM(CommissionPayment.amount)`.

- **Período es siempre el primer día del mes** (`2026-08-01` = agosto 2026); la UI trabaja con un selector de mes/año, nunca una fecha arbitraria.
- **Convención de signo**: al registrar un pago, el usuario escribe montos "amigables" (positivos). Un `Pago` se guarda positivo, un `Chargeback` se guarda automáticamente negativo (el servidor invierte el signo), y solo un `Ajuste` acepta signo explícito (positivo o negativo), pero nunca 0.
- **Estado mostrado es siempre derivado, nunca guardado**: Pendiente / Parcial / Pagada / Sobrepagada / Saldo negativo (según la relación entre lo esperado y lo recibido), además de Cancelada y dos casos especiales cuando lo esperado es $0.
- **Nunca se borra ni se reescribe un pago ya registrado.** Cualquier corrección se hace con un `Ajuste` nuevo, preservando el historial completo de movimientos.
- **Cancelar una comisión esperada no la borra** — solo bloquea nuevos movimientos; los ya registrados siguen visibles.
- **ASSISTANT no tiene ningún acceso a este módulo** (ni en el menú, ni navegando directamente a `/commissions` — recibe un 403). AGENT ve en solo lectura las comisiones de pólizas a las que ya tiene acceso. Solo ADMIN crea/edita/cancela expectativas y registra movimientos. Ver [docs/SECURITY.md](docs/SECURITY.md).
- Nunca aparece en Contactos, Hogares, Tareas, Cumpleaños ni el listado general de Pólizas — solo en `/commissions`, el detalle de una comisión, o la sección "Comisiones" (oculta para ASSISTANT) del detalle de una póliza.

**Reglas de comisión (`CommissionRule`)**: capa opcional que describe *cómo* se calcula una comisión (monto fijo o porcentaje, sobre qué base — prima mensual, prima anualizada, por miembro cubierto o fijo —, periodicidad, y un residual opcional desde un año de póliza determinado), configurada desde **Configuración → Productos** o como excepción sobre una póliza específica. Desde el detalle de una póliza, "Generar expectativa" crea la `CommissionExpectation` de un mes concreto a partir de la regla aplicable — nunca genera un rango abierto, y generar dos veces el mismo período no duplica. Cambiar una regla nunca reescribe expectativas ya generadas. Administrar reglas es exclusivo de ADMIN (más estricto que el resto de Comisiones, donde AGENT sí tiene lectura).

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) y [docs/SECURITY.md](docs/SECURITY.md).

### Conciliación de comisiones (`/commissions/reconciliation`)

Compara `CommissionExpectation` (lo esperado) contra pagos reales reportados por agencias/uplines. ADMIN-only: subir un reporte (CSV/XLSX), revisar la vista previa, emparejar filas ambiguas/sin emparejar manualmente, y confirmar la aplicación — nunca se cargan pagos automáticamente al subir el archivo. Único adaptador implementado: **Orange/Oscar** (`RECEIVED = columna Subtotal, nunca Total` — la Asistencia es un proceso separado). Idempotente: subir el mismo reporte dos veces nunca duplica pagos. Detalle completo: [docs/COMMISSION_RECONCILIATION.md](docs/COMMISSION_RECONCILIATION.md).

### Exportación CSV

Botón "Exportar CSV" en Contactos, Pólizas, Comisiones y el Reporte de clientes — siempre acotado a lo que el usuario ya puede ver en el listado (ASSISTANT nunca exporta Comisiones). Nunca incluye SSN, USCIS/A-Number, número de documento, datos bancarios, credenciales, contenido de documentos ni texto de notas/medicamentos. Ver [docs/SECURITY.md](docs/SECURITY.md).

### Reportes (`/reports`)

Menú "Reportes" con acceso a Clientes, Pólizas y Comisiones — Pólizas y Comisiones reutilizan sus listados existentes (ya sirven como reporte); **Clientes** (`/reports/clients`) es una vista operativa nueva de cartera, distinta del listado básico de Contactos: filtros por estado, agente asignado, ubicación (estado/ciudad/condado/ZIP), categoría migratoria, póliza activa/tipo/compañía, asistencia de pago y "vencen en 30 días"; columnas de hogar, pólizas activas, última actividad; paginación 25/50/100; exporta CSV respetando los filtros seleccionados. Cada fila enlaza al Contact Detail real — el reporte nunca duplica esa información, solo la resume para filtrar/exportar. Nunca incluye SSN/USCIS/A-Number/número de documento — solo la categoría migratoria. Detalle: [docs/DECISIONS.md](docs/DECISIONS.md).

### Primas / Seguimiento de pago

No existe ninguna entidad de pagos: este módulo gestiona directamente 6 campos ya existentes de `Policy` (`premiumAmount`, `billingFrequency`, `nextPaymentDueDate`, `autopay`, `needsPaymentAssistance`, `paymentStatus`). Representa **únicamente el estado actual / próximo pago** — nunca un historial de pagos, recibos, pagos parciales ni conciliación.

- **`PaymentStatus` real solo tiene tres valores**: Al día (`CURRENT`), Por vencer (`DUE`), Vencido (`PAST_DUE`) — no existe un valor "Pagado" separado; "Marcar al día" es la acción equivalente.
- **"Vencida" se calcula, nunca se guarda**: una póliza con `nextPaymentDueDate` en el pasado se marca vencida, salvo que su estado ya sea "Al día" — un hecho de negocio confirmado pesa más que una fecha potencialmente desactualizada.
- **Marcar un estado nunca avanza automáticamente `nextPaymentDueDate`.** El sistema no asume ningún calendario de facturación del carrier — el usuario ajusta la próxima fecha manualmente desde "Editar seguimiento de pago" cuando corresponda.
- **`needsPaymentAssistance` se destaca visualmente** ("Requiere asistencia") y tiene su propio filtro en `/premiums` — corresponde al mismo indicador que ya se usaba en el Excel anterior del negocio.
- **ASSISTANT tiene acceso completo a este módulo** (ver y editar), a diferencia de Comisiones — es seguimiento operativo del cobro al cliente, no comisión del agente. AGENT ve/edita solo pólizas dentro de su acceso; ADMIN acceso total. Ver [docs/SECURITY.md](docs/SECURITY.md).
- Nunca aparece con datos de Comisiones ni de Salud — solo los 6 campos propios de seguimiento de pago.

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) y [docs/SECURITY.md](docs/SECURITY.md).

### Administración de usuarios

**Configuración → Usuarios** (`/settings/users`, solo ADMIN): listar, crear (nombre, correo, rol) y activar/desactivar usuarios. Un AGENT/ASSISTANT sigue siendo simplemente un `User` con ese rol — nunca una entidad separada.

- **Al crear un usuario, se genera una contraseña temporal que se muestra en pantalla exactamente una vez** — el ADMIN debe copiarla y compartirla por un canal seguro fuera del CRM (envío automático por correo queda pendiente, requiere configurar un proveedor de email). Nunca se vuelve a mostrar ni se guarda en texto plano.
- **No se puede desactivar al único administrador activo** — evita dejar el CRM sin nadie con acceso administrativo.
- **"Ver actividad" (por fila de usuario, solo ADMIN)** muestra el historial de `AuditEvent` generados por ESE usuario (`actorUserId`), más reciente primero, paginado — misma redacción/allowlist que el resto del Historial, nunca el JSON crudo.

Detalle de seguridad: [docs/SECURITY.md](docs/SECURITY.md).

### Identidad visual

Colores de marca extraídos directamente del logo real de TuPlanSeguro USA (azul `#0070AA`, verde `#00A660`, naranja `#FF7F13` — este último usado con moderación, nunca como fondo dominante de un componente). Centralizados como variables CSS de marca en `src/app/globals.css`, sobre las que se remapean los tokens de shadcn/ui existentes — ningún componente hardcodea un color de marca directamente.

### Dashboard

`/dashboard` reemplaza el placeholder de bienvenida — responde "¿qué necesita mi atención hoy?", no es un reporte ejecutivo. No implementa ninguna regla propia: compone datos de los módulos existentes (Tareas, Primas/Pagos, Cumpleaños, Pólizas, Comisiones).

- **Hoy**: tareas de hoy, tareas vencidas, pagos vencidos, pólizas que requieren asistencia — cada número es clickeable hacia su listado ya filtrado (`/tasks?dueToday=true`, `/premiums?overdueOnly=true`, etc.).
- **Tareas prioritarias**: hasta 5, ordenadas vencidas primero, luego por prioridad (Urgente > Alta > Normal > Baja), luego por fecha más cercana.
- **Primas y pagos**: vencidas, vencen hoy, próximos 7 días, y una lista corta de los casos más urgentes (sin datos bancarios).
- **Cumpleaños**: hoy y próximos (máx. 5), con estado de felicitación — no envía ningún mensaje desde el Dashboard.
- **Cartera**: pólizas activas y pendientes. Sin KPI de "Renovaciones" — no existe `renewalDate` en el schema y `previousPolicyId` no es suficiente para calcularlas de forma confiable.
- **Comisiones ("Dinero")**: solo ADMIN/AGENT (según su alcance). **ASSISTANT no recibe esta sección en absoluto** — ni siquiera se consulta el servicio de Comisiones para ese rol. Distingue "sin comisiones registradas este mes" de "el monto esperado realmente es $0".
- Sin gráficos, sin Activity Feed, sin auto-refresh/polling — recargar la página trae datos frescos.

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) y [docs/SECURITY.md](docs/SECURITY.md).

UI construida con [shadcn/ui](https://ui.shadcn.com) (preset `base-nova`, sobre [Base UI](https://base-ui.com), no Radix — los componentes que envuelven un `<Link>` u otro elemento no-botón usan `render={<Link ... />}` + `nativeButton={false}`, no `asChild`).

### Importación de datos legacy

Pipeline de migración controlada del Excel histórico de TuPlanSeguro USA — no forma parte de la aplicación web, vive en `src/import/` y se ejecuta manualmente:

```bash
# Dry run (por defecto, nunca escribe nada):
npm run import:legacy -- --file "C:\ruta\al\archivo.xlsx"

# Aplicar de verdad (requiere ambos flags):
npm run import:legacy -- --file "C:\ruta\al\archivo.xlsx" --apply --confirm
```

- El workbook real y el reporte generado **nunca se commitean** (`.gitignore` excluye `*.xlsx`/`*.xls`, `/private-imports/`, `import-report*.json`).
- Nunca importa SSN, datos bancarios/tarjeta completos, credenciales de aseguradoras, ni ficha médica (diferida a una fase futura explícita).
- Person nunca se duplica por tener varias pólizas — matching con niveles de confianza (STRONG/MEDIUM/WEAK), nunca fusión automática por coincidencia débil.
- Sin `legacyImportId` en el schema — la idempotencia se logra re-resolviendo cada entidad contra el estado real de la base de datos en cada `--apply` (correr el import dos veces no duplica nada).

Detalle completo del pipeline, mappings e inventario del workbook: [docs/IMPORTING_LEGACY_DATA.md](docs/IMPORTING_LEGACY_DATA.md).

## Tests

```bash
npm run test
```

Corren contra el PostgreSQL local real (igual que las migraciones — sin mocks de Prisma). Requiere que `docker compose up -d` esté corriendo.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
