"use client";

import { useMemo, useState, type FormEvent } from "react";
import {
  opportunityOutcomeLabels,
  opportunityStageLabels,
  opportunityStages,
  type OpportunityStage,
} from "../lib/crm";
import { PipelineStepper, type PipelineOutcome } from "./pipeline";
import type {
  ActivityRow,
  BusinessRow,
  ContactRow,
  OpportunityHistoryRow,
  OpportunityQuoteLink,
  OpportunityRow,
  RecordRow,
} from "./types";
import {
  Breadcrumbs,
  Empty,
  InlineAlert,
  Modal,
  Pagination,
  dateInputValue,
  dateTime,
  money,
  useFormGuard,
  usePagination,
  useUrlState,
} from "./ui";

function nextHistoryId(rows: ReadonlyArray<{ id: number }>) {
  return rows.reduce((lowest, row) => Math.min(lowest, row.id), 0) - 1;
}

export function OpportunitiesView({
  opportunities,
  setOpportunities,
  businesses,
  contacts,
  records,
  setRecords,
  quoteLinks,
  setQuoteLinks,
  activities,
  history,
  setHistory,
  selectedId,
  setSelectedId,
  canWrite,
  isAdmin,
  currentUserEmail,
  setMessage,
  onOpenActivity,
}: {
  opportunities: OpportunityRow[];
  setOpportunities(value: OpportunityRow[]): void;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  records: RecordRow[];
  setRecords(value: RecordRow[]): void;
  quoteLinks: OpportunityQuoteLink[];
  setQuoteLinks(value: OpportunityQuoteLink[]): void;
  activities: ActivityRow[];
  history: OpportunityHistoryRow[];
  setHistory(value: OpportunityHistoryRow[]): void;
  selectedId: string | null;
  setSelectedId(value: string | null): void;
  canWrite: boolean;
  isAdmin: boolean;
  currentUserEmail: string;
  setMessage(message: string): void;
  onOpenActivity(id: string): void;
}) {
  const [search, setSearch] = useUrlState("q");
  const [stageFilter, setStageFilter] = useUrlState("stage");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner");
  const [sort, setSort] = useUrlState("sort", "recent");
  const [editing, setEditing] = useState<OpportunityRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [showClose, setShowClose] = useState(false);
  const [showQuote, setShowQuote] = useState(false);
  const [showReopen, setShowReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const selected =
    opportunities.find((opportunity) => opportunity.id === selectedId) ?? null;
  const owners = [
    ...new Set(opportunities.map((opportunity) => opportunity.ownerEmail)),
  ].sort();
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return opportunities
      .filter((opportunity) => {
        const business = businesses.find(
          (item) => item.id === opportunity.businessId,
        );
        return (
          (!stageFilter || opportunity.stage === stageFilter) &&
          (!ownerFilter || opportunity.ownerEmail === ownerFilter) &&
          `${opportunity.title} ${business?.name ?? ""} ${opportunity.notes}`
            .toLowerCase()
            .includes(term)
        );
      })
      .toSorted((left, right) => {
        if (sort === "value")
          return right.estimatedValue - left.estimatedValue;
        if (sort === "close")
          return (left.expectedCloseDate ?? "9999").localeCompare(
            right.expectedCloseDate ?? "9999",
          );
        if (sort === "stage")
          return (
            opportunityStages.indexOf(left.stage) -
            opportunityStages.indexOf(right.stage)
          );
        return right.updatedAt.localeCompare(left.updatedAt);
      });
  }, [
    businesses,
    opportunities,
    ownerFilter,
    search,
    sort,
    stageFilter,
  ]);
  const { page, pageItems, setPage, totalPages } = usePagination(rows);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(
      editing ? `/api/opportunities/${editing.id}` : "/api/opportunities",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as {
      opportunity?: OpportunityRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.opportunity) {
      const error = result.error ?? "No se pudo guardar la Opportunity.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setOpportunities(
      editing
        ? opportunities.map((item) =>
            item.id === result.opportunity!.id ? result.opportunity! : item,
          )
        : [result.opportunity, ...opportunities],
    );
    if (!editing) {
      setHistory([
        {
          id: nextHistoryId(history),
          opportunityId: result.opportunity.id,
          fromStage: null,
          toStage: "evaluation",
          outcome: null,
          changedBy: currentUserEmail,
          changedAt: result.opportunity.createdAt,
          note: "Opportunity creada",
        },
        ...history,
      ]);
    }
    setSelectedId(result.opportunity.id);
    setShowForm(false);
    setEditing(null);
    setFormError("");
    setMessage("Opportunity guardada.");
  }

  async function advance(opportunity: OpportunityRow) {
    setBusy(true);
    const response = await fetch(
      `/api/opportunities/${opportunity.id}/advance`,
      { method: "POST" },
    );
    const result = (await response.json()) as {
      opportunity?: OpportunityRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.opportunity) {
      setMessage(result.error ?? "No se pudo avanzar la Opportunity.");
      return;
    }
    setOpportunities(
      opportunities.map((item) =>
        item.id === result.opportunity!.id ? result.opportunity! : item,
      ),
    );
    setHistory([
      {
        id: nextHistoryId(history),
        opportunityId: opportunity.id,
        fromStage: opportunity.stage,
        toStage: result.opportunity.stage,
        outcome: null,
        changedBy: currentUserEmail,
        changedAt: result.opportunity.updatedAt,
        note: "Advance Stage",
      },
      ...history,
    ]);
    setMessage(
      `Opportunity actualizada a ${opportunityStageLabels[result.opportunity.stage]}.`,
    );
  }

  async function closeOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/opportunities/${selected.id}/close`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as {
      opportunity?: OpportunityRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.opportunity) {
      const error = result.error ?? "No se pudo cerrar la Opportunity.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setOpportunities(
      opportunities.map((item) =>
        item.id === result.opportunity!.id ? result.opportunity! : item,
      ),
    );
    setHistory([
      {
        id: nextHistoryId(history),
        opportunityId: selected.id,
        fromStage: "negotiation_review",
        toStage: "closed",
        outcome: result.opportunity.outcome,
        changedBy: currentUserEmail,
        changedAt: result.opportunity.updatedAt,
        note: result.opportunity.lossReason,
      },
      ...history,
    ]);
    setShowClose(false);
    setFormError("");
    setMessage(
      `Opportunity Closed — ${opportunityOutcomeLabels[result.opportunity.outcome!]}.`,
    );
  }

  async function reopenOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(`/api/opportunities/${selected.id}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as {
      opportunity?: OpportunityRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.opportunity) {
      const error = result.error ?? "No se pudo reabrir la Opportunity.";
      setFormError(error);
      setMessage(error);
      return;
    }
    setOpportunities(
      opportunities.map((item) =>
        item.id === result.opportunity!.id ? result.opportunity! : item,
      ),
    );
    setHistory([
      {
        id: nextHistoryId(history),
        opportunityId: selected.id,
        fromStage: "closed",
        toStage: "negotiation_review",
        outcome: null,
        changedBy: currentUserEmail,
        changedAt: result.opportunity.updatedAt,
        note: String(payload.note ?? ""),
      },
      ...history,
    ]);
    setShowReopen(false);
    setFormError("");
    setMessage("Oportunidad reabierta en negociación / revisión.");
  }

  async function addQuote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(
      `/api/opportunities/${selected.id}/quotes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as {
      quote?: RecordRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.quote) {
      const error = result.error ?? "No se pudo vincular la cotización.";
      setFormError(error);
      setMessage(error);
      return;
    }
    if (!records.some((record) => record.id === result.quote!.id)) {
      setRecords([result.quote, ...records]);
    }
    if (
      !quoteLinks.some(
        (link) =>
          link.opportunityId === selected.id &&
          link.quoteRecordId === result.quote!.id,
      )
    ) {
      setQuoteLinks([
        {
          opportunityId: selected.id,
          quoteRecordId: result.quote.id,
          createdBy: currentUserEmail,
          createdAt: new Date().toISOString(),
        },
        ...quoteLinks,
      ]);
    }
    setShowQuote(false);
    setFormError("");
    setMessage("Cotización vinculada. La etapa no cambió automáticamente.");
  }

  if (selected) {
    const business = businesses.find(
      (item) => item.id === selected.businessId,
    );
    const contact = contacts.find(
      (item) => item.id === selected.primaryContactId,
    );
    const opportunityHistory = history
      .filter((item) => item.opportunityId === selected.id)
      .toSorted((left, right) => right.changedAt.localeCompare(left.changedAt));
    const currentStageIndex = opportunityStages.indexOf(selected.stage);
    const completed = new Set<string>(
      opportunityStages.slice(0, currentStageIndex),
    );
    const relatedActivities = activities.filter(
      (activity) =>
        activity.relatedType === "opportunity" &&
        activity.relatedId === selected.id,
    );
    const linkedQuotes = quoteLinks
      .filter((link) => link.opportunityId === selected.id)
      .map((link) =>
        records.find((record) => record.id === link.quoteRecordId),
      )
      .filter((record): record is RecordRow => Boolean(record));
    const availableQuotes = records.filter(
      (record) =>
        record.module === "cotizaciones" &&
        !linkedQuotes.some((quote) => quote.id === record.id),
    );
    const closingOutcomes: PipelineOutcome[] =
      selected.stage === "closed" && selected.outcome
        ? [
            {
              value: "won",
              label: opportunityOutcomeLabels.won,
              description: "Resultado de cierre seleccionado.",
              tone: "success",
            },
            {
              value: "lost",
              label: opportunityOutcomeLabels.lost,
              description: "Resultado de cierre seleccionado.",
              tone: "loss",
            },
          ]
        : [];
    const opportunityAction =
      canWrite && selected.stage === "evaluation"
        ? {
            label: `Avanzar a ${opportunityStageLabels.quote}`,
            onAction: () => advance(selected),
          }
        : canWrite && selected.stage === "quote"
          ? {
              label: `Avanzar a ${opportunityStageLabels.negotiation_review}`,
              onAction: () => advance(selected),
            }
          : canWrite && selected.stage === "negotiation_review"
            ? {
                label: "Cerrar oportunidad",
                onAction: () => {
                  setFormError("");
                  setShowClose(true);
                },
              }
            : undefined;
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            { label: "Oportunidades", onClick: () => setSelectedId(null) },
            { label: selected.title },
          ]}
        />
        <div className="page-heading">
          <div>
            <p className="eyebrow">CRM pipeline</p>
            <h1>{selected.title}</h1>
            <p>
              {business?.name ?? "Empresa no disponible"} ·{" "}
              {selected.stage === "closed" && selected.outcome
                ? `Cerrada — ${opportunityOutcomeLabels[selected.outcome]}`
                : opportunityStageLabels[selected.stage]}
            </p>
          </div>
          {canWrite && (
            <button
              className="secondary-button"
              onClick={() => {
                setEditing(selected);
                setFormError("");
                setShowForm(true);
              }}
            >
              Editar oportunidad
            </button>
          )}
        </div>
        <PipelineStepper
          action={opportunityAction}
          ariaLabel="Pipeline de la oportunidad"
          busy={busy}
          completedStages={completed}
          currentStatus={selected.stage}
          outcomeDescription="Won y Lost son resultados mutuamente exclusivos."
          outcomeHeading="Resultado del cierre"
          selectedOutcome={selected.outcome}
          stages={opportunityStages.map((stage) => ({
            value: stage,
            label: opportunityStageLabels[stage],
          }))}
          terminalOutcomes={closingOutcomes}
        />
        {isAdmin && selected.stage === "closed" && (
          <div className="terminal-actions">
            <div><strong>Oportunidad cerrada</strong><span>Solo un administrador puede reabrirla.</span></div>
            <button className="secondary-button" onClick={() => { setFormError(""); setShowReopen(true); }}>Reabrir oportunidad</button>
          </div>
        )}
        <section className="detail-grid">
          <article className="detail-card">
            <h2>Detalles de la oportunidad</h2>
            <dl>
              <div><dt>Empresa</dt><dd>{business?.name ?? "—"}</dd></div>
              <div><dt>Contacto principal</dt><dd>{contact?.name ?? "—"}</dd></div>
              <div><dt>Valor estimado</dt><dd>{money(selected.estimatedValue)}</dd></div>
              <div><dt>Cierre previsto</dt><dd>{dateTime(selected.expectedCloseDate)}</dd></div>
              <div><dt>Responsable</dt><dd>{selected.ownerEmail}</dd></div>
              <div><dt>Etapa</dt><dd>{opportunityStageLabels[selected.stage]}</dd></div>
              {selected.outcome && <div><dt>Resultado del cierre</dt><dd>{opportunityOutcomeLabels[selected.outcome]}</dd></div>}
              {selected.lossReason && <div><dt>Motivo de pérdida</dt><dd>{selected.lossReason}</dd></div>}
            </dl>
            {selected.notes && <p className="detail-notes">{selected.notes}</p>}
          </article>
          <article className="detail-card">
            <div className="card-heading"><h2>Cotizaciones</h2>{canWrite && <button className="text-button" onClick={() => { setFormError(""); setShowQuote((value) => !value); }}>Agregar cotización</button>}</div>
            {showQuote && (
              <form className="compact-form" onSubmit={addQuote}>
                <InlineAlert message={formError} />
                <label>Vincular cotización existente<select name="quoteRecordId" defaultValue=""><option value="">Crear una cotización</option>{availableQuotes.map((quote) => <option key={quote.id} value={quote.id}>{quote.title}</option>)}</select></label>
                <label>Título de la cotización<input defaultValue={`${selected.title} — Cotización`} name="title" /></label>
                <label>Monto (DOP)<input min="0" name="amount" step="0.01" type="number" /></label>
                <label>Fecha límite<input name="dueDate" type="date" /></label>
                <button className="primary-button" disabled={busy}>Guardar vínculo</button>
              </form>
            )}
            {linkedQuotes.length ? (
              <ul className="quote-list">
                {linkedQuotes.map((quote) => (
                  <li key={quote.id}><div><strong>{quote.title}</strong><span>{quote.status} · {dateTime(quote.updatedAt)}</span></div><strong>{money(quote.amount)}</strong></li>
                ))}
              </ul>
            ) : <p className="muted">No hay cotizaciones vinculadas.</p>}
          </article>
          <article className="detail-card">
            <h2>Historial de etapas</h2>
            {opportunityHistory.length ? (
              <ol className="history-list">
                {opportunityHistory.map((item) => (
                  <li key={item.id}><strong>{opportunityStageLabels[item.toStage as OpportunityStage] ?? item.toStage}{item.outcome ? ` — ${opportunityOutcomeLabels[item.outcome as "won" | "lost"]}` : ""}</strong><span>{dateTime(item.changedAt, true)} · {item.changedBy}</span>{item.note && <p>{item.note}</p>}</li>
                ))}
              </ol>
            ) : <p className="muted">No hay historial de etapas.</p>}
          </article>
          <article className="detail-card">
            <h2>Actividades relacionadas</h2>
            {relatedActivities.length ? (
              <ul className="activity-mini-list">{relatedActivities.map((activity) => <li key={activity.id}><button onClick={() => onOpenActivity(activity.id)}><strong>{activity.title}</strong><span>{dateTime(activity.startAt, true)}</span></button></li>)}</ul>
            ) : <p className="muted">No hay actividades relacionadas.</p>}
          </article>
        </section>
        {showForm && <OpportunityForm businesses={businesses} busy={busy} contacts={contacts} currentUserEmail={currentUserEmail} error={formError} onCancel={() => setShowForm(false)} onSubmit={save} opportunity={editing} />}
        {showClose && <CloseDialog busy={busy} error={formError} onClose={() => setShowClose(false)} onSubmit={closeOpportunity} />}
        {showReopen && (
          <Modal eyebrow="Acción de administrador" onClose={() => setShowReopen(false)} title="Reabrir oportunidad">
            <form onSubmit={reopenOpportunity}><InlineAlert message={formError} /><p>El resultado anterior permanecerá en el historial de etapas.</p><label>Motivo de reapertura<textarea name="note" required rows={4} /></label><div className="form-actions"><button className="secondary-button" onClick={() => setShowReopen(false)} type="button">Cancelar</button><button className="primary-button" disabled={busy}>Reabrir oportunidad</button></div></form>
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio" }, { label: "Oportunidades" }]} />
      <div className="page-heading">
        <div><p className="eyebrow">CRM</p><h1>Oportunidades</h1><p>Trabajo calificado desde evaluación hasta cierre.</p></div>
        {canWrite && <button className="primary-button" onClick={() => { setEditing(null); setFormError(""); setShowForm(true); }}>Nueva oportunidad</button>}
      </div>
      <div className="toolbar toolbar-filters">
        <input aria-label="Buscar oportunidades" autoComplete="off" name="q" onChange={(event) => setSearch(event.target.value)} placeholder="Buscar oportunidades o empresas…" value={search} />
        <select aria-label="Filtrar oportunidades por etapa" onChange={(event) => setStageFilter(event.target.value)} value={stageFilter}><option value="">Todas las etapas</option>{opportunityStages.map((stage) => <option key={stage} value={stage}>{opportunityStageLabels[stage]}</option>)}</select>
        <select aria-label="Filtrar oportunidades por responsable" onChange={(event) => setOwnerFilter(event.target.value)} value={ownerFilter}><option value="">Todos los responsables</option>{owners.map((owner) => <option key={owner}>{owner}</option>)}</select>
        <select aria-label="Ordenar oportunidades" onChange={(event) => setSort(event.target.value)} value={sort}><option value="recent">Actualizadas recientemente</option><option value="value">Valor estimado</option><option value="close">Cierre previsto</option><option value="stage">Etapa del pipeline</option></select>
        <span>{rows.length} oportunidades</span>
      </div>
      {showForm && <OpportunityForm businesses={businesses} busy={busy} contacts={contacts} currentUserEmail={currentUserEmail} error={formError} onCancel={() => setShowForm(false)} onSubmit={save} opportunity={editing} />}
      <section className="panel">
        {rows.length ? (
          <div className="table-wrap"><table className="responsive-table"><thead><tr><th>Oportunidad</th><th>Empresa</th><th>Etapa / resultado</th><th>Valor</th><th>Cierre previsto</th><th>Responsable</th></tr></thead><tbody>{pageItems.map((opportunity) => (
            <tr
              className="clickable-row"
              key={opportunity.id}
              onClick={() => setSelectedId(opportunity.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setSelectedId(opportunity.id);
                }
              }}
              tabIndex={0}
            ><td data-label="Oportunidad"><strong>{opportunity.title}</strong></td><td data-label="Empresa">{businesses.find((item) => item.id === opportunity.businessId)?.name ?? "—"}</td><td data-label="Etapa / resultado"><span className={`status status-${opportunity.stage}`}>{opportunityStageLabels[opportunity.stage]}{opportunity.outcome ? ` — ${opportunityOutcomeLabels[opportunity.outcome]}` : ""}</span></td><td data-label="Valor">{money(opportunity.estimatedValue)}</td><td data-label="Cierre previsto">{dateTime(opportunity.expectedCloseDate)}</td><td data-label="Responsable">{opportunity.ownerEmail}</td></tr>
          ))}</tbody></table></div>
        ) : <Empty action={canWrite ? <button className="primary-button" onClick={() => { setEditing(null); setFormError(""); setShowForm(true); }} type="button">Nueva oportunidad</button> : undefined} text="No hay oportunidades en esta vista." />}
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      </section>
    </>
  );
}

function OpportunityForm({
  opportunity,
  businesses,
  contacts,
  busy,
  currentUserEmail,
  error,
  onSubmit,
  onCancel,
}: {
  opportunity: OpportunityRow | null;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  busy: boolean;
  currentUserEmail: string;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  const { formProps, requestCancel } = useFormGuard(onCancel);
  return (
    <form {...formProps} className="record-form" onSubmit={onSubmit}>
      <div className="form-heading"><h2>{opportunity ? "Editar oportunidad" : "Nueva oportunidad"}</h2><button aria-label="Cerrar" onClick={requestCancel} type="button">×</button></div>
      <InlineAlert message={error} />
      <div className="form-grid">
        <label className="wide">Título de la oportunidad<input autoComplete="off" defaultValue={opportunity?.title} name="title" required /></label>
        <label>Empresa<select defaultValue={opportunity?.businessId ?? ""} name="businessId" required><option value="">Seleccionar empresa</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
        <label>Contacto principal<select defaultValue={opportunity?.primaryContactId ?? ""} name="primaryContactId"><option value="">Sin contacto principal</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>
        <label>Valor estimado (DOP)<input defaultValue={opportunity?.estimatedValue ?? 0} min="0" name="estimatedValue" step="0.01" type="number" /></label>
        <label>Fecha de cierre prevista<input defaultValue={dateInputValue(opportunity?.expectedCloseDate ?? null)} name="expectedCloseDate" type="date" /></label>
        <label>Responsable<input autoComplete="email" defaultValue={opportunity?.ownerEmail ?? currentUserEmail} name="ownerEmail" required spellCheck={false} type="email" /></label>
        <label className="wide">Notas<textarea defaultValue={opportunity?.notes} name="notes" rows={4} /></label>
      </div>
      <div className="form-actions"><button className="secondary-button" onClick={requestCancel} type="button">Cancelar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div>
    </form>
  );
}

function CloseDialog({
  busy,
  error,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onClose(): void;
}) {
  const [outcome, setOutcome] = useState("");
  const { formProps, requestCancel } = useFormGuard(onClose);
  return (
    <Modal eyebrow="Acción final" onClose={requestCancel} title="Cerrar oportunidad">
      <form {...formProps} onSubmit={onSubmit}>
        <InlineAlert message={error} />
        <p>Cerrada es la etapa final. Selecciona un resultado de cierre.</p>
        <fieldset className="outcome-options">
          <legend>Resultado del cierre</legend>
          <label><input checked={outcome === "won"} name="outcome" onChange={() => setOutcome("won")} required type="radio" value="won" /> Ganada</label>
          <label><input checked={outcome === "lost"} name="outcome" onChange={() => setOutcome("lost")} required type="radio" value="lost" /> Perdida</label>
        </fieldset>
        {outcome === "lost" && <label>Motivo de pérdida<textarea name="lossReason" required rows={4} /></label>}
        <div className="form-actions"><button className="secondary-button" onClick={requestCancel} type="button">Cancelar</button><button className="primary-button" disabled={busy || !outcome}>{busy ? "Cerrando…" : `Cerrar como ${outcome ? opportunityOutcomeLabels[outcome as "won" | "lost"] : ""}`}</button></div>
      </form>
    </Modal>
  );
}
