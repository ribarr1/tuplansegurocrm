import { describe, it, expect } from "vitest";
import { AppError } from "@/services/errors";
import { formDataToPersonInput, toFormState } from "./form-helpers";

function fd(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

describe("formDataToPersonInput", () => {
  it("solo incluye campos reales de Person con valor no vacío", () => {
    const result = formDataToPersonInput(
      fd({ firstName: "Ana", lastName: "  ", email: "" , unknownField: "x" })
    );
    expect(result).toEqual({ firstName: "Ana" });
  });

  it("incluye assignedAgentId cuando viene", () => {
    const result = formDataToPersonInput(fd({ firstName: "Ana", assignedAgentId: "abc-123" }));
    expect(result.assignedAgentId).toBe("abc-123");
  });
});

describe("toFormState", () => {
  it("separa código VALIDATION_ERROR (campo: mensaje) en fieldErrors", () => {
    const state = toFormState(
      new AppError("VALIDATION_ERROR", "phone: El teléfono debe tener al menos 7 caracteres."),
      { firstName: "Ana" }
    );
    expect(state?.fieldErrors).toEqual({
      phone: "El teléfono debe tener al menos 7 caracteres.",
    });
    expect(state?.values).toEqual({ firstName: "Ana" });
  });

  it("conserva los valores enviados para repoblar el formulario", () => {
    const submitted = { firstName: "Ana", lastName: "Gomez" };
    const state = toFormState(new AppError("FORBIDDEN", "No autorizado."), submitted);
    expect(state?.values).toEqual(submitted);
    expect(state?.error).toBe("No autorizado.");
  });

  it("nunca deja pasar un error no controlado (Prisma/interno) tal cual", () => {
    const state = toFormState(new Error("relation \"people\" does not exist"), {});
    expect(state?.error).toBe("Ocurrió un error inesperado. Intenta de nuevo.");
  });
});
