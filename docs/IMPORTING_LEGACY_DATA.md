# Importación de datos legacy (Fase 019)

Pipeline controlado para migrar los datos históricos del Excel de TuPlanSeguro USA al modelo normalizado del CRM. **Es una migración de datos, no una funcionalidad del producto** — vive en `src/import/` y `scripts/import-legacy.ts`, fuera de la aplicación web (no se ejecuta automáticamente en ningún flujo de `dev`/`build`/`start`).

## Principio rector

```
Excel original → lectura → normalización → validación → detección de problemas
               → DRY RUN → reporte → APPLY explícito → PostgreSQL
```

Nunca `Excel → prisma.create()` directo. El dry run es el comportamiento por defecto — escribir requiere dos flags explícitos.

## Uso

```bash
# Dry run (por defecto — nunca escribe nada):
npm run import:legacy -- --file "C:\ruta\al\archivo.xlsx"

# Aplicar de verdad (requiere AMBOS flags):
npm run import:legacy -- --file "C:\ruta\al\archivo.xlsx" --apply --confirm
```

Genera un resumen en consola (ver formato en `src/import/report.ts`) y un reporte machine-readable en `private-imports/import-report.json` — **nunca en `git status`** (ver más abajo).

## El workbook y el reporte NUNCA se commitean

- `.gitignore` excluye `*.xlsx`/`*.xls` por extensión (no solo por carpeta) y `/private-imports/` completo, más `import-report*.json` en cualquier ubicación — así un XLSX real copiado por error a cualquier parte del proyecto nunca se stagea.
- El workbook real de TuPlanSeguro USA vive en `private-imports/CRM_TuPlanSeguro.xlsx` — una carpeta local, nunca versionada.
- Los fixtures de test **no se versionan como `.xlsx`** — se generan programáticamente en memoria con `exceljs` en cada test (`src/import/__tests__/fixture.ts`) y se escriben a un directorio temporal del sistema operativo (`os.tmpdir()`, fuera del repo) justo antes de leerse, luego se borran. Si alguna vez hiciera falta un fixture binario versionado, usar una excepción explícita (`!ruta/al/fixture.xlsx`) en el `.gitignore` en vez de remover la regla general.

## Librería elegida: `exceljs`

Se evaluó `xlsx` (SheetJS) y `exceljs`. `xlsx` en npm está congelado en `0.18.5` desde 2023 — el proyecto SheetJS sigue activo pero deja de publicar versiones nuevas al registro público de npm (mueve las release a su propio CDN), por lo que instalar `xlsx` desde npm hoy trae una versión con vulnerabilidades conocidas (prototype pollution, ReDoS) ya resueltas río arriba pero nunca republicadas a npm. `exceljs` no presentó ninguna vulnerabilidad en `npm audit` al instalarlo, soporta hojas/celdas/fechas/fórmulas y lectura por streaming si hiciera falta a futuro. Se eligió `exceljs`.

## Inventario real del workbook (TuPlanSeguro USA)

Confirmado por inspección estructural (nunca se imprimieron valores de columnas sensibles):

| Hoja | Filas de datos | Notas |
|---|---|---|
| `clientes` | 38 | Fuente principal: Person + Household + Policy + HealthPolicyDetail + seguimiento de pago |
| `Comisiones` | ~29 bloques | Pagos recibidos por mes (ENE-DIC) — **calidad de datos irregular**, ver advertencia abajo |
| `estimacion Comisiones ` (con espacio final real) | ~36 bloques | Montos esperados por mes (ENE-DIC) |
| `fichamedica` | 11 | DEFERRED_SENSITIVE — solo se cuenta, nunca se importa detalle |
| `Cumpleaños` | 14 | Auxiliar — no hay evidencia suficiente para importar `BirthdayGreeting` histórico |
| `clientescumpleaños` | 25 | Mismo schema que `clientes` — **solo** fuente auxiliar de validación de DOB, nunca segunda fuente de creación |
| `cuentas aseguradoras` | 2 | EXCLUDED_SENSITIVE — credenciales de portales, hoja completa excluida |

**Advertencia de calidad de datos encontrada en el dry run real**: la columna `COMPAÑIA DE SEGUROS` de la hoja `Comisiones` contiene, en varias filas, valores que no son nombres de aseguradora (números sueltos, "ReportesEasy") — indicio de una hoja con estructura irregular en ese tramo. El pipeline nunca adivina: esas filas se reportan como `UNKNOWN_CARRIER`/`COMMISSION_POLICY_NOT_FOUND` y quedan bloqueadas hasta que alguien limpie esa sección del Excel o confirme el mapeo correcto.

## Datos que nunca se importan

**Prohibidos de forma absoluta** (`EXCLUDED_SENSITIVE`, ver `src/import/sensitive.ts`):

- SSN (titular, cónyuge, dependientes 1-6)
- Número de documento de inmigración (USCIS#) — sensible, sin campo de destino en el schema
- Banco, titular de cuenta, número de ruta, número de cuenta, ciudad/estado del banco
- Nombre en la tarjeta, tipo, compañía, número, mes/año de vencimiento, código de seguridad

Ninguna función del pipeline lee el *valor* de estas columnas — `workbook.ts::cellByHeader` lanza si algo intenta hacerlo. Solo se cuenta cuántas filas tienen al menos una de estas columnas con valor (`sensitiveSummary.rowsWithExcludedData`), nunca cuáles ni sus valores.

La hoja `cuentas aseguradoras` (credenciales de portales de aseguradoras) se excluye completa — no se lee ninguna celda más allá de confirmar que la hoja existe.

**Diferido, no prohibido**: `fichamedica` (PersonProvider/PersonMedication) — se cuenta cuántas filas parecen tener datos médicos, nunca se importa el detalle. Una migración médica separada y explícita queda para una fase futura.

## Person matching (niveles de confianza)

Ver `src/import/matching.ts`. Nunca fusiona automáticamente por coincidencia débil:

- **STRONG**: email normalizado idéntico, O teléfono normalizado + fecha de nacimiento idénticos → `MATCHED`.
- **MEDIUM**: nombre completo (sin tildes, sin mayúsculas) + fecha de nacimiento idénticos → `MATCHED`.
- **WEAK**: solo nombre, sin DOB/email/teléfono utilizables → nunca decide `MATCHED`; si hay algún homónimo (existente en DB o ya planeado en este mismo run) → `AMBIGUOUS`, se bloquea para revisión humana. Sin homónimos → `NEW`.
- Más de una coincidencia en cualquier nivel → `AMBIGUOUS`.

La misma lógica (`matchAgainstPool`, función pura) se usa tanto contra PostgreSQL como contra las personas ya planeadas en el mismo run (`PersonRegistry`) — así un titular que aparece en varias filas de `clientes` por tener varias pólizas nunca se duplica, sin necesidad de una regla especial de "mismo nombre en la misma hoja".

`CONFLICT` existe como tipo pero el motor V1 nunca lo distingue de `AMBIGUOUS` — ambos bloquean la fila para revisión humana, que es la conducta segura; distinguirlos con más precisión queda para una iteración futura si se demuestra necesario con datos reales.

## Mappings explícitos (nunca fuzzy match)

`src/import/mappings.ts` — cada valor legacy debe aparecer literalmente o la fila se reporta como `UNKNOWN_*` y se bloquea:

- `POLICY_STATUS_MAP`: `PROCESADA`→ACTIVE, `CANCELADA`→CANCELLED, `BRADON`→PENDING ("borrador"). `FALTA` queda deliberadamente **fuera** del mapa — es ambiguo (puede significar "falta pago"/"falta documento"), nunca se asume.
- `OPERATION_TYPE_MAP`: `CLIENTE NUEVO`→NEW_ENROLLMENT, `RENOVACION`→RENEWAL, `CAMBIO DE PLAN`→PLAN_CHANGE.
- `MARKETPLACE_STATE_MAP`: nombres de estado en español → código de 2 letras (`HealthPolicyDetail.marketplaceState`). La columna `ESTADO` de `clientes` es el estado de la póliza en el Marketplace, no una dirección de `Person` (que el schema todavía no tiene, ver `docs/DECISIONS.md`).
- `CARRIER_NAME_MAP`: los 4 valores reales de `clientes` (`AMBETTER`, `BLUE CROSS BLUE SHIELD (BCBS)`, `KAISER PERMANENTE`, `OSCAR`) → nombre real de `Carrier`. Nunca se mapea contra un Carrier `(Dev Seed)`.
- `AGENT_NAME_TO_EMAIL_MAP`: vacío a propósito. El único agente real en el source (`RUBEN IBARRA`) queda sin mapear hasta que se confirme explícitamente a qué `User.email` corresponde — nunca se crea un `User` automáticamente. Sin mapping, `agentId`/`processedById` quedan `null` y se reporta `UNMAPPED_AGENT` (INFO, no bloquea).

`PLAN` (nombre de producto) no usa un mapa fijo: se agrupa por nombre normalizado (trim + mayúsculas) para evitar crear un `Product` duplicado por diferencias de capitalización (se detectó exactamente este caso en el source: `"BLUE PRECISION GOLD HMO 703"` vs `"Blue Precision Gold HMO 703"`), pero `HealthPolicyDetail.planNameSnapshot` conserva el nombre **original** de la fila, no el normalizado — ver §23 del brief original y `docs/DECISIONS.md`.

## Modelo destino

Solo entidades ya existentes: `Person`, `Household`, `HouseholdMember`, `Carrier`, `Product`, `Policy`, `PolicyMember`, `HealthPolicyDetail`, `CommissionExpectation`, `CommissionPayment`. Nunca `Task` inventada desde notas, nunca `BirthdayGreeting` inventado desde una lista de cumpleaños, `PersonProvider`/`PersonMedication` diferidos.

## Household

- `HouseholdMemberRole` real: `HEAD`/`SPOUSE`/`CHILD`/`DEPENDENT`/`OTHER`. Un dependiente se clasifica `CHILD` solo si `DEPENDIENTE N RELACION` contiene un patrón reconocible de hijo/hija (`/hij|son|daughter|child/i`); cualquier otro valor (sobrino, padre, etc.) usa `DEPENDENT` — nunca se asume `CHILD` solo porque la columna se llama "dependiente".
- Household solo se crea si la fila tiene más de un miembro (titular + al menos cónyuge/dependiente) — un titular solo no genera un Household de una persona.
- Idempotencia: antes de crear un Household, `apply.ts` busca si el titular ya es `HEAD` de un Household existente y lo reutiliza.

## Policy

- `PolicyType` siempre `HEALTH` en V1 — es el único tipo que el source actual permite derivar sin adivinar (no hay columnas que distingan Vida/Dental/Gastos Finales en `clientes`).
- `ACTIVE` sin `FECHA DE INICIO` reconocible **bloquea la fila** (`ACTIVE_MISSING_EFFECTIVE_DATE`) — nunca se degrada a `PENDING` automáticamente ni se inventa una fecha.
- `RENEWED` no existe como estado — `TIPO DE APLICACION = RENOVACION` se importa como una `Policy` normal con `operationType = RENEWAL`; **no** se intenta inferir `previousPolicyId` automáticamente en V1 (la relación exacta entre una póliza vieja y su renovación no es inequívoca en el source actual) — queda como trabajo pendiente si se necesita ese encadenamiento.
- `PolicyMember` con `role = PRIMARY` solo si `¿EL TITULAR ESTARA CUBIERTO...?` = SI. Cónyuge/dependientes cubiertos usan `SPOUSE`/`DEPENDENT` según corresponda, solo si su columna `¿... ESTARA CUBIERTO...?` = SI.
- Idempotencia: antes de crear una `Policy`, se busca una existente con el mismo `(holderId, productId, effectiveDate)` — el source no tiene número de póliza, así que esta es la clave natural disponible. Si existe, se reutiliza (`policiesSkippedExisting`), nunca se duplica.

## Comisiones (`Comisiones` / `estimacion Comisiones `)

- Cada columna de mes (`ENE`..`DIC`) con valor se convierte en su **propio** registro — nunca columnas de mes en la base de datos.
- `period` = primer día de ese mes. El año se pasa por `--commission-year` (default: año actual del sistema al momento de correr el import) — el source no registra el año explícitamente por fila, es una limitación conocida del formato original, documentada aquí en vez de adivinada silenciosamente.
- El titular solo aparece en la primera fila de cada bloque de comisión (patrón legacy de "celda combinada visualmente") — se arrastra hacia la siguiente fila con nombre no vacío.
- Vincular una fila de comisión a una `Policy` real requiere (titular resuelto + compañía) → **exactamente una** `Policy` planeada de esa combinación. Cero o más de una coincidencia → se reporta y **no se importa** esa fila (`COMMISSION_POLICY_NOT_FOUND`/`COMMISSION_POLICY_AMBIGUOUS`); nunca se adivina a cuál póliza pertenece un monto.
- `Comisiones` se importa como `CommissionPayment` tipo `PAYMENT` — el source solo trae un monto mensual consolidado, nunca movimientos individuales, así que **no se inventa** ninguna distinción PAYMENT/CHARGEBACK/ADJUSTMENT a partir de esa hoja (la nota del registro creado lo aclara explícitamente). Un chargeback real solo se importaría desde una fuente que lo distinga estructuralmente, que este source no tiene.
- Idempotencia de `CommissionExpectation`: constraint único `(policyId, period)` ya existente en el schema — se verifica antes de crear.
- Idempotencia de `CommissionPayment` (sin constraint único en el schema): clave de aplicación = `(commissionExpectationId, type=PAYMENT, receivedAt=period exacto, amount)` — si ya existe un pago con esa combinación exacta, se omite. Ver `docs/DECISIONS.md` para la discusión completa de por qué esta estrategia es segura sin agregar `legacyImportId` al schema.

## Hardening del Dashboard (requisito previo de esta fase)

Antes de construir el import se corrigió una limitación de Fase 018: los totales de Comisiones del Dashboard sumaban sobre `listCommissionExpectations` (paginado, tope 100). Ahora usan `getCommissionTotalsForPeriod` (`commissions.service.ts`), que agrega en la base de datos (`prisma.commissionExpectation.aggregate` + `prisma.commissionPayment.aggregate` filtrando por la relación) — nunca carga filas a memoria para sumar, y nunca trunca. Probado con 105 `CommissionExpectation` en un mismo período (`commissions.service.test.ts`, caso AP).

## Idempotencia general

Sin `legacyImportId` en el schema (decisión deliberada — ver instrucciones de esta fase: agregarlo requeriría una migración que no se justificó como necesaria). En su lugar, **cada entidad se resuelve contra el estado actual de la base de datos dentro de la misma transacción de apply**, nunca se confía en que un P2002 "salve" la idempotencia:

| Entidad | Clave de idempotencia |
|---|---|
| Person | Motor de matching (email / teléfono+DOB / nombre+DOB) — re-ejecutado en cada apply |
| Household | Titular ya es `HEAD` de un household existente |
| Policy | `(holderId, productId, effectiveDate)` |
| HealthPolicyDetail | `policyId` único (constraint del schema) |
| CommissionExpectation | `(policyId, period)` único (constraint del schema) |
| CommissionPayment | `(commissionExpectationId, type, receivedAt, amount)` — verificado en aplicación |

Correr `--apply` dos veces seguidas sobre el mismo archivo no duplica nada — la segunda corrida reutiliza todo (ver test AM, `import.test.ts`).

## Transacción

Todo `apply.ts` corre dentro de **una sola** `prisma.$transaction(...)` — preferencia fuerte confirmada por el volumen real (decenas de filas, no miles): si algo falla a mitad de camino, rollback completo, nunca una importación parcialmente aplicada sin saberlo.

## Severidades y `READY_TO_IMPORT`

- `INFO`: informativo, nunca bloquea (ej. `UNMAPPED_AGENT`, hojas auxiliares no importadas).
- `WARNING`: algo se omitió pero no compromete la integridad del resto (ej. carrier desconocido en una fila de comisión suelta).
- `BLOCKING`: la fila/entidad no se importa hasta resolverse. `READY_TO_IMPORT = false` si existe al menos un `BLOCKING`.
- `EXCLUDED_SENSITIVE`: exclusión deliberada de datos prohibidos — no es un error, es el pipeline funcionando correctamente.

`--apply` sin `READY_TO_IMPORT = true` se rechaza (`apply.ts` lanza antes de abrir la transacción). Requiere además el flag `--confirm` — ambos, nunca solo `--apply`.

## Seguridad — reglas de logging

- Nunca `console.log` de una fila completa ni de un objeto de persona.
- Nunca se serializa `plan.persons[].data` (nombre/email/teléfono/DOB) al reporte JSON — solo conteos agregados (`counts.persons.{NEW,MATCHED,AMBIGUOUS}`).
- `ImportIssue.message` se redacta a mano en cada punto de emisión — nunca interpola el valor crudo de una celda, solo códigos/nombres de columna/números de fila.
- Verificado en tests (`import.test.ts`, casos V/W/X/AH): el plan y el reporte JSON serializados nunca contienen los valores de fixture usados para SSN/banco/credenciales.
