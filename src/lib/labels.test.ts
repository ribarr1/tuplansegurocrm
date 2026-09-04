import { describe, it, expect } from "vitest";
import {
  HOUSEHOLD_MEMBER_ROLE_LABELS,
  POLICY_MEMBER_ROLE_LABELS,
  suggestPolicyMemberRole,
  paymentModeAutopayLabel,
  paymentModeShowsAssistanceBadge,
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

// Fase 025.1 (Hallazgo #3 de UAT): paymentManagementMode es la ÚNICA
// fuente de verdad para "Autopay"/"Asistencia" en cualquier lista u
// pantalla operativa — estas dos funciones puras centralizan ese
// mapeo (items 11-14 de la ficha).
describe("labels — paymentModeAutopayLabel / paymentModeShowsAssistanceBadge", () => {
  it("11) AUTOPAY: Autopay = Sí, sin badge de asistencia", () => {
    expect(paymentModeAutopayLabel("AUTOPAY")).toBe("Sí");
    expect(paymentModeShowsAssistanceBadge("AUTOPAY")).toBe(false);
  });

  it("12) ASSISTED: Autopay = No, con badge de asistencia", () => {
    expect(paymentModeAutopayLabel("ASSISTED")).toBe("No");
    expect(paymentModeShowsAssistanceBadge("ASSISTED")).toBe(true);
  });

  it("13) CLIENT_MANAGED: Autopay = No, sin badge de asistencia", () => {
    expect(paymentModeAutopayLabel("CLIENT_MANAGED")).toBe("No");
    expect(paymentModeShowsAssistanceBadge("CLIENT_MANAGED")).toBe(false);
  });

  it("14) ningún modo produce simultáneamente Autopay=Sí y el badge de asistencia", () => {
    for (const mode of ["AUTOPAY", "ASSISTED", "CLIENT_MANAGED"] as const) {
      const autopayYes = paymentModeAutopayLabel(mode) === "Sí";
      const showsAssistance = paymentModeShowsAssistanceBadge(mode);
      expect(autopayYes && showsAssistance).toBe(false);
    }
  });
});
