import { describe, it, expect, beforeEach } from "vitest";
import { checkLeadIntakeRateLimit, cleanupExpiredRateLimitWindows, _resetLeadIntakeRateLimitForTests } from "./lead-rate-limit";
import { prisma } from "@/lib/prisma";

describe("lead-rate-limit (PostgreSQL, compartido entre instancias)", () => {
  beforeEach(async () => {
    await _resetLeadIntakeRateLimitForTests();
  });

  it("A) permite solicitudes dentro del límite", async () => {
    const key = `test-${Date.now()}-a`;
    for (let i = 0; i < 5; i++) {
      const result = await checkLeadIntakeRateLimit(key);
      expect(result.allowed).toBe(true);
    }
  });

  it("B) bloquea después de superar el límite por ventana, con retryAfterSeconds", async () => {
    const key = `test-${Date.now()}-b`;
    let lastResult: Awaited<ReturnType<typeof checkLeadIntakeRateLimit>> | undefined;
    for (let i = 0; i < 61; i++) {
      lastResult = await checkLeadIntakeRateLimit(key);
    }
    expect(lastResult?.allowed).toBe(false);
    expect(lastResult?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("C) dos bucketKey distintos nunca comparten contador", async () => {
    const keyA = `test-${Date.now()}-c-a`;
    const keyB = `test-${Date.now()}-c-b`;
    for (let i = 0; i < 61; i++) await checkLeadIntakeRateLimit(keyA);
    const resultB = await checkLeadIntakeRateLimit(keyB);
    expect(resultB.allowed).toBe(true);
  });

  it("D) incrementos CONCURRENTES para la misma clave nunca se pisan (atomicidad real en PostgreSQL)", async () => {
    const key = `test-${Date.now()}-d`;
    const concurrentRequests = 30;
    const results = await Promise.all(
      Array.from({ length: concurrentRequests }, () => checkLeadIntakeRateLimit(key))
    );
    const allowedCount = results.filter((r) => r.allowed).length;
    // Las 30 deben quedar dentro del límite (60/minuto) — ninguna se
    // "pierde" por una condición de carrera en el incremento.
    expect(allowedCount).toBe(concurrentRequests);

    const row = await prisma.leadRateLimitWindow.findFirst({ where: { bucketKey: key } });
    expect(row?.count).toBe(concurrentRequests);
  });

  it("E) cleanupExpiredRateLimitWindows elimina solo ventanas vencidas", async () => {
    const key = `test-${Date.now()}-e`;
    await checkLeadIntakeRateLimit(key);
    // Fuerza una ventana claramente vencida insertándola directo.
    await prisma.leadRateLimitWindow.create({
      data: { bucketKey: key, windowStart: new Date(Date.now() - 60 * 60_000), count: 1 },
    });

    const deleted = await cleanupExpiredRateLimitWindows();
    expect(deleted).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.leadRateLimitWindow.findMany({ where: { bucketKey: key } });
    // La ventana reciente (de hace unos milisegundos) debe sobrevivir.
    expect(remaining.length).toBeGreaterThanOrEqual(1);
  });
});
