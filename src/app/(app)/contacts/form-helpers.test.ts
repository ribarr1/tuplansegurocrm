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

  // Fase 024 (Hallazgo #1): bug real encontrado en UAT — "sex" faltaba
  // en PERSON_FORM_FIELDS, así que el formulario de Editar contacto
  // guardaba un 200 OK sin error visible pero nunca persistía el
  // cambio de Sexo (el POST llegaba al servidor sin ese campo).
  it("incluye sex cuando viene (bug real de Fase 024: faltaba en PERSON_FORM_FIELDS)", () => {
    const result = formDataToPersonInput(fd({ firstName: "Ana", sex: "FEMALE" }));
    expect(result.sex).toBe("FEMALE");
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
    // Nunca hay una lectura ambigua: un error real siempre produce
    // `error` o `fieldErrors`, jamás un estado vacío que la UI pudiera
    // confundir con éxito.
    expect(state?.error || state?.fieldErrors).toBeTruthy();
  });

  // Fase 025.5.2 (Corrección 7) — los tres motivos de rechazo de
  // assertActiveAgent (people.service.ts) usan el prefijo
  // "assignedAgentId: " para que SIEMPRE lleguen como error DEL CAMPO
  // (bajo el selector), nunca como un banner genérico ni, mucho menos,
  // en silencio.
  it("un agente inactivo rechazado por el servicio llega como fieldErrors.assignedAgentId", () => {
    const state = toFormState(
      new AppError("VALIDATION_ERROR", "assignedAgentId: El agente seleccionado está inactivo."),
      { firstName: "Ana", assignedAgentId: "some-id" }
    );
    expect(state?.fieldErrors).toEqual({ assignedAgentId: "El agente seleccionado está inactivo." });
    expect(state?.values?.assignedAgentId).toBe("some-id"); // el valor elegido no se pierde
  });

  it("un usuario sin isAgent=true rechazado por el servicio llega como fieldErrors.assignedAgentId", () => {
    const state = toFormState(
      new AppError("VALIDATION_ERROR", "assignedAgentId: El usuario seleccionado no tiene la condición de agente (isAgent)."),
      { firstName: "Ana" }
    );
    expect(state?.fieldErrors?.assignedAgentId).toMatch(/isAgent/);
  });

  it("un agente inexistente (ID inválido) rechazado por el servicio llega como fieldErrors.assignedAgentId", () => {
    const state = toFormState(
      new AppError("VALIDATION_ERROR", "assignedAgentId: El agente seleccionado ya no existe."),
      { firstName: "Ana" }
    );
    expect(state?.fieldErrors?.assignedAgentId).toBe("El agente seleccionado ya no existe.");
  });
});
