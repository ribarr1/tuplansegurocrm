// Feedback estándar de formularios con Server Action — Fase 019.6
// (hallazgo #11 de UAT: el ActionState existía server-side pero varios
// formularios no lo mostraban). Tres piezas reutilizables en vez de
// que cada formulario reinvente su propio <p> con clases repetidas:
// error a nivel de formulario, éxito, y error de un campo puntual.
// Ninguna decide el mensaje — cada formulario sigue siendo dueño de
// cuándo mostrar cuál, esto solo estandariza el marcado/estilo.

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p
      role="status"
      className="rounded-md px-3 py-2 text-sm"
      style={{ backgroundColor: "color-mix(in oklab, var(--brand-secondary) 12%, transparent)", color: "var(--brand-secondary)" }}
    >
      {message}
    </p>
  );
}

export function FieldError({ id, message }: { id?: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}
