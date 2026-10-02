import "server-only";
import crypto from "node:crypto";

// ---------------------------------------------------------------------------
// Mapeo de los payloads NATIVOS de Google/Meta hacia el formato interno
// de intakeLead (leadIntakeSchema) — Fase 026, Preparación para
// producción (§5D). Fuentes oficiales, fecha de revisión y versiones
// exactas: ver docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md.
//
// NUNCA inventa datos ni consentimiento: un campo que la plataforma no
// envía queda `undefined`/ausente, nunca se rellena con un valor
// supuesto. Los campos no reconocidos se conservan íntegros en
// `formResponses` — nunca se descartan en silencio.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Mapeo de preguntas PERSONALIZADAS (§6, Preparación para producción)
// — configurable por ADMIN por credencial, SIN desplegar código cada
// vez que cambia un formulario (ver `LeadIntegrationCredential.
// customFieldMapping`, UI en /settings/lead-credentials). Un
// `fieldKey` ausente o que no aparece en el payload real NUNCA se
// inventa — el campo simplemente queda sin mapear (visible igual en
// `formResponses`, nunca se pierde el dato).
//
// Para Google, `fieldKey` se compara contra `column_name` O
// `column_id` (lo que el ADMIN tenga a mano al configurar — el
// `column_id` es el identificador técnico, `column_name` es la
// etiqueta de la pregunta tal como la ve el usuario final).
// Para Meta, contra `field_data[].name` (case-insensitive, igual
// criterio que los candidatos estándar).
// ---------------------------------------------------------------------------
export type CustomFieldMapping = {
  residenceStateFieldKey?: string;
  productInterestFieldKey?: string;
};

export type MappedIntakePayload = {
  fullName?: string;
  phone?: string;
  email?: string;
  residenceState?: string;
  productInterest?: string;
  externalId?: string;
  campaignId?: string;
  campaignName?: string;
  originalInquiryAt?: string;
  consentGiven?: boolean | null;
  consentText?: string;
  consentSource?: string;
  formResponses?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// GOOGLE — Lead Form Extensions, entrega por webhook.
// Campos documentados del payload: lead_id, user_column_data[],
// api_version, form_id, campaign_id, adgroup_id, creative_id, gcl_id,
// google_key, is_test, lead_submit_time, lead_source.
//
// `user_column_data[].column_id` para las preguntas ESTÁNDAR de Google
// usa valores fijos conocidos (FULL_NAME, PHONE_NUMBER, EMAIL) — para
// preguntas PERSONALIZADAS (ej. "Estado de residencia", "Producto de
// interés"), Google asigna un `column_id` arbitrario definido al crear
// el formulario, que esta función no puede adivinar de forma
// GENÉRICA. Por eso acepta un `customMapping` OPCIONAL (configurado
// por ADMIN en /settings/lead-credentials, por credencial — ver
// `CustomFieldMapping` arriba) con el `column_id`/`column_name` real
// de ESE formulario específico. Sin ese mapeo configurado, la
// respuesta se conserva completa en `formResponses`, nunca se
// descarta ni se adivina — ver docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md.
// ---------------------------------------------------------------------------
const GOOGLE_STANDARD_COLUMN_IDS = {
  FULL_NAME: "fullName",
  PHONE_NUMBER: "phone",
  EMAIL: "email",
} as const;

export type GoogleLeadWebhookPayload = {
  lead_id: string;
  user_column_data?: { column_id: string; column_name?: string; string_value: string }[];
  api_version?: string;
  form_id?: string;
  campaign_id?: string;
  adgroup_id?: string;
  creative_id?: string;
  gcl_id?: string;
  google_key: string;
  is_test?: boolean;
  lead_submit_time?: string;
  lead_source?: string;
};

export function mapGoogleLeadToIntakePayload(
  body: GoogleLeadWebhookPayload,
  customMapping?: CustomFieldMapping
): MappedIntakePayload {
  const mapped: MappedIntakePayload = {
    externalId: body.lead_id,
    campaignId: body.campaign_id,
    originalInquiryAt: body.lead_submit_time,
  };
  const formResponses: Record<string, unknown> = {};
  const customTargets: { fieldKey: string; target: "residenceState" | "productInterest" }[] = [];
  if (customMapping?.residenceStateFieldKey) {
    customTargets.push({ fieldKey: customMapping.residenceStateFieldKey, target: "residenceState" });
  }
  if (customMapping?.productInterestFieldKey) {
    customTargets.push({ fieldKey: customMapping.productInterestFieldKey, target: "productInterest" });
  }

  for (const column of body.user_column_data ?? []) {
    const target = GOOGLE_STANDARD_COLUMN_IDS[column.column_id as keyof typeof GOOGLE_STANDARD_COLUMN_IDS];
    if (target) {
      mapped[target] = column.string_value;
      continue;
    }
    const custom = customTargets.find(
      (c) => c.fieldKey === column.column_id || c.fieldKey === column.column_name
    );
    if (custom) {
      mapped[custom.target] = column.string_value;
      continue;
    }
    formResponses[column.column_name ?? column.column_id] = column.string_value;
  }

  if (Object.keys(formResponses).length > 0) mapped.formResponses = formResponses;
  // Google Lead Form Extensions no incluye un campo de consentimiento
  // explícito en el payload del webhook — nunca se infiere ni se
  // marca como otorgado; queda ausente (null en el Lead, ver
  // leadIntakeSchema/Lead.consentGiven).
  return mapped;
}

// ---------------------------------------------------------------------------
// Verificación META — handshake de suscripción (hub.verify_token) y
// firma de eventos (X-Hub-Signature-256, HMAC-SHA256 del cuerpo crudo
// con el App Secret). Extraídas aquí (en vez de vivir solo en la
// ruta) para poder probarlas de forma aislada — ver
// lead-source-mapping.test.ts.
// ---------------------------------------------------------------------------
export function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function verifyMetaSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const expectedBuf = Buffer.from(expected, "hex");
  const receivedBuf = Buffer.from(received, "hex");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

export function verifyGoogleWebhookKey(receivedKey: string | undefined, expectedKey: string): boolean {
  if (!receivedKey) return false;
  const a = Buffer.from(receivedKey);
  const b = Buffer.from(expectedKey);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// META — Lead Ads, field_data obtenido vía Graph API a partir de
// leadgen_id (el webhook en sí NUNCA trae los datos, solo el id — ver
// docs/LEAD_SOURCES_OFFICIAL_REFERENCES.md).
//
// Los nombres de campo (`field_data[].name`) de las preguntas
// ESTÁNDAR de Meta son razonablemente consistentes (full_name,
// first_name, last_name, email, phone_number, state) pero Meta permite
// variaciones según versión/configuración del formulario — se prueban
// varias claves candidatas por campo; lo no reconocido se conserva
// íntegro en `formResponses`. Confirmar los nombres REALES contra un
// lead de prueba del formulario configurado antes de producción (no
// se puede garantizar de forma genérica sin esa verificación).
// ---------------------------------------------------------------------------
type MetaFieldDatum = { name: string; values: string[] };

const META_FIELD_CANDIDATES: Record<keyof Pick<MappedIntakePayload, "fullName" | "phone" | "email" | "residenceState">, string[]> = {
  fullName: ["full_name", "name"],
  phone: ["phone_number", "phone"],
  email: ["email", "work_email"],
  residenceState: ["state"],
};

export function mapMetaFieldDataToIntakePayload(
  fieldData: MetaFieldDatum[],
  meta: { leadgenId: string; createdTime?: string; campaignId?: string; campaignName?: string },
  customMapping?: CustomFieldMapping
): MappedIntakePayload {
  const byName = new Map(fieldData.map((f) => [f.name.toLowerCase(), f.values?.[0]]));
  const mapped: MappedIntakePayload = {
    externalId: meta.leadgenId,
    originalInquiryAt: meta.createdTime,
    campaignId: meta.campaignId,
    campaignName: meta.campaignName,
  };

  for (const [target, candidates] of Object.entries(META_FIELD_CANDIDATES) as [
    keyof typeof META_FIELD_CANDIDATES,
    string[],
  ][]) {
    for (const candidate of candidates) {
      const value = byName.get(candidate);
      if (value !== undefined) {
        mapped[target] = value;
        break;
      }
    }
  }

  // first_name + last_name por separado, si no vino full_name directo.
  if (!mapped.fullName) {
    const first = byName.get("first_name");
    const last = byName.get("last_name");
    if (first || last) mapped.fullName = [first, last].filter(Boolean).join(" ");
  }

  const mappedNames = new Set<string>();
  for (const candidates of Object.values(META_FIELD_CANDIDATES)) candidates.forEach((c) => mappedNames.add(c));
  mappedNames.add("first_name");
  mappedNames.add("last_name");

  // Mapeo personalizado (§6) — solo se aplica a campos que no
  // coincidieron ya con un candidato estándar; nunca sobrescribe
  // `state` si Meta ya lo mandó como campo estándar.
  if (customMapping?.residenceStateFieldKey && mapped.residenceState === undefined) {
    const value = byName.get(customMapping.residenceStateFieldKey.toLowerCase());
    if (value !== undefined) {
      mapped.residenceState = value;
      mappedNames.add(customMapping.residenceStateFieldKey.toLowerCase());
    }
  }
  if (customMapping?.productInterestFieldKey) {
    const value = byName.get(customMapping.productInterestFieldKey.toLowerCase());
    if (value !== undefined) {
      mapped.productInterest = value;
      mappedNames.add(customMapping.productInterestFieldKey.toLowerCase());
    }
  }

  const formResponses: Record<string, unknown> = {};
  for (const field of fieldData) {
    if (!mappedNames.has(field.name.toLowerCase())) {
      formResponses[field.name] = field.values?.length === 1 ? field.values[0] : field.values;
    }
  }
  if (Object.keys(formResponses).length > 0) mapped.formResponses = formResponses;

  // Meta no expone un campo de consentimiento explícito separado en
  // field_data — mismo criterio que Google: nunca se infiere, queda
  // ausente.
  return mapped;
}
