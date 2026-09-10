import { describe, it, expect } from "vitest";
import { checkRateLimit, resetRateLimitForTests } from "./rate-limit";

describe("rate-limit (CORRECCIÓN — activación de usuarios / recuperación de contraseña)", () => {
  it("permite hasta el límite configurado dentro de la ventana", () => {
    resetRateLimitForTests();
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(key, 5, 60_000)).toBe(true);
    }
  });

  it("rechaza una vez excedido el límite", () => {
    resetRateLimitForTests();
    const key = `test-${Date.now()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(key, 3, 60_000);
    expect(checkRateLimit(key, 3, 60_000)).toBe(false);
  });

  it("claves distintas tienen contadores independientes", () => {
    resetRateLimitForTests();
    const keyA = `a-${Date.now()}`;
    const keyB = `b-${Date.now()}`;
    for (let i = 0; i < 3; i++) checkRateLimit(keyA, 3, 60_000);
    expect(checkRateLimit(keyA, 3, 60_000)).toBe(false);
    expect(checkRateLimit(keyB, 3, 60_000)).toBe(true);
  });

  it("la ventana expira y vuelve a permitir después", async () => {
    resetRateLimitForTests();
    const key = `window-${Date.now()}`;
    expect(checkRateLimit(key, 1, 20)).toBe(true);
    expect(checkRateLimit(key, 1, 20)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(checkRateLimit(key, 1, 20)).toBe(true);
  });
});
