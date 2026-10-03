import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  mapGoogleLeadToIntakePayload,
  mapMetaFieldDataToIntakePayload,
  verifyGoogleWebhookKey,
  verifyMetaSignature,
  timingSafeEqualStrings,
} from "./lead-source-mapping";

describe("lead-source-mapping — Google", () => {
  it("A) mapea los campos estándar (FULL_NAME/PHONE_NUMBER/EMAIL) y conserva lo demás en formResponses", () => {
    const mapped = mapGoogleLeadToIntakePayload({
      lead_id: "lead-123",
      google_key: "k",
      campaign_id: "camp-1",
      lead_submit_time: "2026-01-01T00:00:00Z",
      user_column_data: [
        { column_id: "FULL_NAME", string_value: "Juan Pérez" },
        { column_id: "PHONE_NUMBER", string_value: "3051234567" },
        { column_id: "EMAIL", string_value: "juan@example.com" },
        { column_id: "custom_123", column_name: "¿Interesado en Medicare?", string_value: "Sí" },
      ],
    });

    expect(mapped.fullName).toBe("Juan Pérez");
    expect(mapped.phone).toBe("3051234567");
    expect(mapped.email).toBe("juan@example.com");
    expect(mapped.externalId).toBe("lead-123");
    expect(mapped.campaignId).toBe("camp-1");
    expect(mapped.originalInquiryAt).toBe("2026-01-01T00:00:00Z");
    expect(mapped.consentGiven).toBeUndefined();
    expect(mapped.formResponses).toEqual({ "¿Interesado en Medicare?": "Sí" });
  });

  it("B) sin preguntas personalizadas, formResponses queda ausente (nunca un objeto vacío)", () => {
    const mapped = mapGoogleLeadToIntakePayload({
      lead_id: "lead-456",
      google_key: "k",
      user_column_data: [{ column_id: "FULL_NAME", string_value: "Ana" }],
    });
    expect(mapped.formResponses).toBeUndefined();
  });

  it("C) verifyGoogleWebhookKey rechaza una clave incorrecta o ausente", () => {
    expect(verifyGoogleWebhookKey("wrong", "correct-key")).toBe(false);
    expect(verifyGoogleWebhookKey(undefined, "correct-key")).toBe(false);
    expect(verifyGoogleWebhookKey("correct-key", "correct-key")).toBe(true);
  });

  it("J) customMapping (§6) extrae estado de residencia/producto de interés por column_id, sin inventar valores ausentes", () => {
    const mapped = mapGoogleLeadToIntakePayload(
      {
        lead_id: "lead-789",
        google_key: "k",
        user_column_data: [
          { column_id: "FULL_NAME", string_value: "Pedro Gómez" },
          { column_id: "custom_state_99", string_value: "FL" },
          { column_id: "custom_product_11", string_value: "Dental" },
        ],
      },
      { residenceStateFieldKey: "custom_state_99", productInterestFieldKey: "custom_product_11" }
    );
    expect(mapped.residenceState).toBe("FL");
    // Se normaliza a mayúsculas para coincidir con el catálogo (DENTAL).
    expect(mapped.productInterest).toBe("DENTAL");
    // Los campos mapeados nunca quedan además duplicados en formResponses.
    expect(mapped.formResponses).toBeUndefined();
  });

  it("K) customMapping también acepta column_name (lo que el ADMIN tiene a mano al configurar)", () => {
    const mapped = mapGoogleLeadToIntakePayload(
      {
        lead_id: "lead-790",
        google_key: "k",
        user_column_data: [
          { column_id: "q_42", column_name: "Estado de residencia", string_value: "TX" },
        ],
      },
      { residenceStateFieldKey: "Estado de residencia" }
    );
    expect(mapped.residenceState).toBe("TX");
  });

  it("L) un fieldKey configurado que no aparece en el payload real nunca inventa un valor", () => {
    const mapped = mapGoogleLeadToIntakePayload(
      { lead_id: "lead-791", google_key: "k", user_column_data: [{ column_id: "FULL_NAME", string_value: "Sin Match" }] },
      { residenceStateFieldKey: "no_existe_en_este_formulario" }
    );
    expect(mapped.residenceState).toBeUndefined();
  });
});

describe("lead-source-mapping — Meta", () => {
  it("D) mapea full_name/phone_number/email/state y conserva preguntas personalizadas", () => {
    const mapped = mapMetaFieldDataToIntakePayload(
      [
        { name: "full_name", values: ["María López"] },
        { name: "phone_number", values: ["3059998888"] },
        { name: "email", values: ["maria@example.com"] },
        { name: "state", values: ["FL"] },
        { name: "producto_de_interes", values: ["Dental"] },
      ],
      { leadgenId: "leadgen-1", createdTime: "2026-02-01T00:00:00Z" }
    );

    expect(mapped.fullName).toBe("María López");
    expect(mapped.phone).toBe("3059998888");
    expect(mapped.email).toBe("maria@example.com");
    expect(mapped.residenceState).toBe("FL");
    expect(mapped.externalId).toBe("leadgen-1");
    expect(mapped.formResponses).toEqual({ producto_de_interes: "Dental" });
  });

  it("E) reconstruye fullName a partir de first_name + last_name cuando no viene full_name", () => {
    const mapped = mapMetaFieldDataToIntakePayload(
      [
        { name: "first_name", values: ["Carlos"] },
        { name: "last_name", values: ["Ruiz"] },
        { name: "phone_number", values: ["3051112222"] },
      ],
      { leadgenId: "leadgen-2" }
    );
    expect(mapped.fullName).toBe("Carlos Ruiz");
  });

  it("F) campos ausentes (ej. sin teléfono) quedan ausentes, nunca inventados", () => {
    const mapped = mapMetaFieldDataToIntakePayload([{ name: "full_name", values: ["Solo Nombre"] }], {
      leadgenId: "leadgen-3",
    });
    expect(mapped.phone).toBeUndefined();
    expect(mapped.email).toBeUndefined();
  });

  it("M) customMapping (§6) extrae producto de interés desde un nombre de campo no estándar, sin inventar valores ausentes", () => {
    const mapped = mapMetaFieldDataToIntakePayload(
      [
        { name: "full_name", values: ["Lucía Fernández"] },
        { name: "interes_producto", values: ["life"] },
      ],
      { leadgenId: "leadgen-4" },
      { productInterestFieldKey: "interes_producto" }
    );
    expect(mapped.productInterest).toBe("LIFE");
    // Consumido por el mapeo personalizado: ya no aparece duplicado en formResponses.
    expect(mapped.formResponses).toBeUndefined();
  });

  it("N) customMapping nunca sobrescribe 'state' cuando Meta ya lo envió como campo estándar", () => {
    const mapped = mapMetaFieldDataToIntakePayload(
      [
        { name: "state", values: ["FL"] },
        { name: "otro_campo_estado", values: ["TX"] },
      ],
      { leadgenId: "leadgen-5" },
      { residenceStateFieldKey: "otro_campo_estado" }
    );
    expect(mapped.residenceState).toBe("FL");
    // El campo configurado pero no usado (porque ya había match estándar) se conserva visible.
    expect(mapped.formResponses).toEqual({ otro_campo_estado: "TX" });
  });

  it("O) un fieldKey configurado que no aparece en el payload real nunca inventa un valor", () => {
    const mapped = mapMetaFieldDataToIntakePayload(
      [{ name: "full_name", values: ["Sin Match"] }],
      { leadgenId: "leadgen-6" },
      { productInterestFieldKey: "no_existe_en_este_formulario" }
    );
    expect(mapped.productInterest).toBeUndefined();
  });
});

describe("lead-source-mapping — verificación de Meta (handshake y firma)", () => {
  it("G) timingSafeEqualStrings compara correctamente, incluyendo longitudes distintas", () => {
    expect(timingSafeEqualStrings("abc", "abc")).toBe(true);
    expect(timingSafeEqualStrings("abc", "abd")).toBe(false);
    expect(timingSafeEqualStrings("abc", "abcd")).toBe(false);
  });

  it("H) verifyMetaSignature acepta una firma HMAC-SHA256 válida del cuerpo con el App Secret", () => {
    const appSecret = "mi-app-secret";
    const body = JSON.stringify({ entry: [{ changes: [{ field: "leadgen", value: { leadgen_id: "1" } }] }] });
    const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(body, "utf8").digest("hex")}`;
    expect(verifyMetaSignature(body, signature, appSecret)).toBe(true);
  });

  it("I) verifyMetaSignature rechaza una firma incorrecta, de otro secreto, o ausente", () => {
    const appSecret = "mi-app-secret";
    const body = JSON.stringify({ a: 1 });
    const validSig = `sha256=${crypto.createHmac("sha256", appSecret).update(body, "utf8").digest("hex")}`;
    const sigFromOtherSecret = `sha256=${crypto.createHmac("sha256", "otro-secret").update(body, "utf8").digest("hex")}`;

    expect(verifyMetaSignature(body, sigFromOtherSecret, appSecret)).toBe(false);
    expect(verifyMetaSignature(body, null, appSecret)).toBe(false);
    expect(verifyMetaSignature(body, "sha256=notahexsignature", appSecret)).toBe(false);
    // Un cuerpo MODIFICADO después de firmarlo invalida la firma —
    // nunca se confía en el payload sin esta verificación.
    expect(verifyMetaSignature(JSON.stringify({ a: 2 }), validSig, appSecret)).toBe(false);
  });
});
