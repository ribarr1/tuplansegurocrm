import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireUser } from "@/lib/authorization";
import { getCommissionAnalytics } from "@/services/commission-analytics.service";
import { listActiveCarriers } from "@/services/policies.service";
import { listActiveAgents } from "@/services/users.service";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { BarChart } from "@/components/charts/bar-chart";
import { LineChart } from "@/components/charts/line-chart";
import { COMMISSION_DERIVED_STATUS_LABELS } from "@/lib/labels";
import { POLICY_TYPE_VALUES } from "@/schemas/policy.schema";
import { POLICY_TYPE_LABELS } from "@/lib/labels";

type SearchParams = {
  periodMode?: string;
  year?: string;
  month?: string;
  quarter?: string;
  startDate?: string;
  endDate?: string;
  carrierId?: string;
  agentId?: string;
  policyType?: string;
  businessSource?: string;
};

function formatMoney(amount: { toFixed: (n: number) => string } | null): string {
  if (!amount) return "—";
  return `$${amount.toFixed(2)}`;
}

function formatPct(value: { toFixed: (n: number) => string } | null): string {
  if (!value) return "—";
  return `${value.toFixed(1)}%`;
}

// Dashboard gráfico de comisiones — AMPLIACIÓN PREPRODUCCIÓN. Server
// Component: TODOS los cálculos ya llegan agregados desde
// commission-analytics.service.ts (nunca se suma en el cliente). ADMIN
// ve todo; AGENT ve su propio alcance (scope ya aplicado por el
// servicio); ASSISTANT recibe 403 real, igual que el resto del módulo
// de comisiones.
export default async function CommissionAnalyticsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const actor = await requireUser();
  if (actor.role === "ASSISTANT") forbidden();

  const sp = await searchParams;
  const [result, carriers, agents] = await Promise.all([
    getCommissionAnalytics(actor, {
      periodMode: sp.periodMode || undefined,
      year: sp.year || undefined,
      month: sp.month || undefined,
      quarter: sp.quarter || undefined,
      startDate: sp.startDate || undefined,
      endDate: sp.endDate || undefined,
      carrierId: sp.carrierId || undefined,
      agentId: sp.agentId || undefined,
      policyType: sp.policyType || undefined,
      businessSource: sp.businessSource || undefined,
    }),
    listActiveCarriers(actor),
    actor.role === "ADMIN" ? listActiveAgents(actor) : Promise.resolve([]),
  ]);

  const { overall, charts } = result;
  const periodMode = sp.periodMode || "ALL";

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-semibold">Analítica de comisiones</h2>
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/commissions" />}>
          Ver listado
        </Button>
      </div>

      <form className="flex flex-wrap items-end gap-3 rounded-md border p-4" method="GET">
        <div className="flex flex-col gap-1">
          <Label htmlFor="periodMode">Período</Label>
          <select
            id="periodMode"
            name="periodMode"
            defaultValue={periodMode}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="ALL">Todo</option>
            <option value="MONTH">Mes</option>
            <option value="QUARTER">Trimestre</option>
            <option value="YEAR">Año</option>
            <option value="RANGE">Rango personalizado</option>
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
        {actor.role === "ADMIN" && (
          <div className="flex flex-col gap-1">
            <Label htmlFor="agentId">Agente</Label>
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
        <div className="flex flex-col gap-1">
          <Label htmlFor="policyType">Tipo de póliza</Label>
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
          <Label htmlFor="businessSource">Propia/Referida</Label>
          <select id="businessSource" name="businessSource" defaultValue={sp.businessSource ?? ""} className="h-9 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Todas</option>
            <option value="OWN">Propia</option>
            <option value="REFERRAL">Referida</option>
            <option value="UNKNOWN">Sin clasificar</option>
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        <Button variant="ghost" nativeButton={false} render={<Link href="/commissions/analytics" />}>
          Limpiar
        </Button>
      </form>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Indicator label="Total esperado" value={formatMoney(overall.expected)} />
        <Indicator label="Recibido bruto" value={formatMoney(overall.receivedGross)} />
        <Indicator label="Pendiente" value={formatMoney(overall.pending)} />
        <Indicator label="Pagado de más" value={formatMoney(overall.overpaid)} />
        <Indicator label="Asistencia" value={formatMoney(overall.assistance)} hint="Solo pagos ligados a un statement importado" />
        <Indicator label="Neto recibido" value={formatMoney(overall.netReceived)} hint="Bruto − Asistencia" />
        <Indicator label="Diferencia" value={formatMoney(overall.difference)} hint="Recibido − Esperado" />
        <Indicator label="% conciliado" value={formatPct(overall.pctReconciled)} />
        <Indicator
          label="Pagos sin expectativa"
          value={`${overall.paymentsWithoutExpectationCount} (${formatMoney(overall.paymentsWithoutExpectationAmount)})`}
        />
      </div>

      <ChartCard title="Esperado vs. recibido por mes" caption="Usa CommissionExpectation.period / CommissionPayment.period">
        <LineChart
          data={charts.monthlyTrend.map((m) => ({ label: m.label, values: { expected: Number(m.expected), received: Number(m.received) } }))}
          series={[
            { key: "expected", label: "Esperado" },
            { key: "received", label: "Recibido" },
          ]}
          valueFormat="currency"
        />
      </ChartCard>

      <ChartCard title="Tendencia mensual de asistencia y neto recibido">
        <LineChart
          data={charts.monthlyTrend.map((m) => ({ label: m.label, values: { assistance: Number(m.assistance), net: Number(m.net) } }))}
          series={[
            { key: "assistance", label: "Asistencia" },
            { key: "net", label: "Neto recibido" },
          ]}
          valueFormat="currency"
        />
      </ChartCard>

      <div className="grid gap-6 lg:grid-cols-2">
        <ChartCard title="Pendiente y recibido por carrier">
          <BarChart
            data={charts.byCarrier.map((c) => ({ category: c.carrierName, values: { pending: Number(c.pending), received: Number(c.received) } }))}
            series={[
              { key: "pending", label: "Pendiente" },
              { key: "received", label: "Recibido" },
            ]}
            valueFormat="currency"
            emptyMessage={sp.carrierId ? "Ya filtraste por una compañía específica." : "No hay comisiones registradas todavía."}
          />
        </ChartCard>

        <ChartCard title="Recibido por agente">
          <BarChart
            data={charts.byAgent.map((a) => ({ category: a.agentName, values: { received: Number(a.received) } }))}
            series={[{ key: "received", label: "Recibido" }]}
            valueFormat="currency"
            emptyMessage={sp.agentId ? "Ya filtraste por un agente específico." : "No hay comisiones registradas todavía."}
          />
        </ChartCard>

        <ChartCard title="Propias vs. referidas">
          <BarChart
            data={charts.byBusinessSource.map((b) => ({ category: b.label, values: { expected: Number(b.expected), received: Number(b.received) } }))}
            series={[
              { key: "expected", label: "Esperado" },
              { key: "received", label: "Recibido" },
            ]}
            valueFormat="currency"
          />
        </ChartCard>

        <ChartCard title="Estados de conciliación">
          <BarChart
            data={charts.reconciliationStatus.map((s) => ({ category: COMMISSION_DERIVED_STATUS_LABELS[s.status] ?? s.status, values: { count: s.count } }))}
            series={[{ key: "count", label: "Expectativas" }]}
          />
        </ChartCard>
      </div>
    </div>
  );
}

function Indicator({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
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
