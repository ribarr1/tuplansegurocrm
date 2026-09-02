# Conciliación de comisiones (Fase 020)

Referencia central del módulo de conciliación de comisiones: compara `CommissionExpectation.expectedAmount` (lo que esperamos cobrar) contra pagos reales reportados por agencias/uplines (`CommissionPayment`, RECEIVED). Ver también `docs/DATABASE.md` (schema, migración 012), `docs/SECURITY.md` (autorización) y `docs/AUDIT_TRAIL.md` (eventos auditados).

## Qué es y qué NO es

- **NO es un importador automático de comisiones.** Nunca aplica un pago sin que un ADMIN revise una vista previa y confirme explícitamente. El flujo siempre es: Subir/parsear → Vista previa → Emparejamiento → Validación → Revisión humana → Confirmar → Aplicar.
- **NO reemplaza el registro manual de pagos** (`addCommissionPayment`, ya existente desde antes de esta fase) — sigue siendo el camino de respaldo para carriers sin reporte compatible, ajustes y excepciones.
- **NO interpreta un valor faltante o la Asistencia como un chargeback automático.** Filas de tipo ajuste/chargeback futuras se mapearán explícitamente por adaptador cuando existan; el adaptador Orange/Oscar actual solo produce pagos (`PAYMENT`).

## Regla de negocio crítica: Orange/Oscar — `RECEIVED = Subtotal`, nunca `Total`

El primer formato real analizado ("REPORTE DE PAGO OSCAR AGOSTO ORANGE 2026") trae columnas `Subtotal`, `Asistencia` y `Total`, donde **`Total = Subtotal − Asistencia`**. La Asistencia es un proceso separado, fuera del alcance de esta conciliación — **nunca se resta del monto reconciliado ni se trata como chargeback**.

Ejemplo verbatim de la ficha (7 filas del reporte real):

| Cliente | Rate | Members | Subtotal (= RECEIVED) | Asistencia | Total |
|---|---|---|---|---|---|
| Viridiana Cabrales | 25 | 2 | **$50** | $6 | $44 |
| Leonardo Cardoso | 25 | 1 | $25 | — | — |
| Scarlen Luna Sanchez | 20 | 1 | $20 | — | — |
| Erynic Avila-Alvarez | 20 | 1 | $20 | — | — |
| Jaime Rubio Franco | 25 | 1 | $25 | — | — |
| Vanessa Campos | 25 | 3 | **$75** | — | — |
| Domingo Duque Vera | 18 | 1 | $18 | — | — |

**Total normalizado para conciliación: $233** (nunca $203 — la diferencia de $30 es Asistencia agregada, fuera de este proceso). Viridiana Cabrales registra un pago de **$50**, nunca $44. Cubierto por `orange-oscar-adapter.test.ts` (letras A-F).

## Arquitectura: adaptador plegable

```
Buffer (CSV/XLSX) → CommissionStatementAdapter.parse() → NormalizedCommissionRow[]
                                                              │
                                                     matchStatementRow() (3 niveles)
                                                              │
                                            CommissionStatement + CommissionStatementRow (persistido, PREVIEW)
                                                              │
                                    Vista previa (Expected/Received/Difference/Status) — ADMIN revisa
                                                              │
                                   Emparejamiento manual (UNMATCHED/AMBIGUOUS) o Ignorar
                                                              │
                                          Apply → CommissionPayment (type=PAYMENT) por fila MATCHED
```

Nunca se hardcodea lógica "si es Orange/Oscar entonces..." fuera de `orange-oscar-adapter.ts` — cualquier adaptador nuevo solo necesita implementar `CommissionStatementAdapter.parse()` y registrarse en `registry.ts`; el resto del pipeline (matching, persistencia, preview, apply, idempotencia) es genérico.

### `src/services/commission-statements/`

- **`types.ts`** — `NormalizedCommissionRow` (forma común de una fila, independiente del formato de origen), `ParsedStatement`, interfaz `CommissionStatementAdapter`.
- **`csv.ts`** — parser RFC4180 propio (sin dependencia nueva): comillas, comas/saltos de línea embebidos, `""` escapado.
- **`orange-oscar-adapter.ts`** — único adaptador implementado. Acepta `.csv` y `.xlsx` (vía `exceljs`, ya usado por el pipeline de import legacy). Mapea `receivedAmount` desde la columna `Subtotal`, nunca `Total`. Nunca se intentó un adaptador PDF: parsing por posición visual o OCR es frágil y la propia ficha permitió aceptar CSV/XLSX en su lugar — un adaptador PDF queda explícitamente pendiente si en el futuro solo existe ese formato.
- **`registry.ts`** — catálogo de adaptadores por `source` (string abierto, mismo principio que `AuditEvent.action` — un catálogo que crece por configuración, sin migración).
- **`matcher.ts`** — motor de emparejamiento, ver abajo.
- **`reconciliation.service.ts`** — orquestador: upload, preview, manual match, ignore, apply.

## `PolicyExternalReference` — por qué es un modelo nuevo

El "Member ID" del reporte Orange/Oscar (ej. `OSC74659064-01`) **nunca se asume igual a `Policy.policyNumber`** — son identificadores de sistemas distintos (el ID interno de la agencia vs. el número de póliza del carrier), y confundirlos habría producido falsos emparejamientos. `PolicyExternalReference` (`source`, `type`, `externalId`, único por los tres) guarda el vínculo aprendido la primera vez que un ADMIN confirma manualmente una fila — a partir de ahí, futuros reportes con el mismo `externalId` emparejan automáticamente (Nivel 1 del matcher). Nunca se sobreescribe un vínculo ya existente hacia una póliza distinta sin error explícito (`CONFLICT`).

## Emparejamiento (`matcher.ts`) — conservador por diseño

Tres niveles, en orden, el primero que produce un resultado gana:

1. **`PolicyExternalReference` exacto** (`source` + `type` + `externalId`) — el más confiable, aprendido de emparejamientos manuales previos.
2. **`Policy.policyNumber` exacto** — genérico, para un futuro adaptador que sí entregue un número de póliza real (Orange/Oscar nunca usa este nivel, su "Member ID" nunca se trata como `policyNumber`).
3. **Nombre completo exacto** (case-insensitive, trim) + carrier exacto si el adaptador lo provee — **autoconfirma solo si queda EXACTAMENTE un candidato**. Cero candidatos → `UNMATCHED`. Dos o más → `AMBIGUOUS`, nunca se autoconfirma por nombre con múltiples coincidencias.

`inferPeriod` prefiere el mes de `paidAt` sobre el de `effectiveDate` para buscar la `CommissionExpectation` del período correspondiente — el período de comisión nunca se asume igual a la fecha efectiva de la póliza.

## Vista previa y estados

Por cada fila, en tiempo de lectura (nunca almacenado, siempre derivado de `Prisma.Decimal`):

- `difference = receivedAmount − expectedAmount`
- `reviewState`: `MATCH` (diferencia cero) | `UNDERPAID` (recibido < esperado) | `OVERPAID` (recibido > esperado) | `NO_EXPECTATION` (emparejó una póliza pero no hay `CommissionExpectation` para ese período) | `UNMATCHED` | `AMBIGUOUS` | `IGNORED`

La tabla de vista previa muestra Cliente / External ID / Carrier / Esperado / Recibido / Diferencia / Estado — nunca carga pagos automáticamente al subir el archivo.

## Idempotencia

Dos capas, ambas estructurales (no solo una advertencia en UI):

1. **A nivel de reporte**: `CommissionStatement.fingerprint` (único) = hash sha256 de `source` + JSON canónico y ordenado de `{externalId-o-nombre, receivedAmount, paidAt, effectiveDate}` por fila — calculado ANTES de persistir. Subir el mismo contenido dos veces (incluso con nombre de archivo distinto) retorna `{ duplicate: true, existingStatementId }` sin crear un segundo `CommissionStatement`.
2. **A nivel de fila**: `CommissionPayment.statementRowId` es `@unique`, y `applyCommissionStatement` solo procesa filas `matchStatus: "MATCHED"` (nunca `"APPLIED"`) — reaplicar un reporte ya aplicado naturalmente procesa cero filas la segunda vez, sin necesitar lógica adicional de detección.

## Pagos parciales

Múltiples filas de reporte (incluso de reportes distintos) pueden sumar hacia una misma `CommissionExpectation` — cada `Apply` crea un `CommissionPayment` independiente vinculado a su propia fila; el total recibido de una expectativa siempre es la suma de sus pagos, nunca un valor único sobreescrito.

## `Apply` — qué crea exactamente

Por cada fila `MATCHED` de un `CommissionStatement`, en una única transacción:

- `CommissionPayment` con `type: "PAYMENT"`, `amount: row.receivedAmount`, `receivedAt: row.paidAt ?? row.effectiveDate ?? new Date()` — nunca se asume la fecha efectiva de la póliza como fecha de pago si el reporte trae "Paid At" real.
- La fila pasa a `matchStatus: "APPLIED"`.
- Un `AuditEvent` `COMMISSION_PAYMENT_FROM_STATEMENT` por pago (nunca registra el monto).

Al final, el `CommissionStatement` pasa a `status: "APPLIED"` con un `AuditEvent` `COMMISSION_STATEMENT_APPLY` resumen.

## Autorización

- **ADMIN**: único rol con acceso al módulo completo — subir, ver vista previa, emparejar manualmente, ignorar, aplicar. Decisión explícita (ver `docs/DECISIONS.md`, Fase 020): la ficha solo garantiza a AGENT "consultar sus propias comisiones" (el módulo ya existente y acotado por agente desde antes de esta fase) — nunca menciona acceso de AGENT a reportes de conciliación, que no son datos acotados por agente (un reporte trae filas de múltiples agentes a la vez).
- **AGENT**: sin acceso a `/commissions/reconciliation` ni a ninguna función de `reconciliation.service.ts` — sigue con acceso normal a sus propias comisiones (sin cambios).
- **ASSISTANT**: sin acceso al módulo de Comisiones en absoluto (regla ya existente, sin cambios).

## Seguridad de archivos

- Extensión validada contra `adapter.acceptedExtensions` (nunca se confía en el nombre del archivo).
- Tamaño máximo `MAX_STATEMENT_SIZE_BYTES = 5 MB`.
- Para `.xlsx`: verificación de firma binaria (`looksLikeZipArchive`, magic bytes `PK\x03\x04`) antes de pasarlo a `exceljs` — una señal más débil que las firmas PDF/PNG/JPEG/WEBP ya existentes (muchos formatos comparten la firma ZIP), pero suficiente para rechazar contenido obviamente no-XLSX. Alcance explícitamente limitado a subida de reportes de comisión — nunca se aplicó a `PolicyDocument` (que sigue solo PDF/PNG/JPEG/WEBP).
- El archivo original **nunca se guarda en Postgres** — si en el futuro se necesita conservar el binario para trazabilidad, debe usarse `FileStorage` (no implementado en esta fase, no es obligatorio).

## Pendiente / fuera de alcance de esta fase

- Adaptadores para otras agencias/carriers — solo Orange/Oscar está implementado; nunca se asumió que todas las agencias comparten su formato.
- Adaptador PDF para Orange/Oscar — diferido, CSV/XLSX cubre el caso real analizado.
- Filas de tipo chargeback/ajuste — el adaptador actual solo produce `PAYMENT`.
- Persistencia del archivo binario original (`FileStorage`).
