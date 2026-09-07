"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  activityStatusLabels,
  activityStatuses,
  relatedRecordTypes,
  type RelatedRecordType,
} from "../lib/crm";
import type {
  ActivityRow,
  BusinessRow,
  ContactRow,
  LeadRow,
  OpportunityRow,
  RecordRow,
} from "./types";
import {
  ActiveFilterChip,
  AutocompleteInput,
  Breadcrumbs,
  Empty,
  FilterableStatus,
  InlineAlert,
  Modal,
  PageHeader,
  PageSizeControl,
  Pagination,
  dateTime,
  dateTimeInputValue,
  formatBusinessDate,
  useFormGuard,
  usePagination,
  useUrlState,
} from "./ui";

type AgendaMode = "schedule" | "calendar";
type CalendarMode = "month" | "week" | "day";
type ActivityCreateContext = {
  relatedType: RelatedRecordType;
  relatedId: string;
};

export function AgendaView({
  mode,
  activities,
  setActivities,
  businesses,
  contacts,
  leads,
  opportunities,
  records,
  selectedId,
  setSelectedId,
  initialCreateContext,
  onCreateContextConsumed,
  canWrite,
  currentUserEmail,
  setMessage,
}: {
  mode: AgendaMode;
  activities: ActivityRow[];
  setActivities(value: ActivityRow[]): void;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  leads: LeadRow[];
  opportunities: OpportunityRow[];
  records: RecordRow[];
  selectedId: string | null;
  setSelectedId(value: string | null): void;
  initialCreateContext?: ActivityCreateContext | null;
  onCreateContextConsumed?(): void;
  canWrite: boolean;
  currentUserEmail: string;
  setMessage(message: string): void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ActivityRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [search, setSearch] = useUrlState("q");
  const [statusFilter, setStatusFilter] = useUrlState("status");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner");
  const [direction, setDirection] = useUrlState("dir", "asc");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const [calendarModeValue, setCalendarModeValue] = useUrlState(
    "mode",
    "month",
  ); // useUrlState("mode", "month")
  const calendarMode: CalendarMode = isCalendarMode(calendarModeValue)
    ? calendarModeValue
    : "month";
  const [focusDateValue, setFocusDateValue] = useUrlState(
    "date",
    dateKey(new Date()),
  );
  const focusDate = parseCalendarDate(focusDateValue);
  const selected =
    activities.find((activity) => activity.id === selectedId) ?? null;
  const owners = [
    ...new Set(activities.map((activity) => activity.ownerEmail)),
  ].sort();
  const filtered = useMemo(
    () =>
      activities
        .filter(
          (activity) =>
            (!statusFilter || activity.status === statusFilter) &&
            (!ownerFilter || activity.ownerEmail === ownerFilter) &&
            `${activity.title} ${activity.description} ${activity.location} ${activity.notes}`
              .toLowerCase()
              .includes(search.trim().toLowerCase()),
        )
        .toSorted((left, right) => {
          const compared = left.startAt.localeCompare(right.startAt);
          return direction === "desc" ? -compared : compared;
        }),
    [activities, direction, ownerFilter, search, statusFilter],
  );
  const pageSize =
    pageSizeValue === "all"
      ? Math.max(filtered.length, 1)
      : Number(pageSizeValue) || 10;
  const { page, pageItems, setPage, totalPages } = usePagination(
    filtered,
    pageSize,
  );

  useEffect(() => {
    if (mode !== "schedule" || !canWrite || !initialCreateContext || selectedId)
      return;
    const timer = window.setTimeout(() => {
      setEditing(null);
      setFormError("");
      setShowForm(true);
      onCreateContextConsumed?.();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [
    canWrite,
    initialCreateContext,
    mode,
    onCreateContextConsumed,
    selectedId,
  ]);

  useEffect(() => {
    if (
      mode === "calendar" &&
      !new URLSearchParams(window.location.search).has("mode") &&
      window.matchMedia("(max-width: 520px)").matches
    ) {
      setCalendarModeValue("day");
    }
  }, [mode, setCalendarModeValue]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form);
    payload.allDay = form.get("allDay") === "on" ? "true" : "";
    const response = await fetch(
      editing ? `/api/activities/${editing.id}` : "/api/activities",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...payload,
          allDay: form.get("allDay") === "on",
        }),
      },
    );
    const result = (await response.json()) as {
      activity?: ActivityRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.activity) {
      const error = result.error ?? "No se pudo guardar la actividad.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setActivities(
      editing
        ? activities.map((activity) =>
            activity.id === result.activity!.id ? result.activity! : activity,
          )
        : [...activities, result.activity].toSorted((left, right) =>
            left.startAt.localeCompare(right.startAt),
          ),
    );
    setSelectedId(result.activity.id);
    setEditing(null);
    setShowForm(false);
    setFormError("");
    setMessage(
      "Actividad guardada. Actividades y Calendario están sincronizados.",
    );
  }

  if (selected) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            {
              label: mode === "schedule" ? "Actividades" : "Calendario",
              onClick: () => setSelectedId(null),
            },
            { label: selected.title },
          ]}
        />
        <div className="page-heading">
          <div>
            <p className="eyebrow">Datos de actividad compartidos</p>
            <h1>{selected.title}</h1>
            <p>
              {dateTime(selected.startAt, true)} –{" "}
              {dateTime(selected.endAt, true)}
            </p>
          </div>
          {canWrite && (
            <button
              className="primary-button"
              onClick={() => {
                setEditing(selected);
                setFormError("");
                setShowForm(true);
              }}
            >
              Editar actividad
            </button>
          )}
        </div>
        <section className="detail-card">
          <dl>
            <div>
              <dt>Estado</dt>
              <dd>{activityStatusLabels[selected.status]}</dd>
            </div>
            <div>
              <dt>Día completo</dt>
              <dd>{selected.allDay ? "Sí" : "No"}</dd>
            </div>
            <div>
              <dt>Responsable</dt>
              <dd>{selected.ownerEmail}</dd>
            </div>
            <div>
              <dt>Ubicación</dt>
              <dd>{selected.location || "—"}</dd>
            </div>
            <div>
              <dt>Participantes</dt>
              <dd>{safeAttendees(selected.attendees).join(", ") || "—"}</dd>
            </div>
            <div>
              <dt>Registro relacionado</dt>
              <dd>
                {relatedLabel(
                  selected,
                  businesses,
                  contacts,
                  leads,
                  opportunities,
                  records,
                )}
              </dd>
            </div>
          </dl>
          {selected.description && (
            <p className="detail-notes">{selected.description}</p>
          )}
          {selected.notes && <p className="detail-notes">{selected.notes}</p>}
        </section>
        {showForm && (
          <Modal
            onClose={() => setShowForm(false)}
            title={editing ? "Editar actividad" : "Nueva actividad"}
            wide
          >
            <ActivityForm
              activity={editing}
              businesses={businesses}
              busy={busy}
              contacts={contacts}
              currentUserEmail={currentUserEmail}
              error={formError}
              initialRelated={initialCreateContext}
              leads={leads}
              onCancel={() => setShowForm(false)}
              onSubmit={save}
              opportunities={opportunities}
              records={records}
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <Breadcrumbs
        items={[
          { label: "Inicio" },
          { label: mode === "schedule" ? "Actividades" : "Calendario" },
        ]}
      />
      <PageHeader
        action={
          canWrite ? (
            <button
              className="primary-button"
              onClick={() => {
                setEditing(null);
                setFormError("");
                setShowForm(true);
              }}
            >
              Nueva actividad
            </button>
          ) : undefined
        }
        description={
          mode === "schedule"
            ? "Agenda y cronología de las actividades operativas."
            : "Vistas de mes, semana y día de las mismas actividades."
        }
        eyebrow="Datos de actividad compartidos"
        title={mode === "schedule" ? "Actividades" : "Calendario"}
      />
      {showForm && (
        <Modal
          onClose={() => setShowForm(false)}
          title={editing ? "Editar actividad" : "Nueva actividad"}
          wide
        >
          <ActivityForm
            activity={editing}
            businesses={businesses}
            busy={busy}
            contacts={contacts}
            currentUserEmail={currentUserEmail}
            error={formError}
            initialRelated={initialCreateContext}
            leads={leads}
            onCancel={() => setShowForm(false)}
            onSubmit={save}
            opportunities={opportunities}
            records={records}
          />
        </Modal>
      )}
      {mode === "schedule" ? (
        <>
          <div className="toolbar toolbar-filters">
            <AutocompleteInput
              ariaLabel="Buscar actividades"
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              onSelect={(option) => {
                setSearch(option.label);
                setPage(1);
              }}
              options={filtered.slice(0, 8).map((activity) => ({
                id: activity.id,
                label: activity.title,
                secondary: activity.location || activity.ownerEmail,
              }))}
              placeholder="Escribe un título, descripción o ubicación…"
              value={search}
            />
            <select
              aria-label="Filtrar actividades por estado"
              onChange={(event) => {
                setStatusFilter(event.target.value);
                setPage(1);
              }}
              value={statusFilter}
            >
              <option value="">Todos los estados</option>
              {activityStatuses.map((status) => (
                <option key={status} value={status}>
                  {activityStatusLabels[status]}
                </option>
              ))}
            </select>
            <select
              aria-label="Filtrar actividades por responsable"
              onChange={(event) => {
                setOwnerFilter(event.target.value);
                setPage(1);
              }}
              value={ownerFilter}
            >
              <option value="">Todos los responsables</option>
              {owners.map((owner) => (
                <option key={owner}>{owner}</option>
              ))}
            </select>
            <select
              aria-label="Ordenar actividades"
              onChange={(event) => {
                setDirection(event.target.value);
                setPage(1);
              }}
              value={direction}
            >
              <option value="asc">Próximas primero</option>
              <option value="desc">Más recientes primero</option>
            </select>
            <PageSizeControl
              label="Actividades por página"
              onChange={(value) => {
                setPageSizeValue(value);
                setPage(1);
              }}
              value={pageSizeValue}
            />
            <span className="record-count">
              <strong>{filtered.length}</strong> actividades
            </span>
          </div>
          {(statusFilter || ownerFilter) && (
            <div className="active-filter-row">
              {statusFilter && (
                <ActiveFilterChip
                  label={`Estado: ${activityStatusLabels[statusFilter as keyof typeof activityStatusLabels] ?? statusFilter}`}
                  onClear={() => {
                    setStatusFilter("");
                    setPage(1);
                  }}
                />
              )}
              {ownerFilter && (
                <ActiveFilterChip
                  label={`Responsable: ${ownerFilter}`}
                  onClear={() => {
                    setOwnerFilter("");
                    setPage(1);
                  }}
                />
              )}
            </div>
          )}
          <section className="panel schedule-list">
            {filtered.length ? (
              pageItems.map((activity) => (
                <article key={activity.id}>
                  <time dateTime={activity.startAt}>
                    <strong>
                      {formatBusinessDate(activity.startAt, { day: "2-digit" })}
                    </strong>
                    <span>
                      {formatBusinessDate(activity.startAt, { month: "short" })}
                    </span>
                  </time>
                  <button
                    onClick={() => setSelectedId(activity.id)}
                    type="button"
                  >
                    <strong>{activity.title}</strong>
                    <span>
                      {activity.allDay
                        ? "Todo el día"
                        : formatBusinessDate(activity.startAt, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}{" "}
                      · {activity.location || "Sin ubicación"}
                    </span>
                  </button>
                  <FilterableStatus
                    label={activityStatusLabels[activity.status]}
                    onFilter={() => {
                      setStatusFilter(activity.status);
                      setPage(1);
                    }}
                  />
                  <span>{activity.ownerEmail}</span>
                </article>
              ))
            ) : (
              <Empty
                action={
                  canWrite ? (
                    <button
                      className="primary-button"
                      onClick={() => {
                        setEditing(null);
                        setFormError("");
                        setShowForm(true);
                      }}
                      type="button"
                    >
                      Nueva actividad
                    </button>
                  ) : undefined
                }
                text="No hay actividades en esta vista."
              />
            )}
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
            />
          </section>
        </>
      ) : (
        <CalendarView
          activities={filtered}
          calendarMode={calendarMode}
          focusDate={focusDate}
          onMode={(nextMode) => setCalendarModeValue(nextMode)}
          onMove={(direction) =>
            setFocusDateValue(
              dateKey(moveDate(focusDate, calendarMode, direction)),
            )
          }
          onOpen={setSelectedId}
          onToday={() => setFocusDateValue(dateKey(new Date()))}
        />
      )}
    </>
  );
}

function ActivityForm({
  activity,
  initialRelated,
  businesses,
  contacts,
  leads,
  opportunities,
  records,
  busy,
  currentUserEmail,
  error,
  onSubmit,
  onCancel,
}: {
  activity: ActivityRow | null;
  initialRelated?: ActivityCreateContext | null;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  leads: LeadRow[];
  opportunities: OpportunityRow[];
  records: RecordRow[];
  busy: boolean;
  currentUserEmail: string;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  const [relatedType, setRelatedType] = useState<RelatedRecordType | "">(
    (activity?.relatedType as RelatedRecordType | null) ??
      initialRelated?.relatedType ??
      "",
  );
  const relatedOptions = relationOptions(
    relatedType,
    businesses,
    contacts,
    leads,
    opportunities,
    records,
  );
  const { formProps, requestCancel } = useFormGuard(onCancel);
  return (
    <form {...formProps} className="record-form" onSubmit={onSubmit}>
      <InlineAlert message={error} />
      <div className="form-grid">
        <label className="wide">
          Título
          <input
            autoComplete="off"
            defaultValue={activity?.title}
            name="title"
            required
          />
        </label>
        <label>
          Inicio
          <input
            defaultValue={dateTimeInputValue(activity?.startAt ?? null)}
            name="startAt"
            required
            type="datetime-local"
          />
        </label>
        <label>
          Fin
          <input
            defaultValue={dateTimeInputValue(activity?.endAt ?? null)}
            name="endAt"
            required
            type="datetime-local"
          />
        </label>
        <label className="check-label">
          <input
            defaultChecked={activity?.allDay}
            name="allDay"
            type="checkbox"
          />{" "}
          Día completo
        </label>
        <label>
          Estado
          <select defaultValue={activity?.status ?? "planned"} name="status">
            {activityStatuses.map((status) => (
              <option key={status} value={status}>
                {activityStatusLabels[status]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Responsable
          <input
            autoComplete="email"
            defaultValue={activity?.ownerEmail ?? currentUserEmail}
            name="ownerEmail"
            required
            spellCheck={false}
            type="email"
          />
        </label>
        <label>
          Participantes
          <input
            aria-describedby="attendees-hint"
            autoComplete="off"
            defaultValue={safeAttendees(activity?.attendees ?? "[]").join(", ")}
            inputMode="email"
            name="attendees"
            placeholder="correo@ejemplo.com, …"
            spellCheck={false}
          />
          <small id="attendees-hint">Separa múltiples correos con comas.</small>
        </label>
        <label>
          Ubicación
          <input
            autoComplete="off"
            defaultValue={activity?.location}
            name="location"
          />
        </label>
        <label>
          Tipo de registro relacionado
          <select
            name="relatedType"
            onChange={(event) =>
              setRelatedType(event.target.value as RelatedRecordType | "")
            }
            value={relatedType}
          >
            <option value="">Sin registro relacionado</option>
            {relatedRecordTypes.map((type) => (
              <option key={type} value={type}>
                {relatedRecordTypeLabel(type)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Registro relacionado
          <select
            defaultValue={
              activity?.relatedId ?? initialRelated?.relatedId ?? ""
            }
            disabled={!relatedType}
            name="relatedId"
          >
            <option value="">Seleccionar registro</option>
            {relatedOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="wide">
          Descripción
          <textarea
            defaultValue={activity?.description}
            name="description"
            rows={3}
          />
        </label>
        <label className="wide">
          Notas
          <textarea defaultValue={activity?.notes} name="notes" rows={3} />
        </label>
      </div>
      <div className="form-actions">
        <button
          className="secondary-button"
          onClick={requestCancel}
          type="button"
        >
          Cancelar
        </button>
        <button className="primary-button" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function CalendarView({
  activities,
  calendarMode,
  focusDate,
  onMode,
  onMove,
  onOpen,
  onToday,
}: {
  activities: ActivityRow[];
  calendarMode: CalendarMode;
  focusDate: Date;
  onMode(mode: CalendarMode): void;
  onMove(direction: -1 | 1): void;
  onOpen(id: string): void;
  onToday(): void;
}) {
  const days =
    calendarMode === "month"
      ? monthGrid(focusDate)
      : calendarMode === "week"
        ? weekDays(focusDate)
        : [new Date(focusDate)];
  return (
    <section className="calendar-panel">
      <div className="calendar-toolbar">
        <div>
          <button
            aria-label="Período anterior"
            className="secondary-button"
            onClick={() => onMove(-1)}
          >
            ←
          </button>
          <button className="secondary-button" onClick={onToday}>
            Hoy
          </button>
          <button
            aria-label="Período siguiente"
            className="secondary-button"
            onClick={() => onMove(1)}
          >
            →
          </button>
        </div>
        <h2>{calendarTitle(focusDate, calendarMode)}</h2>
        <div role="group" aria-label="Vista del calendario">
          <button
            aria-pressed={calendarMode === "month"}
            className={calendarMode === "month" ? "active" : ""}
            onClick={() => onMode("month")}
          >
            Mes
          </button>
          <button
            aria-pressed={calendarMode === "week"}
            className={calendarMode === "week" ? "active" : ""}
            onClick={() => onMode("week")}
          >
            Semana
          </button>
          <button
            aria-pressed={calendarMode === "day"}
            className={calendarMode === "day" ? "active" : ""}
            onClick={() => onMode("day")}
          >
            Día
          </button>
        </div>
      </div>
      <div className={`calendar-grid calendar-${calendarMode}-mode`}>
        {calendarMode !== "day" &&
          weekDays(new Date(Date.UTC(2026, 0, 4, 12))).map((day) => (
            <strong className="calendar-weekday" key={day.toISOString()}>
              {new Intl.DateTimeFormat("es-DO", { weekday: "short" }).format(
                day,
              )}
            </strong>
          ))}
        {days.map((day) => {
          const events = activities.filter((activity) =>
            sameDay(new Date(activity.startAt), day),
          );
          return (
            <article
              className={
                sameDay(day, new Date()) ? "calendar-day today" : "calendar-day"
              }
              key={day.toISOString()}
            >
              <time dateTime={day.toISOString()}>
                {calendarMode === "day"
                  ? formatBusinessDate(day, {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })
                  : day.getDate()}
              </time>
              <div>
                {events.map((activity) => (
                  <button
                    className={`calendar-event status-${activity.status}`}
                    key={activity.id}
                    onClick={() => onOpen(activity.id)}
                  >
                    <strong>{activity.title}</strong>
                    <span>
                      {activity.allDay
                        ? "Todo el día"
                        : formatBusinessDate(activity.startAt, {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                    </span>
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
      {calendarMode !== "day" && (
        <p className="scroll-hint">
          Desliza horizontalmente para ver más días.
        </p>
      )}
    </section>
  );
}

function safeAttendees(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function isCalendarMode(value: string): value is CalendarMode {
  return value === "month" || value === "week" || value === "day";
}

function dateKey(value: Date) {
  const local = new Date(value);
  local.setMinutes(local.getMinutes() - local.getTimezoneOffset());
  return local.toISOString().slice(0, 10);
}

function parseCalendarDate(value: string) {
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function relatedRecordTypeLabel(type: RelatedRecordType) {
  const labels: Record<RelatedRecordType, string> = {
    business: "Empresa",
    contact: "Contacto",
    lead: "Prospecto",
    opportunity: "Oportunidad",
    case: "Caso",
    project: "Proyecto",
  };
  return labels[type];
}

function relationOptions(
  type: RelatedRecordType | "",
  businesses: BusinessRow[],
  contacts: ContactRow[],
  leads: LeadRow[],
  opportunities: OpportunityRow[],
  records: RecordRow[],
) {
  if (type === "business")
    return businesses.map((item) => ({ id: item.id, label: item.name }));
  if (type === "contact")
    return contacts.map((item) => ({ id: item.id, label: item.name }));
  if (type === "lead")
    return leads.map((item) => ({
      id: item.id,
      label: `${item.businessName} · ${item.contactName}`,
    }));
  if (type === "opportunity")
    return opportunities.map((item) => ({ id: item.id, label: item.title }));
  if (type === "case")
    return records
      .filter((item) => item.module === "ordenes-cambio")
      .map((item) => ({ id: item.id, label: item.title }));
  if (type === "project")
    return records
      .filter((item) => item.module === "proyectos")
      .map((item) => ({ id: item.id, label: item.title }));
  return [];
}

function relatedLabel(
  activity: ActivityRow,
  businesses: BusinessRow[],
  contacts: ContactRow[],
  leads: LeadRow[],
  opportunities: OpportunityRow[],
  records: RecordRow[],
) {
  return (
    relationOptions(
      (activity.relatedType as RelatedRecordType | null) ?? "",
      businesses,
      contacts,
      leads,
      opportunities,
      records,
    ).find((item) => item.id === activity.relatedId)?.label ?? "—"
  );
}

function sameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function addDays(date: Date, amount: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function weekDays(date: Date) {
  const start = addDays(date, -date.getDay());
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

function monthGrid(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const start = addDays(first, -first.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function moveDate(date: Date, mode: CalendarMode, direction: -1 | 1) {
  const result = new Date(date);
  if (mode === "month") result.setMonth(result.getMonth() + direction);
  else result.setDate(result.getDate() + direction * (mode === "week" ? 7 : 1));
  return result;
}

function calendarTitle(date: Date, mode: CalendarMode) {
  if (mode === "day")
    return formatBusinessDate(date, {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  if (mode === "week") {
    const days = weekDays(date);
    return `${formatBusinessDate(days[0], { month: "short", day: "numeric" })} – ${formatBusinessDate(days[6], { month: "short", day: "numeric", year: "numeric" })}`;
  }
  return formatBusinessDate(date, {
    month: "long",
    year: "numeric",
  });
}
