# Arquitectura

Documento breve. Describe el flujo de una operación y qué capa hace qué — no es un manual exhaustivo.

## Flujo de una operación

```
UI (Client Component)
  ↓  fetch / Server Action (futuro)
Server Action / Route Handler        ← resuelve identidad
  ↓
requireSessionUser() / requireSessionRole(...)   [src/lib/authorization.ts]
  ↓  produce un "actor" (AuthorizedUser) ya verificado
Service                              [src/services/*.service.ts]
  ↓  valida input (Zod) + aplica reglas de negocio/permisos sobre ese actor
Prisma                               [src/lib/prisma.ts]
  ↓
PostgreSQL
```

Para páginas/Server Components que solo necesitan proteger una ruta (sin llamar un servicio), se usa `requireUser()`/`requireRole()` directamente — ver `src/app/dashboard/page.tsx`.

## Por qué la autorización está partida en dos

1. **Identidad** (¿quién eres, y estás activo?) se resuelve **una sola vez**, justo antes de invocar el servicio, con `requireSessionUser()`/`requireSessionRole()`. Producen un `AuthorizedUser` ya verificado contra Prisma en ese instante — nunca se construye a mano a partir de datos del cliente.
2. **Permiso sobre la operación concreta** (ej. "¿puede este AGENT editar esta Person en particular?") vive **dentro del servicio**, usando el `actor` recibido. Cada función de servicio exige `actor: AuthorizedUser` como primer parámetro obligatorio.

Esto evita que una regla de negocio sensible se salte por reutilizar un servicio desde un lugar nuevo que "se olvidó" de comprobar el rol antes de llamarlo — la regla vive en el propio servicio, no en el llamador.

## Qué NO debe importar Prisma directamente

- **Client Components** (`"use client"`) — nunca. `src/lib/prisma.ts`, `src/services/*` y `src/lib/authorization.ts` usan `import "server-only"` precisamente para que un import accidental desde un Client Component falle en build, no en producción.
- **Páginas/Route Handlers** no deberían llamar `prisma.*` directamente para operaciones de negocio — deben pasar por un servicio. Se acepta Prisma directo únicamente para lecturas triviales de infraestructura (ninguna todavía en el proyecto).

## Errores de aplicación

`src/services/errors.ts` — `AppError` con `code` (`UNAUTHORIZED` | `FORBIDDEN` | `NOT_FOUND` | `VALIDATION_ERROR` | `CONFLICT`) y `statusCode` ya resuelto. Los servicios lanzan `AppError` para casos previsibles; nunca dejan escapar errores crudos de Prisma (SQL, nombres de constraint, stack traces) hacia el usuario.

## Validación

Zod, en `src/schemas/*.schema.ts`. Los servicios validan el input **antes** de tocar Prisma, usando `parseOrThrow()` (`src/services/errors.ts`), que traduce un error de Zod a `AppError("VALIDATION_ERROR", ...)`. No se duplican validaciones que PostgreSQL ya garantiza (unicidad, FKs, CHECK).

## Transacciones

`createPerson`/`updatePerson` (single-entity) no usan `$transaction` — no hay necesidad real. Cuando una operación futura deba crear/modificar múltiples entidades de forma atómica (ejemplo: `Household` + `HouseholdMember`s + `Policy` en un solo flujo), usar `prisma.$transaction([...])` (forma de array, para operaciones independientes entre sí) o `prisma.$transaction(async (tx) => {...})` (forma interactiva, cuando una operación depende del resultado de la anterior dentro de la misma transacción).

## Logging

Sin sistema de logging todavía. Regla mientras tanto: nunca loggear password, `BETTER_AUTH_SECRET`, contenido de `PersonMedication`/`PersonProvider.notes`, montos/datos financieros sensibles, ni objetos Prisma completos. Errores técnicos pueden loggearse server-side de forma sanitizada (mensaje + código, no el objeto de error crudo de Prisma).

## Multi-tenancy

No implementado ni planeado. TuPlanSeguro USA es una sola agencia — no hay `tenantId` en ninguna tabla, y no se anticipa esa necesidad.

## Tests

Vitest, contra el PostgreSQL local real (mismo patrón usado en cada migración: sin mocks de Prisma). `server-only` se alias a un no-op en `vitest.config.mts` porque ese paquete lanza intencionalmente fuera del compilador de Next.js. Los tests de servicio construyen el `actor` directamente (sin pasar por sesión real); un test separado (`src/lib/authorization.test.ts`) prueba la resolución de sesión real usando `auth.api.signInEmail`.
