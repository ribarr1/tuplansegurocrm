This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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

El login usa email + contraseña (Better Auth), con sesiones respaldadas por base de datos. No hay registro público — el primer usuario ADMIN se crea con un script de bootstrap.

### Crear el primer administrador local

```bash
npm run create-admin
```

Pide nombre, correo y contraseña por terminal (contraseña oculta, mínimo 10 caracteres). También puedes pasarlos por variable de entorno de proceso, sin escribirlos en ningún archivo:

```bash
ADMIN_NAME="Tu Nombre" ADMIN_EMAIL="tu@correo.com" ADMIN_PASSWORD="una-contraseña-segura" npm run create-admin
```

El script rechaza correos duplicados o inválidos y contraseñas demasiado cortas, y usa la misma lógica de hash que el resto de la aplicación (no reinventa criptografía).

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

## Capa de servicios

La lógica de negocio vive en `src/services/*.service.ts`, no directamente en páginas/Route Handlers. Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para el flujo completo (UI → autorización → servicio → Prisma).

## Rutas del CRM

| Ruta | Descripción |
|---|---|
| `/login` | Login (email + contraseña) |
| `/dashboard` | Placeholder — bienvenida y acceso a Contactos |
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
| `/settings` | Configuración: acceso a Compañías y Productos |
| `/settings/carriers` | Lista de compañías; crear/editar/activar-desactivar (solo ADMIN) |
| `/settings/products` | Lista de productos: filtro por compañía/tipo/estado; crear/editar/activar-desactivar (solo ADMIN) |
| `/contacts/[id]?tab=tareas` | Tab "Tareas": tareas de la persona |
| `/tasks` | Lista de tareas: vistas rápidas (Hoy, Vencidas, Pendientes, Completadas) + filtros |
| `/tasks/new?personId=<id>` / `?policyId=<id>` | Nueva tarea (contexto de contacto/póliza preseleccionado) |
| `/tasks/[id]` | Detalle de tarea: completar, cancelar, editar |
| `/tasks/[id]/edit` | Editar tarea (reabrir una tarea completada/cancelada requiere ADMIN) |
| `/birthdays` | Cumpleaños: vistas rápidas (Hoy, Este mes, Próximos, Todos), marcar enviada/omitida |
| `/commissions` | Lista de comisiones esperadas: búsqueda, filtro por período/agente/compañía/estado, paginación (ASSISTANT: sin acceso) |
| `/commissions/new?policyId=<id>` | Nueva comisión esperada (solo ADMIN, desde el detalle de una póliza) |
| `/commissions/[id]` | Detalle de comisión: montos, movimientos, editar/registrar pago/cancelar (solo ADMIN); AGENT ve la misma información en solo lectura |

No existe eliminación de contactos, pólizas, compañías, productos ni tareas (no hay borrado físico en el CRM — las tareas se cierran con estado `COMPLETED`/`CANCELLED`, el resto se retira con `isActive`/`inactivo`). La única excepción es "Restablecer felicitación" (solo ADMIN), que sí borra el registro anual de `BirthdayGreeting` — es un tracking, no una entidad de negocio con historial (ver docs/DECISIONS.md).

### Tareas / Seguimiento

`Task` es la base operativa del CRM ("¿qué tengo que hacer hoy?"). Puede vincularse a un `Person`, a una `Policy`, a ambas, o a ninguna (tarea general/administrativa).

- **"Vencida" no es un estado guardado** — se deriva de `dueAt` en el pasado + estado todavía activo (`OPEN`/`IN_PROGRESS`). Una tarea completada o cancelada nunca aparece como vencida, aunque su fecha ya haya pasado.
- **Responsable (`assignedToId`)**: un AGENT siempre queda asignado a sí mismo al crear una tarea y nunca puede reasignarla — ADMIN y ASSISTANT pueden asignar a cualquier agente activo o dejarla sin asignar.
- **Reabrir una tarea completada o cancelada requiere ADMIN.**
- La fecha/hora de vencimiento se interpreta según `APP_TIME_ZONE` (ver arriba), no la zona horaria del proceso — corregido en Fase 015.

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

### Pólizas de salud

`HealthPolicyDetail` es una extensión 1:1 de `Policy`, solo para pólizas con producto de tipo Salud. No se crea automáticamente al crear la póliza — desde `/policies/[id]` aparece la sección "Información del plan de salud" con un botón para agregarla cuando todavía no existe.

- Marketplace (Application ID, estado de 2 letras), nombre del plan (snapshot histórico, editable pero no se resincroniza si el producto cambia de nombre después), financiero de Marketplace (crédito fiscal, ingreso utilizado) y cost sharing (deducibles y out-of-pocket individual/familiar).
- **`incomeUsed` y `taxCreditAmount` son información financiera personal sensible.** ASSISTANT nunca los ve ni puede modificarlos — el servidor los omite de la respuesta y rechaza cualquier intento de escritura, no es solo un campo oculto en el formulario. Ver [docs/SECURITY.md](docs/SECURITY.md).
- Nunca aparece en listados generales de pólizas — solo se consulta explícitamente desde el detalle de una póliza de Salud.

### Comisiones

`CommissionExpectation` (cuánto se espera recibir por una póliza en un período/mes) y `CommissionPayment` (pagos, chargebacks y ajustes reales) son entidades distintas — el total recibido y la diferencia **nunca se almacenan**, siempre se calculan a partir de `SUM(CommissionPayment.amount)`.

- **Período es siempre el primer día del mes** (`2026-08-01` = agosto 2026); la UI trabaja con un selector de mes/año, nunca una fecha arbitraria.
- **Convención de signo**: al registrar un pago, el usuario escribe montos "amigables" (positivos). Un `Pago` se guarda positivo, un `Chargeback` se guarda automáticamente negativo (el servidor invierte el signo), y solo un `Ajuste` acepta signo explícito (positivo o negativo), pero nunca 0.
- **Estado mostrado es siempre derivado, nunca guardado**: Pendiente / Parcial / Pagada / Sobrepagada / Saldo negativo (según la relación entre lo esperado y lo recibido), además de Cancelada y dos casos especiales cuando lo esperado es $0.
- **Nunca se borra ni se reescribe un pago ya registrado.** Cualquier corrección se hace con un `Ajuste` nuevo, preservando el historial completo de movimientos.
- **Cancelar una comisión esperada no la borra** — solo bloquea nuevos movimientos; los ya registrados siguen visibles.
- **ASSISTANT no tiene ningún acceso a este módulo** (ni en el menú, ni navegando directamente a `/commissions` — recibe un 403). AGENT ve en solo lectura las comisiones de pólizas a las que ya tiene acceso. Solo ADMIN crea/edita/cancela expectativas y registra movimientos. Ver [docs/SECURITY.md](docs/SECURITY.md).
- Nunca aparece en Contactos, Hogares, Tareas, Cumpleaños ni el listado general de Pólizas — solo en `/commissions`, el detalle de una comisión, o la sección "Comisiones" (oculta para ASSISTANT) del detalle de una póliza.

Detalle de diseño y política de acceso: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) y [docs/SECURITY.md](docs/SECURITY.md).

UI construida con [shadcn/ui](https://ui.shadcn.com) (preset `base-nova`, sobre [Base UI](https://base-ui.com), no Radix — los componentes que envuelven un `<Link>` u otro elemento no-botón usan `render={<Link ... />}` + `nativeButton={false}`, no `asChild`).

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
