# Arquitectura

Documento breve. Describe el flujo de una operación y qué capa hace qué — no es un manual exhaustivo.

## Flujo de una operación

```
UI (Client Component: formulario)
  ↓  <form action={...}> (useActionState)
Server Action                        [src/app/(app)/contacts/actions.ts]
  ↓
requireSessionUser() / requireSessionRole(...)   [src/lib/authorization.ts]
  ↓  produce un "actor" (AuthorizedUser) ya verificado
Service                              [src/services/*.service.ts]
  ↓  valida input (Zod) + aplica reglas de negocio/permisos sobre ese actor
Prisma                               [src/lib/prisma.ts]
  ↓
PostgreSQL
```

Para páginas/Server Components que solo leen datos (sin mutación), se llama al servicio **directamente desde el Server Component** — no hace falta una Server Action para una lectura en el render inicial. Ejemplo: `src/app/(app)/contacts/page.tsx` llama `listPeople(actor, ...)` directo. Las Server Actions existen específicamente para mutaciones disparadas desde un Client Component (formularios) — ver `src/app/(app)/contacts/actions.ts`.

Para páginas/Server Components que solo necesitan proteger una ruta sin llamar un servicio, se usa `requireUser()`/`requireRole()` directamente — ver `src/app/(app)/dashboard/page.tsx`. Toda el área protegida comparte un layout común: `src/app/(app)/layout.tsx` llama `requireUser()` una vez y renderiza el shell (sidebar + header); `src/proxy.ts` solo hace una redirección optimista (existencia de cookie) antes de eso.

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

Los flujos que dependen del servidor Next.js real corriendo (protección de rutas por proxy/layout, formularios completos con Server Action, permisos reflejados en la UI) se verifican con el servidor de desarrollo levantado (`npm run dev`) — mismo patrón manual usado en la Fase 007 para Auth, no Playwright (no instalado, sin necesidad real todavía).

## CRM Shell + Contactos — Fase 009

- **Shell:** `src/app/(app)/layout.tsx` (protegido) + `src/components/shell/*` (`Sidebar`, `Header`, `MobileNav`, `UserMenu`, `NavContent`). Navegación centralizada en `src/components/shell/nav-items.ts` — un módulo sin implementar se marca `enabled: false` ahí y aparece deshabilitado en la UI, nunca como una página que finja funcionar.
- **UI library:** [shadcn/ui](https://ui.shadcn.com), preset `base-nova`, construido sobre **Base UI** (no Radix). Composición polimórfica usa `render={<Elemento />}` en vez de `asChild` + hijo — ej. `<Button render={<Link href="..." />}>Texto</Button>`. Cuando el elemento renderizado no es un `<button>` real (como `Link`), se agrega `nativeButton={false}` — de lo contrario Base UI emite un warning de accesibilidad en consola.
- **Contactos es el primer (y único) módulo funcional.** `listPeople`/`getPersonById`/`createPerson`/`updatePerson` (Fase 008) alimentan `/contacts`, `/contacts/[id]`, `/contacts/new`, `/contacts/[id]/edit`. Sin `deletePerson` — no hay eliminación física de contactos en el CRM.
- **Búsqueda/filtro/paginación viven en la URL** (`?q=&status=&page=`), no en estado de cliente — el formulario de filtro es un `<form method="GET">` nativo, sin JavaScript necesario para funcionar.
- **`assignedAgentId` en los formularios:** el `<select>` de agente solo se renderiza para ADMIN (`showAgentSelect = actor.role === "ADMIN"`) — AGENT/ASSISTANT ni lo ven, para no sugerir un control que la política del servicio va a ignorar de todas formas. La UI es conveniencia, nunca la autoridad: `people.service.ts` aplica la política igual si alguien arma el POST a mano.
- **`canEditPerson` (people.service.ts) es la misma función que decide si `/contacts/[id]/edit` muestra el formulario o "no tienes permiso".** No hay una segunda copia de la regla en la UI — si se relaja o endurece la política de edición, cambia en un solo lugar.
- **Errores de formulario en español, nunca el texto crudo de Zod.** Los `.min()`/`.email()`/etc. en `src/schemas/person.schema.ts` llevan mensaje explícito (ej. `"El teléfono debe tener al menos 7 caracteres."`) — sin esto, el usuario vería el mensaje interno en inglés de Zod tal cual.
- **`ContactForm` repite los valores enviados tras un error** (`state.values`, `src/app/(app)/contacts/form-helpers.ts`) y usa un `key` en el `<form>` para forzar remount. React 19 limpia los campos no controlados de un formulario al terminar una Server Action — sin este mecanismo, un error de validación borraría lo que el usuario ya había escrito.
- **`formDataToPersonInput`/`toFormState` viven en `form-helpers.ts`, no en `actions.ts`.** Un archivo `"use server"` solo puede exportar funciones `async` — separar la lógica pura permite probarla con Vitest sin esa restricción.

## Household / Familia — Fase 010

- **Vive dentro del perfil de contacto, no como módulo propio.** El tab "Familia" de `/contacts/[id]` (`src/app/(app)/contacts/[id]/family-tab.tsx`) es la única superficie de UI — no hay una ruta `/households` independiente en esta fase.
- **`households.service.ts`** expone `getHouseholdsForPerson`, `getHouseholdById`, `createHouseholdWithInitialMember`, `addHouseholdMember`, `removeHouseholdMember`, `updateHouseholdMemberRole`, `createPersonAndAddToHousehold` — mismo patrón que `people.service.ts`: `actor: AuthorizedUser` como primer parámetro obligatorio, `select` explícito sin datos médicos/financieros, `AppError` para todo caso previsible (`NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION_ERROR`).
- **`createHouseholdWithInitialMember` y `createPersonAndAddToHousehold` usan `prisma.$transaction(async (tx) => {...})`** — primer caso real en el proyecto de la forma interactiva mencionada en la sección "Transacciones" arriba (cada paso depende del anterior: crear el hogar/persona y enlazar la membresía deben ocurrir juntos o no ocurrir).
- **Server Actions** en `src/app/(app)/contacts/household-actions.ts` — mismo patrón que `contacts/actions.ts`: llaman `requireSessionUser()`, delegan toda regla de negocio al servicio, traducen `AppError` a `HouseholdFormState` (`household-form-helpers.ts`), y hacen `revalidatePath('/contacts/[id]')` tras cada mutación. `searchPeopleAction` reutiliza `listPeople` (Fase 008) — no hay un segundo servicio de búsqueda de personas.
- **La UI de un hogar se renderiza de forma independiente en el perfil de cada uno de sus miembros.** No existe una vista "canónica" única de `Household` — al abrir el tab Familia de cualquier persona del hogar se consulta y renderiza esa misma entidad vía `getHouseholdsForPerson`. Consecuencia observada en pruebas manuales: una mutación hecha desde el perfil de la Persona A revalida solo `/contacts/[A]`; el perfil de la Persona B (mismo hogar) muestra los datos actualizados en su próxima carga de servidor (no requiere acción adicional, pero no es una revalidación "en vivo" cross-perfil).

## Pólizas — Fase 011

- **`policies.service.ts`** expone `listPolicies`, `getPolicyById`, `getPoliciesForPerson`, `createPolicy`, `updatePolicy` (sin `deletePolicy`), más `listActiveCarriers`/`listActiveProducts` como catálogo de solo lectura — mismo patrón que el resto de servicios (`actor` primero, `select` explícito sin datos de salud/comisiones, `AppError` para todo caso previsible).
- **`createPolicy` es una transacción** (`Policy` + `PolicyMember`(s)): si cualquier miembro falla (ej. FK inválida), toda la póliza se revierte — nunca queda una `Policy` sin sus miembros o a medias.
- **Autorización de Policy reutiliza el mismo criterio que `Household` (Fase 010), aplicado a "titular + miembros cubiertos" en vez de "miembros del hogar".** ADMIN/ASSISTANT sin restricción; AGENT necesita acceso (sin asignar o asignado a sí mismo) a AL MENOS UNA persona involucrada (titular o algún miembro cubierto). `listPolicies`/`getPoliciesForPerson` aplican ese mismo filtro a nivel de `where`, no solo como guard post-consulta — un AGENT nunca ve en la lista una póliza fuera de su acceso.
- **El navegador nunca decide `policyType`/`carrier` de una póliza.** El formulario los usa únicamente para filtrar qué `Product` mostrar en el `<select>`; solo `productId` viaja al servidor, que vuelve a consultar `Product → Carrier` — igual que la regla ya establecida para `Policy.product` en el schema.
- **`/policies/new` usa la URL como estado, igual que `/contacts` y `/contacts/[id]/edit`:** el titular (`?holderId=`), el filtro de tipo/compañía (`?policyType=&carrierId=`) y la búsqueda de titular (`?holderSearch=`) son query params — cambiar de titular o filtrar productos es una navegación (`GET`), no estado de cliente. Solo el envío final (crear la póliza) es un `POST`/Server Action.
- **Los candidatos a "miembro cubierto" en el formulario de creación provienen de los hogares del titular** (`getHouseholdsForPerson`), no de una búsqueda global de personas — decisión explícita de mantener el primer flujo simple (ver docs/DECISIONS.md). El servicio, sin embargo, no restringe `coveredMembers` a esos candidatos: valida que cada `personId` exista, igual que cualquier otro input — la lista de candidatos es una conveniencia de UI, no el límite de seguridad real (mismo principio que `showAgentSelect` en Fase 009).
- **`premiumAmount` viaja como string validado por regex (`policy.schema.ts`) en todo el camino UI → Server Action → servicio → Prisma**, nunca como `number` de JavaScript — Prisma acepta un string para un campo `Decimal`, evitando aritmética de punto flotante sobre un monto financiero.
- **La regla "ACTIVE requiere `effectiveDate`" se evalúa dos veces con la misma función (`assertActiveHasEffectiveDate`): en `createPolicy` sobre el input completo, y en `updatePolicy` sobre el estado ya combinado (existente + lo que se está actualizando)** — evita que una edición parcial (ej. solo cambiar `premiumAmount`) deje una póliza `ACTIVE` sin fecha efectiva por accidente.
- **Bug real encontrado en pruebas manuales, corregido antes de cerrar la fase:** en el formulario de edición, tras un error de validación, los checkboxes `autopay`/`needsPaymentAssistance` se re-renderizaban siempre marcados — `state.values` los devuelve como texto ("false") para poder repetirlos en el formulario, y una string no vacía es *truthy* en JavaScript, así que un simple `{...defaultValues, ...state.values}` los volvía todos `true` visualmente aunque el valor real fuera "false". Se corrigió resolviendo esos dos campos aparte con una comparación explícita (`=== "true"`) antes de construir `values`.

## Administración de Carrier/Product — Fase 012

- **`carriers.service.ts` y `products.service.ts`** siguen el mismo esqueleto que el resto de servicios: `actor` primero, `select` explícito, `AppError` para todo caso previsible. Crear/editar/activar-desactivar exige `actor.role === "ADMIN"` (`assertCanManageCarriers`/`assertCanManageProducts`); ver el catálogo está abierto a cualquier usuario activo.
- **`/settings` vive en su propio segmento de ruta**, no anidado bajo `/contacts` ni `/policies` — es administración transversal, no parte del flujo operativo diario. Las páginas de creación/edición (`/settings/carriers/new`, `/settings/products/[id]/edit`, etc.) verifican `actor.role === "ADMIN"` igual que `contacts/[id]/edit` verifica `canEditPerson` — si falla, renderizan un mensaje "no autorizado" en vez de redirigir, mismo patrón ya establecido.
- **Los botones "Activar"/"Desactivar" de las listas son un Client Component pequeño (`toggle-active-button.tsx`) con `useTransition` llamando directamente a una Server Action**, sin pasar por `useActionState`/`<form>` — es una mutación de un solo campo (`isActive`) sin campos que validar/mostrar en un formulario, así que el patrón más pesado de formulario no aporta nada aquí.
- **El formulario de edición de producto deshabilita (`disabled`) los campos bloqueados por uso histórico (`carrierId`/`policyType`/`planYear`) en vez de solo mostrarlos de forma read-only.** Un `<select>`/`<input>` `disabled` no viaja en el `FormData` al enviar — la UI ni siquiera intenta enviar un cambio que el servicio (`products.service.ts::updateProduct`) rechazaría de todas formas. La regla real sigue viviendo exclusivamente en el servicio; el `disabled` es conveniencia, no el límite de seguridad.
- **`policies.service.ts::assertActiveProduct`/`listActiveProducts` ahora también verifican `Product.carrier.isActive`, no solo `Product.isActive`** (cambio de esta fase) — un Carrier desactivado vuelve inelegibles todos sus productos para una póliza nueva sin tener que desactivarlos uno por uno. Las pólizas ya emitidas no se ven afectadas: la regla solo aplica al crear/cambiar de producto, nunca a lo ya guardado.
- **Bug preexistente encontrado durante las pruebas manuales, NO corregido en esta fase (fuera de alcance):** al abrir el menú de usuario (`UserMenu`, `src/components/shell/user-menu.tsx`, construido en la Fase 009) el navegador muestra un error de runtime — "Base UI: MenuGroupContext is missing. Menu group parts must be used within `<Menu.Group>` or `<Menu.RadioGroup>`" en `src/components/ui/dropdown-menu.tsx` (`DropdownMenuLabel`). No se tocó ningún archivo de esa fase en Fase 012; queda documentado para corregirse en una fase futura que toque el shell.
