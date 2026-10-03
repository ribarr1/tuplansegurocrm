import { describe, it, expect } from "vitest";
import { quoteLargeIntegerIds, toExternalId } from "./lead-source-mapping";

const BIG = "12345678901234567"; // 17 dígitos: no representable con exactitud como Number

describe("quoteLargeIntegerIds — solo transforma los identificadores previstos", () => {
  it("1) cita únicamente los ids conocidos con 16+ dígitos y conserva TODOS sus dígitos", () => {
    const raw = `{"lead_id":${BIG},"form_id":${BIG},"campaign_id":${BIG},"adgroup_id":${BIG},"creative_id":${BIG},"asset_group_id":${BIG},"leadgen_id":${BIG},"page_id":${BIG},"ad_id":${BIG},"id":${BIG}}`;
    const parsed = JSON.parse(quoteLargeIntegerIds(raw));
    for (const key of ["lead_id", "form_id", "campaign_id", "adgroup_id", "creative_id", "asset_group_id", "leadgen_id", "page_id", "ad_id", "id"]) {
      expect(parsed[key]).toBe(BIG);
    }
  });

  it("2) otras claves con números grandes NO se tocan (siguen siendo número)", () => {
    const raw = `{"score":${BIG},"phone_number":${BIG},"created_time":1440120384,"form_id":42}`;
    const parsed = JSON.parse(quoteLargeIntegerIds(raw));
    expect(typeof parsed.score).toBe("number");
    expect(typeof parsed.phone_number).toBe("number");
    expect(parsed.created_time).toBe(1440120384);
    // Enteros de menos de 16 dígitos tampoco: ya son seguros.
    expect(parsed.form_id).toBe(42);
    expect(quoteLargeIntegerIds(raw)).toBe(raw);
  });

  it("3) claves PARECIDAS no se transforman (sufijos, prefijos, mayúsculas, espacios, column_id)", () => {
    const raw = `{"campaign_id_old":${BIG},"my_campaign_id":${BIG},"Campaign_Id":${BIG},"campaign_id ":${BIG},"column_id":${BIG},"leadgen_id2":${BIG},"ids":${BIG},"_id":${BIG}}`;
    expect(quoteLargeIntegerIds(raw)).toBe(raw);
  });

  it("4) ids ya entrecomillados, de 15 dígitos o con espacios/saltos de línea alrededor se respetan", () => {
    expect(quoteLargeIntegerIds(`{"campaign_id":"${BIG}"}`)).toBe(`{"campaign_id":"${BIG}"}`);
    expect(quoteLargeIntegerIds('{"campaign_id":123456789012345}')).toBe('{"campaign_id":123456789012345}');
    const spaced = `{\n  "campaign_id"\n  :\n  ${BIG}\n  ,\n  "x": 1\n}`;
    expect(JSON.parse(quoteLargeIntegerIds(spaced)).campaign_id).toBe(BIG);
  });

  it("5) decimales y exponentes NO se convierten en id (siguen siendo número y toExternalId los rechazará)", () => {
    const raw = `{"campaign_id":${BIG}.5,"form_id":1.2345678901234567e20}`;
    expect(quoteLargeIntegerIds(raw)).toBe(raw);
    const parsed = JSON.parse(raw);
    expect(() => toExternalId(parsed.campaign_id, "campaign_id")).toThrow();
    expect(() => toExternalId(parsed.form_id, "form_id")).toThrow();
  });
});

describe("quoteLargeIntegerIds — no altera respuestas personalizadas", () => {
  it("6) nada dentro de user_column_data / field_data se modifica, aunque tenga claves llamadas id/lead_id o números grandes", () => {
    const raw = `{"lead_id":"x","user_column_data":[{"column_id":"Q1","string_value":"${BIG}","id":${BIG},"lead_id":${BIG}},{"id":${BIG},"nested":{"campaign_id":${BIG}}}],"campaign_id":${BIG}}`;
    const out = quoteLargeIntegerIds(raw);
    const parsed = JSON.parse(out);
    // Dentro de las respuestas: intactas (siguen siendo números).
    expect(typeof parsed.user_column_data[0].id).toBe("number");
    expect(typeof parsed.user_column_data[0].lead_id).toBe("number");
    expect(typeof parsed.user_column_data[1].id).toBe("number");
    expect(typeof parsed.user_column_data[1].nested.campaign_id).toBe("number");
    expect(parsed.user_column_data[0].string_value).toBe(BIG);
    // Fuera: sí se cita.
    expect(parsed.campaign_id).toBe(BIG);
    // El único cambio de todo el texto son las 2 comillas del campaign_id real.
    expect(out.length).toBe(raw.length + 2);

    const meta = `{"field_data":[{"name":"x","values":[1],"id":${BIG}}]}`;
    expect(quoteLargeIntegerIds(meta)).toBe(meta);
  });
});

describe("quoteLargeIntegerIds — no modifica el contenido de cadenas ni textos escapados", () => {
  it("7) texto que imita un id dentro de una cadena (con y sin comillas escapadas) queda idéntico", () => {
    const tricky = [
      `{"nota":"\\"campaign_id\\": ${BIG}, y \\"lead_id\\":${BIG}"}`,
      `{"nota":"campaign_id: ${BIG}"}`,
      `{"nota":"\\\\","campaign_id":"ok"}`,
      `{"nota":"\\\\\\"campaign_id\\":${BIG}"}`,
      `{"nota":"\\u0022campaign_id\\u0022:${BIG}"}`,
      `{"a":"x\\"","b":"\\"campaign_id\\":${BIG}"}`,
    ];
    for (const raw of tricky) {
      expect(quoteLargeIntegerIds(raw)).toBe(raw);
      expect(JSON.parse(quoteLargeIntegerIds(raw))).toEqual(JSON.parse(raw));
    }
  });

  it("8) una cadena con una barra invertida final no desfasa el escáner: el id real que sigue SÍ se cita y la cadena no cambia", () => {
    const raw = `{"nota":"termina en barra \\\\","campaign_id":${BIG},"otra":"campaign_id"}`;
    const parsed = JSON.parse(quoteLargeIntegerIds(raw));
    expect(parsed.nota).toBe("termina en barra \\");
    expect(parsed.campaign_id).toBe(BIG);
    expect(parsed.otra).toBe("campaign_id");
  });
});

describe("quoteLargeIntegerIds — identificadores de 64 bits exactos", () => {
  it("9) int64 máximo/mínimo y 16 dígitos inseguros se conservan dígito a dígito", () => {
    const raw = `{"campaign_id":9223372036854775807,"form_id":-9223372036854775808,"ad_id":9007199254740993,"id":9007199254740991}`;
    const parsed = JSON.parse(quoteLargeIntegerIds(raw));
    expect(parsed.campaign_id).toBe("9223372036854775807");
    expect(parsed.form_id).toBe("-9223372036854775808");
    expect(parsed.ad_id).toBe("9007199254740993");
    expect(parsed.id).toBe("9007199254740991");
    // Sin la protección, JSON.parse sí corrompe el valor:
    expect(String(JSON.parse(raw).campaign_id)).not.toBe("9223372036854775807");
  });

  it("10) la notificación oficial de Meta y el payload de Google (ids cortos) quedan SIN cambios de contenido", () => {
    const meta = `{"object":"page","entry":[{"id":153125381133,"time":1438292065,"changes":[{"field":"leadgen","value":{"leadgen_id":123123123123,"page_id":123123123,"form_id":12312312312,"adgroup_id":12312312312,"ad_id":12312312312,"created_time":1440120384}}]}]}`;
    expect(quoteLargeIntegerIds(meta)).toBe(meta);
    const google = `{"lead_id":"abc","form_id":349080077126,"campaign_id":23729418209,"adgroup_id":195583084496,"creative_id":30000000000,"is_test":true}`;
    expect(quoteLargeIntegerIds(google)).toBe(google);
  });

  it("11) JSON malformado o vacío no lanza ni inventa contenido (el JSON.parse posterior lo rechaza)", () => {
    expect(() => quoteLargeIntegerIds("")).not.toThrow();
    expect(() => quoteLargeIntegerIds('{"campaign_id": 1234567890123456')).not.toThrow();
    expect(() => quoteLargeIntegerIds('{"a":"sin cerrar')).not.toThrow();
    expect(() => JSON.parse(quoteLargeIntegerIds('{"a":"sin cerrar'))).toThrow();
  });
});

describe("toExternalId — un id inseguro ya guardado como número se rechaza, nunca se reconstruye", () => {
  it("12) un número que ya perdió precisión lanza un error explícito sin devolver ni mostrar ningún valor", () => {
    // Así queda un id de 17 dígitos que ya fue parseado como número
    // (ej. un evento guardado antes de esta corrección).
    const lossy = JSON.parse(`{"campaign_id":${BIG}}`).campaign_id as number;
    expect(Number.isSafeInteger(lossy)).toBe(false);
    let thrown: unknown;
    try {
      toExternalId(lossy, "campaign_id");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    const message = (thrown as Error).message;
    expect(message).toMatch(/campaign_id.*no seguro/);
    expect(message).not.toContain(BIG);
    expect(message).not.toContain(String(lossy));
  });
});
