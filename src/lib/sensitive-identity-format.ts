// Funciones puras de formato/validación para identificadores sensibles
// (SSN, USCIS/A-Number, número de documento migratorio) — Fase 021.
// Nunca cifran ni descifran (eso vive en pii-crypto.ts, "server-only");
// estas son solo normalización/enmascarado, seguras de importar desde
// cualquier lado (aunque en la práctica solo se llaman desde servicios
// del servidor — el valor completo nunca debe llegar al cliente salvo
// bajo demanda explícita de "Mostrar", ver docs/SENSITIVE_PII.md).

const SSN_DIGITS_PATTERN = /^\d{9}$/;

// Acepta "123-45-6789" o "123456789" (con o sin guiones/espacios) —
// nunca acepta menos/más de 9 dígitos reales. Retorna el SSN
// normalizado a 9 dígitos sin separadores, o null si no es válido.
export function normalizeSsn(raw: string): string | null {
  const digitsOnly = raw.replace(/[\s-]/g, "");
  return SSN_DIGITS_PATTERN.test(digitsOnly) ? digitsOnly : null;
}

export function isValidSsn(raw: string): boolean {
  return normalizeSsn(raw) !== null;
}

export function last4(normalized: string): string {
  return normalized.slice(-4);
}

// "123-45-6789" — solo para mostrar el valor COMPLETO ya revelado
// (nunca se usa para el valor por defecto/enmascarado).
export function formatSsnFull(normalizedSsn: string): string {
  return `${normalizedSsn.slice(0, 3)}-${normalizedSsn.slice(3, 5)}-${normalizedSsn.slice(5)}`;
}

// "***-**-6789" — el único formato que debe verse por defecto.
export function maskSsn(ssnLast4: string): string {
  return `***-**-${ssnLast4}`;
}

// USCIS/A-Number y número de documento migratorio: formato mucho menos
// estandarizado entre agencias/estados que un SSN (a veces incluye una
// "A" inicial, a veces solo dígitos) — normalización deliberadamente
// mínima (recorta espacios, exige contenido no vacío), sin imponer un
// patrón rígido que rechace un valor real y válido.
export function normalizeIdentifier(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// "*****1234" (5 asteriscos + last4) — usado para USCIS/A-Number.
export function maskUscisNumber(uscisLast4: string): string {
  return `*****${uscisLast4}`;
}

// "******9876" (6 asteriscos + last4) — usado para número de documento.
export function maskDocumentNumber(documentLast4: string): string {
  return `******${documentLast4}`;
}
