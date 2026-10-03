import { describe, it, expect } from "vitest";
import {
  mapGoogleLeadToIntakePayload,
  mapMetaFieldDataToIntakePayload,
  quoteLargeIntegerIds,
  toExternalId,
} from "./lead-source-mapping";

// ---------------------------------------------------------------------------
// Regresión de producción — payload REAL de la prueba de Google Ads
// (is_test=true). campaign_id/form_id/adgroup_id/creative_id llegan como
// NÚMERO; el worker falló con "campaignId: Invalid input: expected
// string, received number". La google_key del fixture es un
// placeholder, nunca la real.
// ---------------------------------------------------------------------------
const GOOGLE_TEST_PAYLOAD_RAW = `{
  "lead_id": "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBbCcDdEeFfGgHhIiJjKkLl",
  "user_column_data": [
    { "column_name": "Full Name", "string_value": "FirstName LastName", "column_id": "FULL_NAME" },
    { "column_name": "User Email", "string_value": "test@example.com", "column_id": "EMAIL" },
    { "column_name": "User Phone", "string_value": "+16505550123", "column_id": "PHONE_NUMBER" },
    { "column_name": "City", "string_value": "Mountain View", "column_id": "CITY" },
    { "column_name": "Postal Code", "string_value": "94043", "column_id": "POSTAL_CODE" },
    { "column_name": "Region", "string_value": "California", "column_id": "REGION" }
  ],
  "api_version": "1.0",
  "form_id": 349080077126,
  "campaign_id": 23729418209,
  "google_key": "REPLACE_WITH_TEST_GOOGLE_KEY",
  "is_test": true,
  "gcl_id": "TeSter-123-ABCDEFGHIJKLMNOPQRSTUVWXYZ-abcdefghijklmnopqrstuvwxyz-0123456789-AaBbCcDdEeFfGgHhIiJjKkLl",
  "adgroup_id": 195583084496,
  "creative_id": 30000000000
}`;

describe("adaptador Google — payload real (is_test) y tipos de identificadores", () => {
  const payload = JSON.parse(quoteLargeIntegerIds(GOOGLE_TEST_PAYLOAD_RAW));

  it("P) mapea nombre/correo/teléfono y convierte campaign_id numérico a TEXTO", () => {
    const mapped = mapGoogleLeadToIntakePayload(payload);
    expect(mapped.fullName).toBe("FirstName LastName");
    expect(mapped.email).toBe("test@example.com");
    expect(mapped.phone).toBe("+16505550123");
    expect(mapped.campaignId).toBe("23729418209");
    expect(typeof mapped.campaignId).toBe("string");
    expect(mapped.externalId).toBe(payload.lead_id);
    expect(mapped.consentGiven).toBeUndefined();
  });

  it("Q) REGION/CITY/POSTAL_CODE se conservan en formResponses; residenceState queda ausente (sin mapeo configurado)", () => {
    const mapped = mapGoogleLeadToIntakePayload(payload);
    expect(mapped.residenceState).toBeUndefined();
    expect(mapped.formResponses).toEqual({
      City: "Mountain View",
      "Postal Code": "94043",
      Region: "California",
    });
  });

  it("R) con mapeo REGION configurado, 'California' (nombre completo) NO se inventa como 'CA': se conserva en formResponses", () => {
    const mapped = mapGoogleLeadToIntakePayload(payload, { residenceStateFieldKey: "REGION" });
    expect(mapped.residenceState).toBeUndefined();
    expect(mapped.formResponses?.Region).toBe("California");
  });

  it("S) con mapeo REGION y un valor que SÍ es un código válido ('fl'), se normaliza a 'FL'", () => {
    const withCode = {
      ...payload,
      user_column_data: [
        ...payload.user_column_data.filter((c: { column_id: string }) => c.column_id !== "REGION"),
        { column_id: "REGION", column_name: "Region", string_value: "fl" },
      ],
    };
    expect(mapGoogleLeadToIntakePayload(withCode, { residenceStateFieldKey: "REGION" }).residenceState).toBe("FL");
  });

  it("T) google_key nunca aparece en el objeto mapeado ni en formResponses", () => {
    const mapped = mapGoogleLeadToIntakePayload(payload);
    expect(JSON.stringify(mapped)).not.toContain("REPLACE_WITH_TEST_GOOGLE_KEY");
  });

  it("U) un correo inválido no hace fallar el lead: se conserva en formResponses, email queda ausente", () => {
    const mapped = mapGoogleLeadToIntakePayload({
      lead_id: "x1",
      google_key: "k",
      user_column_data: [{ column_id: "EMAIL", column_name: "User Email", string_value: "no-es-correo" }],
    });
    expect(mapped.email).toBeUndefined();
    expect(mapped.formResponses).toEqual({ "User Email": "no-es-correo" });
  });

  it("V) campaign_id ausente/null no se convierte en la cadena 'null'/'undefined'", () => {
    expect(mapGoogleLeadToIntakePayload({ lead_id: "x2", google_key: "k" }).campaignId).toBeUndefined();
    expect(
      mapGoogleLeadToIntakePayload({ lead_id: "x3", google_key: "k", campaign_id: null as unknown as string }).campaignId
    ).toBeUndefined();
  });
});

describe("toExternalId / quoteLargeIntegerIds", () => {
  it("W) acepta strings y enteros seguros; null/undefined/'' -> undefined", () => {
    expect(toExternalId("abc ", "f")).toBe("abc");
    expect(toExternalId(123, "f")).toBe("123");
    expect(toExternalId(undefined, "f")).toBeUndefined();
    expect(toExternalId(null, "f")).toBeUndefined();
    expect(toExternalId("  ", "f")).toBeUndefined();
  });

  it("X) rechaza enteros no seguros, decimales, negativos y tipos no soportados — sin incluir el valor en el mensaje", () => {
    expect(() => toExternalId(2 ** 60, "campaign_id")).toThrow(/campaign_id.*no seguro/);
    expect(() => toExternalId(1.5, "f")).toThrow();
    expect(() => toExternalId(-1, "f")).toThrow();
    expect(() => toExternalId({}, "f")).toThrow(/tipo/);
    expect(() => toExternalId(true, "f")).toThrow();
    try {
      toExternalId(2 ** 60, "campaign_id");
    } catch (e) {
      expect(String(e)).not.toContain(String(2 ** 60));
    }
  });

  it("Y) un id de 17 dígitos conserva TODOS sus dígitos (sin pérdida de precisión por JSON.parse)", () => {
    const raw = '{"campaign_id": 12345678901234567, "leadgen_id":98765432109876543,"form_id": 42}';
    const parsed = JSON.parse(quoteLargeIntegerIds(raw));
    expect(parsed.campaign_id).toBe("12345678901234567");
    expect(parsed.leadgen_id).toBe("98765432109876543");
    expect(parsed.form_id).toBe(42);
    // Sin la protección, JSON.parse sí corrompe el valor:
    expect(String(JSON.parse(raw).campaign_id)).not.toBe("12345678901234567");
  });
});

describe("adaptador Meta — notificación (ids numéricos) y valores opcionales fuera de catálogo", () => {
  it("Z) state='Florida' (nombre completo) y correo inválido no hacen fallar el lead: se conservan en formResponses", () => {
    const mapped = mapMetaFieldDataToIntakePayload(
      [
        { name: "full_name", values: ["Ana"] },
        { name: "phone_number", values: ["+13055550100"] },
        { name: "state", values: ["Florida"] },
        { name: "email", values: ["no-valido"] },
      ],
      { leadgenId: "444444444444" }
    );
    expect(mapped.residenceState).toBeUndefined();
    expect(mapped.email).toBeUndefined();
    expect(mapped.formResponses).toEqual({ state: "Florida", email: "no-valido" });
  });

  it("AA) state='fl' se normaliza a 'FL'", () => {
    const mapped = mapMetaFieldDataToIntakePayload([{ name: "state", values: ["fl"] }], { leadgenId: "1" });
    expect(mapped.residenceState).toBe("FL");
  });

  it("AB) la notificación oficial de Meta trae leadgen_id/page_id NUMÉRICOS: toExternalId los vuelve string comparable", () => {
    const body = JSON.parse(
      quoteLargeIntegerIds(
        '{"entry":[{"id":153125381133,"changes":[{"field":"leadgen","value":{"leadgen_id":123123123123,"page_id":123123123,"form_id":12312312312,"created_time":1440120384}}]}]}'
      )
    );
    const value = body.entry[0].changes[0].value;
    expect(toExternalId(value.leadgen_id, "leadgen_id")).toBe("123123123123");
    expect(toExternalId(value.page_id, "page_id")).toBe("123123123");
  });
});

describe("contrato WEB (/api/leads/intake) — sin cambios, documentado", () => {
  it("AC) el contrato interno sigue siendo estricto: campaignId numérico y null en opcionales se rechazan (el servidor de la web debe enviar strings y omitir lo vacío)", async () => {
    const { leadIntakeSchema } = await import("@/schemas/lead.schema");
    const base = { fullName: "Ana Torres", phone: "3051112222", idempotencyKey: "web-1" };
    expect(leadIntakeSchema.safeParse({ ...base, campaignId: "123" }).success).toBe(true);
    expect(leadIntakeSchema.safeParse({ ...base, campaignId: 123 }).success).toBe(false);
    expect(leadIntakeSchema.safeParse({ ...base, email: null }).success).toBe(false);
    expect(leadIntakeSchema.safeParse({ ...base, email: undefined }).success).toBe(true);
  });
});
