import { z } from "zod";

// Los filtros de las páginas de lista llegan desde searchParams de la
// URL — un <select>/<input> vacío en un <form method="GET"> serializa
// como "clave=" (string vacío), no como "ausente". Sin este
// preprocesamiento, un campo z.uuid().optional()/z.string().min(1)
// rechaza esa string vacía en vez de tratarla como "sin filtro" —
// bug real encontrado en Fase 014 (afectaba también Contactos y
// Pólizas, no solo Tareas) al enviar un formulario de filtro sin
// cambiar ninguna opción. Envolver el campo en
// z.preprocess(emptyStringToUndefined, ...) lo hace tolerante de forma
// permanente, sin depender de que cada page.tsx recuerde hacer
// `sp.campo || undefined` antes de llamar al servicio.
export function emptyStringToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

export function optionalUuidFilter(message?: string) {
  return z.preprocess(emptyStringToUndefined, z.uuid(message).optional());
}

export function optionalSearchFilter(max = 200) {
  return z.preprocess(
    emptyStringToUndefined,
    z.string().trim().min(1).max(max).optional()
  );
}
