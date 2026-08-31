import { prisma } from "@/lib/prisma";
import { foldForMatching } from "./normalize";
import type { PersonMatchConfidence, PersonMatchOutcome } from "./types";

// Motor de matching de Person — Fase 019. Nunca fusiona automáticamente
// por coincidencia débil (ver docs/DECISIONS.md):
//
//   STRONG:  email normalizado idéntico, O teléfono normalizado + DOB idénticos.
//   MEDIUM:  nombre completo (sin tildes/mayúsculas) + DOB idénticos.
//   WEAK:    solo nombre — nunca decide MATCHED por sí solo.
//
// Un candidato WEAK que coincide con exactamente un homónimo (existente
// o ya planeado en este mismo run) se reporta como AMBIGUOUS (requiere
// revisión humana), nunca se fusiona. Cero coincidencias => NEW. Más de
// una coincidencia en cualquier nivel => AMBIGUOUS.
//
// La misma función pura (matchAgainstPool) se usa tanto contra
// PostgreSQL (personas ya existentes) como contra las personas ya
// planeadas EN ESTE MISMO import (PersonRegistry, más abajo) — es la
// pieza que evita duplicar a un titular que aparece en varias filas de
// "clientes" por tener varias pólizas (ver docs/DECISIONS.md).

export type PersonCandidate = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  dateOfBirth: Date | null;
};

export type MatchResult = {
  outcome: PersonMatchOutcome;
  confidence?: PersonMatchConfidence;
  matchedKey?: string;
};

type PoolEntry = { key: string; data: PersonCandidate };

function sameDay(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

function foldedFullName(p: { firstName: string; lastName: string }): string {
  return foldForMatching(`${p.firstName} ${p.lastName}`);
}

export function matchAgainstPool(candidate: PersonCandidate, pool: PoolEntry[]): MatchResult {
  if (candidate.email) {
    const byEmail = pool.filter((p) => p.data.email === candidate.email);
    if (byEmail.length === 1) return { outcome: "MATCHED", confidence: "STRONG", matchedKey: byEmail[0].key };
    if (byEmail.length > 1) return { outcome: "AMBIGUOUS" };
  }

  if (candidate.phone && candidate.dateOfBirth) {
    const byPhone = pool.filter(
      (p) => p.data.phone === candidate.phone && sameDay(p.data.dateOfBirth, candidate.dateOfBirth)
    );
    if (byPhone.length === 1) return { outcome: "MATCHED", confidence: "STRONG", matchedKey: byPhone[0].key };
    if (byPhone.length > 1) return { outcome: "AMBIGUOUS" };
  }

  if (candidate.dateOfBirth) {
    const target = foldedFullName(candidate);
    const byNameDob = pool.filter(
      (p) => sameDay(p.data.dateOfBirth, candidate.dateOfBirth) && foldedFullName(p.data) === target
    );
    if (byNameDob.length === 1) return { outcome: "MATCHED", confidence: "MEDIUM", matchedKey: byNameDob[0].key };
    if (byNameDob.length > 1) return { outcome: "AMBIGUOUS" };
  }

  const target = foldedFullName(candidate);
  const weakMatches = pool.filter((p) => foldedFullName(p.data) === target);
  if (weakMatches.length >= 1) return { outcome: "AMBIGUOUS" };

  return { outcome: "NEW" };
}

async function loadDbPool(candidate: PersonCandidate): Promise<PoolEntry[]> {
  const orConditions: Record<string, unknown>[] = [];
  if (candidate.email) orConditions.push({ email: candidate.email });
  if (candidate.phone) orConditions.push({ phone: candidate.phone });
  if (candidate.dateOfBirth) orConditions.push({ dateOfBirth: candidate.dateOfBirth });
  orConditions.push({ lastName: { equals: candidate.lastName, mode: "insensitive" } });

  const rows = await prisma.person.findMany({
    where: { OR: orConditions },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, dateOfBirth: true },
  });
  return rows.map((r) => ({
    key: r.id,
    data: { firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone, dateOfBirth: r.dateOfBirth },
  }));
}

// Registro de personas de UN run de importación. Cada llamada a
// resolve() intenta matchear primero contra lo YA planeado en este
// mismo run (evita duplicar un titular con varias pólizas en la misma
// hoja) y luego contra PostgreSQL. Devuelve una "personKey" lógica
// estable para todo el plan (households/policies referencian esta key,
// nunca directamente un id de persona que podría no existir todavía en
// modo dry-run).
export class PersonRegistry {
  private entries: { key: string; outcome: PersonMatchOutcome; confidence?: PersonMatchConfidence; existingPersonId?: string; data: PersonCandidate }[] = [];
  private nextId = 1;

  async resolve(candidate: PersonCandidate): Promise<{ key: string; outcome: PersonMatchOutcome; confidence?: PersonMatchConfidence; existingPersonId?: string }> {
    const localPool: PoolEntry[] = this.entries
      .filter((e) => e.outcome === "MATCHED" || e.outcome === "NEW")
      .map((e) => ({ key: e.key, data: e.data }));

    const local = matchAgainstPool(candidate, localPool);
    if (local.outcome === "MATCHED" && local.matchedKey) {
      const existing = this.entries.find((e) => e.key === local.matchedKey)!;
      return { key: existing.key, outcome: "MATCHED", confidence: local.confidence, existingPersonId: existing.existingPersonId };
    }

    const dbPool = await loadDbPool(candidate);
    const dbResult = matchAgainstPool(candidate, dbPool);

    const key = `p${this.nextId++}`;
    if (dbResult.outcome === "MATCHED" && dbResult.matchedKey) {
      this.entries.push({ key, outcome: "MATCHED", confidence: dbResult.confidence, existingPersonId: dbResult.matchedKey, data: candidate });
      return { key, outcome: "MATCHED", confidence: dbResult.confidence, existingPersonId: dbResult.matchedKey };
    }
    if (dbResult.outcome === "AMBIGUOUS" || local.outcome === "AMBIGUOUS") {
      this.entries.push({ key, outcome: "AMBIGUOUS", data: candidate });
      return { key, outcome: "AMBIGUOUS" };
    }
    this.entries.push({ key, outcome: "NEW", data: candidate });
    return { key, outcome: "NEW" };
  }
}
