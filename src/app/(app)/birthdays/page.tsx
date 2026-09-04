import Link from "next/link";
import { requireUser } from "@/lib/authorization";
import { listBirthdays } from "@/services/birthdays.service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTimeUS, formatMonthDayUS, getTodayBusinessRange } from "@/lib/business-time";
import {
  CONTACT_STATUS_BADGE_VARIANT,
  CONTACT_STATUS_LABELS,
  BIRTHDAY_GREETING_STATUS_LABELS,
  BIRTHDAY_GREETING_STATUS_BADGE_VARIANT,
  BIRTHDAY_GREETING_CHANNEL_LABELS,
} from "@/lib/labels";
import { BIRTHDAY_GREETING_STATUS_VALUES } from "@/schemas/birthday.schema";
import { MarkSentDialog } from "./mark-sent-dialog";
import { SkipGreetingButton, ResetGreetingButton } from "./greeting-quick-buttons";

type SearchParams = { view?: string; q?: string; status?: string };

const VIEWS = [
  { key: "all", label: "Todos" },
  { key: "today", label: "Hoy" },
  { key: "month", label: "Este mes" },
  { key: "nextMonth", label: "Mes siguiente" },
  { key: "upcoming", label: "Próximos" },
] as const;

// APP_TIME_ZONE, nunca el timezone del navegador — mismo criterio que
// el resto de "hoy" de negocio (ver src/lib/business-time.ts).
const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
] as const;

const formatOccurrence = formatMonthDayUS;

export default async function BirthdaysPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const actor = await requireUser();
  const sp = await searchParams;
  const view = VIEWS.some((v) => v.key === sp.view) ? sp.view! : "all";
  const status = (BIRTHDAY_GREETING_STATUS_VALUES as readonly string[]).includes(sp.status ?? "")
    ? sp.status
    : undefined;

  const results = await listBirthdays(actor, { view, search: sp.q, status });
  const isAdmin = actor.role === "ADMIN";

  // Título contextual para "Este mes"/"Mes siguiente" — calculado sobre
  // APP_TIME_ZONE (nunca el timezone del navegador), mismo criterio que
  // el resto de "hoy" de negocio.
  const { year: todayYear, month: todayMonth } = getTodayBusinessRange();
  let heading = "Cumpleaños";
  if (view === "month") {
    heading = `Cumpleaños de ${MONTH_NAMES[todayMonth - 1]}`;
  } else if (view === "nextMonth") {
    const nextMonth = todayMonth === 12 ? 1 : todayMonth + 1;
    const nextYear = todayMonth === 12 ? todayYear + 1 : todayYear;
    heading = `Cumpleaños de ${MONTH_NAMES[nextMonth - 1]}${nextYear !== todayYear ? ` ${nextYear}` : ""}`;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <h2 className="font-heading text-lg font-semibold">{heading}</h2>

      <div className="flex flex-wrap gap-1 border-b">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "all" ? "/birthdays" : `/birthdays?view=${v.key}`}
            className={
              view === v.key
                ? "border-b-2 border-foreground px-3 py-2 text-sm font-medium"
                : "px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            }
          >
            {v.label}
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-3" method="GET">
        <input type="hidden" name="view" value={view} />
        <div className="flex flex-col gap-1">
          <Label htmlFor="q">Buscar</Label>
          {/* Fase 022 (Hallazgo #7 de UAT): key fuerza remount cuando
              cambia sp.q vía otra navegación de la misma ruta (ej. un
              link de paginación/limpiar filtros) sin que el usuario haya
              tocado este campo — evita mutar defaultValue sobre una
              instancia ya inicializada (ver policies/new/page.tsx). */}
          <Input key={sp.q ?? ""} id="q" name="q" placeholder="Nombre" defaultValue={sp.q ?? ""} className="w-56" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="status">Felicitación</Label>
          <select
            id="status"
            name="status"
            defaultValue={sp.status ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">Todas</option>
            {BIRTHDAY_GREETING_STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {BIRTHDAY_GREETING_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="secondary">
          Filtrar
        </Button>
        {(sp.q || sp.status) && (
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link href={view === "all" ? "/birthdays" : `/birthdays?view=${view}`} />}
          >
            Limpiar
          </Button>
        )}
      </form>

      {results.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">No hay cumpleaños con esos filtros.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Cumpleaños</TableHead>
                <TableHead>Edad</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Felicitación</TableHead>
                <TableHead>Canal / envío</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.map((r) => (
                <TableRow key={r.person.id}>
                  <TableCell className="font-medium">
                    <Link href={`/contacts/${r.person.id}`} className="underline">
                      {r.person.firstName} {r.person.lastName}
                    </Link>
                    {r.daysUntil === 0 && <span className="ml-2">🎂 Hoy</span>}
                  </TableCell>
                  <TableCell>{formatOccurrence(r.occurrenceMonth, r.occurrenceDay)}</TableCell>
                  <TableCell>{r.turningAge}</TableCell>
                  <TableCell>{r.person.phone ?? "—"}</TableCell>
                  <TableCell>{r.person.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={CONTACT_STATUS_BADGE_VARIANT[r.person.contactStatus]}>
                      {CONTACT_STATUS_LABELS[r.person.contactStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={BIRTHDAY_GREETING_STATUS_BADGE_VARIANT[r.greeting.status]}>
                      {BIRTHDAY_GREETING_STATUS_LABELS[r.greeting.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.greeting.channel ? BIRTHDAY_GREETING_CHANNEL_LABELS[r.greeting.channel] : "—"}
                    {r.greeting.sentAt
                      ? ` · ${formatDateTimeUS(r.greeting.sentAt)}`
                      : ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      <MarkSentDialog
                        personId={r.person.id}
                        personName={`${r.person.firstName} ${r.person.lastName}`}
                      />
                      <SkipGreetingButton personId={r.person.id} />
                      {isAdmin && r.greeting.status !== "PENDING" && (
                        <ResetGreetingButton personId={r.person.id} />
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
