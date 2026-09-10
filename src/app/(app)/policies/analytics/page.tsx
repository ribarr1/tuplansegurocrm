import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { getPolicyAnalytics } from "@/services/policy-analytics.service";
import { listActiveCarriers } from "@/services/policies.service";
import { listActiveAgents } from "@/services/users.service";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { POLICY_TYPE_LABELS } from "@/lib/labels";
import { US_STATE_CODES } from "@/lib/us-states";
import { formatDateOnlyUS } from "@/lib/date-only";

type SearchParams = {
  periodMode?: string;
  year?: string;
  month?: string;
  quarter?: string;
  startDate?: string;
  endDate?: string;
  dateField?: string;
  carrierId?: string;
  agentId?: string;
  policyType?: string;
  status?: string;
  businessSource?: string;
  geographicState?: string;
};

function buildDrilldownHref(sp: SearchParams, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  if (sp.carrierId) params.set("carrierId", sp.carrierId);
  if (sp.agentId) params.set("agentId", sp.agentId);
  if (sp.policyType) params.set("policyType", sp.policyType);
  if (sp.status) params.set("status", sp.status);
  if (sp.businessSource) params.set("businessSource", sp.businessSource);
  for (const [key, value] of Object.entries(overrides)) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const qs = params.toString();
  return qs ? `/policies?${qs}` : "/policies";
}

// Dashboard gráfico de pólizas — AMPLIACIÓN PREPRODUCCIÓN. Server
// Component, cálculos agregados en policy-analytics.service.ts. Cada
// tarjeta indica explícitamente qué fecha usa (creación/efectiva/
// terminación) — ver comentarios en el servicio sobre las limitaciones
// documentadas (estado geográfico depende de Household.state;
// "renovaciones" y "terminaciones" próximas colapsan en una sola señal).
export default async function PolicyAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireUser();
  const sp = await searchParams;

  const [result, carriers, agents] = await Promise.all([
    getPolicyAnalytics(actor, {
      periodMode: sp.periodMode || undefined,
      year: sp.year || undefined,
      month: sp.month || undefined,
      quarter: sp.quarter || undefined,
      startDate: sp.startDate || undefined,
      endDate: sp.endDate || undefined,
      dateField: sp.dateField || undefined,
      carrierId: sp.carrierId || undefined,
      agentId: sp.agentId || undefined,
      policyType: sp.policyType || undefined,
      status: sp.status || undefined,
      businessSource: sp.businessSource || undefined,
      geographicState: sp.geographicState || undefined,
    }),
    listActiveCarriers(actor),
    actor.role === "ADMIN" || actor.role === "ASSISTANT" ? listActiveAgents(actor) : Promise.resolve([]),
  ]);

  const { indicators, charts, upcomingRenewalsOrTerminations, filters } = result;
  const dateFieldLabel = filters.dateField === "EFFECTIVE" ? "fecha efectiva" : filters.dateField === "TERMINATION" ? "fecha de terminación" : "fecha de creación";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Analítica de pólizas</h2>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/policies" />}>
          Ver listado
        </Button>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-md border p-4" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="periodMode">Período</Label>
          <select id="periodMode" name="periodMode" defaultValue={sp.periodMode || "ALL"} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="ALL">Todo</option>
            <option value="MONTH">Mes</option>
            <option value="QUARTER">Trimestre</option>
            <option value="YEAR">Año</option>
            <option value="RANGE">Rango personalizado</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="dateField">Fecha que filtra el período</Label>
          <select id="dateField" name="dateField" defaultValue={sp.dateField || "CREATED"} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="CREATED">Creación</option>
            <option value="EFFECTIVE">Efectiva</option>
            <option value="TERMINATION">Terminación/cancelación</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="year">Año</Label>
          <Input key={sp.year ?? ""} id="year" name="year" type="number" placeholder="2026" defaultValue={sp.year ?? ""} className="w-24" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="month">Mes (1-12)</Label>
          <Input key={sp.month ?? ""} id="month" name="month" type="number" min={1} max={12} defaultValue={sp.month ?? ""} className="w-20" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="quarter">Trimestre (1-4)</Label>
          <Input key={sp.quarter ?? ""} id="quarter" name="quarter" type="number" min={1} max={4} defaultValue={sp.quarter ?? ""} className="w-20" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="startDate">Desde</Label>
          <Input key={sp.startDate ?? ""} id="startDate" name="startDate" type="date" defaultValue={sp.startDate ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="endDate">Hasta</Label>
          <Input key={sp.endDate ?? ""} id="endDate" name="endDate" type="date" defaultValue={sp.endDate ?? ""} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="carrierId">Compañía</Label>
          <select id="carrierId" name="carrierId" defaultValue={sp.carrierId ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas</option>
            {carriers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyType">Tipo</Label>
          <select id="policyType" name="policyType" defaultValue={sp.policyType ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos</option>
            {POLICY_TYPE_VALUES.map((t) => (
              <option key={t} value={t}>
                {POLICY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Estado</Label>
          <select id="status" name="status" defaultValue={sp.status ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos</option>
            <option value="PENDING">Pendiente</option>
            <option value="ACTIVE">Activa</option>
            <option value="CANCELLED">Cancelada</option>
            <option value="EXPIRED">Expirada</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="businessSource">Propia/Referida</Label>
          <select id="businessSource" name="businessSource" defaultValue={sp.businessSource ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas</option>
            <option value="OWN">Propia</option>
            <option value="REFERRAL">Referida</option>
            <option value="UNKNOWN">Sin clasificar</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="geographicState">Estado geográfico</Label>
          <select id="geographicState" name="geographicState" defaultValue={sp.geographicState ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todos</option>
            {US_STATE_CODES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {agents.length > 0 && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="agentId">Procesado por</Label>
            <select id="agentId" name="agentId" defaultValue={sp.agentId ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
              <option value="">Todos</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        <Button variant="ghost" nativeButton={false} render={<Link href="/policies/analytics" />}>
          Limpiar
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">
        &quot;Total de pólizas&quot; y los desgloses de esta página usan {dateFieldLabel} para aplicar el período
        seleccionado. &quot;Nuevas por mes&quot; siempre usa fecha de creación; &quot;cancelaciones&quot; siempre usa
        fecha de terminación.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicator label="Total de pólizas" value={String(indicators.total)} />
        {charts.byStatus.map((s) => (
          <Indicator key={s.status} label={s.label} value={String(s.count)} />
        ))}
      </div>

      <ChartCard title="Tendencia mensual de altas y cancelaciones" caption="Altas: fecha de creación. Cancelaciones: fecha de terminación.">
        <LineChart
          data={charts.monthlyAltasCancelaciones.map((m) => ({ label: m.label, values: { altas: m.altas, cancelaciones: m.cancelaciones } }))}
          series={[
            { key: "altas", label: "Altas" },
            { key: "cancelaciones", label: "Cancelaciones" },
          ]}
        />
      </ChartCard>

      <ChartCard title="Nuevas pólizas por mes" caption="Fecha de creación">
        <LineChart
          data={charts.newByMonth.map((m) => ({ label: m.label, values: { count: m.count } }))}
          series={[{ key: "count", label: "Nuevas" }]}
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Pólizas por carrier">
          <BarChart
            data={charts.byCarrier.map((c) => ({ category: c.carrierName, values: { count: c.count } }))}
            series={[{ key: "count", label: "Pólizas" }]}
            emptyMessage={sp.carrierId ? "Ya filtraste por una compañía específica." : "No hay pólizas con estos filtros."}
          />
        </ChartCard>
        <ChartCard title="Pólizas por tipo">
          <BarChart
            data={charts.byType.map((t) => ({ category: POLICY_TYPE_LABELS[t.policyType as keyof typeof POLICY_TYPE_LABELS] ?? t.policyType, values: { count: t.count } }))}
            series={[{ key: "count", label: "Pólizas" }]}
            emptyMessage={sp.policyType ? "Ya filtraste por un tipo específico." : "No hay pólizas con estos filtros."}
          />
        </ChartCard>
        <ChartCard title="Propias vs. referidas">
          <BarChart
            data={charts.byBusinessSource.map((b) => ({ category: b.label, values: { count: b.count } }))}
            series={[{ key: "count", label: "Pólizas" }]}
            emptyMessage={sp.businessSource ? "Ya filtraste por Propia/Referida." : "No hay pólizas con estos filtros."}
          />
        </ChartCard>
        <ChartCard title="Pólizas por estado geográfico" caption="Vía Household.state — una póliza sin hogar vinculado cae en 'Sin estado'">
          <BarChart
            data={charts.byGeographicState.map((g) => ({ category: g.label, values: { count: g.count } }))}
            series={[{ key: "count", label: "Pólizas" }]}
            emptyMessage={sp.geographicState ? "Ya filtraste por un estado específico." : "No hay pólizas con estos filtros."}
          />
        </ChartCard>
        <ChartCard title="Pólizas por agente" caption="Procesado por (Policy.processedById)">
          <BarChart
            data={charts.byAgent.map((a) => ({ category: a.agentName, values: { count: a.count } }))}
            series={[{ key: "count", label: "Pólizas" }]}
            emptyMessage={sp.agentId ? "Ya filtraste por un agente específico." : "No hay pólizas con estos filtros."}
          />
        </ChartCard>
      </div>

      <div className="rounded-md border p-4">
        <p className="text-sm font-medium">Renovaciones / terminaciones próximas (30 días)</p>
        <p className="mb-2 text-xs text-muted-foreground">
          El esquema no distingue si una póliza próxima a vencer se renovará o simplemente terminará — ambos
          conceptos del ticket se muestran aquí como una sola señal (fecha de terminación dentro de 30 días, misma
          lista que ya usa el Dashboard).
        </p>
        {upcomingRenewalsOrTerminations.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna póliza vence en los próximos 30 días.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {upcomingRenewalsOrTerminations.map((p) => (
              <li key={p.id}>
                <Link href={`/policies/${p.id}`} className="underline">
                  {p.policyNumber ?? "sin número"}
                </Link>{" "}
                — {p.holderName} — {p.carrierName} — vence {p.terminationDate ? formatDateOnlyUS(p.terminationDate) : "—"}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        <Link href={buildDrilldownHref(sp, {})} className="underline">
          Ver estas pólizas en el listado con los mismos filtros
        </Link>
      </p>
    </div>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function ChartCard({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-sm font-medium">{title}</p>
      {caption && <p className="mb-2 text-xs text-muted-foreground">{caption}</p>}
      <div className={caption ? "" : "mt-2"}>{children}</div>
    </div>
  );
}
