"use client";

import { useId, useRef, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { usDateToIso, isoToUsDate } from "@/lib/date-only";
import {
  combineUsDateTimeToIsoLocal,
  splitIsoLocalToUsDateTime,
  maskTwoDigits,
  maskUsDate,
  type Meridiem,
} from "@/lib/us-datetime";

interface USDateTimeInputProps {
  id?: string;
  name: string;
  // "YYYY-MM-DDTHH:mm" (hora de pared en APP_TIME_ZONE) o null/"" —
  // ver toBusinessDateTimeLocalString en business-time.ts para cómo se
  // calcula desde el Server Component.
  defaultValue?: string | null;
  required?: boolean;
}

// Fase 020 (§5): composición USDateInput + hora 12h + AM/PM (nunca
// 24h) — el mismo enfoque que la ficha sugiere explícitamente en vez
// de una librería de calendario pesada. Produce un único
// <input type="hidden"> con "YYYY-MM-DDTHH:mm", que el servidor
// interpreta como hora de pared en APP_TIME_ZONE (nunca la zona del
// proceso Node) — ver zonedTimeToUtc en business-time.ts.
export function USDateTimeInput({ id, name, defaultValue, required }: USDateTimeInputProps) {
  const baseId = useId();
  const nativeDateId = useId();
  const nativeDateRef = useRef<HTMLInputElement>(null);
  const initial = splitIsoLocalToUsDateTime(defaultValue);
  const [dateDisplay, setDateDisplay] = useState(initial.dateUs);
  const [hourDisplay, setHourDisplay] = useState(initial.hour12);
  const [minuteDisplay, setMinuteDisplay] = useState(initial.minute);
  const [meridiem, setMeridiem] = useState<Meridiem>(initial.meridiem);

  const iso = combineUsDateTimeToIsoLocal(dateDisplay, hourDisplay, minuteDisplay, meridiem);

  // Fase 025.4 (UAT-02): mismo mecanismo de calendario real que
  // USDateInput — un <input type="date"> nativo oculto, abierto solo
  // vía el botón, nunca la fuente de verdad del envío (eso sigue
  // siendo el hidden "YYYY-MM-DDTHH:mm" combinado más abajo).
  function openCalendar() {
    const el = nativeDateRef.current;
    if (!el) return;
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // Fallback abajo para navegadores sin soporte/gesto bloqueado.
      }
    }
    el.focus();
    el.click();
  }

  return (
    <div className="flex items-center gap-2">
      <div className="relative flex items-center">
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          placeholder="MM/DD/AAAA"
          maxLength={10}
          required={required}
          value={dateDisplay}
          onChange={(e) => setDateDisplay(maskUsDate(e.target.value))}
          className="w-32 pr-9"
        />
        <button
          type="button"
          aria-label="Abrir calendario"
          onClick={openCalendar}
          className="absolute right-2 flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
        >
          <CalendarIcon className="h-4 w-4" />
        </button>
        <input
          ref={nativeDateRef}
          id={nativeDateId}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          value={usDateToIso(dateDisplay)}
          onChange={(e) => setDateDisplay(isoToUsDate(e.target.value))}
          className="pointer-events-none absolute h-0 w-0 opacity-0"
        />
      </div>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="HH"
        maxLength={2}
        aria-label="Hora"
        value={hourDisplay}
        onChange={(e) => setHourDisplay(maskTwoDigits(e.target.value))}
        className="w-12 text-center"
      />
      <span className="text-muted-foreground">:</span>
      <Input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="MM"
        maxLength={2}
        aria-label="Minuto"
        value={minuteDisplay}
        onChange={(e) => setMinuteDisplay(maskTwoDigits(e.target.value))}
        className="w-12 text-center"
      />
      <select
        aria-label="AM/PM"
        value={meridiem}
        onChange={(e) => setMeridiem(e.target.value as Meridiem)}
        className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
      <input type="hidden" id={baseId} name={name} value={iso} />
    </div>
  );
}
