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
| `/settings` | Configuración: acceso a Compañías y Productos |
| `/settings/carriers` | Lista de compañías; crear/editar/activar-desactivar (solo ADMIN) |
| `/settings/products` | Lista de productos: filtro por compañía/tipo/estado; crear/editar/activar-desactivar (solo ADMIN) |

Tareas, Comisiones y Cumpleaños aparecen en la navegación pero deshabilitados — no tienen módulo todavía. No existe eliminación de contactos, pólizas, compañías ni productos (no hay borrado físico en el CRM — todo se retira con un estado `isActive`/`inactivo`).

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
