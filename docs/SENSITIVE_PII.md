# Identidad sensible del contacto (Fase 021)

Referencia central de SSN, USCIS/A-Number, información migratoria y documentos migratorios — la categoría de PII más sensible del CRM (por encima de salud/medicamentos, Fase 019.8). Ver también `docs/SECURITY.md` (autorización/cifrado), `docs/AUDIT_TRAIL.md` (eventos auditados) y `docs/DECISIONS.md` (razonamiento de arquitectura).

## Qué es y qué NO es

- **Información ADMINISTRATIVA registrada para operaciones de seguros** — nunca una determinación jurídica del estatus migratorio de una persona. `ImmigrationCategory` nunca se usa (aquí ni en ningún otro módulo) para concluir automáticamente elegibilidad de Marketplace, subsidio o Medicaid — esas reglas son independientes y pueden cambiar sin que este registro cambie.
- **Cifrado ≠ irrecuperable.** SSN, USCIS/A-Number y número de documento se cifran con AES-256-GCM (autenticado, recuperable) — nunca con un hash irreversible. El negocio necesita poder mostrar el valor completo bajo demanda a un usuario autorizado durante inscripciones/renovaciones/modificaciones en Marketplace.
- **Enmascarado por defecto, siempre.** Ningún endpoint, Server Component ni DTO envía el valor completo salvo que el usuario pulse "Mostrar" explícitamente.

## Modelo (`prisma/schema.prisma`, migración 013)

```prisma
model PersonSensitiveIdentity {
  id                   String              @id @default(uuid()) @db.Uuid
  personId             String              @unique @db.Uuid
  immigrationCategory  ImmigrationCategory @default(UNKNOWN)
  ssnEncrypted         String?
  ssnLast4             String?             @db.VarChar(4)
  uscisNumberEncrypted String?
  uscisNumberLast4     String?             @db.VarChar(4)
  createdAt            DateTime            @default(now())
  updatedAt            DateTime            @updatedAt
}

model PersonImmigrationDocument {
  id                      String                  @id @default(uuid()) @db.Uuid
  personId                String                  @db.Uuid
  documentType            ImmigrationDocumentType
  documentNumberEncrypted String?
  documentNumberLast4     String?                 @db.VarChar(4)
  issuedDate              DateTime?               @db.Date
  expirationDate          DateTime?               @db.Date
  isActive                Boolean                 @default(true)
}
```

- **`PersonSensitiveIdentity` es una extensión 1:1 de `Person`, deliberadamente SEPARADA** (mismo patrón que `HealthPolicyDetail` sobre `Policy`) — nunca columnas directas en `Person`. Así, ningún `select` amplio ya existente sobre `Person` (usado en decenas de servicios) puede incluir por accidente un campo cifrado solo por seleccionar campos que ya existían antes de esta fase.
- **USCIS/A-Number vive en `PersonSensitiveIdentity` (nivel de PERSONA), NUNCA duplicado por documento.** Es un identificador asignado por USCIS a la persona — el mismo número aparece en su tarjeta de residente y en su EAD si tiene ambos. `PersonImmigrationDocument.documentNumberEncrypted` es el número FÍSICO de cada documento (distinto por documento, ej. el número impreso en la tarjeta) — nunca se confunde con el A-Number. Ver `docs/DECISIONS.md` para el razonamiento completo de esta separación.
- **`isActive` en `PersonImmigrationDocument`** permite desactivar un documento vencido/reemplazado sin borrar su fila — mismo patrón que `PersonMedication.isActive`.
- **No se creó ningún modelo para el estatus migratorio "legal"** — `ImmigrationCategory` es un catálogo administrativo mínimo (`US_CITIZEN`, `LAWFUL_PERMANENT_RESIDENT`, `EMPLOYMENT_AUTHORIZATION`, `OTHER`, `UNKNOWN`), no un enum legal exhaustivo.

## Cifrado (`src/lib/pii-crypto.ts`)

- **AES-256-GCM** (cifrado autenticado: cualquier manipulación del ciphertext hace fallar el descifrado, nunca devuelve texto parcial o corrupto silenciosamente).
- **Formato versionado**: `v1:<iv>:<authTag>:<ciphertext>` (todo en base64) — permite migrar de algoritmo/clave en el futuro sin adivinar el formato de filas ya cifradas con `v1`. No se implementó KMS ni rotación automática en esta fase (ver "Pendiente" abajo).
- **`PII_ENCRYPTION_KEY`** (32 bytes, base64) — nunca en la base de datos, el repo, `NEXT_PUBLIC_*`, logs ni `AuditEvent`. Solo en `.env` local (dev, gitignored) o como secreto de producción independiente. Generación documentada en `.env.example` (sin incluir una key real). **Sin esta clave, los valores cifrados NUNCA son recuperables** — perderla equivale a perder esos datos (ver "Backups" abajo).
- **Errores de descifrado nunca exponen el ciphertext ni la clave** — mensaje genérico ("No se pudo recuperar el SSN.") tanto si el formato es inválido como si la autenticación GCM falla (ciphertext corrupto/manipulado o clave equivocada).

## Enmascarado (`src/lib/sensitive-identity-format.ts`)

| Campo | Enmascarado |
|---|---|
| SSN | `***-**-6789` |
| USCIS / A-Number | `*****1234` |
| Número de documento | `******9876` |

SSN se normaliza a 9 dígitos (acepta `123-45-6789` o `123456789`, rechaza cualquier otra longitud) antes de cifrar. USCIS/A-Number y número de documento usan normalización deliberadamente laxa (recorte de espacios, no vacío) — no todos los formatos entre estados/agencias son iguales.

## Autorización — DELIBERADAMENTE más estricta que `canEditPerson`

`sensitive-identity.service.ts` define su propio gate, `canAccessSensitiveIdentity`, **nunca reutiliza `canEditPerson`** (que trata a ASSISTANT como sin restricción para el resto del contacto):

| Rol | Ver (masked) | Registrar/editar/eliminar/revelar/copiar |
|---|---|---|
| ADMIN | Sí | Sí |
| AGENT | Sí, si tiene acceso operativo al contacto (mismo criterio que `canEditPerson`: sin agente asignado, o asignado a sí mismo) | Sí, mismo criterio |
| ASSISTANT | Sí | **Nunca** — ni siquiera para la categoría migratoria (no sensible por sí sola) o crear un documento |

Un AGENT que puede abrir un contacto **no necesariamente** puede descifrar sus identificadores — la vista "Ver" (`getSensitiveIdentitySummary`) es la única función de `sensitive-identity.service.ts` con el gate más permisivo; todo lo demás (incluida la categoría migratoria) usa el gate estricto.

## Nunca se envía el valor completo salvo bajo demanda

- **`getSensitiveIdentitySummary`** (el único DTO que llega a Contact Detail en la carga inicial de la página) retorna únicamente `{ hasValue, masked }` por campo — nunca `Encrypted` ni el valor en claro. Verificado estructuralmente por tests (`Object.keys(summary.ssn)` nunca incluye una clave adicional).
- **"Mostrar"** dispara una Server Action (`revealSsnAction`/`revealUscisNumberAction`/`revealImmigrationDocumentNumberAction`) — nunca cacheable (una Server Action de Next.js siempre se ejecuta como POST). El valor vive solo en estado de React (`RevealableField`) — recargar, navegar o desmontar el componente vuelve a mostrar el enmascarado; nunca se persiste en `localStorage`/`sessionStorage`/cookies.
- **"Copiar"** usa `navigator.clipboard.writeText` en el navegador — el valor ya revelado nunca se reenvía al servidor solo para copiarlo.
- **Editar nunca precarga el valor completo.** `SensitiveValueManager`/`ImmigrationDocumentDialog` solo ofrecen "Reemplazar" (input vacío) — abrir el formulario de edición nunca descifra nada por sí solo.

## Auditoría (`AuditEvent`)

`SSN_SET`/`SSN_UPDATE`/`SSN_REMOVED`/`SSN_REVEALED`, `USCIS_SET`/`USCIS_UPDATE`/`USCIS_REMOVED`/`USCIS_REVEALED`, `IMMIGRATION_CATEGORY_UPDATE`, `IMMIGRATION_DOCUMENT_CREATE`/`UPDATE`/`DEACTIVATE`/`REVEALED`. **Ninguno de estos eventos incluye el valor en claro ni siquiera parcial** — `summary` es siempre un texto genérico ("SSN consultado para operación autorizada") y `changes` nunca incluye estos campos en su allowlist (`buildDiff` solo se llama con `["immigrationCategory"]` o los campos no sensibles de un documento). Ver `docs/AUDIT_TRAIL.md` para el catálogo completo.

## Exclusiones estructurales

- **Búsqueda global (`search.service.ts`) nunca busca por SSN/USCIS/A-Number/número de documento** — ni siquiera ADMIN. Esos campos no forman parte de ningún `where` de `globalSearch`.
- **Reporte de clientes y su exportación CSV (`reports.service.ts`/`export.service.ts`) nunca incluyen SSN/USCIS/A-Number/número de documento** — solo `Immigration Category` (una categoría administrativa, no un identificador).
- **CSV de Contactos/Pólizas/Comisiones** (Fase 020) tampoco los incluyen — nunca formaron parte de sus columnas.

## Pendiente / fuera de alcance de esta fase

- **Rotación de `PII_ENCRYPTION_KEY` / KMS** — el formato versionado (`v1:...`) lo permite en el futuro, pero no se implementó un mecanismo de rotación ni un KMS externo en esta fase (ver §10 de la ficha: "no implementar KMS complejo todavía").
- **Import legacy real de SSN/USCIS del Excel** — esta fase solo prepara el destino seguro (schema, cifrado, UI). El Excel legacy sigue sin importarse (`EXCLUDED_SENSITIVE_COLUMNS` en `src/import/sensitive.ts` sigue excluyendo esas columnas). Una fase futura explícita ("Secure Legacy Import") decidirá cómo migrar esos valores reales sin pasar por texto plano en ningún punto del pipeline.
- **Persistencia de un escaneo/foto del documento físico** — este módulo registra solo el NÚMERO del documento (cifrado), nunca un archivo adjunto del documento en sí.
