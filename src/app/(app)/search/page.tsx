import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { globalSearch } from "@/services/search.service";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CONTACT_STATUS_BADGE_VARIANT, CONTACT_STATUS_LABELS, POLICY_STATUS_BADGE_VARIANT, POLICY_STATUS_LABELS } from "@/lib/labels";

// Buscador global — Fase 019.9 (§6). Nunca muestra SSN/credenciales
// (esos campos no existen en el modelo, así que no hay riesgo de
// exponerlos aquí ni por accidente). Resultados agrupados: Contactos y
// Pólizas.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const actor = await requireUser();

  const results = q && q.trim() ? await globalSearch(actor, { q }) : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Buscar</h2>
      <form method="GET" className="flex max-w-xl gap-2">
        <input
          type="text"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Nombre, teléfono, correo o número de póliza"
          className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
          autoFocus
        />
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
          Buscar
        </button>
      </form>

      {!results ? (
        <p className="text-sm text-muted-foreground">Escribe algo para buscar.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Contactos ({results.contacts.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {results.contacts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin resultados.</p>
              ) : (
                results.contacts.map((c) => (
                  <Link
                    key={c.id}
                    href={`/contacts/${c.id}`}
                    className="flex flex-col rounded-md border p-2 text-sm hover:bg-muted"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {c.firstName} {c.lastName}
                      <Badge variant={CONTACT_STATUS_BADGE_VARIANT[c.contactStatus]}>
                        {CONTACT_STATUS_LABELS[c.contactStatus]}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Pólizas ({results.policies.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {results.policies.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin resultados.</p>
              ) : (
                results.policies.map((p) => (
                  <Link
                    key={p.id}
                    href={`/policies/${p.id}`}
                    className="flex flex-col rounded-md border p-2 text-sm hover:bg-muted"
                  >
                    <span className="flex items-center gap-2 font-medium">
                      {p.policyNumber ?? "Póliza sin número"}
                      <Badge variant={POLICY_STATUS_BADGE_VARIANT[p.status]}>
                        {POLICY_STATUS_LABELS[p.status]}
                      </Badge>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {p.holder.firstName} {p.holder.lastName} · {p.product.carrier.name} —{" "}
                      {p.product.name}
                    </span>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
