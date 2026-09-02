# Seguridad

Notas de seguridad específicas del proyecto. No es una política general — solo decisiones concretas que no son obvias a partir del código.

## Autenticación

- **Librería:** [Better Auth](https://www.better-auth.com/), self-hosted, open source (MIT). Elegida sobre Auth.js/NextAuth porque soporta sesiones respaldadas por base de datos junto con el proveedor de email+password — Auth.js solo permite JWT con `CredentialsProvider`, lo cual no permite revocar acceso en tiempo real cuando `User.isActive` cambia. Ver [DECISIONS.md](./DECISIONS.md) para el análisis completo.
- **Password hashing:** scrypt (implementación interna de Better Auth sobre `node:crypto`, sin dependencias nativas). Nunca criptografía propia. El hash vive en `Account.password` — **nunca** en `User` ni en ningún log.
- **Longitud mínima de contraseña:** 10 caracteres (`emailAndPassword.minPasswordLength` en `src/lib/auth.ts`), reforzada también en el script de bootstrap.
- **Sesiones:** cookie `HttpOnly`, `Secure` en producción, `SameSite` por defecto de Better Auth. Nunca tokens de sesión en `localStorage`. Sesiones respaldadas por la tabla `session` (base de datos), no JWT-only.
- **Sin login social todavía** (Google/Facebook/Microsoft) — solo email + password. El modelo `Account` ya soporta múltiples proveedores si se agrega después, sin nueva migración estructural para eso.
- **Sin registro público — reforzado a nivel de Better Auth desde Fase 019.5.** No existe endpoint `/signup` ni flujo de alta abierto en la UI, y desde Fase 019.5 la ruta pública de Better Auth (`/api/auth/sign-up/email`) queda además **bloqueada incondicionalmente** vía `emailAndPassword.disableSignUp: true` (`src/lib/auth.ts`) — antes solo no se enlazaba desde ningún lado, pero seguía siendo alcanzable por cualquiera que conociera la ruta. El único mecanismo de creación de usuarios es `npm run create-admin` (bootstrap del primer ADMIN) y, desde Fase 019.5, Configuración → Usuarios (ADMIN, ver sección "Administración de usuarios" abajo).
- **Bootstrap del primer ADMIN:** `scripts/create-admin.ts`. Como `disableSignUp` bloquea la ruta de Better Auth incluso para una llamada interna, este script ya no usa `auth.api.signUpEmail` — construye `User`+`Account` directamente, hasheando con `better-auth/crypto::hashPassword` (la misma función que usa el runtime de Better Auth internamente, así que el hash resultante es indistinguible de uno generado por su propio flujo). Valida email y longitud de password, rechaza duplicados, nunca imprime la contraseña, y no persiste credenciales en ningún archivo — se reciben por variable de entorno de proceso o prompt interactivo con eco oculto.
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
- **Matriz de roles inicial:** `ADMIN` (acceso total), `AGENT` y `ASSISTANT` (clientes, hogares, pólizas, tareas, cumpleaños; acceso financiero/salud a definir por regla específica cuando se construyan esos módulos). Reglas granulares por módulo se implementan cuando cada módulo se construya, no de forma anticipada. **Excepción explícita desde Fase 016:** Comisiones es el único módulo donde ASSISTANT no tiene ningún acceso (ni lectura ni escritura) — ver sección "Comisiones — Fase 016" más abajo.

## Medicamentos y proveedores/médicos preferidos (`PersonMedication`/`PersonProvider`) — Fase 019.8

Clasificación: información operacional de salud, más sensible que el resto del CRM (el CRM no es un sistema clínico).

- **Autorización: `canEditPerson`** (misma regla que editar cualquier otro dato de un contacto — ADMIN/ASSISTANT sin restricción de asignación, AGENT solo si tiene acceso al contacto), aplicada tanto a lectura como a escritura en `health-records.service.ts`. Deliberadamente más estricta que ver el perfil básico de un contacto (Fase 008, abierto a cualquier usuario activo) — se decidió que incluso LEER esta información debiera seguir la regla de asignación, no solo escribirla.
- **Viven en `Person`, nunca en `Policy`.** Una persona puede cambiar de póliza y su historial de medicamentos/proveedores debe permanecer — nunca se consultan ni se muestran desde el contexto de una `Policy`.
- **Nunca se exponen fuera de la sección "Salud" del perfil de contacto** — no aparecen en tablas generales de contactos, el Dashboard, resultados de búsqueda global, ni notificaciones/resúmenes automáticos (mismo principio ya aplicado a `HealthPolicyDetail`).
- **`CommissionExpectation`/`CommissionPayment` ya se implementaron en Fase 016 — ver esa sección para las reglas reales.**

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

## Comisiones — Fase 016

Clasificación: **FINANCIERO / RESTRINGIDO**. `CommissionExpectation` (monto esperado por póliza/período) y `CommissionPayment` (pagos, chargebacks y ajustes reales de carriers) son la información financiera más sensible del CRM hasta ahora — no son datos del cliente, son ingresos reales/esperados de la agencia.

- **ASSISTANT no tiene ningún acceso a este módulo — ni lectura ni escritura, ni siquiera para pólizas donde sí tiene acceso administrativo en el resto de la aplicación.** `commissions.service.ts` lanza `FORBIDDEN` para ASSISTANT al inicio de cada función exportada (`listCommissionExpectations`, `getCommissionExpectationById`, `getCommissionsForPolicy`, `createCommissionExpectation`, `updateCommissionExpectation`, `cancelCommissionExpectation`, `addCommissionPayment`) — es la autoridad real, no una conveniencia de UI.
- **La UI refuerza, pero no reemplaza, esa autorización:** el ítem "Comisiones" del menú se omite por completo para ASSISTANT (`nav-content.tsx`), la sección "Comisiones" del detalle de Póliza no se renderiza para ASSISTANT (ni siquiera se llama al servicio), y `/commissions`/`/commissions/[id]` invocan `forbidden()` (`next/navigation`) para ASSISTANT — un **403 real**, no un redirect silencioso a `/dashboard`. Se habilitó `experimental.authInterrupts` en `next.config.ts` específicamente para esto (ver `docs/DECISIONS.md`).
- **AGENT tiene acceso de solo lectura, acotado a las pólizas donde ya tendría acceso operativo** (misma regla que `canAccessPolicy` de `Policy`/`Task`). Nunca puede crear expectativas, editarlas, cancelarlas, ni registrar pagos/chargebacks/ajustes — la UI oculta esos controles para AGENT, y el servicio los rechaza (`FORBIDDEN`) igualmente si se invocaran directamente.
- **Solo ADMIN muta este módulo.** Crear, editar, cancelar expectativas y registrar cualquier movimiento (`PAYMENT`/`CHARGEBACK`/`ADJUSTMENT`) requiere `actor.role === "ADMIN"`, verificado dentro del servicio antes de tocar Prisma.
- **Minimización de datos:** `getPolicyById`/`listPolicies` nunca incluyen `CommissionExpectation` en su `select` — se confirmó explícitamente en esta fase. Los montos de comisión solo se obtienen vía `getCommissionsForPolicy`/`listCommissionExpectations`/`getCommissionExpectationById`, llamados únicamente desde el módulo de Comisiones y la sección "Comisiones" (ya gateada por rol) del detalle de Póliza. Nunca aparecen en Contactos, Hogares, Tareas, Cumpleaños ni el listado general de Pólizas.
- **`expectedAmount`, montos de pagos, chargebacks y cualquier agregado financiero nunca deben registrarse en logs normales de aplicación.** Si un log necesita referenciar un movimiento o una expectativa, debe usar su `id`, nunca los montos.
- **Sin borrado de `CommissionPayment` en ningún rol, incluido ADMIN.** No existe una función de servicio para borrar o reescribir el monto/tipo de un pago ya creado — cualquier corrección exige un `ADJUSTMENT` nuevo, preservando el historial completo de movimientos como registro de auditoría implícito.

## Primas / Seguimiento de pago — Fase 017

Clasificación: **FINANCIERO OPERATIVO** — distinto de Comisiones (**FINANCIERO RESTRINGIDO**, ver sección anterior). La distinción importa: Comisiones es dinero que gana la agencia (ingreso propio, ASSISTANT sin acceso); Primas/Seguimiento de pago es el estado del cobro al cliente (trabajo operativo diario, ASSISTANT sí participa).

- **ADMIN**: acceso total. **AGENT**: ve y edita seguimiento de pago solo de pólizas dentro de su acceso operativo (misma regla que `Policy`/`Task`/Comisiones). **ASSISTANT**: acceso completo, igual que ADMIN/AGENT sin restricción de asignación — decisión explícita distinta de Comisiones.
- **No otorga acceso a información de salud ni de comisiones.** Que ASSISTANT tenga acceso a Primas no cambia su acceso a `HealthPolicyDetail` (sigue redactado según Fase 013) ni a Comisiones (sigue `FORBIDDEN` según Fase 016) — son autorizaciones completamente independientes, verificadas en el servicio de cada módulo.
- **No se almacena ni se muestra ningún dato de método de pago real**: sin número de tarjeta, cuenta bancaria, routing number, CVV, ni credenciales de portales de aseguradoras o Marketplace. Los 6 campos de este módulo (`premiumAmount`, `billingFrequency`, `nextPaymentDueDate`, `autopay`, `needsPaymentAssistance`, `paymentStatus`) son seguimiento operativo, no datos de pago — ver `docs/DECISIONS.md` para el detalle de cada campo.
- **`premiumAmount` no debe registrarse en logs normales de aplicación** — mismo principio que el resto de montos financieros del proyecto (Comisiones, `HealthPolicyDetail`). Un log de error debe referenciar el `id` de la póliza, nunca el monto.
- **Minimización de datos**: `listPremiumTracking`/`getPremiumTrackingForPolicy` nunca incluyen `CommissionExpectation`/`CommissionPayment`, `HealthPolicyDetail`, `PersonProvider` ni `PersonMedication` en su `select` — verificado explícitamente en tests (`premiums.service.test.ts`, casos Y/Z).

## Dashboard — Fase 018

El Dashboard es una vista compuesta, no un módulo con reglas propias — su superficie de seguridad es la suma de las reglas ya documentadas para Tareas, Primas/Pagos, Cumpleaños, Pólizas y Comisiones, nunca una regla nueva.

- **ASSISTANT nunca recibe datos de Comisiones en el Dashboard, ni siquiera indirectamente.** `dashboard.service.ts` no agrega la clave `commissions` al objeto devuelto para ese rol — `getDashboard` ni siquiera llama a `listCommissionExpectations` cuando `actor.role === "ASSISTANT"`. Verificado en tests (`dashboard.service.test.ts`, casos C/V/Z: se confirma que la clave está ausente y que el JSON serializado del resultado no contiene la palabra "commissions").
- **Los conteos y listas del Dashboard heredan el scoping de AGENT de cada servicio de origen** — un AGENT nunca ve en el Dashboard una tarea, póliza, pago o comisión fuera de su cartera, porque `dashboard.service.ts` pasa el `actor` real a cada llamada (`listTasks(actor, ...)`, `listPremiumTracking(actor, ...)`, etc.) sin construir ningún acceso propio. No existe combinación "conteo global + lista filtrada" en ningún bloque — ambos se calculan con el mismo `actor` scoped.
- **Minimización de datos**: el DTO del Dashboard nunca incluye `HealthPolicyDetail`, `incomeUsed`, `taxCreditAmount`, `PersonProvider`, `PersonMedication`, notas completas de Task, ni ningún dato de método de pago — verificado explícitamente en tests (caso Y).

## Importación de datos legacy — Fase 019

Ver `docs/IMPORTING_LEGACY_DATA.md` para el detalle completo del pipeline. Resumen de seguridad:

- **El workbook real y el reporte generado nunca deben llegar al repositorio.** `.gitignore` excluye `*.xlsx`/`*.xls` por extensión (no solo por carpeta), `/private-imports/` completo, y `import-report*.json` en cualquier ubicación.
- **Columnas prohibidas de forma absoluta** (SSN, USCIS#, datos bancarios completos, datos de tarjeta completos) — nunca se leen más allá de "¿tiene valor o no?" (`workbook.ts::cellByHeader` lanza si algo intenta leer su valor). Solo se reporta una cantidad de filas afectadas, nunca cuáles ni sus valores.
- **La hoja `cuentas aseguradoras` (credenciales de portales de aseguradoras) se excluye completa** — ni una celda de esa hoja se lee más allá de confirmar su existencia.
- **`fichamedica` queda DEFERRED_SENSITIVE** — se cuenta cuántas filas parecen tener datos médicos, nunca se importa el detalle (medicamentos, PCP, especialistas). Una migración médica separada y explícita queda para una fase futura, fuera de esta.
- **Nunca se registra en logs/consola/reporte una fila completa, un objeto de persona, ni el valor de una celda sensible.** `ImportIssue.message` se redacta a mano en cada punto de emisión del código — nunca interpola el valor crudo de una celda del Excel.
- **El reporte JSON (`import-report.json`) solo contiene conteos agregados y códigos de error con `sheet`/`row`** — nunca serializa nombre, email, teléfono, fecha de nacimiento ni ningún valor de columna. Verificado en tests (`import.test.ts`, casos V/W/X/AH).
- **DRY RUN es el comportamiento por defecto.** Escribir en PostgreSQL requiere `--apply` y `--confirm` simultáneos — ninguno solo es suficiente. `apply.ts` además rechaza escribir si el plan tiene algún error `BLOCKING` (`READY_TO_IMPORT = false`).
- **El CLI de importación no crea `User`/cuentas de acceso** bajo ninguna circunstancia — nombres de agente sin mapping explícito quedan como `agentId`/`processedById` nulos, nunca inventan un usuario.

## Documentos de póliza (`PolicyDocument`) — Fase 019.5

Clasificación: **operativo**, no financiero-restringido (a diferencia de Comisiones) — ASSISTANT sí participa.

- **Nunca se guarda el binario en PostgreSQL.** `PolicyDocument` es solo metadata; el archivo vive en el `FileStorage` abstraído (`src/lib/storage.ts`) — en desarrollo, fuera de `/public` (`private-storage/`, gitignored); en producción requiere un adapter S3-compatible todavía no implementado (deliberadamente, ver `docs/DECISIONS.md`).
- **Nunca URLs públicas permanentes.** Toda descarga/visualización pasa por `GET /api/policies/[id]/documents/[documentId]` (Route Handler), que llama `requireSessionUser()` y vuelve a verificar autorización de la póliza (`assertCanAccessPolicy`) en cada request — conocer la URL/el `documentId` nunca es suficiente por sí solo.
- **El tipo real del archivo se verifica por firma binaria, nunca por extensión ni por el `Content-Type` declarado por el navegador.** `src/lib/file-sniff.ts` implementa detección real de magic bytes (PDF `%PDF`, PNG, JPEG, WEBP) — un archivo `.exe` renombrado a `.pdf` se rechaza aunque el navegador diga `application/pdf`.
- **Allow-list, no deny-list.** `ALLOWED_DOCUMENT_MIME_TYPES` lista únicamente PDF/PNG/JPEG/WEBP — cualquier otro tipo (incluidos `.exe`/`.js`/`.html`/`.svg`) se rechaza automáticamente sin necesidad de enumerarlo.
- **`storageKey` siempre generado (`crypto.randomUUID()` + extensión derivada del MIME ya verificado), nunca el nombre de archivo original** — es el mecanismo real que impide path traversal, reforzado con validación de patrón estricto en `LocalFileStorage.resolveSafePath()` como defensa en profundidad.
- **Tamaño máximo 15MB**, validado antes de escribir a disco.
- **Autorización igual que `Policy`** (`assertCanAccessPolicy`), no una regla más estricta como Comisiones — ASSISTANT puede subir/ver/eliminar documentos operativos en cualquier póliza a la que ya tenga acceso.

## Reglas de comisión (`CommissionRule`) — Fase 019.5

Clasificación: **FINANCIERO / RESTRINGIDO**, más estricto incluso que Comisiones (donde AGENT tiene lectura) — configurar cómo se le paga a la agencia es una decisión puramente administrativa.

- **Solo ADMIN puede ver, crear, desactivar reglas o generar expectativas desde una regla.** `commission-rules.service.ts` restringe el módulo completo a ADMIN (`assertAdminOnly` al inicio de cada función exportada) — ni siquiera AGENT tiene acceso de lectura, a diferencia del resto de Comisiones.
- **Generar una expectativa desde una regla sigue pasando por la misma autorización de póliza** (`assertCanAccessPolicy`) antes de la restricción ADMIN-only — defensa en profundidad, aunque en la práctica ADMIN ya tiene acceso a todo.
- **`generateExpectationForPeriod` (acción manual ADMIN) nunca genera un rango implícito** — exactamente una póliza y un período explícito por invocación.
- **Generación automática (Fase 019.7, Hallazgo #14): `autoGenerateCurrentPeriodExpectation` es "mejor esfuerzo" (nunca lanza excepción) y está estrictamente acotada al período actual — nunca genera meses futuros/pasados ni recorre pólizas en lote.** Se dispara como efecto secundario desde la capa de Server Actions (crear/activar póliza, cambiar prima, agregar/quitar miembro, asignar regla), nunca desde un job en segundo plano. Comparte el mismo invariante "solo CREATE, nunca UPDATE" que la generación manual — no requiere ni agrega ninguna autorización nueva, porque nunca se invoca directamente desde una request de un usuario sin pasar antes por la autorización propia de esa acción (crear póliza, editar prima, etc.).
- **Auditoría de corrección manual de una expectativa (`isManualOverride`/`overriddenById`/`overriddenAt`/`overrideReason`) queda expuesta solo a quien ya tenía acceso de escritura a Comisiones (ADMIN).** No es una tabla de audit log separada — vive en la propia fila de `CommissionExpectation`, consistente con el resto del módulo (ver Fase 016/019.5 más arriba).

## Administración de usuarios (Configuración → Usuarios) — Fase 019.5

- **ADMIN únicamente** — `users.service.ts::assertAdminOnly` protege `listAllUsers`/`createUser`/`setUserActive`/`getUserById`.
- **Contraseña temporal generada por el servidor (18 bytes aleatorios), mostrada al ADMIN exactamente una vez en la UI tras crear el usuario — nunca se persiste en texto plano ni se registra en logs.** El ADMIN debe compartirla manualmente por un canal seguro fuera de banda; envío automático por email queda pendiente (requiere proveedor de email, no configurado todavía).
- **No se puede desactivar al único ADMIN activo** (`setUserActive` cuenta `role=ADMIN AND isActive=true` antes de permitir la desactivación) — evita un lockout administrativo accidental del CRM.
- **AGENT sigue siendo un `User` con `role=AGENT`, nunca una entidad separada** — no hay superficie de administración distinta para "agentes" vs. "usuarios".

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
- **Sin auditoría de intentos de login fallidos** más allá de los logs por defecto de Better Auth — el `AuditEvent` implementado en Fase 019.9 (ver más abajo) NO cubre autenticación (login/logout, intentos fallidos), solo acciones de negocio ya autenticadas; sigue pendiente si se decide auditar también el acceso.

## Audit Trail (`AuditEvent`) — Fase 019.9

Detalle funcional completo (qué se audita, formato, servicio central) en [AUDIT_TRAIL.md](./AUDIT_TRAIL.md). Aquí solo las propiedades de seguridad.

- **Append-only por construcción de código, no por permiso de base de datos.** No existe ninguna función `updateAuditEvent`/`deleteAuditEvent` en `audit.service.ts`, ni ninguna ruta/Server Action que las exponga — la única operación posible desde la aplicación es `create`. Un mantenimiento técnico que requiriera tocar filas existentes (ej. una corrección de datos) tendría que hacerse fuera de la aplicación, de forma documentada, nunca vía una UI de "editar historial" (que deliberadamente no existe).
- **Atribución real del actor**: `actorUserId` es una FK a `users`, nunca solo un nombre en texto — el timeline muestra `actor.name` resuelto en el momento de consultar, así que un usuario renombrado se refleja correctamente en eventos pasados (a diferencia de si se hubiera guardado el nombre como string suelto). `actorType: SYSTEM` (con `actorUserId = null`) se usa exclusivamente cuando no hay un actor humano real — nunca se atribuye una acción del sistema a un usuario por conveniencia.
- **Minimización de PII/PHI de forma estructural, no solo por convención**: los campos auditables de cada entidad son una allowlist explícita pasada a `buildDiff()` (`PERSON_AUDIT_FIELDS`, `POLICY_AUDIT_FIELDS`, `HOUSEHOLD_AUDIT_FIELDS`, `HEALTH_DETAIL_AUDIT_FIELDS`, `TASK_AUDIT_FIELDS`, `PREMIUM_AUDIT_FIELDS`) — un campo que no está en esa lista no puede aparecer en `changes` aunque el objeto `before`/`after` completo lo contenga. `incomeUsed`/`taxCreditAmount` (financiero personal), montos de comisiones/pagos (financiero restringido, Fase 016), y nombre/dosis/notas de medicamentos/proveedores (salud operacional) están excluidos de sus respectivas allowlists — esos eventos se generan igual (para saber QUE algo cambió, quién y cuándo) pero sin `changes`, o con `changes` limitado a los campos no sensibles del mismo registro.
- **Nunca contenido de archivos ni texto de notas** — `DOCUMENT_UPLOAD`/`DOCUMENT_DELETE` solo guardan `fileName` (metadata ya pública dentro de la aplicación, nunca los bytes); `NOTE_CREATE` nunca incluye `content`.
- **Autorización del timeline reutiliza exactamente la autorización ya establecida de cada entidad** (`canEditPerson` para contactos, `assertCanAccessPolicy` para pólizas) — nunca una regla nueva y paralela que pudiera desincronizarse. ASSISTANT excluido de eventos de Comisiones en el timeline por el mismo principio que en el módulo de Comisiones (Fase 016): FORBIDDEN total, sin excepción por contexto.
- **Transaccional con la escritura real** (`prisma.$transaction`) cuando es razonable — evita el escenario de un cambio real sin su evento correspondiente (o viceversa). Ver "Transaccionalidad" en `AUDIT_TRAIL.md` para el detalle de por qué las queries dentro de esas transacciones son siempre secuenciales (nunca `Promise.all`), consistente con el hallazgo de concurrencia de `pg` de Fase 019.6.

## Exportación CSV y conciliación de comisiones — Fase 020

- **Exportación CSV nunca amplía lo que el usuario ya puede ver.** `exportContactsCsv`/`exportPoliciesCsv`/`exportCommissionsCsv` reutilizan exactamente la misma autorización que sus listados normales (`policyAgentAccessWhere`, `agentCommissionAccessWhere`) — un CSV nunca contiene una fila que ese usuario no vería ya en `/contacts`, `/policies` o `/commissions`. **ASSISTANT nunca puede exportar Comisiones** (`FORBIDDEN` inmediato, misma exclusión total de Fase 016).
- **El CSV nunca incluye SSN, datos bancarios/tarjeta, credenciales, contenido de documentos, texto de notas, ni nombre/dosis/notas de medicamentos o proveedores** — las columnas exportadas son una lista explícita y corta por módulo (ver `export.service.ts`), nunca un `SELECT *` volcado a CSV. Verificado con tests que buscan explícitamente ausencia de esas palabras clave en el CSV generado (`export.service.test.ts`).
- **Límite de filas (`EXPORT_ROW_LIMIT = 5000`)** documentado en código — evita uso de memoria sin límite; suficiente para la escala de una sola agencia en V1.
- **El audit log de una exportación nunca guarda el contenido exportado** — solo actor, tipo, fecha, filtros seguros aplicados y un conteo aproximado (`EXPORT_CONTACTS`/`EXPORT_POLICIES`/`EXPORT_COMMISSIONS`, ver `AUDIT_TRAIL.md`).
- **Conciliación de comisiones es ADMIN-only en su totalidad** (subir, ver vista previa, emparejar, ignorar, aplicar) — decisión explícita documentada en `docs/DECISIONS.md`. AGENT conserva su acceso ya existente y acotado a sus propias comisiones (sin cambios); ASSISTANT sigue sin acceso al módulo de Comisiones en absoluto.
- **Archivos de reporte de comisión**: extensión validada contra el adaptador, tamaño máximo 5 MB, firma binaria verificada para `.xlsx` (`looksLikeZipArchive`) antes de parsear — nunca se confía en el nombre de archivo ni en el `Content-Type` declarado por el navegador (mismo principio que `file-sniff.ts` ya establecido para documentos de póliza). El archivo original nunca se guarda en la base de datos.
- **"Ver actividad" de un usuario (Configuración → Usuarios) es ADMIN-only** (`getUserActivity` en `history.service.ts`) — reutiliza la misma redacción/allowlist de `AuditEvent` ya vigente, nunca expone el JSON crudo de `changes`/`metadata` sin pasar por el mismo renderizado que el resto del Historial.
