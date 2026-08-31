# Decisiones de arquitectura

Registro de decisiones importantes sobre el modelo de datos del CRM. No es documentación exhaustiva — solo lo que no es obvio a partir del código y que necesitaríamos recordar en una conversación nueva.

## Identidad y relación comercial

- **`Person` es la identidad central del sistema.** Prospecto, cliente y excliente son la misma fila de `Person` en distintos momentos — nunca se duplica al cambiar de estado. Todo su historial (notas, tareas, pólizas) permanece intacto porque sigue apuntando al mismo `id`.
- **`Person.contactStatus` es la relación GENERAL con la agencia, no un estado por línea de producto.** Una persona puede ser cliente de Salud y prospecto de Vida al mismo tiempo; `contactStatus` no lo distingue. Si se necesita pipeline comercial por producto, se resolverá con una entidad futura `Opportunity` — no sobrecargando `contactStatus`.

## Hogares

- **`Household` se relaciona con `Person` en N:M**, vía `HouseholdMember`, no 1:N. Una persona puede pertenecer a más de un hogar (ej. hijo de padres divorciados). El rol dentro del hogar (`HEAD`, `SPOUSE`, `CHILD`, `DEPENDENT`, `OTHER`) vive en la tabla intermedia, no en columnas fijas tipo `dependiente1`/`dependiente2`.

## Carriers y productos

- **`Product` es la fuente de verdad del tipo de seguro (`policyType`) y del carrier.** `Policy` no tiene columnas `carrierId` ni `policyType` propias — se derivan siempre vía `Policy → Product → Carrier`. Se evaluó explícitamente si existía un motivo de negocio real (no de rendimiento) para duplicar `carrierId` en `Policy` — no se encontró ninguno: un cambio real de carrier equivale a una renovación hacia una nueva póliza con su propio `Product`.
- **`Product.planYear` puede ser `null`.** Aplica a productos con vigencia anual (ej. planes de Marketplace: "Ambetter Plan X 2026" vs "2027"); productos sin ciclo anual (ej. ciertos seguros de vida) simplemente no lo usan.

## Cobertura de pólizas

- **`PolicyMember` representa únicamente cobertura efectiva de una póliza ya emitida.** Solo existen filas para personas realmente cubiertas — la ausencia de fila significa "no cubierto". No se agregó un campo `coverageStatus` a `PolicyMember` para distinguir excluido/nunca evaluado.
- **Si el titular (`Policy.holderId`) está efectivamente cubierto, también debe tener su propia fila en `PolicyMember`** (con `role = PRIMARY`). Esto hace que `PolicyMember` sea siempre la única fuente de verdad de cobertura — nunca se infiere comparando `PolicyMember.personId` con `Policy.holderId` en la aplicación. Si el titular es solo responsable administrativo sin estar él mismo cubierto, no tiene fila.
- **La evaluación/exclusión durante cotización pertenecerá a `Application`/`Quote` + `ApplicationMember` (futuras, no implementadas).** Esa es una etapa de negocio anterior y distinta a la póliza emitida. Antes de agregar esa lógica a `PolicyMember`, se debe diseñar `Application`/`Quote` explícitamente — **no se debe resolver agregando `coverageStatus` a `PolicyMember` sin revisar primero esta decisión.**

## Renovaciones e historial de pólizas

- **Una renovación crea una nueva fila de `Policy`**, encadenada hacia la anterior mediante `previousPolicyId` (self-relation). Una póliza histórica **nunca se sobrescribe** con los datos de la renovación.
- **`Policy.previousPolicyId` es único**: cada póliza histórica solo puede tener una renovación apuntándole, manteniendo la cadena lineal (sin ramificaciones).
- **El FK de `previousPolicyId` usa `onDelete: Restrict`**, no `SetNull` ni `Cascade`: bloquea activamente el borrado de una póliza histórica mientras una renovación la referencia, en vez de permitir el borrado y dejar el enlace huérfano en silencio. La misma lógica de protección aplica a `holder`, `product` (Restrict) y a `PolicyMember → Policy` (Restrict): una póliza con miembros de cobertura no se puede borrar sin limpiar antes esos registros explícitamente.
- **`HealthPolicyDetail.planNameSnapshot` congela el nombre del plan al momento de la póliza.** El catálogo `Product` es mutable (se puede renombrar/desactivar); el historial de una póliza no debe cambiar si el catálogo cambia después. No se duplican otros campos de `Product` (carrier, policyType) porque no cambian de forma que genere confusión histórica real.
- **La regla "`HealthPolicyDetail` solo debe existir si `Policy.product.policyType == HEALTH`" se valida en la aplicación/servicio, no mediante trigger de base de datos.** Un FK normal no puede expresar esa condición, y no se implementaron triggers para evitar complejidad innecesaria en esta fase.

## Tareas y notas

- **`Task` y `Note` usan FKs explícitas y opcionales hacia `Person`/`Policy`** (`personId`, `policyId`), no un sistema polimórfico (`entityType`/`entityId`). Con solo dos entidades relacionables en V1, el polimorfismo genérico es complejidad prematura.
- **"Vencida" (overdue) es un estado calculado, no un valor de `TaskStatus`.** Se deriva como `status NOT IN (COMPLETED, CANCELLED) AND dueAt < now()`. No se almacena para evitar que quede desactualizado respecto a la hora real.
- **`Task.assignedToId` y `Task.createdById` son conceptos distintos y ambos existen**: quién debe ejecutar la tarea vs. quién la creó. Ambos nullable con `onDelete: SetNull` porque todavía no hay autenticación real — durante migraciones/importaciones puede no haber un actor conocido.
- **`Note` es historial operativo de negocio, no un sustituto de `AuditLog`.** `AuditLog` (futuro) registrará cambios estructurados del sistema (qué campo cambió, cuándo, quién); `Note` es texto libre que un agente escribe sobre un cliente o póliza. No mezclar ambos conceptos en la misma tabla.

## Cumpleaños

- **La fecha de nacimiento vive únicamente en `Person.dateOfBirth`.** No existe ni existirá una tabla separada que duplique personas para manejar cumpleaños. `BirthdayGreeting` (implementada en la migración 003) solo registra la gestión anual de la tarjeta (pendiente/enviada/omitida, canal, fecha de envío) — nunca otra fecha de nacimiento.
- **`BirthdayGreeting` tiene `UNIQUE(personId, year)`** — una gestión por persona y año.
- **La ausencia de una fila `BirthdayGreeting` para (persona, año actual) se interpreta como "aún no gestionado"**, equivalente a pendiente implícito. El futuro dashboard consulta `Person.dateOfBirth` directamente para calcular cumpleaños de hoy/mes/próximos, y hace `LEFT JOIN` contra `BirthdayGreeting` del año actual para saber si ya se gestionó.
- **No se generan automáticamente filas de `BirthdayGreeting` para todas las personas cada enero.** La fila se crea solo cuando el flujo de trabajo interactúa realmente con ese cumpleaños (o cuando en el futuro se decida automatizarlo explícitamente) — evita crear cientos de registros sin uso real.

## Comisiones (diseño futuro)

- **`CommissionExpectation` (futura) tendrá `UNIQUE(policyId, period)`** — una única expectativa por póliza y período para la V1. Si en el futuro se identifica un caso real que requiera múltiples conceptos de comisión para la misma póliza/período, se evolucionará el modelo explícitamente en ese momento, no de forma anticipada.

## Seguridad y minimización de datos

- **El CRM no almacena credenciales de ningún tipo dentro de sus tablas de negocio**: ni contraseñas de portales de aseguradoras, ni credenciales de Marketplace, ni datos bancarios, ni número completo de tarjeta ni CVV. `User` (usuario interno del CRM) tampoco tiene campos de autenticación todavía — se agregarán en una migración dedicada cuando se diseñe el módulo de autenticación.
- **`Policy` solo registra seguimiento operativo de prima** (`premiumAmount`, `billingFrequency`, `nextPaymentDueDate`, `autopay`, `needsPaymentAssistance`, `paymentStatus`), no datos de pago reales: sin número de tarjeta, CVV, cuenta bancaria ni tokens de pago. Un `PaymentMethodReference` con datos mínimos y seguros (tipo, últimos 4 dígitos) queda para una fase posterior si se necesita.
- **`Person` no incluye SSN completo, dirección, datos médicos ni datos de pago en la migración 001.** Esos campos se incorporarán solo cuando exista una necesidad operacional clara y se haya evaluado explícitamente, siguiendo el principio de minimización de datos del proyecto.

## Identificadores

- **Todas las tablas usan UUID v4 como clave primaria** (tipo nativo `uuid` de PostgreSQL), en vez de autoincrement o CUID2. Motivo: evita exponer información secuencial (cantidad/orden de prospectos y clientes) y es un estándar universal para integraciones futuras, sin depender de una librería adicional.
