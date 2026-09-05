"use client";

import { useId, useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { isoToUsDate, maskUsDate, usDateToIso } from "@/lib/date-only";

interface USDateInputProps {
  id?: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

// Hallazgo #16 de UAT (Fase 019.8) + Fase 025.4 (UAT-02): reemplaza
// <input type="date"> para garantizar la visual MM/DD/AAAA sin
// depender del locale/SO del navegador — pero SÍ debe abrir un
// calendario real al hacer clic, cosa que un <input type="text"> puro
// nunca hace. Se resuelve con un <input type="date"> nativo oculto
// (accesible solo mediante el botón de calendario, vía
// HTMLInputElement.showPicker()) que sincroniza su valor con el campo
// de texto visible — nunca al revés en el otro sentido de conflicto:
// ambos escriben al mismo estado (display/iso), nunca hay dos fuentes
// de verdad. El campo realmente enviado sigue siendo el
// <input type="hidden"> en formato YYYY-MM-DD, sin cambios de
// contrato para el resto de la app.
//
// El campo de texto visible NUNCA lleva `name` (solo `id`) — evita que
// el heurístico de autocompletado de pagos de Chrome lo asocie con
// "vencimiento de tarjeta" por la combinación numérica corta cercana a
// campos de monto (ej. Prima). `autoComplete="off"` respeta la
// intención semántica (nunca es una fecha de nacimiento/pago
// reutilizable), aunque el aviso de Chrome sobre autocompletado de
// pagos deshabilitado por conexión insegura es un comportamiento del
// navegador en HTTP — no depende de este componente ni desaparece
// cambiando atributos, solo al servir la app por HTTPS (ver
// docs/DECISIONS.md).
export function USDateInput({
  id,
  name,
  defaultValue,
  required,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: USDateInputProps) {
  const hiddenId = useId();
  const nativeDateId = useId();
  const nativeDateRef = useRef<HTMLInputElement>(null);
  const [display, setDisplay] = useState(() => isoToUsDate(defaultValue));
  const [iso, setIso] = useState(() => usDateToIso(isoToUsDate(defaultValue)));

  function openCalendar() {
    const el = nativeDateRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // showPicker puede lanzar si el input no está "conectado" o el
        // navegador lo bloquea (ej. sin gesto de usuario) — el
        // fallback de abajo cubre navegadores sin soporte.
      }
    }
    el.focus();
    el.click();
  }

  return (
    <div className="relative flex items-center">
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM/DD/AAAA"
        maxLength={10}
        value={display}
        required={required}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        className="pr-9"
        onChange={(e) => {
          const masked = maskUsDate(e.target.value);
          setDisplay(masked);
          setIso(usDateToIso(masked));
        }}
      />
      <button
        type="button"
        aria-label="Abrir calendario"
        onClick={openCalendar}
        className="absolute right-2 flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
      >
        <CalendarIcon className="h-4 w-4" />
      </button>
      {/* Input nativo real — invisible pero funcional, solo se abre vía
          el botón de arriba. Nunca lleva `name`: el valor que se envía
          es siempre el hidden de abajo, en YYYY-MM-DD. */}
      <input
        ref={nativeDateRef}
        id={nativeDateId}
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={iso}
        onChange={(e) => {
          setIso(e.target.value);
          setDisplay(isoToUsDate(e.target.value));
        }}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
      />
      <input type="hidden" id={hiddenId} name={name} value={iso} />
    </div>
  );
}
