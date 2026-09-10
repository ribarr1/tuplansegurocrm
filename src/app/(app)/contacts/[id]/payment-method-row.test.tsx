// @vitest-environment jsdom
//
// AMPLIACIÓN — CORRECCIÓN del revelado de métodos de pago.
//
// El resto de la suite del proyecto corre en environment "node" (sin
// DOM) contra Postgres real — apropiado para servicios, pero incapaz
// de probar comportamiento puramente de UI como un temporizador de
// ocultamiento automático o una llamada a navigator.clipboard. Este
// archivo es la ÚNICA excepción: usa jsdom + @testing-library/react
// (nuevas devDependencies, decisión explícita — ver el reporte de esta
// fase) para montar el componente cliente real y verificar su
// comportamiento interactivo. La lógica de servidor (reautenticación,
// autorización, descifrado, auditoría) ya está cubierta con datos e
// infraestructura reales en payment-methods.service.test.ts — aquí SOLO
// se sustituyen las Server Actions (una frontera que de todas formas no
// puede ejecutarse en jsdom, ya que dependen de next/headers()) por
// dobles que devuelven exactamente el mismo contrato que el servicio
// real ya prueba.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Requerido por React 18+ para que act() reconozca este entorno como
// interactivo (evita la advertencia "not configured to support act(...)"
// — cosmética, pero se corrige para mantener la suite limpia).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { PaymentMethodRow } from "./payment-method-row";
import type { RevealedPaymentMethod } from "@/services/payment-methods.service";

vi.mock("./payment-methods-actions", () => ({
  revealPaymentMethodFullAction: vi.fn(),
  copyPaymentMethodFieldAction: vi.fn(),
  replacePaymentMethodSecretAction: vi.fn(),
  setDefaultPaymentMethodAction: vi.fn(),
  revokePaymentMethodAction: vi.fn(),
  updatePaymentMethodAction: vi.fn(),
}));

import {
  revealPaymentMethodFullAction,
  copyPaymentMethodFieldAction,
} from "./payment-methods-actions";

const CARD_REVEALED: RevealedPaymentMethod = {
  type: "CREDIT_CARD",
  cardholderName: "Juan Sintetico",
  cardNumber: "4111111111111234",
  cardExpMonth: 12,
  cardExpYear: 2030,
  cardBrand: "VISA",
  billingAddressLine1: "123 Calle Falsa",
  billingAddressLine2: null,
  billingCity: "Miami",
  billingState: "FL",
  billingZipCode: "33101",
  comment: "Notas administrativas sintéticas",
};

const BANK_REVEALED: RevealedPaymentMethod = {
  type: "BANK_ACCOUNT",
  bankAccountHolderName: "Maria Sintetica",
  bankName: "Banco de Pruebas",
  routingNumber: "011000015",
  accountNumber: "000123456789",
  bankAccountType: "CHECKING",
  billingAddressLine1: null,
  billingAddressLine2: null,
  billingCity: null,
  billingState: null,
  billingZipCode: null,
  comment: null,
};

function renderRow(overrides: Partial<React.ComponentProps<typeof PaymentMethodRow>> = {}) {
  return render(
    <PaymentMethodRow
      personId="person-1"
      paymentMethodId="pm-1"
      maskedLabel="Visa •••• 1234"
      isDefault={false}
      autopay={false}
      isActive={true}
      comment=""
      policyId={null}
      policies={[]}
      secretFields={[{ field: "cardNumber", label: "número de tarjeta" }]}
      {...overrides}
    />
  );
}

async function openAndReveal(revealed: RevealedPaymentMethod) {
  vi.mocked(revealPaymentMethodFullAction).mockResolvedValue({ data: revealed });
  fireEvent.click(screen.getByText("Ver detalles completos"));
  fireEvent.change(screen.getByLabelText("Tu contraseña"), { target: { value: "AdminPasswordSintetica2026" } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "Configurar pago en el portal del carrier" } });
  fireEvent.click(screen.getByRole("button", { name: "Revelar todo" }));
  const secretValue = revealed.type === "BANK_ACCOUNT" ? revealed.accountNumber : revealed.cardNumber;
  await screen.findByText(secretValue);
}

beforeEach(() => {
  vi.mocked(revealPaymentMethodFullAction).mockReset();
  vi.mocked(copyPaymentMethodFieldAction).mockReset().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PaymentMethodRow — revelado completo en una sola ventana (CORRECCIÓN)", () => {
  it("tarjeta completa: una sola reautenticación muestra nombre, número, vencimiento, marca/tipo, dirección y comentario", async () => {
    renderRow();
    await openAndReveal(CARD_REVEALED);

    expect(screen.getByText("Juan Sintetico")).toBeTruthy();
    expect(screen.getByText("4111111111111234")).toBeTruthy();
    expect(screen.getByText("12/2030")).toBeTruthy();
    expect(screen.getByText(/Visa · Crédito/)).toBeTruthy();
    expect(screen.getByText(/123 Calle Falsa/)).toBeTruthy();
    expect(screen.getByText("Notas administrativas sintéticas")).toBeTruthy();

    // Una sola llamada de reautenticación para todo el conjunto — nunca
    // una por campo.
    expect(revealPaymentMethodFullAction).toHaveBeenCalledTimes(1);
  });

  it("cuenta bancaria completa: una sola reautenticación muestra titular, banco, routing y número de cuenta completos", async () => {
    renderRow({ secretFields: [{ field: "routingNumber", label: "routing number" }, { field: "accountNumber", label: "número de cuenta" }] });
    await openAndReveal(BANK_REVEALED);

    expect(screen.getByText("Maria Sintetica")).toBeTruthy();
    expect(screen.getByText("Banco de Pruebas")).toBeTruthy();
    expect(screen.getByText("011000015")).toBeTruthy();
    expect(screen.getByText("000123456789")).toBeTruthy();
    expect(revealPaymentMethodFullAction).toHaveBeenCalledTimes(1);
  });

  it("campos opcionales ausentes: sin dirección de facturación ni comentario, no se muestran esas filas (nunca un valor vacío o inventado)", async () => {
    renderRow({ secretFields: [{ field: "routingNumber", label: "routing number" }, { field: "accountNumber", label: "número de cuenta" }] });
    await openAndReveal(BANK_REVEALED);

    expect(screen.queryByText("Dirección de facturación")).toBeNull();
    expect(screen.queryByText("Comentario")).toBeNull();
  });

  it("reautenticación incorrecta: el error del servidor se muestra y NUNCA se revela ningún dato", async () => {
    vi.mocked(revealPaymentMethodFullAction).mockResolvedValue({ error: "password: Contraseña incorrecta." });
    renderRow();
    fireEvent.click(screen.getByText("Ver detalles completos"));
    fireEvent.change(screen.getByLabelText("Tu contraseña"), { target: { value: "incorrecta" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "prueba" } });
    fireEvent.click(screen.getByRole("button", { name: "Revelar todo" }));

    await screen.findByText("password: Contraseña incorrecta.");
    expect(screen.queryByText(CARD_REVEALED.cardNumber)).toBeNull();
  });

  it("ocultamiento automático: los datos revelados desaparecen solos después del tiempo configurado", async () => {
    // shouldAdvanceTime: true deja que el reloj falso avance en
    // proporción al tiempo real mientras se resuelve el formulario
    // (testing-library usa setTimeout internamente para su polling de
    // findByText) — pero permite además saltar instantáneamente los
    // 20s del temporizador de ocultamiento sin esperarlos de verdad.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    renderRow();
    await openAndReveal(CARD_REVEALED);
    expect(screen.getByText(CARD_REVEALED.cardNumber)).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });

    expect(screen.queryByText(CARD_REVEALED.cardNumber)).toBeNull();
    // Vuelve a mostrar el formulario de reautenticación, no una
    // pantalla en blanco ni el valor "medio oculto".
    expect(screen.getByLabelText("Tu contraseña")).toBeTruthy();
  });

  it("cerrar la ventana también oculta los datos de inmediato (no solo el temporizador)", async () => {
    renderRow();
    await openAndReveal(CARD_REVEALED);

    // Cierra el diálogo (botón "X" con aria-label accesible de Base UI).
    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    // Al reabrir, nunca debe reaparecer el valor anterior — el estado
    // se reinicia por completo al cerrar.
    fireEvent.click(screen.getByText("Ver detalles completos"));
    expect(screen.queryByText(CARD_REVEALED.cardNumber)).toBeNull();
    expect(screen.getByLabelText("Tu contraseña")).toBeTruthy();
  });

  it("copia individual: copia el valor real al portapapeles pero audita SOLO el nombre del campo, nunca el valor", async () => {
    renderRow();
    await openAndReveal(CARD_REVEALED);

    const copyButtons = screen.getAllByRole("button", { name: "Copiar" });
    await act(async () => {
      fireEvent.click(copyButtons[1]); // segundo campo copiable = número de tarjeta
      await Promise.resolve();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(CARD_REVEALED.cardNumber);
    expect(copyPaymentMethodFieldAction).toHaveBeenCalledWith("pm-1", "cardNumber");
    // El mock nunca fue invocado con el valor real — solo con el
    // nombre de campo — confirmando que el valor jamás viaja hacia la
    // capa que terminaría auditándolo.
    for (const call of vi.mocked(copyPaymentMethodFieldAction).mock.calls) {
      expect(JSON.stringify(call)).not.toContain(CARD_REVEALED.cardNumber);
    }
  });
});
