# Seguridad

Notas de seguridad específicas del proyecto. No es una política general — solo decisiones concretas que no son obvias a partir del código.

## Información médica operacional (`PersonProvider`, `PersonMedication`)

Estas dos tablas contienen información más sensible que el resto del CRM, aunque deliberadamente limitada a datos operativos (proveedores conocidos, medicamentos informados) — el CRM no es un sistema clínico y no almacena diagnósticos ni historial médico (ver [DECISIONS.md](./DECISIONS.md)).

Mientras no exista autenticación:

- No hay controles de acceso implementados todavía — esto es un riesgo aceptado temporalmente, propio de esta fase del proyecto (base técnica sin Auth).

Cuando se implemente autenticación y roles (`ADMIN`/`AGENT`/`ASSISTANT`), aplicar para `PersonProvider` y `PersonMedication`:

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
- `User` (usuario interno) no tiene campos de autenticación todavía (sin password/sesiones/MFA) — se diseñarán en una migración dedicada.

## Variables de entorno y secretos

- `.env` está excluido de Git (`.gitignore`); solo `.env.example` con valores ficticios se versiona.
- `DATABASE_URL` y credenciales de PostgreSQL viven únicamente en `.env` local, nunca hardcodeadas en `schema.prisma`, código fuente o configuración versionada.
