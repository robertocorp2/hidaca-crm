"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { BusinessRow, ContactRow } from "./types";
import type { QuotationDetail, QuotationSummary } from "./source-types";
import { Empty, dateTime, formatBusinessDate, money } from "./ui";

type ProjectOption = {
  id: string;
  name: string;
  businessId: string;
  businessName: string;
};

type Filters = {
  query: string;
  status: string;
  type: string;
  serviceCategory: string;
  dateFrom: string;
  dateTo: string;
  month: string;
  year: string;
  projectId: string;
  paymentStatus: string;
  minTotal: string;
  maxTotal: string;
  sourceFilename: string;
  importBatchId: string;
};

const initialFilters: Filters = {
  query: "",
  status: "",
  type: "",
  serviceCategory: "",
  dateFrom: "",
  dateTo: "",
  month: "",
  year: "",
  projectId: "",
  paymentStatus: "",
  minTotal: "",
  maxTotal: "",
  sourceFilename: "",
  importBatchId: "",
};

export function QuotationsView({
  businesses,
  contacts,
  canWrite,
  selectedId,
  setSelectedId,
  setMessage,
}: {
  businesses: BusinessRow[];
  contacts: ContactRow[];
  canWrite: boolean;
  selectedId: string | null;
  setSelectedId(value: string | null): void;
  setMessage(value: string): void;
}) {
  const [quotations, setQuotations] = useState<QuotationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [detail, setDetail] = useState<QuotationDetail | null>(null);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [revisionId, setRevisionId] = useState("");
  const [showEdit, setShowEdit] = useState(false);
  const [detailVersion, setDetailVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function updateFilter(name: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [name]: value }));
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/projects", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as {
          projects?: ProjectOption[];
        };
        setProjects(result.projects ?? []);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "250" });
      for (const [name, value] of Object.entries(filters)) {
        if (!value.trim()) continue;
        params.set(name === "query" ? "q" : name, value.trim());
      }
      try {
        const response = await fetch(`/api/quotations?${params}`, {
          signal: controller.signal,
        });
        const result = (await response.json()) as {
          quotations?: QuotationSummary[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            result.error ?? "No se pudieron cargar las cotizaciones.",
          );
        }
        setError("");
        setQuotations(result.quotations ?? []);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") {
          setError((reason as Error).message);
        }
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [filters]);

  useEffect(() => {
    if (!selectedId) {
      const timer = window.setTimeout(() => {
        setDetail(null);
        setRevisionId("");
        setShowEdit(false);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = revisionId
        ? `?revisionId=${encodeURIComponent(revisionId)}`
        : "";
      void fetch(`/api/quotations/${encodeURIComponent(selectedId)}${params}`, {
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = (await response.json()) as QuotationDetail & {
            error?: string;
          };
          if (!response.ok) {
            throw new Error(result.error ?? "No se pudo cargar la cotización.");
          }
          setDetail(result);
          setError("");
        })
        .catch((reason) => {
          if ((reason as Error).name !== "AbortError") {
            setError((reason as Error).message);
          }
        })
        .finally(() => setLoading(false));
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [detailVersion, revisionId, selectedId]);

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId) return;
    setBusy(true);
    setError("");
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(
      `/api/quotations/${encodeURIComponent(selectedId)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo guardar la cotización.");
      return;
    }
    setShowEdit(false);
    setDetailVersion((value) => value + 1);
    setMessage("Cotización actualizada con historial de auditoría.");
  }

  if (selectedId) {
    if (loading && !detail) {
      return <p className="empty-state">Cargando cotización…</p>;
    }
    if (error && !detail) {
      return (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      );
    }
    if (!detail) return null;
    const quote = detail.quotation;
    const revision = detail.revision;
    const financials = detail.financials;
    return (
      <>
        <div className="breadcrumbs">
          <span>Inicio</span>
          <i>/</i>
          <button onClick={() => setSelectedId(null)} type="button">
            Cotizaciones
          </button>
          <i>/</i>
          <span aria-current="page">{quote.quotationNumber}</span>
        </div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Cotización normalizada</p>
            <h1>{quote.quotationNumber}</h1>
            <p>
              {quote.title} · {quote.businessName}
            </p>
          </div>
          <div className="page-heading-actions">
            <label className="revision-picker">
              Revisión
              <select
                onChange={(event) => setRevisionId(event.target.value)}
                value={String(revision?.id ?? "")}
              >
                {detail.revisions.map((item) => (
                  <option key={String(item.id)} value={String(item.id)}>
                    {String(
                      item.revisionLabel || `Revisión ${item.revisionNumber}`,
                    )}
                    {item.alternativeLabel ? ` · ${item.alternativeLabel}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {canWrite && (
              <button
                className="primary-button"
                onClick={() => setShowEdit(true)}
                type="button"
              >
                Editar
              </button>
            )}
          </div>
        </div>
        {error && (
          <div className="inline-alert" role="alert">
            {error}
          </div>
        )}
        {showEdit && (
          <QuotationForm
            businesses={businesses}
            busy={busy}
            contacts={contacts}
            detail={detail}
            error={error}
            onCancel={() => setShowEdit(false)}
            onSubmit={submitEdit}
            projects={projects}
          />
        )}
        <section className="detail-grid">
          <article className="detail-card">
            <h2>Resumen y cliente</h2>
            <dl>
              <Field label="Cliente" value={quote.businessName} />
              <Field label="RNC/Cédula" value={String(quote.rnc || "—")} />
              <Field
                label="Contacto"
                value={String(quote.contactName ?? "—")}
              />
              <Field
                label="Teléfono"
                value={String(quote.contactPhone || "—")}
              />
              <Field
                label="Celular"
                value={String(quote.contactMobilePhone || "—")}
              />
              <Field label="Correo" value={String(quote.contactEmail || "—")} />
              <Field
                label="Proyecto"
                value={String(quote.projectName ?? "—")}
              />
              <Field label="Servicio" value={quote.serviceCategory || "—"} />
              <Field label="Tipo" value={quote.quotationType} />
              <Field label="Estado" value={quote.status} />
            </dl>
          </article>
          <article className="detail-card">
            <h2>Fecha, revisión y alternativa</h2>
            <dl>
              <Field
                label="Fecha"
                value={formatDate(revision?.quotationDate)}
              />
              <Field label="Mes" value={monthName(revision?.quotationMonth)} />
              <Field label="Año" value={String(quote.quotationYear ?? "—")} />
              <Field
                label="Revisión"
                value={String(
                  revision?.revisionLabel || revision?.revisionNumber || "—",
                )}
              />
              <Field
                label="Alternativa"
                value={String(revision?.alternativeLabel || "—")}
              />
              <Field
                label="Alcance"
                value={String(revision?.scopeLabel || "—")}
              />
              <Field
                label="Validez hasta"
                value={formatDate(revision?.validityUntil)}
              />
              <Field
                label="Fecha original"
                value={String(revision?.sourceDateRaw || "—")}
              />
              <Field
                label="Mes original"
                value={String(revision?.sourceMonthRaw || "—")}
              />
            </dl>
          </article>
          <article className="detail-card">
            <h2>Resumen financiero</h2>
            <dl>
              <Field
                label="Moneda"
                value={String(
                  financials?.currency || quote.currency || "No indicada",
                )}
              />
              <Field
                label="Subtotal de origen"
                value={amount(financials?.sourceSubtotal, quote.currency)}
              />
              <Field
                label="Subtotal calculado"
                value={amount(financials?.calculatedSubtotal, quote.currency)}
              />
              <Field
                label="Descuento"
                value={amount(financials?.discountAmount, quote.currency)}
              />
              <Field
                label="ITBIS de origen"
                value={amount(financials?.sourceTaxAmount, quote.currency)}
              />
              <Field
                label="Total de origen"
                value={amount(financials?.sourceTotal, quote.currency)}
              />
              <Field
                label="Total calculado"
                value={amount(financials?.calculatedTotal, quote.currency)}
              />
              <Field
                label="Diferencia"
                value={amount(financials?.discrepancyAmount, quote.currency)}
              />
              <Field
                label="Estado de pago"
                value={String(financials?.paymentStatus ?? "unknown")}
              />
            </dl>
          </article>
          <ListCard
            title="Direcciones"
            rows={detail.addresses}
            render={(item) =>
              `${String(item.label || item.type)}: ${String(item.line1 || "—")}`
            }
          />
        </section>
        {detail.sourceRecord && (
          <SourceRecordCard record={detail.sourceRecord} />
        )}
        <ListTable detail={detail} currency={quote.currency} />
        <section className="detail-grid">
          <ListCard
            title="Mediciones"
            rows={detail.measurements}
            render={(item) =>
              `${String(item.location || item.areaLabel || "Ubicación")} · ${measurement(item)}`
            }
          />
          <ListCard
            title="Cargos"
            rows={detail.charges}
            render={(item) =>
              `${String(item.label || item.type)} · ${amount(item.sourceAmount ?? item.calculatedAmount, String(item.currency || quote.currency))}`
            }
          />
          <ListCard
            title="Pagos y balance"
            rows={detail.payments}
            render={(item) =>
              `${String(item.label || item.type)} · ${amount(item.amount, String(item.currency || quote.currency))} · ${formatDate(item.paymentDate)}`
            }
          />
          <ListCard
            title="Términos y condiciones"
            rows={termsRows(detail.terms)}
            render={(item) => `${String(item.label)}: ${String(item.value)}`}
          />
        </section>
        {Boolean(revision?.customerFacingNotes || revision?.internalNotes) && (
          <section className="detail-card source-section">
            <h2>Notas</h2>
            {Boolean(revision?.customerFacingNotes) && (
              <p>{String(revision?.customerFacingNotes)}</p>
            )}
            {Boolean(revision?.internalNotes) && detail.internalVisible && (
              <p className="detail-notes">{String(revision?.internalNotes)}</p>
            )}
          </section>
        )}
        <SourceAndAudit detail={detail} />
        {detail.internalVisible && detail.manufacturing.length > 0 && (
          <section className="detail-card source-section internal-section">
            <h2>Producción interna</h2>
            <p className="muted">
              Solo visible para administradores y operadores.
            </p>
            {detail.manufacturing.map((sheet) => (
              <div className="manufacturing-block" key={String(sheet.id)}>
                <h3>
                  {String(sheet.name)}{" "}
                  <span className={`status status-${sheet.calculationStatus}`}>
                    {String(sheet.calculationStatus)}
                  </span>
                </h3>
                <ul>
                  {detail.materialComponents
                    .filter((component) => component.worksheetId === sheet.id)
                    .map((component) => (
                      <li key={String(component.id)}>
                        <strong>{String(component.name)}</strong>
                        <span>
                          {displayNumber(component.quantity)} ·{" "}
                          {amount(
                            component.totalCost,
                            String(component.currency || quote.currency),
                          )}{" "}
                          · {String(component.formulaStatus)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </section>
        )}
      </>
    );
  }

  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">Cotizaciones</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Registros normalizados</p>
          <h1>Cotizaciones</h1>
          <p>Revisiones, alternativas, importes y documentos de origen.</p>
        </div>
      </div>
      <div className="toolbar toolbar-filters source-filters">
        <input
          aria-label="Buscar cotizaciones"
          onChange={(event) => updateFilter("query", event.target.value)}
          placeholder="Número, cliente, RNC, contacto, teléfono…"
          value={filters.query}
        />
        <select
          aria-label="Filtrar por estado"
          onChange={(event) => updateFilter("status", event.target.value)}
          value={filters.status}
        >
          <option value="">Todos los estados</option>
          {[
            "draft",
            "sent",
            "accepted",
            "rejected",
            "expired",
            "cancelled",
            "unknown",
          ].map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <select
          aria-label="Filtrar por tipo"
          onChange={(event) => updateFilter("type", event.target.value)}
          value={filters.type}
        >
          <option value="">Todos los tipos</option>
          {["installation", "repair", "maintenance", "mixed", "other"].map(
            (value) => (
              <option key={value}>{value}</option>
            ),
          )}
        </select>
        <input
          aria-label="Filtrar por archivo fuente"
          onChange={(event) =>
            updateFilter("sourceFilename", event.target.value)
          }
          placeholder="Archivo fuente"
          value={filters.sourceFilename}
        />
      </div>
      <details className="detail-card filter-details">
        <summary>Más filtros</summary>
        <div className="form-grid">
          <label>
            Desde
            <input
              onChange={(event) => updateFilter("dateFrom", event.target.value)}
              type="date"
              value={filters.dateFrom}
            />
          </label>
          <label>
            Hasta
            <input
              onChange={(event) => updateFilter("dateTo", event.target.value)}
              type="date"
              value={filters.dateTo}
            />
          </label>
          <label>
            Mes
            <input
              max="12"
              min="1"
              onChange={(event) => updateFilter("month", event.target.value)}
              type="number"
              value={filters.month}
            />
          </label>
          <label>
            Año
            <input
              max="9999"
              min="1900"
              onChange={(event) => updateFilter("year", event.target.value)}
              type="number"
              value={filters.year}
            />
          </label>
          <label>
            Proyecto
            <select
              onChange={(event) =>
                updateFilter("projectId", event.target.value)
              }
              value={filters.projectId}
            >
              <option value="">Todos</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name} · {project.businessName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Estado de pago
            <select
              onChange={(event) =>
                updateFilter("paymentStatus", event.target.value)
              }
              value={filters.paymentStatus}
            >
              <option value="">Todos</option>
              {["unpaid", "partial", "paid", "overdue", "unknown"].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Servicio
            <input
              onChange={(event) =>
                updateFilter("serviceCategory", event.target.value)
              }
              value={filters.serviceCategory}
            />
          </label>
          <label>
            Total mínimo
            <input
              min="0"
              onChange={(event) => updateFilter("minTotal", event.target.value)}
              step="0.01"
              type="number"
              value={filters.minTotal}
            />
          </label>
          <label>
            Total máximo
            <input
              min="0"
              onChange={(event) => updateFilter("maxTotal", event.target.value)}
              step="0.01"
              type="number"
              value={filters.maxTotal}
            />
          </label>
          <label>
            Lote de importación
            <input
              onChange={(event) =>
                updateFilter("importBatchId", event.target.value)
              }
              value={filters.importBatchId}
            />
          </label>
        </div>
        <button
          className="secondary-button"
          onClick={() => setFilters(initialFilters)}
          type="button"
        >
          Limpiar filtros
        </button>
      </details>
      {error && (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        {loading ? (
          <p className="empty-state">Cargando cotizaciones…</p>
        ) : quotations.length ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Cotización</th>
                  <th>Cliente</th>
                  <th>Revisión</th>
                  <th>Fecha</th>
                  <th>Proyecto</th>
                  <th>Total</th>
                  <th>Pago</th>
                  <th>Fuente</th>
                </tr>
              </thead>
              <tbody>
                {quotations.map((quote) => (
                  <tr
                    className="clickable-row"
                    key={quote.id}
                    onClick={() => setSelectedId(quote.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(quote.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td data-label="Cotización">
                      <strong>{quote.quotationNumber}</strong>
                      <span>{quote.title}</span>
                    </td>
                    <td data-label="Cliente">
                      {quote.businessName}
                      <span>{quote.contactName}</span>
                    </td>
                    <td data-label="Revisión">
                      {quote.revisionLabel || "—"}
                      {quote.alternativeLabel
                        ? ` · ${quote.alternativeLabel}`
                        : ""}
                    </td>
                    <td data-label="Fecha">
                      {formatDate(quote.quotationDate)}
                    </td>
                    <td data-label="Proyecto">{quote.projectName || "—"}</td>
                    <td data-label="Total">
                      {amount(
                        quote.sourceTotal ?? quote.calculatedTotal,
                        quote.currency,
                      )}
                    </td>
                    <td data-label="Pago">
                      <span className={`status status-${quote.paymentStatus}`}>
                        {quote.paymentStatus || "unknown"}
                      </span>
                    </td>
                    <td data-label="Fuente">{quote.sourceFilename || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No hay cotizaciones normalizadas en esta vista." />
        )}
      </section>
    </>
  );
}

function QuotationForm({
  detail,
  businesses,
  contacts,
  projects,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  detail: QuotationDetail;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  projects: ProjectOption[];
  busy: boolean;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  const quote = detail.quotation;
  const revision = detail.revision;
  return (
    <form className="record-form" onSubmit={onSubmit}>
      <div className="form-heading">
        <h2>Editar cotización</h2>
        <button aria-label="Cerrar" onClick={onCancel} type="button">
          ×
        </button>
      </div>
      {error && (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      <input
        name="revisionId"
        type="hidden"
        value={String(revision?.id ?? "")}
      />
      <div className="form-grid">
        <label>
          Número
          <input
            defaultValue={quote.quotationNumber}
            name="quotationNumber"
            required
          />
        </label>
        <label>
          Año
          <input
            defaultValue={quote.quotationYear ?? ""}
            max="9999"
            min="1900"
            name="quotationYear"
            type="number"
          />
        </label>
        <label className="wide">
          Título
          <input defaultValue={quote.title} name="title" />
        </label>
        <label>
          Cliente
          <select defaultValue={quote.businessId} name="businessId" required>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contacto
          <select
            defaultValue={String(quote.primaryContactId ?? "")}
            name="primaryContactId"
          >
            <option value="">Sin contacto</option>
            {contacts.map((contact) => (
              <option key={contact.id} value={contact.id}>
                {contact.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Proyecto
          <select defaultValue={String(quote.projectId ?? "")} name="projectId">
            <option value="">Sin proyecto</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name} · {project.businessName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tipo
          <select defaultValue={quote.quotationType} name="quotationType">
            {["installation", "repair", "maintenance", "mixed", "other"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Servicio
          <input defaultValue={quote.serviceCategory} name="serviceCategory" />
        </label>
        <label>
          Estado
          <select defaultValue={quote.status} name="status">
            {[
              "draft",
              "sent",
              "accepted",
              "rejected",
              "expired",
              "cancelled",
              "unknown",
            ].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label>
          Moneda
          <input defaultValue={quote.currency} maxLength={8} name="currency" />
        </label>
        <label>
          Fecha
          <input
            defaultValue={String(revision?.quotationDate ?? "")}
            name="quotationDate"
            type="date"
          />
        </label>
        <label>
          Mes
          <input
            defaultValue={String(revision?.quotationMonth ?? "")}
            max="12"
            min="1"
            name="quotationMonth"
            type="number"
          />
        </label>
        <label>
          Etiqueta de revisión
          <input
            defaultValue={String(revision?.revisionLabel ?? "")}
            name="revisionLabel"
          />
        </label>
        <label>
          Alternativa
          <input
            defaultValue={String(revision?.alternativeLabel ?? "")}
            name="alternativeLabel"
          />
        </label>
        <label>
          Alcance
          <input
            defaultValue={String(revision?.scopeLabel ?? "")}
            name="scopeLabel"
          />
        </label>
        <label>
          Validez hasta
          <input
            defaultValue={String(revision?.validityUntil ?? "")}
            name="validityUntil"
            type="date"
          />
        </label>
        <label className="wide">
          Notas para el cliente
          <textarea
            defaultValue={String(revision?.customerFacingNotes ?? "")}
            name="customerFacingNotes"
            rows={3}
          />
        </label>
        <label className="wide">
          Notas internas
          <textarea
            defaultValue={String(revision?.internalNotes ?? "")}
            name="internalNotes"
            rows={3}
          />
        </label>
        <label className="wide">
          Motivo del cambio
          <input
            name="changeReason"
            placeholder="Obligatorio para trazabilidad operativa"
            required
          />
        </label>
      </div>
      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">
          Cancelar
        </button>
        <button className="primary-button" disabled={busy}>
          {busy ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </form>
  );
}

function ListTable({
  detail,
  currency,
}: {
  detail: QuotationDetail;
  currency: string;
}) {
  return (
    <section className="detail-card source-section">
      <h2>Partidas</h2>
      {detail.lineItems.length ? (
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Ubicación</th>
                <th>Cantidad</th>
                <th>Medidas</th>
                <th>Precio</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {detail.lineItems.map((item) => (
                <tr key={String(item.id)}>
                  <td data-label="Descripción">
                    <strong>{String(item.description)}</strong>
                    <span>{String(item.category || "")}</span>
                  </td>
                  <td data-label="Ubicación">{String(item.location || "—")}</td>
                  <td data-label="Cantidad">{displayNumber(item.quantity)}</td>
                  <td data-label="Medidas">{measurement(item)}</td>
                  <td data-label="Precio">
                    {amount(
                      item.unitPrice ?? item.pricePerSqm ?? item.flatFee,
                      String(item.currency || currency),
                    )}
                  </td>
                  <td data-label="Total">
                    {amount(
                      item.sourceLineTotal ?? item.calculatedLineTotal,
                      String(item.currency || currency),
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">No hay partidas normalizadas.</p>
      )}
    </section>
  );
}

function SourceRecordCard({
  record,
}: {
  record: NonNullable<QuotationDetail["sourceRecord"]>;
}) {
  const value = (item: string | number | null) =>
    item === null || item === "" ? "—" : String(item);
  return (
    <section className="detail-card source-section">
      <h2>Datos exactos del libro fuente</h2>
      <p className="muted">
        Registro {record.sourceRowNumber} · {record.sourceWorkbook}
      </p>
      <dl className="source-record-grid">
        <Field label="Fecha" value={value(record.sourceDate)} />
        <Field label="Mes" value={value(record.sourceMonth)} />
        <Field label="Año" value={value(record.sourceYear)} />
        <Field
          label="Cotización NO"
          value={value(record.sourceQuotationNumber)}
        />
        <Field label="Cliente" value={value(record.sourceCustomerName)} />
        <Field label="RNC" value={value(record.sourceRnc)} />
        <Field label="Contacto" value={value(record.sourceContact)} />
        <Field label="Teléfono" value={value(record.sourcePhone)} />
        <Field label="Celular" value={value(record.sourceMobilePhone)} />
        <Field label="Correo" value={value(record.sourceEmail)} />
        <Field label="Dirección" value={value(record.sourceAddress)} />
        <Field
          label="Dirección de Proyecto"
          value={value(record.sourceProjectAddress)}
        />
        <Field label="Archivo de Origen" value={value(record.sourceFilename)} />
      </dl>
      {record.sourceDocumentUri ? (
        <p>
          <a href={record.sourceDocumentUri} target="_blank" rel="noreferrer">
            Abrir documento fuente
          </a>
        </p>
      ) : (
        <p className="muted">Sin enlace al documento fuente.</p>
      )}
    </section>
  );
}

function SourceAndAudit({ detail }: { detail: QuotationDetail }) {
  return (
    <>
      {detail.warnings.length > 0 && (
        <section className="detail-card source-section">
          <h2>Advertencias de importación</h2>
          <div className="review-list">
            {detail.warnings.map((warning) => (
              <article key={String(warning.id)}>
                <span className={`status status-${warning.severity}`}>
                  {String(warning.severity)}
                </span>
                <div>
                  <strong>{String(warning.title)}</strong>
                  <p>
                    {String(warning.detail || warning.sourceLocation || "")}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <section className="detail-grid">
        <ListCard
          title="Documentos fuente"
          rows={detail.documents}
          render={(item) =>
            `${String(item.name)} · ${formatBytes(Number(item.size || 0))}`
          }
          link={(item) =>
            `/api/documents/${encodeURIComponent(String(item.id))}`
          }
        />
        <ListCard
          title="Metadatos de importación"
          rows={detail.sourceReferences}
          render={(item) =>
            `${String(item.originalFilename || "Fuente")} · ${String(item.sourceOrigin || "origen desconocido")} · fila ${String(item.sourceRowNumber || "—")} · ${String(item.importOutcome || item.availability)}`
          }
          link={(item) => {
            const uri = String(item.originalUri || "");
            return /^https?:\/\//i.test(uri) ? uri : "";
          }}
        />
        <ListCard
          title="Historial de revisiones"
          rows={detail.revisions}
          render={(item) =>
            `${String(item.revisionLabel || `Revisión ${item.revisionNumber}`)}${item.alternativeLabel ? ` · ${item.alternativeLabel}` : ""} · ${formatDate(item.quotationDate)}`
          }
        />
        <ListCard
          title="Auditoría"
          rows={detail.history}
          render={(item) =>
            `${String(item.action)} · ${String(item.actorEmail)} · ${dateTime(String(item.createdAt))}`
          }
        />
      </section>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ListCard({
  title,
  rows,
  render,
  link,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  render(item: Record<string, unknown>): string;
  link?: (item: Record<string, unknown>) => string;
}) {
  return (
    <article className="detail-card">
      <h2>{title}</h2>
      {rows.length ? (
        <ul className="history-list">
          {rows.map((item, index) => {
            const href = link?.(item);
            return (
              <li key={String(item.id ?? item.createdAt ?? index)}>
                {href ? (
                  <a href={href}>{render(item)}</a>
                ) : (
                  <span>{render(item)}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">Sin registros.</p>
      )}
    </article>
  );
}

function termsRows(terms: Record<string, unknown> | null) {
  if (!terms) return [];
  const labels: Record<string, string> = {
    quotationValidity: "Validez",
    paymentConditions: "Condiciones de pago",
    warranty: "Garantía",
    returnPolicy: "Devoluciones",
    installationObservations: "Instalación",
    maintenanceDisclaimer: "Mantenimiento",
    unforeseenPartsDisclaimer: "Piezas no previstas",
    additionalCostNotice: "Costos adicionales",
  };
  return Object.entries(labels)
    .filter(([key]) => Boolean(terms[key]))
    .map(([key, label]) => ({ id: key, label, value: terms[key] }));
}

function amount(value: unknown, currency: string) {
  return typeof value === "number" && Number.isFinite(value)
    ? money(value, currency || "DOP")
    : "—";
}

function displayNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Intl.NumberFormat("es-DO", { maximumFractionDigits: 3 }).format(value)
    : "—";
}

function formatDate(value: unknown) {
  if (!value) return "—";
  const date = new Date(
    String(value).includes("T") ? String(value) : `${value}T00:00:00`,
  );
  return Number.isNaN(date.getTime())
    ? String(value)
    : formatBusinessDate(date, { dateStyle: "medium" });
}

function monthName(value: unknown) {
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) return "—";
  return formatBusinessDate(new Date(Date.UTC(2020, month - 1, 1, 12)), {
    month: "long",
  });
}

function measurement(item: Record<string, unknown>) {
  if (typeof item.areaSqm === "number")
    return `${displayNumber(item.areaSqm)} m²`;
  if (
    typeof item.finishedWidthCm === "number" ||
    typeof item.finishedHeightCm === "number"
  ) {
    return `${displayNumber(item.finishedWidthCm)} × ${displayNumber(item.finishedHeightCm)} cm`;
  }
  if (
    typeof item.openingWidthCm === "number" ||
    typeof item.openingHeightCm === "number"
  ) {
    return `${displayNumber(item.openingWidthCm)} × ${displayNumber(item.openingHeightCm)} cm`;
  }
  return "—";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
