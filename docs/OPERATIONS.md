# Operación: jobs automáticos (Fase 025)

Referencia para correr manualmente los jobs de mantenimiento del CRM. Ver también `docs/DECISIONS.md` (razonamiento de diseño) y `docs/AUDIT_TRAIL.md` (eventos auditados).

## Reconciliación del ciclo de vida de pólizas

**Qué hace**: aplica automáticamente las transiciones de estado que no requieren una decisión humana:

- `PENDING` → `ACTIVE` cuando `effectiveDate <= día de negocio actual`.
- `ACTIVE` → `EXPIRED` cuando `terminationDate < día de negocio actual` (una póliza con `terminationDate = 12/31` sigue `ACTIVE` el 12/31 mismo; pasa a `EXPIRED` a partir del 1/1).
- `CANCELLED` y `EXPIRED` **nunca** se reactivan automáticamente, sea cual sea su fecha.

Cada cambio genera un `AuditEvent` con actor `SYSTEM` (`POLICY_AUTO_ACTIVATED` / `POLICY_AUTO_EXPIRED`) y recomputa Prospecto/Cliente (`recomputePersonContactStatus`) para el titular y cada miembro cubierto — la misma regla que ya aplica cuando un agente cambia el estado manualmente.

**El "día de negocio" siempre viene de `APP_TIME_ZONE`** (variable de entorno, identificador IANA — ej. `America/Chicago`), nunca de la zona horaria del navegador ni de la del proceso Node. Si `APP_TIME_ZONE` falta o es inválido, el job falla de inmediato con un mensaje claro, antes de tocar ninguna fila.

### Correr manualmente

```bash
npm run jobs:policy-lifecycle
```

Salida esperada (segura para logs — nunca nombres de clientes ni otro PII, solo conteos):

```
[policy-lifecycle] Zona horaria de negocio: America/Chicago
[policy-lifecycle] Día de negocio: 2026-09-04
[policy-lifecycle] Pólizas activadas (PENDING -> ACTIVE): 2
[policy-lifecycle] Pólizas expiradas (ACTIVE -> EXPIRED): 0
[policy-lifecycle] Reconciliación completada.
```

Código de salida `0` en éxito, `1` si ocurre un error (variable de entorno faltante, error de base de datos, etc.) — apto para monitoreo externo (ej. alertar si un cron falla).

### Idempotencia

Correr el job varias veces el mismo día no duplica nada: cada consulta interna solo selecciona filas que **todavía** están en el estado de origen (`PENDING`/`ACTIVE`), así que una póliza ya procesada deja de coincidir en la siguiente corrida. Es seguro reintentar tras un fallo a mitad de ejecución (cada póliza se actualiza en su propia transacción).

### Troubleshooting

- **"APP_TIME_ZONE no está configurado"**: definir la variable en `.env` (ej. `APP_TIME_ZONE=America/Chicago`) antes de correr el job.
- **"APP_TIME_ZONE inválido"**: el valor no es un identificador de zona horaria IANA reconocido — verificar contra la [lista de la tz database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
- **El job corre pero no activa/expira nada esperado**: revisar que las pólizas en cuestión realmente tengan `effectiveDate`/`terminationDate` poblados — una `PENDING` sin `effectiveDate` nunca se activa automáticamente (le faltan los datos requeridos para ser `ACTIVE`, ver `docs/DECISIONS.md`); esto es intencional, no un bug.
- Para investigar qué cambió una corrida específica, filtrar `AuditEvent` por `action IN ('POLICY_AUTO_ACTIVATED', 'POLICY_AUTO_EXPIRED')` y `actorType = 'SYSTEM'`.

### Futuro: cron en producción (NO configurado todavía)

Este job **no** tiene una tarea programada en producción — correrlo hoy es exclusivamente manual. Cuando se autorice, el ejemplo conceptual (VPS con Docker, hora de negocio 06:00) sería:

```cron
# 06:00 hora de negocio — ajustar la hora del contenedor/host o usar
# TZ=America/Chicago explícito según cómo se despliegue.
0 6 * * * cd /app && npm run jobs:policy-lifecycle >> /var/log/tuplanseguro/policy-lifecycle.log 2>&1
```

Antes de activar esto en producción: confirmar backups de la base de datos, y que el log destino no se llene sin rotación (`logrotate` u equivalente). **NO PRODUCCIÓN. NO DEPLOY** hasta autorización explícita — ver CLAUDE.md.
