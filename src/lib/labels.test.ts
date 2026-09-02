import { describe, it, expect } from "vitest";
import {
  HOUSEHOLD_MEMBER_ROLE_LABELS,
  POLICY_MEMBER_ROLE_LABELS,
  suggestPolicyMemberRole,
} from "@/lib/labels";

// Hallazgo #13 de UAT (Fase 019.7): etiquetas amigables en español para
// la filiación familiar, y el mapeo de sugerencia hacia el rol de
// cobertura de una póliza (conceptos DISTINTOS, nunca mezclados).
describe("labels — filiación familiar vs rol de póliza", () => {
  it("E) HouseholdMemberRole.CHILD se muestra como 'Hijo/a'", () => {
    expect(HOUSEHOLD_MEMBER_ROLE_LABELS.CHILD).toBe("Hijo/a");
  });

  it("F) HouseholdMemberRole.SPOUSE se muestra como 'Esposo/a'", () => {
    expect(HOUSEHOLD_MEMBER_ROLE_LABELS.SPOUSE).toBe("Esposo/a");
  });

  it("PolicyMemberRole.SPOUSE también se muestra como 'Esposo/a' (misma convención)", () => {
    expect(POLICY_MEMBER_ROLE_LABELS.SPOUSE).toBe("Esposo/a");
  });

  it("suggestPolicyMemberRole: CHILD y DEPENDENT del hogar sugieren DEPENDENT en la póliza", () => {
    expect(suggestPolicyMemberRole("CHILD")).toBe("DEPENDENT");
    expect(suggestPolicyMemberRole("DEPENDENT")).toBe("DEPENDENT");
  });

  it("suggestPolicyMemberRole: SPOUSE del hogar sugiere SPOUSE en la póliza", () => {
    expect(suggestPolicyMemberRole("SPOUSE")).toBe("SPOUSE");
  });

  it("suggestPolicyMemberRole: HEAD/OTHER del hogar sugieren OTHER (nunca PRIMARY, reservado al titular)", () => {
    expect(suggestPolicyMemberRole("HEAD")).toBe("OTHER");
    expect(suggestPolicyMemberRole("OTHER")).toBe("OTHER");
  });
});
