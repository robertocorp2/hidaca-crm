"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  leadStatuses,
  leadStatusLabels,
  type LeadStatus,
} from "../lib/crm";
import { PipelineStepper, type PipelineOutcome } from "./pipeline";
import { RecordAiPanel } from "./record-ai-panel";
import type {
  ActivityRow,
  BusinessRow,
  ContactRow,
  LeadHistoryRow,
  LeadRow,
  OpportunityRow,
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
  SortHeader,
  dateTime,
  useFormGuard,
  usePagination,
  useUrlState,
} from "./ui";

type ConversionOptions = {
  missingFields: string[];
  businessMatches: BusinessRow[];
  contactMatches: ContactRow[];
};

type ConversionResult = {
  business: BusinessRow;
  contact: ContactRow;
  opportunity: OpportunityRow;
  lead: LeadRow;
};

const leadProgression = ["new", "contacted", "working"] as const;

function nextHistoryId(rows: ReadonlyArray<{ id: number }>) {
  return rows.reduce((lowest, row) => Math.min(lowest, row.id), 0) - 1;
}

export function LeadsView({
  leads,
  setLeads,
  businesses,
  contacts,
  activities,
  history,
  setHistory,
  selectedId,
  setSelectedId,
  canWrite,
  canAskAi,
  canProposeAi,
  canApproveAi,
  isAdmin,
  currentUserEmail,
  setMessage,
  onOpenActivity,
  onConverted,
}: {
  leads: LeadRow[];
  setLeads(value: LeadRow[]): void;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  activities: ActivityRow[];
  history: LeadHistoryRow[];
  setHistory(value: LeadHistoryRow[]): void;
  selectedId: string | null;
  setSelectedId(value: string | null): void;
  canWrite: boolean;
  canAskAi: boolean;
  canProposeAi: boolean;
  canApproveAi: boolean;
  isAdmin: boolean;
  currentUserEmail: string;
  setMessage(message: string): void;
  onOpenActivity(id: string): void;
  onConverted(result: ConversionResult): void;
}) {
  const [search, setSearch] = useUrlState("q");
  const [statusFilter, setStatusFilter] = useUrlState("status");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner");
  const [sort, setSort] = useUrlState("sort", "updated");
  const [direction, setDirection] = useUrlState("dir", "desc");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const [editing, setEditing] = useState<LeadRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conversion, setConversion] = useState<ConversionOptions | null>(null);
  const [reopen, setReopen] = useState(false);
  const [formError, setFormError] = useState("");
  const selected = leads.find((lead) => lead.id === selectedId) ?? null;
  const owners = [...new Set(leads.map((lead) => lead.ownerEmail))].sort();
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return leads
      .filter(
        (lead) =>
          (!statusFilter || lead.status === statusFilter) &&
          (!ownerFilter || lead.ownerEmail === ownerFilter) &&
          `${lead.businessName} ${lead.contactName} ${lead.email} ${lead.phone} ${lead.source}`
            .toLowerCase()
            .includes(term),
      )
      .toSorted((left, right) => {
        const multiplier = direction === "desc" ? -1 : 1;
        if (sort === "status") return multiplier * (leadStatuses.indexOf(left.status) - leadStatuses.indexOf(right.status));
        const leftValue = sort === "business" ? left.businessName : sort === "contact" ? left.contactName : sort === "owner" ? left.ownerEmail : left.updatedAt;
        const rightValue = sort === "business" ? right.businessName : sort === "contact" ? right.contactName : sort === "owner" ? right.ownerEmail : right.updatedAt;
        return multiplier * leftValue.localeCompare(rightValue, "es", { sensitivity: "base" });
      });
  }, [direction, leads, ownerFilter, search, sort, statusFilter]);
  const pageSize = pageSizeValue === "all" ? Math.max(rows.length, 1) : Number(pageSizeValue) || 10;
  const { page, pageItems, setPage, totalPages } = usePagination(rows, pageSize);

  function sortBy(column: string) {
    if (sort === column) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection("asc");
    }
    setPage(1);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(
      editing ? `/api/leads/${editing.id}` : "/api/leads",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as {
      lead?: LeadRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.lead) {
      const error = result.error ?? "No se pudo guardar el Lead.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setLeads(
      editing
        ? leads.map((lead) =>
            lead.id === result.lead!.id ? result.lead! : lead,
          )
        : [result.lead, ...leads],
    );
    if (!editing) {
      setHistory([
        {
          id: nextHistoryId(history),
          leadId: result.lead.id,
          fromStatus: null,
          toStatus: "new",
          changedBy: currentUserEmail,
          changedAt: result.lead.createdAt,
          note: "Lead creado",
        },
        ...history,
      ]);
    }
    setSelectedId(result.lead.id);
    setEditing(null);
    setShowForm(false);
    setFormError("");
    setMessage("Lead guardado.");
  }

  async function advance(lead: LeadRow) {
    setBusy(true);
    const response = await fetch(`/api/leads/${lead.id}/advance`, {
      method: "POST",
    });
    const result = (await response.json()) as {
      lead?: LeadRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.lead) {
      setMessage(result.error ?? "No se pudo avanzar el Lead.");
      return;
    }
    setLeads(
      leads.map((item) => (item.id === result.lead!.id ? result.lead! : item)),
    );
    setHistory([
      {
        id: nextHistoryId(history),
        leadId: lead.id,
        fromStatus: lead.status,
        toStatus: result.lead.status,
        changedBy: currentUserEmail,
        changedAt: result.lead.updatedAt,
        note: "Advance Stage",
      },
      ...history,
    ]);
    setMessage(`Lead actualizado a ${leadStatusLabels[result.lead.status]}.`);
  }

  async function loadConversion(lead: LeadRow) {
    setBusy(true);
    const response = await fetch(`/api/leads/${lead.id}/convert`);
    const result = (await response.json()) as ConversionOptions & {
      error?: string;
    };
    setBusy(false);
    if (!response.ok) {
      const error = result.error ?? "No se pudo preparar la conversión.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setFormError("");
    setConversion(result);
  }

  async function submitConversion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/leads/${selected.id}/convert`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as Partial<ConversionResult> & {
      error?: string;
      businessMatches?: BusinessRow[];
      contactMatches?: ContactRow[];
    };
    setBusy(false);
    if (
      !response.ok ||
      !result.business ||
      !result.contact ||
      !result.opportunity ||
      !result.lead
    ) {
      const error = result.error ?? "No se pudo convertir el prospecto.";
      setFormError(error);
      setMessage(error);
      if (result.businessMatches || result.contactMatches) {
        setConversion((current) => ({
          missingFields: current?.missingFields ?? [],
          businessMatches:
            result.businessMatches ?? current?.businessMatches ?? [],
          contactMatches:
            result.contactMatches ?? current?.contactMatches ?? [],
        }));
      }
      return;
    }
    setLeads(
      leads.map((lead) => (lead.id === result.lead!.id ? result.lead! : lead)),
    );
    setHistory([
      {
        id: nextHistoryId(history),
        leadId: selected.id,
        fromStatus: "working",
        toStatus: "converted",
        changedBy: currentUserEmail,
        changedAt: result.lead.updatedAt,
        note: "Prospecto convertido",
      },
      ...history,
    ]);
    setConversion(null);
    setFormError("");
    onConverted(result as ConversionResult);
  }

  async function submitReopen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/leads/${selected.id}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as {
      lead?: LeadRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.lead) {
      const error = result.error ?? "No se pudo reabrir el prospecto.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setLeads(
      leads.map((lead) => (lead.id === result.lead!.id ? result.lead! : lead)),
    );
    setHistory([
      {
        id: nextHistoryId(history),
        leadId: selected.id,
        fromStatus: selected.status,
        toStatus: "working",
        changedBy: currentUserEmail,
        changedAt: result.lead.updatedAt,
        note: String(payload.note ?? ""),
      },
      ...history,
    ]);
    setReopen(false);
    setFormError("");
    setMessage("Prospecto reabierto en seguimiento.");
  }

  if (selected) {
    const leadHistory = history
      .filter((item) => item.leadId === selected.id)
      .toSorted((left, right) => right.changedAt.localeCompare(left.changedAt));
    const currentProgressIndex = leadProgression.indexOf(
      selected.status as (typeof leadProgression)[number],
    );
    const terminal = ["unqualified", "converted"].includes(selected.status);
    const completed = new Set<string>(
      leadProgression.filter(
        (_, index) => terminal || index < currentProgressIndex,
      ),
    );
    const relatedActivities = activities.filter(
      (activity) =>
        activity.relatedType === "lead" && activity.relatedId === selected.id,
    );
    const terminalOutcomes: PipelineOutcome[] = [
      {
        value: "converted",
        label: leadStatusLabels.converted,
        description:
          selected.status === "converted"
            ? "Resultado seleccionado."
            : "Crea y vincula los registros relacionados.",
        tone: "success",
        actionLabel: "Convertir prospecto",
        onSelect:
          canWrite && selected.status === "working"
            ? () => loadConversion(selected)
            : undefined,
      },
      {
        value: "unqualified",
        label: leadStatusLabels.unqualified,
        description:
          selected.status === "unqualified"
            ? "Resultado seleccionado."
            : "Cierra el seguimiento sin conversión.",
        tone: "loss",
        actionLabel: "Marcar como no calificado",
        onSelect:
          canWrite && selected.status === "working"
            ? () => advance(selected)
            : undefined,
      },
    ];
    const leadAction =
      canWrite && selected.status === "new"
        ? {
            label: `Avanzar a ${leadStatusLabels.contacted}`,
            onAction: () => advance(selected),
          }
        : canWrite && selected.status === "contacted"
          ? {
              label: `Avanzar a ${leadStatusLabels.working}`,
              onAction: () => advance(selected),
            }
          : undefined;
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            { label: "Prospectos", onClick: () => setSelectedId(null) },
            { label: selected.businessName },
          ]}
        />
        <div className="page-heading">
          <div>
            <p className="eyebrow">CRM pipeline</p>
            <h1>{selected.businessName}</h1>
            <p>{selected.contactName} · {selected.email || selected.phone || "Sin contacto"}</p>
          </div>
          {canWrite && (
            <button className="secondary-button" onClick={() => {
              setEditing(selected);
              setFormError("");
              setShowForm(true);
            }}>Editar prospecto</button>
          )}
        </div>
        <PipelineStepper
          action={leadAction}
          ariaLabel="Pipeline del prospecto"
          busy={busy}
          completedStages={completed}
          currentStatus={selected.status}
          outcomeDescription={
            terminal
              ? "El prospecto terminó en este resultado."
              : selected.status === "working"
                ? "Elige uno de los dos resultados; no son etapas consecutivas."
                : "Los resultados estarán disponibles después de En seguimiento."
          }
          outcomeHeading="Resultado desde En seguimiento"
          selectedOutcome={terminal ? selected.status : null}
          stages={leadProgression.map((status) => ({
            value: status,
            label: leadStatusLabels[status],
          }))}
          terminalOutcomes={terminalOutcomes}
        />
        {isAdmin && terminal && (
          <div className="terminal-actions">
            <div><strong>Prospecto cerrado</strong><span>Solo un administrador puede reabrirlo.</span></div>
            <button className="secondary-button" onClick={() => { setFormError(""); setReopen(true); }}>Reabrir prospecto</button>
          </div>
        )}
        <section className="detail-grid">
          <article className="detail-card record-ai-detail-card"><h2>Asistente contextual</h2><p className="muted">Consulta relaciones e historial sin salir del prospecto.</p><RecordAiPanel canApprove={canApproveAi} canAsk={canAskAi} canPropose={canProposeAi} entityId={selected.id} entityType="lead" title={selected.businessName || selected.contactName} /></article>
          <article className="detail-card">
            <h2>Detalles del prospecto</h2>
            <dl>
              <div><dt>Empresa</dt><dd>{selected.businessName}</dd></div>
              <div><dt>Contacto</dt><dd>{selected.contactName}</dd></div>
              <div><dt>Email</dt><dd>{selected.email || "—"}</dd></div>
              <div><dt>Teléfono</dt><dd>{selected.phone || "—"}</dd></div>
              <div><dt>Origen</dt><dd>{selected.source || "—"}</dd></div>
              <div><dt>Responsable</dt><dd>{selected.ownerEmail}</dd></div>
              <div><dt>Estado</dt><dd>{leadStatusLabels[selected.status]}</dd></div>
              <div><dt>Actualización</dt><dd>{dateTime(selected.updatedAt, true)}</dd></div>
            </dl>
            {selected.notes && <p className="detail-notes">{selected.notes}</p>}
          </article>
          <article className="detail-card">
            <h2>Historial de estados</h2>
            {leadHistory.length ? (
              <ol className="history-list">
                {leadHistory.map((item) => (
                  <li key={item.id}>
                    <strong>{leadStatusLabels[item.toStatus as LeadStatus] ?? item.toStatus}</strong>
                    <span>{dateTime(item.changedAt, true)} · {item.changedBy}</span>
                    {item.note && <p>{item.note}</p>}
                  </li>
                ))}
              </ol>
            ) : <p className="muted">No hay historial de estados.</p>}
          </article>
          <article className="detail-card">
            <h2>Actividades relacionadas</h2>
            {relatedActivities.length ? (
              <ul className="activity-mini-list">
                {relatedActivities.map((activity) => (
                  <li key={activity.id}><button onClick={() => onOpenActivity(activity.id)}><strong>{activity.title}</strong><span>{dateTime(activity.startAt, true)}</span></button></li>
                ))}
              </ul>
            ) : <p className="muted">No hay actividades relacionadas.</p>}
          </article>
        </section>
        {showForm && (
          <Modal
            onClose={() => setShowForm(false)}
            title={editing ? "Editar prospecto" : "Nuevo prospecto"}
            wide
          >
            <LeadForm busy={busy} currentUserEmail={currentUserEmail} error={formError} lead={editing} onCancel={() => setShowForm(false)} onSubmit={save} />
          </Modal>
        )}
        {conversion && (
          <ConversionDialog
            businesses={businesses}
            businessMatches={conversion.businessMatches}
            busy={busy}
            contactMatches={conversion.contactMatches}
            contacts={contacts}
            error={formError}
            lead={selected}
            missingFields={conversion.missingFields}
            onClose={() => setConversion(null)}
            onSubmit={submitConversion}
          />
        )}
        {reopen && (
          <Modal eyebrow="Acción de administrador" onClose={() => setReopen(false)} title="Reabrir prospecto">
            <form onSubmit={submitReopen}>
              <InlineAlert message={formError} />
              <p>El historial de conversión se conservará y el prospecto no podrá convertirse dos veces.</p>
              <label>Motivo de reapertura<textarea name="note" required rows={4} /></label>
              <div className="form-actions"><button className="secondary-button" onClick={() => setReopen(false)} type="button">Cancelar</button><button className="primary-button" disabled={busy}>Reabrir prospecto</button></div>
            </form>
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio" }, { label: "Prospectos" }]} />
      <PageHeader action={canWrite ? <button className="primary-button" onClick={() => { setEditing(null); setFormError(""); setShowForm(true); }}>Nuevo prospecto</button> : undefined} description="Desde el primer contacto hasta su conversión." eyebrow="CRM" title="Prospectos" />
      <div className="toolbar toolbar-filters">
        <AutocompleteInput ariaLabel="Buscar prospectos" onChange={(value) => { setSearch(value); setPage(1); }} onSelect={(option) => { setSearch(option.label); setPage(1); }} options={rows.slice(0, 8).map((lead) => ({ id: lead.id, label: lead.businessName, secondary: lead.contactName }))} placeholder="Escribe una empresa, contacto o correo…" value={search} />
        <select aria-label="Filtrar prospectos por estado" onChange={(event) => { setStatusFilter(event.target.value); setPage(1); }} value={statusFilter}><option value="">Todos los estados</option>{leadStatuses.map((status) => <option key={status} value={status}>{leadStatusLabels[status]}</option>)}</select>
        <select aria-label="Filtrar prospectos por responsable" onChange={(event) => { setOwnerFilter(event.target.value); setPage(1); }} value={ownerFilter}><option value="">Todos los responsables</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select>
        <PageSizeControl label="Prospectos por página" onChange={(value) => { setPageSizeValue(value); setPage(1); }} value={pageSizeValue} />
        <span className="record-count"><strong>{rows.length}</strong> prospectos</span>
      </div>
      {(statusFilter || ownerFilter) && <div className="active-filter-row">{statusFilter && <ActiveFilterChip label={`Estado: ${leadStatusLabels[statusFilter as LeadStatus] ?? statusFilter}`} onClear={() => { setStatusFilter(""); setPage(1); }} />}{ownerFilter && <ActiveFilterChip label={`Responsable: ${ownerFilter}`} onClear={() => { setOwnerFilter(""); setPage(1); }} />}</div>}
      {showForm && (
        <Modal
          onClose={() => setShowForm(false)}
          title={editing ? "Editar prospecto" : "Nuevo prospecto"}
          wide
        >
          <LeadForm busy={busy} currentUserEmail={currentUserEmail} error={formError} lead={editing} onCancel={() => setShowForm(false)} onSubmit={save} />
        </Modal>
      )}
      <section className="panel">
        {rows.length ? (
          <div className="table-wrap"><table className="responsive-table collection-table leads-table"><thead><tr><th><SortHeader column="business" direction={direction as "asc" | "desc"} label="Empresa" onSort={sortBy} sort={sort} /></th><th><SortHeader column="contact" direction={direction as "asc" | "desc"} label="Contacto" onSort={sortBy} sort={sort} /></th><th><SortHeader column="status" direction={direction as "asc" | "desc"} label="Estado" onSort={sortBy} sort={sort} /></th><th><SortHeader column="owner" direction={direction as "asc" | "desc"} label="Responsable" onSort={sortBy} sort={sort} /></th><th><SortHeader column="updated" direction={direction as "asc" | "desc"} label="Actualización" onSort={sortBy} sort={sort} /></th></tr></thead><tbody>{pageItems.map((lead) => (
            <tr
              className="clickable-row"
              key={lead.id}
              onClick={() => setSelectedId(lead.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(lead.id);
                }
              }}
              tabIndex={0}
            ><td data-label="Empresa"><strong title={lead.businessName}>{lead.businessName}</strong><span>{lead.source}</span></td><td data-label="Contacto">{lead.contactName}<span>{lead.email || lead.phone}</span></td><td data-label="Estado"><FilterableStatus className={`status-${lead.status}`} label={leadStatusLabels[lead.status]} onFilter={() => { setStatusFilter(lead.status); setPage(1); }} /></td><td data-label="Responsable">{lead.ownerEmail}</td><td data-label="Actualización">{dateTime(lead.updatedAt)}</td></tr>
          ))}</tbody></table></div>
        ) : <Empty action={canWrite ? <button className="primary-button" onClick={() => { setEditing(null); setFormError(""); setShowForm(true); }} type="button">Nuevo prospecto</button> : undefined} text="No hay prospectos en esta vista." />}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </section>
    </>
  );
}

function LeadForm({
  lead,
  busy,
  currentUserEmail,
  error,
  onSubmit,
  onCancel,
}: {
  lead: LeadRow | null;
  busy: boolean;
  currentUserEmail: string;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  const { formProps, requestCancel } = useFormGuard(onCancel);
  return (
    <form {...formProps} className="record-form" onSubmit={onSubmit}>
      <InlineAlert message={error} />
      <div className="form-grid">
        <label>Empresa<input autoComplete="organization" defaultValue={lead?.businessName} name="businessName" required /></label>
        <label>Contacto<input autoComplete="name" defaultValue={lead?.contactName} name="contactName" required /></label>
        <label>Email<input autoComplete="email" defaultValue={lead?.email} name="email" spellCheck={false} type="email" /></label>
        <label>Teléfono<input autoComplete="tel" defaultValue={lead?.phone} inputMode="tel" name="phone" type="tel" /></label>
        <label>Origen<input defaultValue={lead?.source} name="source" /></label>
        <label>Responsable<input autoComplete="email" defaultValue={lead?.ownerEmail ?? currentUserEmail} name="ownerEmail" required spellCheck={false} type="email" /></label>
        <label className="wide">Notas<textarea defaultValue={lead?.notes} name="notes" rows={4} /></label>
      </div>
      <div className="form-actions"><button className="secondary-button" onClick={requestCancel} type="button">Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div>
    </form>
  );
}

function ConversionDialog({
  lead,
  businesses,
  contacts,
  businessMatches,
  contactMatches,
  missingFields,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  lead: LeadRow;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  businessMatches: BusinessRow[];
  contactMatches: ContactRow[];
  missingFields: string[];
  busy: boolean;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onClose(): void;
}) {
  const [businessMode, setBusinessMode] = useState(
    businessMatches.length ? "existing" : "new",
  );
  const [contactMode, setContactMode] = useState(
    contactMatches.length ? "existing" : "new",
  );
  const { formProps, requestCancel } = useFormGuard(onClose);
  return (
    <Modal eyebrow="Conversión controlada" onClose={requestCancel} title="Convertir prospecto" wide>
      <form {...formProps} onSubmit={onSubmit}>
        <InlineAlert message={error} />
        {missingFields.length > 0 && <div className="inline-warning">Campos requeridos antes de convertir: {missingFields.join(", ")}</div>}
        <div className="conversion-grid">
          <fieldset>
            <legend>1. Empresa</legend>
            {businessMatches.length > 0 && <p className="duplicate-note">Se encontraron posibles empresas duplicadas.</p>}
            <label>Acción<select name="businessMode" onChange={(event) => setBusinessMode(event.target.value)} value={businessMode}><option value="new">Crear empresa</option><option value="existing">Usar empresa existente</option></select></label>
            {businessMode === "existing" ? (
              <label>Empresa existente<select defaultValue={businessMatches[0]?.id ?? ""} name="businessId" required><option value="">Seleccionar empresa</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}{business.email ? ` · ${business.email}` : ""}</option>)}</select></label>
            ) : (
              <>
                <label>Empresa<input autoComplete="organization" defaultValue={lead.businessName} name="businessName" required /></label>
                <label>Correo de la empresa<input autoComplete="email" name="businessEmail" spellCheck={false} type="email" /></label>
                <label>Teléfono de la empresa<input autoComplete="tel" inputMode="tel" name="businessPhone" type="tel" /></label>
                <label>Dirección<input autoComplete="street-address" name="businessAddress" /></label>
              </>
            )}
          </fieldset>
          <fieldset>
            <legend>2. Contacto</legend>
            {contactMatches.length > 0 && <p className="duplicate-note">Se encontraron posibles contactos duplicados.</p>}
            <label>Acción<select name="contactMode" onChange={(event) => setContactMode(event.target.value)} value={contactMode}><option value="new">Crear contacto</option><option value="existing">Usar contacto existente</option></select></label>
            {contactMode === "existing" ? (
              <label>Contacto existente<select defaultValue={contactMatches[0]?.id ?? ""} name="contactId" required><option value="">Seleccionar contacto</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}{contact.email ? ` · ${contact.email}` : contact.phone ? ` · ${contact.phone}` : ""}</option>)}</select></label>
            ) : (
              <>
                <label>Contacto<input autoComplete="name" defaultValue={lead.contactName} name="contactName" required /></label>
                <label>Email<input autoComplete="email" defaultValue={lead.email} name="contactEmail" spellCheck={false} type="email" /></label>
                <label>Teléfono<input autoComplete="tel" defaultValue={lead.phone} inputMode="tel" name="contactPhone" type="tel" /></label>
                <label>Cargo<input autoComplete="organization-title" name="contactTitle" /></label>
              </>
            )}
          </fieldset>
          <fieldset>
            <legend>3. Oportunidad</legend>
            <label>Título de la oportunidad<input defaultValue={`${lead.businessName} — Oportunidad`} name="opportunityTitle" required /></label>
            <label>Valor estimado (DOP)<input min="0" name="estimatedValue" step="0.01" type="number" /></label>
            <label>Fecha de cierre prevista<input name="expectedCloseDate" type="date" /></label>
            <label>Responsable<input autoComplete="email" defaultValue={lead.ownerEmail} name="ownerEmail" required spellCheck={false} type="email" /></label>
            <label>Notas<textarea defaultValue={lead.notes} name="opportunityNotes" rows={3} /></label>
          </fieldset>
        </div>
        <div className="conversion-summary">
          <strong>Resumen de la conversión</strong>
          <p>El prospecto permanecerá en el historial y quedará vinculado a una empresa, un contacto y una oportunidad nueva. No se sobrescribirán campos existentes con información.</p>
        </div>
        <div className="form-actions"><button className="secondary-button" onClick={requestCancel} type="button">Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Convirtiendo…" : "Confirmar conversión"}</button></div>
      </form>
    </Modal>
  );
}
