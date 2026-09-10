import { describe, it, expect, afterEach } from "vitest";
import { sendEmail, setEmailTransportForTests, createNoopEmailTransportForTests } from "./email";
import { AppError } from "@/services/errors";

// CORRECCIÓN (activación de usuarios / recuperación de contraseña) —
// nunca se afirma un envío exitoso sin un transport configurado.
describe("email.ts", () => {
  afterEach(() => {
    setEmailTransportForTests(createNoopEmailTransportForTests());
  });

  it("un transport que rechaza propaga el AppError (nunca se traga el error)", async () => {
    setEmailTransportForTests({
      async send() {
        throw new AppError("SERVICE_UNAVAILABLE", "El envío de correo no está configurado.");
      },
    });
    await expect(
      sendEmail({ to: "test@example.com", subject: "x", html: "<p>x</p>", text: "x" })
    ).rejects.toMatchObject({ code: "SERVICE_UNAVAILABLE" });
  });

  it("un transport exitoso no lanza", async () => {
    setEmailTransportForTests(createNoopEmailTransportForTests());
    await expect(
      sendEmail({ to: "test@example.com", subject: "x", html: "<p>x</p>", text: "x" })
    ).resolves.toBeUndefined();
  });
});
