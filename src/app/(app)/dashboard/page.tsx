import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { getDashboard } from "@/services/dashboard.service";
import {
  getAppTimeZone,
  formatDateTimeUS,
  formatMonthDayUS,
  formatPeriodUS,
} from "@/lib/business-time";
import { formatDateOnlyUS } from "@/lib/date-only";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  TASK_PRIORITY_LABELS,
  TASK_PRIORITY_BADGE_VARIANT,
  PAYMENT_STATUS_LABELS,
  BIRTHDAY_GREETING_STATUS_LABELS,
  BIRTHDAY_GREETING_STATUS_BADGE_VARIANT,
  paymentModeShowsAssistanceBadge,
} from "@/lib/labels";

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: getAppTimeZone() }).format(
      new Date()
    )
  );
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

const formatDueAt = formatDateTimeUS;
const formatDueDate = formatDateOnlyUS;
const formatOccurrence = formatMonthDayUS;

function formatMoney(amount: { toFixed: (n: number) => string }): string {
  return `$${amount.toFixed(2)}`;
}

function KpiCard({
  label,
  value,
  href,
  alert,
}: {
  label: string;
  value: number;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-1 rounded-lg border border-border/80 bg-card p-4 shadow-xs transition-colors hover:border-ring/50 hover:bg-muted/30"
    >
      <span
        className={
          alert && value > 0
            ? "font-heading text-2xl font-semibold text-[var(--brand-accent)]"
            : "font-heading text-2xl font-semibold text-foreground"
        }
      >
        {value}
      </span>
      <span className="text-sm text-muted-foreground">{label}</span>
    </Link>
  );
}

// Server Component puro: una sola llamada a getDashboard (que a su vez
// compone varias consultas pequeñas ya existentes), sin fetching en el
// cliente ni auto-refresh — recargar la página trae datos frescos (ver
// docs/DECISIONS.md, Fase 018).
export default async function DashboardPage() {
  const actor = await requireUser();
  const data = await getDashboard(actor);

  return (
    <div className="flex flex-col gap-8 p-6">
      <div>
        <h2 className="font-heading text-xl font-semibold text-foreground">
          {greeting()}, {actor.name}
        </h2>
        <p className="text-sm text-muted-foreground">Esto es lo que necesita tu atención hoy.</p>
      </div>

      {/* HOY --------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Hoy</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Tareas de hoy" value={data.tasks.todayCount} href="/tasks?dueToday=true" />
          <KpiCard
            label="Tareas vencidas"
            value={data.tasks.overdueCount}
            href="/tasks?overdueOnly=true"
            alert
          />
          <KpiCard
            label="Pagos vencidos"
            value={data.premiums.overdueCount}
            href="/premiums?overdueOnly=true"
            alert
          />
          <KpiCard
            label="Requieren asistencia"
            value={data.premiums.assistanceCount}
            href="/premiums?needsAssistance=true"
            alert
          />
        </div>
      </section>

      {/* TAREAS -------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">Tareas prioritarias</h3>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/tasks" />}>
            Ver todas las tareas
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 text-sm">
            {data.tasks.priorityItems.length === 0 ? (
              <p className="text-muted-foreground">No tienes tareas pendientes para hoy.</p>
            ) : (
              data.tasks.priorityItems.map((task) => (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted/40"
                >
                  <span className="font-medium">{task.title}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{formatDueAt(task.dueAt)}</span>
                    <Badge variant={TASK_PRIORITY_BADGE_VARIANT[task.priority as keyof typeof TASK_PRIORITY_BADGE_VARIANT]}>
                      {TASK_PRIORITY_LABELS[task.priority as keyof typeof TASK_PRIORITY_LABELS]}
                    </Badge>
                    {task.isOverdue && <Badge variant="destructive">Vencida</Badge>}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* PRIMAS / PAGOS -------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">Primas y pagos</h3>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/premiums" />}>
            Ver todas
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <Link href="/premiums?dueToday=true" className="rounded-md border p-2 hover:bg-muted/40">
            Vencen hoy: <span className="font-medium text-foreground">{data.premiums.dueTodayCount}</span>
          </Link>
          <Link href="/premiums?next7Days=true" className="rounded-md border p-2 hover:bg-muted/40">
            Próximos 7 días:{" "}
            <span className="font-medium text-foreground">{data.premiums.dueSoonCount}</span>
          </Link>
          <Link href="/premiums?overdueOnly=true" className="rounded-md border p-2 hover:bg-muted/40">
            Vencidos: <span className="font-medium text-foreground">{data.premiums.overdueCount}</span>
          </Link>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 text-sm">
            {data.premiums.urgentItems.length === 0 ? (
              <p className="text-muted-foreground">No hay pagos vencidos ni próximos a vencer.</p>
            ) : (
              data.premiums.urgentItems.map((item) => (
                <Link
                  key={item.id}
                  href={`/policies/${item.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted/40"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{item.holderName}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.carrierName} · {item.policyNumber ?? "sin número"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {formatDueDate(item.nextPaymentDueDate)}
                    </span>
                    {item.paymentStatus && (
                      <Badge variant="outline">{PAYMENT_STATUS_LABELS[item.paymentStatus as keyof typeof PAYMENT_STATUS_LABELS]}</Badge>
                    )}
                    {paymentModeShowsAssistanceBadge(item.paymentManagementMode) && (
                      <Badge variant="secondary">Asistencia</Badge>
                    )}
                    {item.isOverdue && <Badge variant="destructive">Vencida</Badge>}
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* RELACIÓN -------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-muted-foreground">
            Cumpleaños {data.birthdays.todayCount > 0 ? `(${data.birthdays.todayCount} hoy)` : ""}
          </h3>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/birthdays" />}>
            Ver cumpleaños
          </Button>
        </div>
        <Card>
          <CardContent className="flex flex-col gap-2 p-4 text-sm">
            {data.birthdays.upcoming.length === 0 ? (
              <p className="text-muted-foreground">No hay cumpleaños hoy ni en los próximos días.</p>
            ) : (
              data.birthdays.upcoming.map((b) => (
                <Link
                  key={b.personId}
                  href={`/contacts/${b.personId}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 hover:bg-muted/40"
                >
                  <span className="font-medium">
                    {b.firstName} {b.lastName}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {b.daysUntil === 0 ? "Hoy" : formatOccurrence(b.occurrenceMonth, b.occurrenceDay)} · Cumple{" "}
                      {b.turningAge}
                    </span>
                    <Badge variant={BIRTHDAY_GREETING_STATUS_BADGE_VARIANT[b.greetingStatus as keyof typeof BIRTHDAY_GREETING_STATUS_BADGE_VARIANT]}>
                      {BIRTHDAY_GREETING_STATUS_LABELS[b.greetingStatus as keyof typeof BIRTHDAY_GREETING_STATUS_LABELS]}
                    </Badge>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      {/* CARTERA -------------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-muted-foreground">Cartera</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
          <Link
            href="/policies?status=ACTIVE"
            className="flex flex-col gap-1 rounded-lg border border-border/80 bg-card p-4 shadow-xs transition-colors hover:border-ring/50 hover:bg-muted/30"
          >
            <span className="font-heading text-2xl font-semibold text-foreground">{data.policies.activeCount}</span>
            <span className="text-sm text-muted-foreground">Pólizas activas</span>
          </Link>
          <Link
            href="/policies?status=PENDING"
            className="flex flex-col gap-1 rounded-lg border border-border/80 bg-card p-4 shadow-xs transition-colors hover:border-ring/50 hover:bg-muted/30"
          >
            <span className="font-heading text-2xl font-semibold text-foreground">{data.policies.pendingCount}</span>
            <span className="text-sm text-muted-foreground">Pólizas pendientes</span>
          </Link>
        </div>

        {/* Fase 019.9 (§28-§29): "Vencen en 30 días" — nunca incluye
            CANCELLED/EXPIRED (ver listExpiringPolicies). */}
        {data.policies.expiringSoon.length > 0 && (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-4 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Vencen en 30 días</span>
              {data.policies.expiringSoon.map((p) => (
                <Link
                  key={p.id}
                  href={`/policies/${p.id}`}
                  className="flex items-center justify-between gap-2 hover:underline"
                >
                  <span>
                    {p.policyNumber ?? "Póliza sin número"} — {p.holderName}
                  </span>
                  <span className="text-xs text-muted-foreground">{formatDueDate(p.terminationDate)}</span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </section>

      {/* DINERO ------------------------------------------------------- */}
      {/* Solo ADMIN/AGENT — ASSISTANT no tiene ningún acceso a Comisiones
          (Fase 016) y el DTO ni siquiera trae esta clave para ese rol. */}
      {data.commissions && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-muted-foreground">
              Comisiones — {formatPeriodUS(data.commissions.period)}
            </h3>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/commissions" />}>
              Ver comisiones
            </Button>
          </div>
          <Card>
            <CardContent className="p-4 text-sm">
              {!data.commissions.hasData ? (
                <p className="text-muted-foreground">
                  No hay comisiones esperadas registradas para este mes.
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Esperado</span>
                    <span className="text-lg font-semibold">{formatMoney(data.commissions.expected)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Recibido</span>
                    <span className="text-lg font-semibold">{formatMoney(data.commissions.received)}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-xs text-muted-foreground">Diferencia</span>
                    <span className="text-lg font-semibold">{formatMoney(data.commissions.difference)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}
    </div>
  );
}
