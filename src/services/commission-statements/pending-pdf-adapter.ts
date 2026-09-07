import type { CommissionStatementAdapter, ParsedStatement } from "./types";

// ---------------------------------------------------------------------------
// Fase 025.4 (UAT-05) — los reportes de pago REALES que llegan hoy son
// PDF (no CSV/XLSX como se asumió en Fase 020, ver
// docs/COMMISSION_RECONCILIATION.md). Se habilita la SUBIDA segura de
// PDF (validación de extensión + firma real %PDF- + tamaño, igual
// rigor que XLSX) y el CONTRATO de adaptador por fuente/carrier, pero
// el parseo real de cada layout NO se implementa aquí — no existe en
// este entorno ningún PDF de muestra real de Orange/Oscar, Ambetter,
// BCBS, Kaiser o Elite para verificar contra qué estructura exacta
// programar (columnas, posición, si el texto es seleccionable o
// escaneado/OCR). Escribir un parser sin esa evidencia sería
// inventar un layout — exactamente lo que la ficha de UAT prohíbe
// explícitamente.
//
// Este adaptador "pendiente" cumple el resto de la arquitectura: se
// registra, aparece en el selector de fuente, ACEPTA el upload (sube,
// se valida como PDF real), pero `parse()` siempre falla con un
// mensaje claro señalando qué falta — reconciliation.service.ts
// convierte ese error en VALIDATION_ERROR visible para el ADMIN, y
// NUNCA se llega a crear un CommissionStatement en PREVIEW ni,
// mucho menos, a `applyCommissionStatement` (que solo actúa sobre
// filas ya MATCHED de un preview que nunca existió). "Apply" queda
// bloqueado por construcción, no por una bandera aparte.
//
// Para completar un adaptador real: reemplazar `parse()` de la
// entrada correspondiente en registry.ts por una implementación real
// (probablemente con una librería de extracción de texto de PDF,
// añadida ENTONCES, nunca antes de tener con qué probarla) una vez
// se disponga de al menos un PDF representativo real de esa fuente
// (fuera de Git, aportado de forma segura).
function createPendingPdfAdapter(source: string, label: string): CommissionStatementAdapter {
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

// Fase 025.5: ORANGE_OSCAR_PDF, ORANGE_KAISER_PDF y ELITE_BCBS_PDF ya
// tienen adaptador REAL (ver orange-oscar-pdf-adapter.ts,
// orange-kaiser-pdf-adapter.ts, elite-bcbs-pdf-adapter.ts) — se
// retiraron de aquí. Ambetter sigue sin ningún PDF de muestra real
// analizado; se mantiene como pendiente explícito. BCBS_PDF/KAISER_PDF/
// ELITE_PDF (genéricos, sin agencia+modalidad confirmada) se retiran:
// la ficha de UAT confirmó que la combinación real correcta es
// agencia+modalidad+carrier específicos (ej. BCBS puede ser propia vía
// Orange O referida vía Elite, según el estado — nunca "BCBS = Elite"
// a secas), así que un stub genérico por carrier sin esa distinción ya
// no representa correctamente el dominio.
export const PendingPdfAdapters: CommissionStatementAdapter[] = [
  createPendingPdfAdapter("AMBETTER_PDF", "Ambetter"),
];
