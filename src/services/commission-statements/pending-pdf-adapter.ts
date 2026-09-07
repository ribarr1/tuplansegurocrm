import type { CommissionStatementAdapter, ParsedStatement } from "./types";

// ---------------------------------------------------------------------------
// Fase 025.4 (UAT-05) — infraestructura para declarar una fuente PDF
// como "pendiente" (se registra, aparece en el selector, ACEPTA el
// upload y valida la firma real del archivo, pero `parse()` siempre
// falla con un mensaje claro) cuando no existe todavía ningún PDF de
// muestra real para esa AGENCIA+MODALIDAD — nunca se inventa un layout
// sin evidencia.
//
// Fase 025.5.3: el carrier (Oscar, Ambetter, Kaiser, BCBS, Cigna...)
// NUNCA es una fuente/modalidad propia — es un dato que se DETECTA del
// contenido del PDF (ver carrier-detection.ts), así que "Ambetter" ya
// no es (ni debe volver a ser) una entrada aparte aquí: un reporte de
// Ambetter pagado por Orange como propia usa exactamente
// OrangeOwnPdfAdapter, igual que uno de Oscar — el parser ya lo acepta
// sin necesitar código nuevo. Esta lista queda vacía mientras las 3
// agencias+modalidades confirmadas (ORANGE_OWN, ORANGE_REFERRAL,
// ELITE_REFERRAL) tengan adaptador real; se usaría de nuevo solo si
// apareciera una AGENCIA o MODALIDAD genuinamente nueva sin PDF de
// muestra todavía.
// ---------------------------------------------------------------------------
export function createPendingPdfAdapter(source: string, label: string): CommissionStatementAdapter {
  return {
    source,
    label: `${label} (PDF — pendiente)`,
    acceptedExtensions: [".pdf"],
    async parse(): Promise<ParsedStatement> {
      throw new Error(
        `El adaptador de ${label} en PDF todavía no está implementado — falta un PDF representativo real de ` +
          `${label} para programar su formato exacto (nunca se inventa un layout). Contacta al equipo para ` +
          `aportar una muestra real fuera de Git, o usa CSV/XLSX si esa fuente los provee.`
      );
    },
  };
}

export const PendingPdfAdapters: CommissionStatementAdapter[] = [];
