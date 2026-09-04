import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getPersonById } from "@/services/people.service";
import { getHouseholdsForPerson } from "@/services/households.service";
import { listActiveCarriers, listActiveProducts } from "@/services/policies.service";
import { listActiveAgents } from "@/services/users.service";
import { listPeople } from "@/services/people.service";
import { AppError } from "@/services/errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { POLICY_TYPE_LABELS } from "@/lib/labels";
import { PolicyForm, type CoveredCandidate } from "../policy-form";
import { createPolicyAction } from "../actions";

type SearchParams = {
  holderId?: string;
  holderSearch?: string;
  policyType?: string;
  carrierId?: string;
};

export default async function NewPolicyPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;

  const policyType = (POLICY_TYPE_VALUES as readonly string[]).includes(sp.policyType ?? "")
    ? sp.policyType
    : undefined;

  const carriers = await listActiveCarriers(actor);

  let holderSearchResults: { id: string; firstName: string; lastName: string; phone: string | null }[] = [];
  if (sp.holderSearch) {
    const { items } = await listPeople(actor, { search: sp.holderSearch, page: 1, pageSize: 10 });
    holderSearchResults = items;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">Nueva póliza</h2>

      <section className="flex flex-col gap-3 rounded-md border p-4">
        <h3 className="text-sm font-medium">
          {sp.holderId ? "Cambiar titular" : "Buscar titular"}
        </h3>
        <form method="GET" className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor="holderSearch">Buscar persona</Label>
            <Input
              // Hallazgo #7 de UAT (Fase 022): esta sección (incluido este
              // Input) sigue montada al navegar de "?holderSearch=x" a
              // "?holderId=y" (mismo Client Component `Input`, misma
              // posición en el árbol — Next.js no la remonta solo porque
              // cambien los searchParams de la misma ruta). Sin `key`,
              // `defaultValue` pasaría de "x" a "" sobre una instancia YA
              // inicializada — exactamente lo que Base UI advierte
              // ("changing the default value state of an uncontrolled
              // FieldControl after being initialized"). La `key` fuerza un
              // remount limpio cuando el término de búsqueda cambia,
              // mismo patrón ya usado para el `key={formKey}` de los
              // formularios con useActionState.
              key={sp.holderSearch ?? ""}
              id="holderSearch"
              name="holderSearch"
              placeholder="Nombre, teléfono o correo"
              defaultValue={sp.holderSearch ?? ""}
            />
          </div>
          <Button type="submit" variant="secondary">
            Buscar
          </Button>
        </form>
        {sp.holderSearch && holderSearchResults.length === 0 && (
          <p className="text-sm text-muted-foreground">Sin resultados.</p>
        )}
        {holderSearchResults.length > 0 && (
          <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-md border p-1">
            {holderSearchResults.map((person) => (
              <Link
                key={person.id}
                href={`/policies/new?holderId=${person.id}`}
                className="flex flex-col rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <span className="font-medium">
                  {person.firstName} {person.lastName}
                </span>
                <span className="text-xs text-muted-foreground">{person.phone ?? "—"}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      {!sp.holderId ? (
        <p className="text-sm text-muted-foreground">
          Busca y selecciona un titular arriba para continuar.
        </p>
      ) : (
        <HolderPolicyForm
          holderId={sp.holderId}
          policyType={policyType}
          carrierId={sp.carrierId || undefined}
          carriers={carriers}
        />
      )}
    </div>
  );
}

async function HolderPolicyForm({
  holderId,
  policyType,
  carrierId,
  carriers,
}: {
  holderId: string;
  policyType: string | undefined;
  carrierId: string | undefined;
  carriers: { id: string; name: string }[];
}) {
  const actor = await requireUser();

  let holder;
  try {
    holder = await getPersonById(actor, holderId);
  } catch (error) {
    if (error instanceof AppError && (error.code === "NOT_FOUND" || error.code === "VALIDATION_ERROR")) {
      notFound();
    }
    throw error;
  }

  const [households, products] = await Promise.all([
    getHouseholdsForPerson(actor, holderId),
    listActiveProducts(actor, { policyType, carrierId }),
  ]);

  const candidateMap = new Map<string, CoveredCandidate>();
  for (const household of households) {
    for (const member of household.members) {
      if (member.person.id === holderId) continue;
      candidateMap.set(member.person.id, {
        id: member.person.id,
        firstName: member.person.firstName,
        lastName: member.person.lastName,
        householdRole: member.role,
      });
    }
  }
  const candidates = Array.from(candidateMap.values());

  const showProcessedBySelect = actor.role === "ADMIN";
  const activeAgents = showProcessedBySelect ? await listActiveAgents(actor) : [];

  return (
    <>
      <form method="GET" className="flex flex-wrap items-end gap-3 rounded-md border p-4">
        <input type="hidden" name="holderId" value={holderId} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyType">Tipo de seguro</Label>
          <select
            id="policyType"
            name="policyType"
            defaultValue={policyType ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todos</option>
            {POLICY_TYPE_VALUES.map((type) => (
              <option key={type} value={type}>
                {POLICY_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="carrierId">Compañía</Label>
          <select
            id="carrierId"
            name="carrierId"
            defaultValue={carrierId ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {carriers.map((carrier) => (
              <option key={carrier.id} value={carrier.id}>
                {carrier.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar productos
        </Button>
      </form>

      <PolicyForm
        action={createPolicyAction}
        holderId={holderId}
        holderLabel={`${holder.firstName} ${holder.lastName}`}
        products={products}
        candidates={candidates}
        showProcessedBySelect={showProcessedBySelect}
        activeAgents={activeAgents}
      />
    </>
  );
}
