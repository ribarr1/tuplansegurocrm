# Configuración de Resend — dominio `tuplansegurousa.com`

Documentación de referencia para verificar el dominio en [Resend](https://resend.com) y activar el envío real de correos transaccionales (invitaciones, recuperación de contraseña, cambios de contraseña/correo). **Ninguno de estos pasos se ejecutó** — este documento es una guía para que un operador con acceso al panel de DNS del dominio los realice cuando corresponda. No modifica DNS ni producción.

## 1. Crear el dominio en Resend

1. Iniciar sesión en el panel de Resend → **Domains** → **Add Domain**.
2. Ingresar `tuplansegurousa.com`.
3. Resend genera automáticamente los registros DNS exactos a agregar (SPF, DKIM y, opcionalmente, DMARC). **Los valores exactos los genera Resend en el momento** — no se deben inventar ni copiar de otro dominio; cada dominio recibe claves DKIM únicas.

## 2. Registros DNS típicos que Resend pedirá agregar

| Tipo | Host | Propósito |
|------|------|-----------|
| `TXT` | `send.tuplansegurousa.com` (o similar) | SPF — autoriza a los servidores de Resend a enviar en nombre del dominio. |
| `CNAME` / `TXT` (DKIM) | `resend._domainkey.tuplansegurousa.com` (nombre exacto lo da Resend) | DKIM — firma criptográfica de cada correo saliente. |
| `MX` (opcional, solo si se usa la dirección para *recibir* rebotes) | `send.tuplansegurousa.com` | Manejo de rebotes de Resend. |
| `TXT` (recomendado, no exigido por Resend) | `_dmarc.tuplansegurousa.com` | DMARC — política de qué hacer con correos que fallen SPF/DKIM (ej. `v=DMARC1; p=none; rua=mailto:dmarc-reports@tuplansegurousa.com`). |

Los valores exactos (nombre de host completo, valor del registro) **siempre deben tomarse de la pantalla de verificación de Resend en el momento de configurarlo**, nunca de esta tabla — Resend puede cambiar el formato exacto entre cuentas/planes.

## 3. Verificar

Resend valida los registros automáticamente unos minutos después de que propaguen (la propagación de DNS puede tardar hasta 24-48 horas, normalmente mucho menos). El estado del dominio pasa a "Verified" en el panel.

## 4. Elegir la dirección de envío

Una vez verificado el dominio, cualquier dirección `@tuplansegurousa.com` puede usarse como `EMAIL_FROM` (ej. `no-reply@tuplansegurousa.com`) sin necesidad de verificar cada dirección por separado — la verificación es a nivel de DOMINIO.

## 5. Variables de entorno a actualizar (fuera de este repositorio)

En el entorno real (nunca en este repositorio ni en `.env` versionado):

```env
RESEND_API_KEY=<API key real de la cuenta de Resend>
EMAIL_FROM=no-reply@tuplansegurousa.com
EMAIL_REPLY_TO=soporte@tuplansegurousa.com   # opcional
APP_URL=https://<dominio real de la app en producción>   # debe ser HTTPS
```

## 6. Qué NO hacer

- No usar una dirección `@gmail.com`/`@outlook.com`/etc. como `EMAIL_FROM` — Resend exige un dominio propio verificado para envío transaccional confiable.
- No reutilizar la misma `RESEND_API_KEY` entre entornos (dev/staging/producción) — generar una API key separada por entorno en el panel de Resend, con el alcance mínimo necesario (solo envío, "Sending access").
- No modificar los registros DNS del dominio de producción como parte de un cambio de código — es una operación de infraestructura independiente, ejecutada por quien administra el DNS.
