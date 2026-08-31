# Seguridad

Notas de seguridad específicas del proyecto. No es una política general — solo decisiones concretas que no son obvias a partir del código.

## Autenticación

- **Librería:** [Better Auth](https://www.better-auth.com/), self-hosted, open source (MIT). Elegida sobre Auth.js/NextAuth porque soporta sesiones respaldadas por base de datos junto con el proveedor de email+password — Auth.js solo permite JWT con `CredentialsProvider`, lo cual no permite revocar acceso en tiempo real cuando `User.isActive` cambia. Ver [DECISIONS.md](./DECISIONS.md) para el análisis completo.
- **Password hashing:** scrypt (implementación interna de Better Auth sobre `node:crypto`, sin dependencias nativas). Nunca criptografía propia. El hash vive en `Account.password` — **nunca** en `User` ni en ningún log.
- **Longitud mínima de contraseña:** 10 caracteres (`emailAndPassword.minPasswordLength` en `src/lib/auth.ts`), reforzada también en el script de bootstrap.
- **Sesiones:** cookie `HttpOnly`, `Secure` en producción, `SameSite` por defecto de Better Auth. Nunca tokens de sesión en `localStorage`. Sesiones respaldadas por la tabla `session` (base de datos), no JWT-only.
- **Sin login social todavía** (Google/Facebook/Microsoft) — solo email + password. El modelo `Account` ya soporta múltiples proveedores si se agrega después, sin nueva migración estructural para eso.
- **Sin registro público.** No existe endpoint `/signup` ni flujo de alta abierto. El único mecanismo de creación de usuarios es `npm run create-admin` (ver README.md) para el primer ADMIN; altas posteriores serán una función administrativa dentro del CRM (no implementada todavía).
- **Bootstrap del primer ADMIN:** `scripts/create-admin.ts`. Usa `auth.api.signUpEmail` (la misma lógica de hash/creación que el resto de la app) en vez de reinventar criptografía. Valida email y longitud de password, rechaza duplicados, nunca imprime la contraseña, y no persiste credenciales en ningún archivo — se reciben por variable de entorno de proceso o prompt interactivo con eco oculto.
- **Contraseñas de usuarios locales de prueba deben rotarse después de las pruebas** (o el usuario debe eliminarse si solo era para verificación puntual). Ninguna credencial de prueba se versiona ni se documenta en texto plano en el repositorio — cuando aparece en esta documentación o en el chat de una fase, es exclusivamente para el entorno local del desarrollador, nunca para producción.
- **MFA:** no implementado en esta fase. Better Auth tiene un plugin oficial de TOTP (`better-auth/plugins/two-factor`) — camino claro para agregarlo después sin cambiar de librería.
- **Recuperación de contraseña por email:** no implementada — no hay proveedor de email configurado todavía. La tabla `verification` ya existe (creada por Better Auth) para cuando se agregue ese flujo, sin necesitar otra migración solo para la tabla.
- **Rate limiting de login:** habilitado (`rateLimit.enabled: true` en `src/lib/auth.ts`), storage `"memory"` — suficiente para una sola instancia de servidor (desarrollo/V1). **En producción con más de una instancia**, cambiar a `storage: "database"` o `"secondary-storage"` (ej. Redis) para que el límite se comparta entre procesos; con memoria cada instancia cuenta intentos por separado, debilitando la protección.

## Autorización

- **Server-side, siempre.** `src/lib/authorization.ts` expone `requireUser()`/`requireRole(...roles)` (redirigen, para páginas) y `requireSessionUser()`/`requireSessionRole(...roles)` (lanzan `AppError`, para la capa de servicios — ver `docs/ARCHITECTURE.md`). Todas vuelven a consultar `User.role`/`isActive` en Prisma en cada llamada — nunca confían en los datos de sesión cacheados por Better Auth ni en lo que el cliente envíe (`userId`, `role`, etc. nunca se aceptan desde el request).
- **Cada servicio exige `actor: AuthorizedUser` explícito, nunca lo resuelve internamente.** El único lugar que construye un `AuthorizedUser` legítimo es `requireSessionUser()`/`requireSessionRole()`. La regla de permiso sobre la operación concreta (ej. qué puede editar un AGENT) vive dentro del servicio mismo, no en el llamador — no se puede saltar reutilizando el servicio desde otro lugar sin modificar el servicio.
- **Sin endpoints de prueba dejados en el código.** `/api/admin-check`, creado exclusivamente para verificar `requireRole()` en la Fase 007, se eliminó al iniciar la Fase 008 — no debe quedar como precedente dejar rutas de verificación accesibles.
- **`User.isActive = false` bloquea acceso de inmediato en la siguiente petición protegida**, aunque la cookie de sesión siga siendo técnicamente válida — verificado en pruebas (ver `docs/DECISIONS.md`). No hay revocación instantánea vía WebSocket (no necesaria para V1); el usuario pierde acceso en cuanto hace la siguiente petición a una ruta protegida, típicamente segundos después de la desactivación, no al expirar la sesión.
- **El Proxy (`src/proxy.ts`) hace solo una verificación optimista** (existencia de cookie, sin tocar la base de datos) para redirigir rápido a `/login` — la verificación real (sesión válida + `isActive`) ocurre siempre en `requireUser()`/`requireRole()` dentro de la página o Route Handler. Nunca depender solo del Proxy para proteger datos sensibles.
- **Matriz de roles inicial:** `ADMIN` (acceso total), `AGENT` y `ASSISTANT` (clientes, hogares, pólizas, tareas, cumpleaños; acceso financiero/salud a definir por regla específica cuando se construyan esos módulos). Reglas granulares por módulo se implementan cuando cada módulo se construya, no de forma anticipada.

## Información médica y financiera — acceso futuro

`PersonProvider`, `PersonMedication`, `CommissionExpectation`, `CommissionPayment` requieren autorización server-side cuando sus módulos se construyan — nunca deben quedar accesibles solo porque alguien conozca la URL. Con Auth ya implementado (`requireUser()`/`requireRole()` disponibles), cada endpoint/Server Action de esos módulos debe usarlos explícitamente.

## `HealthPolicyDetail` — Fase 013

Clasificación: **SENSIBLE / FINANCIERO relacionado con salud**. Particularmente `incomeUsed` (ingreso usado en la aplicación de Marketplace) y `taxCreditAmount` (crédito fiscal): son datos financieros personales del cliente, no datos operativos del plan.

- **Autorización server-side, nunca solo ocultar en UI.** `health-policies.service.ts` reutiliza exactamente `assertCanAccessPolicy` (misma política que `Policy`) para ver/crear/editar: ADMIN y ASSISTANT sin restricción de asignación, AGENT solo si tiene acceso al titular o a algún miembro cubierto.
- **ASSISTANT nunca recibe `incomeUsed`/`taxCreditAmount` en la respuesta del servicio.** `getHealthPolicyDetail` omite esas dos propiedades del objeto devuelto para ASSISTANT (no solo las pone en `null` — la clave ni siquiera existe en el objeto), y ese objeto ya redactado es lo único que llega al Client Component. `createHealthPolicyDetail`/`updateHealthPolicyDetail` rechazan explícitamente (`FORBIDDEN`) cualquier intento de ASSISTANT de escribir esos dos campos, incluso si el request los incluye a mano — la UI simplemente no renderiza esos inputs para ASSISTANT, pero esa omisión es conveniencia, no el control real.
- **Resto de campos** (`marketplaceApplicationId`, `marketplaceState`, `planNameSnapshot`, deducibles, out-of-pocket) se consideran datos administrativos/del plan, no financieros personales — ASSISTANT los lee y escribe sin restricción.
- **No debe aparecer en listados generales.** `listPolicies`, `getPoliciesForPerson` y el `getPolicyById` básico (usado por `/policies`, el tab "Pólizas" de un contacto, y el resumen de `/policies/[id]`) **nunca** incluyen `HealthPolicyDetail` — se consulta únicamente vía `getHealthPolicyDetail`, llamado explícitamente solo desde la sección "Información del plan de salud" de `/policies/[id]` y desde `/policies/[id]/health`. Verificado en tests (`health-policies.service.test.ts`, casos U/V): ni el listado de pólizas ni el detalle básico de una póliza exponen la clave `healthDetail`.
- **`incomeUsed`/`taxCreditAmount` nunca deben registrarse en logs** — igual que el resto de montos financieros del proyecto (ver principio general en la sección de Comisiones de `docs/DECISIONS.md`), un log de error debe referenciar el `id` de la póliza, nunca los valores del `HealthPolicyDetail`.
- **`HealthPolicyDetail` solo existe para `Policy.product.policyType === HEALTH`**, validado en el servicio (`assertIsHealthPolicy`) antes de crear/editar — nunca mediante trigger de base de datos (mismo patrón que la regla equivalente documentada en la migración 002).

Reglas específicas para `PersonProvider`/`PersonMedication` (información médica operacional, más sensible que el resto del CRM — el CRM no es un sistema clínico, ver [DECISIONS.md](./DECISIONS.md)):

- **Autorización server-side obligatoria** en cualquier endpoint/acción que lea o escriba estas tablas — nunca confiar solo en ocultar la UI.
- **No deben aparecer en logs normales de aplicación** (logs de requests, errores genéricos, etc.). Si un log necesita referenciar una de estas filas, usar su `id`, nunca su contenido (`name`, `dosage`, `notes`).
- **No deben exponerse en el frontend fuera de una sección dedicada y protegida.** Cuando se construya el perfil de persona ("Person Profile"), Salud/Health debe ser una sección separada del resto de la información de contacto — no debe aparecer en:
  - tablas generales de contactos/clientes,
  - el dashboard,
  - resultados de búsqueda global,
  - notificaciones o resúmenes automáticos.
- **No usar esta información para inferir diagnósticos o condiciones médicas** no registradas explícitamente — el sistema no debe "adivinar" nada a partir de un nombre de medicamento.
- Aplica el mismo principio de minimización de datos del resto del proyecto: no agregar campos a estas tablas sin una necesidad operacional clara y evaluada explícitamente.

## Credenciales y datos de pago

- El CRM nunca almacena contraseñas de portales de aseguradoras, credenciales de Marketplace, número completo de tarjeta, CVV, ni cuentas bancarias completas. Ver [DECISIONS.md](./DECISIONS.md) para el detalle por entidad.
- `User` (usuario interno) ya tiene autenticación (Better Auth); ver sección "Autenticación" arriba para el detalle.

## Cumpleaños (Fase 015) — acceso más estricto que la vista general de Person

`/birthdays` surfacea nombre, teléfono, email, fecha de nacimiento y estado de contacto de forma escaneable en una sola pantalla — más expuesto que navegar `/contacts` uno por uno. Por eso, a diferencia de la política general de `Person` (Fase 008, donde cualquier usuario activo puede ver la lista completa de contactos), `listBirthdays` restringe explícitamente a AGENT a solo los contactos a los que ya tiene acceso operativo (sin asignar o asignados a sí mismo), filtrado server-side en el `where` de Prisma — nunca se trae la lista completa y se oculta después en el cliente. ADMIN y ASSISTANT ven todos.

## Variables de entorno y secretos

- `.env` está excluido de Git (`.gitignore`); solo `.env.example` con valores ficticios se versiona.
- `DATABASE_URL` y credenciales de PostgreSQL viven únicamente en `.env` local, nunca hardcodeadas en `schema.prisma`, código fuente o configuración versionada.
- `BETTER_AUTH_SECRET` sigue la misma regla: generado localmente (`npx @better-auth/cli secret`), vive solo en `.env`, nunca se reutiliza entre entornos — producción necesita su propio secreto generado por separado.

## Riesgos pendientes antes de producción

- **Rate limiting con storage `"memory"`** no protege contra fuerza bruta distribuida entre múltiples instancias del servidor — cambiar a `"database"`/Redis antes de escalar horizontalmente.
- **Sin HTTPS forzado todavía** a nivel de aplicación (depende de dónde se despliegue) — `Secure` en cookies solo se activa cuando el entorno es de producción según la detección de Better Auth; confirmar que el proxy/balanceador de producción sirva siempre sobre HTTPS.
- **Sin MFA** — camino ya evaluado (plugin TOTP de Better Auth), no implementado.
- **Sin recuperación de contraseña por email** — requiere elegir y configurar un proveedor de email antes de construirla.
- **Sin auditoría de intentos de login fallidos** más allá de los logs por defecto de Better Auth — considerar un `AuditLog` dedicado (ya identificado como entidad futura) antes de producción.
