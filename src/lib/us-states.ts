// Catálogo controlado de estados/territorios de EE. UU. — hallazgo #15.4
// de UAT (Fase 019.7). Fuente: lista oficial de abreviaciones postales
// de dos letras del USPS (50 estados + Distrito de Columbia + 5
// territorios habitados con código postal propio). Estático porque no
// cambia — una tabla de base de datos sería sobre-ingeniería para un
// catálogo que no se administra ni crece (a diferencia de Carrier/
// Product, que sí son datos operativos reales del negocio).
//
// Deliberadamente NO se incluyen los códigos militares (AA/AE/AP,
// direcciones APO/FPO/DPO) — no son estados/territorios reales y no
// tienen mercado de Marketplace de salud aplicable a esta agencia.
export const US_STATES = [
  { code: "AL", name: "Alabama" },
  { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" },
  { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" },
  { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" },
  { code: "DE", name: "Delaware" },
  { code: "DC", name: "Distrito de Columbia" },
  { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" },
  { code: "HI", name: "Hawái" },
  { code: "ID", name: "Idaho" },
  { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" },
  { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" },
  { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Luisiana" },
  { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" },
  { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" },
  { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Misisipi" },
  { code: "MO", name: "Misuri" },
  { code: "MT", name: "Montana" },
  { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" },
  { code: "NH", name: "Nuevo Hampshire" },
  { code: "NJ", name: "Nueva Jersey" },
  { code: "NM", name: "Nuevo México" },
  { code: "NY", name: "Nueva York" },
  { code: "NC", name: "Carolina del Norte" },
  { code: "ND", name: "Dakota del Norte" },
  { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" },
  { code: "OR", name: "Oregón" },
  { code: "PA", name: "Pensilvania" },
  { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "Carolina del Sur" },
  { code: "SD", name: "Dakota del Sur" },
  { code: "TN", name: "Tennessee" },
  { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" },
  { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" },
  { code: "WA", name: "Washington" },
  { code: "WV", name: "Virginia Occidental" },
  { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
  // Territorios habitados con código postal propio (USPS)
  { code: "AS", name: "Samoa Americana" },
  { code: "GU", name: "Guam" },
  { code: "MP", name: "Islas Marianas del Norte" },
  { code: "PR", name: "Puerto Rico" },
  { code: "VI", name: "Islas Vírgenes de EE. UU." },
] as const;

export type USStateCode = (typeof US_STATES)[number]["code"];

// Tupla readonly (no un array mutable) para poder usarse directamente
// con z.enum(), que exige ese tipo.
export const US_STATE_CODES = US_STATES.map((s) => s.code) as unknown as readonly [
  USStateCode,
  ...USStateCode[],
];

const STATE_NAME_BY_CODE = new Map<string, string>(US_STATES.map((s) => [s.code, s.name]));

export function usStateName(code: string): string | null {
  return STATE_NAME_BY_CODE.get(code.toUpperCase()) ?? null;
}
