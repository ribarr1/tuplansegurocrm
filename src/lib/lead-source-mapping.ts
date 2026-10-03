import "server-only";
import crypto from "node:crypto";
import { z } from "zod";
import { US_STATE_CODES } from "@/lib/us-states";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";

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

// ---------------------------------------------------------------------------
// Identificadores externos y valores opcionales (regresión de producción).
//
// Google documenta `form_id`/`campaign_id`/`adgroup_id`/`creative_id`
// como enteros de 64 bits y Meta envía `leadgen_id`/`page_id`/`form_id`/
// `ad_id` como NÚMEROS en la notificación del webhook (ver docs/
// LEAD_SOURCES_OFFICIAL_REFERENCES.md) — `leadIntakeSchema` exige
// string, así que se normalizan aquí, en el adaptador, nunca en el
// contrato interno.
// ---------------------------------------------------------------------------

// Un entero JSON de 16+ dígitos puede superar Number.MAX_SAFE_INTEGER y
// perder precisión EN SILENCIO al hacer JSON.parse. Se citan en el
// texto crudo ANTES de parsear (solo para claves de identificador
// conocidas), conservando los dígitos exactos como string.
const BIG_INTEGER_ID_KEYS = [
  "lead_id",
  "form_id",
  "campaign_id",
  "adgroup_id",
  "creative_id",
  "asset_group_id",
  "leadgen_id",
  "page_id",
  "ad_id",
  "id",
];
const BIG_INTEGER_ID_KEY_SET: ReadonlySet<string> = new Set(BIG_INTEGER_ID_KEYS);
// Contenedores con respuestas del usuario (Google: user_column_data;
// Meta: field_data): nada dentro de ellos se toca nunca.
const CUSTOM_ANSWER_CONTAINERS: ReadonlySet<string> = new Set(["user_column_data", "field_data"]);
const JSON_NUMBER_AT_CURSOR = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const BIG_INTEGER_TOKEN = /^-?\d{16,}$/;

// Escáner de un solo paso (no una regex sobre el texto completo): lleva
// el estado de cadena (con escapes) y la pila de contenedores, así que
// SOLO cita un número cuando (1) está fuera de toda cadena, (2) es un
// entero puro de 16+ dígitos (sin decimales ni exponente), (3) su clave
// directa es exactamente un identificador previsto y (4) no está dentro
// de respuestas personalizadas. Todo lo demás se copia byte a byte. En
// JSON malformado no inventa nada: JSON.parse lo rechazará después.
export function quoteLargeIntegerIds(rawJson: string): string {
  let out = "";
  let i = 0;
  const n = rawJson.length;
  const stack: (string | null)[] = []; // clave que introdujo cada contenedor abierto
  let currentKey: string | null = null; // clave cuyo valor viene a continuación

  while (i < n) {
    const ch = rawJson[i];

    if (ch === '"') {
      let end = i + 1;
      while (end < n && rawJson[end] !== '"') end += rawJson[end] === "\\" ? 2 : 1;
      const token = rawJson.slice(i, end + 1);
      out += token;
      i = end + 1;
      // ¿Es una clave? (le sigue un ":" tras espacios en blanco)
      let look = i;
      while (look < n && /\s/.test(rawJson[look])) look++;
      if (rawJson[look] === ":") {
        try {
          currentKey = JSON.parse(token) as string;
        } catch {
          currentKey = null;
        }
      } else {
        currentKey = null;
      }
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(currentKey);
      currentKey = null;
    } else if (ch === "}" || ch === "]") {
      stack.pop();
      currentKey = null;
    } else if (ch === ",") {
      currentKey = null;
    } else if (ch === "-" || (ch >= "0" && ch <= "9")) {
      JSON_NUMBER_AT_CURSOR.lastIndex = i;
      const match = JSON_NUMBER_AT_CURSOR.exec(rawJson);
      if (match) {
        const token = match[0];
        const insideCustomAnswers = stack.some((k) => k !== null && CUSTOM_ANSWER_CONTAINERS.has(k));
        const quote =
          currentKey !== null &&
          BIG_INTEGER_ID_KEY_SET.has(currentKey) &&
          !insideCustomAnswers &&
          BIG_INTEGER_TOKEN.test(token);
        out += quote ? `"${token}"` : token;
        i += token.length;
        currentKey = null;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

// null/undefined/"" -> undefined (nunca la cadena "null"/"undefined").
// string -> recortado. number -> solo entero seguro y no negativo
// (cualquier otro número se rechaza: perdió o pudo perder precisión).
// Cualquier otro tipo (objeto, boolean, array) se rechaza.
// El mensaje de error nunca incluye el valor recibido.
export function toExternalId(value: unknown, fieldName: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value >= 0) return String(value);
    throw new Error(`${fieldName}: identificador numérico no seguro (posible pérdida de precisión).`);
  }
  throw new Error(`${fieldName}: tipo de identificador no soportado.`);
}

const optionalEmailSchema = z.email();

function nonBlank(value: string | undefined): string | undefined {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed ? trimmed : undefined;
}

// Valores OPCIONALES que el intake valida contra un catálogo/formato
// estricto: si no coinciden EXACTAMENTE (tras recortar y, en
// estado/producto, pasar a mayúsculas), NO se "adivinan" ni se
// traducen — el llamador los deja en `formResponses` con su etiqueta
// original y el campo interno queda ausente. Así un "California" (en
// vez de "CA") o un correo mal escrito nunca hace fallar el lead
// completo, y el dato original no se pierde.
export function asStateCode(value: string | undefined): string | undefined {
  const candidate = nonBlank(value)?.toUpperCase();
  return candidate && (US_STATE_CODES as readonly string[]).includes(candidate) ? candidate : undefined;
}

export function asProductType(value: string | undefined): string | undefined {
  const candidate = nonBlank(value)?.toUpperCase();
  return candidate && (POLICY_TYPE_VALUES as readonly string[]).includes(candidate) ? candidate : undefined;
}

export function asEmail(value: string | undefined): string | undefined {
  const candidate = nonBlank(value);
  return candidate && optionalEmailSchema.safeParse(candidate).success ? candidate : undefined;
}

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

// Los identificadores llegan como número (form_id/campaign_id/
// adgroup_id/creative_id: enteros de 64 bits) o string (lead_id/
// gcl_id) — ver toExternalId. `google_key` NUNCA se mapea a ningún
// campo del lead ni a formResponses (solo se usa para autenticar en
// la ruta, que además lo redacta antes de guardar el evento).
export type GoogleLeadWebhookPayload = {
  lead_id: string | number;
  user_column_data?: { column_id: string; column_name?: string; string_value: string }[];
  api_version?: string;
  form_id?: string | number;
  campaign_id?: string | number;
  adgroup_id?: string | number;
  creative_id?: string | number;
  gcl_id?: string;
  google_key: string;
  is_test?: boolean;
  lead_submit_time?: string;
  lead_source?: string;
};

// `is_test: true` (envío de prueba desde la consola de Google Ads) se
// procesa IGUAL que un lead real: crea un Lead normal. Es una
// decisión deliberada — permite verificar la tubería completa
// (webhook -> cola -> worker -> lead visible) con la prueba oficial de
// Google; el lead de prueba se identifica por su contenido y se cierra
// manualmente. Ver docs/LEAD_FACTORY_UAT.md.
export function mapGoogleLeadToIntakePayload(
  body: GoogleLeadWebhookPayload,
  customMapping?: CustomFieldMapping
): MappedIntakePayload {
  const mapped: MappedIntakePayload = {
    externalId: toExternalId(body.lead_id, "lead_id"),
    campaignId: toExternalId(body.campaign_id, "campaign_id"),
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
    const label = column.column_name ?? column.column_id;
    const target = GOOGLE_STANDARD_COLUMN_IDS[column.column_id as keyof typeof GOOGLE_STANDARD_COLUMN_IDS];
    if (target === "email") {
      const email = asEmail(column.string_value);
      if (email) mapped.email = email;
      else if (nonBlank(column.string_value)) formResponses[label] = column.string_value;
      continue;
    }
    if (target) {
      mapped[target] = column.string_value;
      continue;
    }
    const custom = customTargets.find(
      (c) => c.fieldKey === column.column_id || c.fieldKey === column.column_name
    );
    if (custom) {
      const value =
        custom.target === "residenceState" ? asStateCode(column.string_value) : asProductType(column.string_value);
      if (value) {
        mapped[custom.target] = value;
        continue;
      }
      // Valor presente pero fuera del catálogo del CRM (ej. "California"
      // en vez de "CA"): se conserva tal cual en formResponses.
    }
    formResponses[label] = column.string_value;
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

  // `consumed` = nombres de campo (minúsculas) que SÍ se llevaron a un
  // campo interno; todo lo demás (incluido un valor presente pero
  // inválido para su campo, ej. state="Florida") queda en
  // formResponses con su nombre original.
  const consumed = new Set<string>();

  for (const [target, candidates] of Object.entries(META_FIELD_CANDIDATES) as [
    keyof typeof META_FIELD_CANDIDATES,
    string[],
  ][]) {
    for (const candidate of candidates) {
      const raw = byName.get(candidate);
      if (raw === undefined) continue;
      const value =
        target === "residenceState" ? asStateCode(raw) : target === "email" ? asEmail(raw) : raw;
      if (value !== undefined) {
        mapped[target] = value;
        consumed.add(candidate);
        break;
      }
    }
  }

  // first_name + last_name por separado, si no vino full_name directo.
  if (!mapped.fullName) {
    const first = byName.get("first_name");
    const last = byName.get("last_name");
    if (first || last) {
      mapped.fullName = [first, last].filter(Boolean).join(" ");
      consumed.add("first_name");
      consumed.add("last_name");
    }
  }
  // Los nombres/teléfonos estándar siempre se consideran consumidos
  // aunque el valor ya viniera mapeado por otro candidato.
  if (mapped.fullName) for (const c of META_FIELD_CANDIDATES.fullName) if (byName.has(c)) consumed.add(c);
  if (mapped.phone) for (const c of META_FIELD_CANDIDATES.phone) if (byName.has(c)) consumed.add(c);

  // Mapeo personalizado (§6) — solo se aplica a campos que no
  // coincidieron ya con un candidato estándar; nunca sobrescribe
  // `state` si Meta ya lo mandó como campo estándar válido.
  if (customMapping?.residenceStateFieldKey && mapped.residenceState === undefined) {
    const key = customMapping.residenceStateFieldKey.toLowerCase();
    const value = asStateCode(byName.get(key));
    if (value) {
      mapped.residenceState = value;
      consumed.add(key);
    }
  }
  if (customMapping?.productInterestFieldKey) {
    const key = customMapping.productInterestFieldKey.toLowerCase();
    const value = asProductType(byName.get(key));
    if (value) {
      mapped.productInterest = value;
      consumed.add(key);
    }
  }

  const formResponses: Record<string, unknown> = {};
  for (const field of fieldData) {
    if (!consumed.has(field.name.toLowerCase())) {
      formResponses[field.name] = field.values?.length === 1 ? field.values[0] : field.values;
    }
  }
  if (Object.keys(formResponses).length > 0) mapped.formResponses = formResponses;

  // Meta no expone un campo de consentimiento explícito separado en
  // field_data — mismo criterio que Google: nunca se infiere, queda
  // ausente.
  return mapped;
}
