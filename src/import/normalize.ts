// Normalización segura de datos de persona — Fase 019. Nunca cambia
// ortografía por heurística, nunca remueve tildes del dato almacenado
// (solo se usan versiones sin tilde para MATCHING, nunca para guardar).

export function normalizeName(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\s+/g, " ");
  return trimmed === "" ? null : trimmed;
}

export function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "" ? null : trimmed;
}

// Solo dígitos, conserva el código de país si venía con 11 dígitos
// iniciando en 1 (EE. UU.) — nunca trunca ni inventa dígitos.
export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return null;
  return digits;
}

// Solo para comparar en el matcher — nunca se persiste esta versión.
export function foldForMatching(raw: string | null): string {
  if (!raw) return "";
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

// "NOMBRE Y APELLIDO" llega como un solo campo de texto libre en el
// source — se separa de forma conservadora (última palabra = apellido)
// solo para poblar firstName/lastName; si el nombre tiene más de una
// palabra en cada parte no se intenta adivinar la separación exacta,
// se reporta como WARNING en el llamador si el resultado parece
// insuficiente (un solo token).
export function splitFullName(raw: string): { firstName: string; lastName: string } {
  const parts = raw.trim().replace(/\s+/g, " ").split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const lastName = parts[parts.length - 1];
  const firstName = parts.slice(0, -1).join(" ");
  return { firstName, lastName };
}
