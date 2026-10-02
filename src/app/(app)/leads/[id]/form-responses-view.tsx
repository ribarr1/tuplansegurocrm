import type { ReactNode } from "react";

// Vista de solo lectura de Lead.formResponses — § "Respuestas del
// formulario" (Fase 026). SIEMPRE renderiza como texto (React escapa
// todo el contenido de un nodo de texto por diseño); nunca usa
// dangerouslySetInnerHTML ni interpreta el valor como HTML, aunque el
// remitente externo haya enviado marcado dentro de una respuesta.
type JsonLike = string | number | boolean | null | JsonLike[] | { [key: string]: JsonLike };

function renderValue(value: JsonLike, depth: number): ReactNode {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "string" || typeof value === "number") return String(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">(lista vacía)</span>;
    return (
      <ul className="ml-4 list-disc">
        {value.map((item, index) => (
          <li key={index}>{renderValue(item, depth + 1)}</li>
        ))}
      </ul>
    );
  }

  const entries = Object.entries(value);
  if (entries.length === 0) return <span className="text-muted-foreground">(sin datos)</span>;
  return (
    <dl className={depth > 0 ? "ml-4 flex flex-col gap-1" : "flex flex-col gap-1"}>
      {entries.map(([key, v]) => (
        <div key={key} className="flex flex-col">
          <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
          <dd>{renderValue(v, depth + 1)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function FormResponsesView({ formResponses }: { formResponses: unknown }) {
  if (formResponses === null || formResponses === undefined) return null;

  return (
    <section className="rounded-md border p-4">
      <h3 className="mb-2 text-sm font-medium">Respuestas del formulario</h3>
      <div className="text-sm">{renderValue(formResponses as JsonLike, 0)}</div>
    </section>
  );
}
