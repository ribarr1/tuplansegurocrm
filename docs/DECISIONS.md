# Decisiones de arquitectura

Registro de decisiones importantes sobre el modelo de datos del CRM. No es documentación exhaustiva — solo lo que no es obvio a partir del código y que necesitaríamos recordar en una conversación nueva.

## Identidad y relación comercial

- **`Person` es la identidad central del sistema.** Prospecto, cliente y excliente son la misma fila de `Person` en distintos momentos — nunca se duplica al cambiar de estado. Todo su historial (notas, tareas, pólizas) permanece intacto porque sigue apuntando al mismo `id`.
- **`Person.contactStatus` es la relación GENERAL con la agencia, no un estado por línea de producto.** Una persona puede ser cliente de Salud y prospecto de Vida al mismo tiempo; `contactStatus` no lo distingue. Si se necesita pipeline comercial por producto, se resolverá con una entidad futura `Opportunity` — no sobrecargando `contactStatus`.

## Hogares

- **`Household` se relaciona con `Person` en N:M**, vía `HouseholdMember`, no 1:N. Una persona puede pertenecer a más de un hogar (ej. hijo de padres divorciados). El rol dentro del hogar (`HEAD`, `SPOUSE`, `CHILD`, `DEPENDENT`, `OTHER`) vive en la tabla intermedia, no en columnas fijas tipo `dependiente1`/`dependiente2`.

## Carriers y productos

- **`Product` es la fuente de verdad del tipo de seguro (`policyType`) y del carrier.** Cuando se implemente `Policy` (migración futura), no tendrá columnas `carrierId` ni `policyType` propias — se derivan siempre vía `Policy → Product → Carrier`. Se evaluó explícitamente si existía un motivo de negocio real (no de rendimiento) para duplicar `carrierId` en `Policy` — no se encontró ninguno: un cambio real de carrier equivale a una renovación hacia una nueva póliza con su propio `Product`.
- **`Product.planYear` puede ser `null`.** Aplica a productos con vigencia anual (ej. planes de Marketplace: "Ambetter Plan X 2026" vs "2027"); productos sin ciclo anual (ej. ciertos seguros de vida) simplemente no lo usan.

## Cobertura de pólizas (diseño futuro)

- **`PolicyMember` (futuro) representará únicamente cobertura efectiva de una póliza ya emitida.** Solo existirán filas para personas realmente cubiertas — la ausencia de fila significa "no cubierto". No se agregará un campo `coverageStatus` a `PolicyMember` para distinguir excluido/nunca evaluado.
- **La evaluación/exclusión durante cotización pertenecerá a `Application`/`Quote` + `ApplicationMember` (futuras, no implementadas).** Esa es una etapa de negocio anterior y distinta a la póliza emitida. Antes de agregar esa lógica a `PolicyMember`, se debe diseñar `Application`/`Quote` explícitamente — no resolverlo ad-hoc más adelante.

## Cumpleaños

- **La fecha de nacimiento vive únicamente en `Person.dateOfBirth`.** No existe ni existirá una tabla separada que duplique personas para manejar cumpleaños. El proceso comercial de la tarjeta (pendiente/enviada, año, medio) se registrará en una entidad futura `BirthdayGreeting`, relacionada a `Person` + año.

## Comisiones (diseño futuro)

- **`CommissionExpectation` (futura) tendrá `UNIQUE(policyId, period)`** — una única expectativa por póliza y período para la V1. Si en el futuro se identifica un caso real que requiera múltiples conceptos de comisión para la misma póliza/período, se evolucionará el modelo explícitamente en ese momento, no de forma anticipada.

## Seguridad y minimización de datos

- **El CRM no almacena credenciales de ningún tipo dentro de sus tablas de negocio**: ni contraseñas de portales de aseguradoras, ni credenciales de Marketplace, ni datos bancarios, ni número completo de tarjeta ni CVV. `User` (usuario interno del CRM) tampoco tiene campos de autenticación todavía — se agregarán en una migración dedicada cuando se diseñe el módulo de autenticación.
- **`Person` no incluye SSN completo, dirección, datos médicos ni datos de pago en la migración 001.** Esos campos se incorporarán solo cuando exista una necesidad operacional clara y se haya evaluado explícitamente, siguiendo el principio de minimización de datos del proyecto.

## Identificadores

- **Todas las tablas usan UUID v4 como clave primaria** (tipo nativo `uuid` de PostgreSQL), en vez de autoincrement o CUID2. Motivo: evita exponer información secuencial (cantidad/orden de prospectos y clientes) y es un estándar universal para integraciones futuras, sin depender de una librería adicional.
