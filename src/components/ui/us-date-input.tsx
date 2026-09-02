"use client";

import { useId, useState } from "react";
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

// Hallazgo #16 de UAT (Fase 019.8): reemplaza <input type="date"> en
// los campos donde necesitamos garantizar la experiencia visual
// MM/DD/AAAA sin depender del locale/SO del navegador. El campo
// visible (texto, enmascarado) nunca se envía al servidor — el que
// viaja en el FormData es el <input type="hidden"> con el mismo
// nombre y el mismo formato YYYY-MM-DD que ya esperaban los schemas
// y Server Actions existentes, así que ningún otro archivo necesita
// cambiar para adoptar este componente.
export function USDateInput({
  id,
  name,
  defaultValue,
  required,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: USDateInputProps) {
  const hiddenId = useId();
  const [display, setDisplay] = useState(() => isoToUsDate(defaultValue));
  const [iso, setIso] = useState(() => usDateToIso(isoToUsDate(defaultValue)));

  return (
    <>
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
        onChange={(e) => {
          const masked = maskUsDate(e.target.value);
          setDisplay(masked);
          setIso(usDateToIso(masked));
        }}
      />
      <input type="hidden" id={hiddenId} name={name} value={iso} />
    </>
  );
}
