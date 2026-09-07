"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { BusinessRow, ContactRow } from "./types";
import { RecordAiPanel } from "./record-ai-panel";
import {
  ActiveFilterChip,
  AutocompleteInput,
  Empty,
  FilterableStatus,
  LoadingState,
  Modal,
  PageHeader,
  PageSizeControl,
  Pagination,
  SortHeader,
  dateTime,
  usePagination,
  useUrlState,
} from "./ui";

type ProjectSummary = {
  id: string;
  name: string;
  description: string;
  projectType: string;
  serviceCategory: string;
  status: string;
  notes: string;
  businessId: string;
  businessName: string;
  primaryContactId: string | null;
  contactName: string | null;
  projectAddress: string | null;
  building: string | null;
  apartment: string | null;
  floor: string | null;
  area: string | null;
  room: string | null;
  balcony: string | null;
  ownerEmail: string;
  updatedAt: string;
  quotationCount: number;
};

type ProjectDetail = {
  project: ProjectSummary;
  contacts: Array<Record<string, unknown>>;
  locations: Array<Record<string, unknown>>;
  quotations: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
};

const projectStatusLabels: Record<string, string> = {
  active: "Activo",
  planned: "Planificado",
  on_hold: "En pausa",
  completed: "Completado",
  cancelled: "Cancelado",
};

export function ProjectsView({
  businesses,
  contacts,
  canWrite,
  canAskAi,
  canProposeAi,
  canApproveAi,
  currentUserEmail,
  selectedId,
  setSelectedId,
  setMessage,
}: {
  businesses: BusinessRow[];
  contacts: ContactRow[];
  canWrite: boolean;
  canAskAi: boolean;
  canProposeAi: boolean;
  canApproveAi: boolean;
  currentUserEmail: string;
  selectedId: string | null;
  setSelectedId(value: string | null): void;
  setMessage(value: string): void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [query, setQuery] = useUrlState("q");
  const [status, setStatus] = useUrlState("status");
  const [sort, setSort] = useUrlState("sort", "updated");
  const [direction, setDirection] = useUrlState("dir", "desc");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ProjectSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const rows = useMemo(() => {
    const multiplier = direction === "desc" ? -1 : 1;
    return projects.toSorted((left, right) => {
      const leftValue = sort === "business" ? left.businessName : sort === "contact" ? (left.contactName ?? "") : sort === "status" ? left.status : sort === "quotes" ? left.quotationCount : sort === "updated" ? left.updatedAt : left.name;
      const rightValue = sort === "business" ? right.businessName : sort === "contact" ? (right.contactName ?? "") : sort === "status" ? right.status : sort === "quotes" ? right.quotationCount : sort === "updated" ? right.updatedAt : right.name;
      if (typeof leftValue === "number" && typeof rightValue === "number") return multiplier * (leftValue - rightValue);
      return multiplier * String(leftValue).localeCompare(String(rightValue), "es", { sensitivity: "base" });
    });
  }, [direction, projects, sort]);
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

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (status) params.set("status", status);
    const response = await fetch(`/api/projects?${params}`);
    const result = (await response.json()) as {
      projects?: ProjectSummary[];
      error?: string;
    };
    setLoading(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudieron cargar los proyectos.");
      return;
    }
    setProjects(result.projects ?? []);
    setError("");
  }, [query, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadProjects(), 200);
    return () => window.clearTimeout(timer);
  }, [loadProjects]);

  useEffect(() => {
    if (!selectedId) {
      const timer = window.setTimeout(() => setDetail(null), 0);
      return () => window.clearTimeout(timer);
    }
    const controller = new AbortController();
    void fetch(`/api/projects/${encodeURIComponent(selectedId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as ProjectDetail & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "No se pudo cargar el proyecto.");
        }
        setDetail(result);
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setError((reason as Error).message);
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  const editingBusinessId = editing?.businessId;
  const filteredContacts = contacts.filter(
    (contact) => !editingBusinessId || contact.businessId === editingBusinessId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    const response = await fetch(
      editing ? `/api/projects/${editing.id}` : "/api/projects",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as {
      project?: { id: string };
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.project) {
      setError(result.error ?? "No se pudo guardar el proyecto.");
      return;
    }
    setShowForm(false);
    setEditing(null);
    await loadProjects();
    setSelectedId(result.project.id);
    setMessage("Proyecto guardado.");
  }

  if (selectedId && detail) {
    const project = detail.project;
    const location = detail.locations[0] ?? {};
    return (
      <>
        <div className="breadcrumbs">
          <span>Inicio</span>
          <i>/</i>
          <button onClick={() => setSelectedId(null)} type="button">
            Proyectos
          </button>
          <i>/</i>
          <span aria-current="page">{project.name}</span>
        </div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Proyecto normalizado</p>
            <h1>{project.name}</h1>
            <p>{project.businessName}</p>
          </div>
          {canWrite && (
            <button
              className="primary-button"
              onClick={() => {
                setEditing(project);
                setShowForm(true);
              }}
              type="button"
            >
              Editar proyecto
            </button>
          )}
        </div>
        <RecordAiPanel canApprove={canApproveAi} canAsk={canAskAi} canPropose={canProposeAi} entityId={project.id} entityType="project" title={project.name} />
        {error && (
          <div className="inline-alert" role="alert">
            {error}
          </div>
        )}
        <section className="detail-grid">
          <article className="detail-card">
            <h2>Resumen</h2>
            <dl>
              <Field label="Cliente" value={project.businessName} />
              <Field
                label="Contacto principal"
                value={project.contactName || "—"}
              />
              <Field label="Tipo" value={project.projectType || "—"} />
              <Field label="Servicio" value={project.serviceCategory || "—"} />
              <Field label="Estado" value={project.status} />
              <Field
                label="Cotizaciones"
                value={String(project.quotationCount)}
              />
              <Field label="Actualizado" value={dateTime(project.updatedAt)} />
            </dl>
            {project.description && <p>{project.description}</p>}
            {project.notes && <p className="detail-notes">{project.notes}</p>}
          </article>
          <article className="detail-card">
            <h2>Dirección y ubicación</h2>
            <dl>
              <Field
                label="Dirección de proyecto"
                value={String(
                  location.projectAddress || project.projectAddress || "—",
                )}
              />
              <Field
                label="Edificio"
                value={String(location.building || "—")}
              />
              <Field
                label="Apartamento"
                value={String(location.apartment || "—")}
              />
              <Field label="Piso" value={String(location.floor || "—")} />
              <Field label="Área" value={String(location.area || "—")} />
              <Field label="Habitación" value={String(location.room || "—")} />
              <Field label="Balcón" value={String(location.balcony || "—")} />
            </dl>
          </article>
        </section>
        <section className="business-related-grid">
          <Related
            title="Contactos"
            rows={detail.contacts}
            render={(item) =>
              `${item.name}${item.role ? ` · ${item.role}` : ""}`
            }
          />
          <Related
            title="Cotizaciones"
            rows={detail.quotations}
            render={(item) => `${item.quotationNumber} · ${item.status}`}
            href={(item) =>
              `/app?view=quotations&record=${encodeURIComponent(String(item.id))}`
            }
          />
          <Related
            title="Documentos fuente"
            rows={detail.documents}
            render={(item) =>
              String(item.originalFilename || item.name || "Referencia")
            }
          />
          <Related
            title="Historial"
            rows={detail.history}
            render={(item) =>
              `${item.action} · ${dateTime(String(item.createdAt))}`
            }
          />
        </section>
        {showForm && (
          <Modal
            onClose={() => setShowForm(false)}
            title={editing ? "Editar proyecto" : "Nuevo proyecto"}
            wide
          >
            <ProjectForm
              businesses={businesses}
              busy={busy}
              contacts={filteredContacts}
              currentUserEmail={currentUserEmail}
              error={error}
              onCancel={() => setShowForm(false)}
              onSubmit={submit}
              project={editing}
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">Proyectos</span>
      </div>
      <PageHeader
        action={canWrite ? (
          <button
            className="primary-button"
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
            type="button"
          >
            Nuevo proyecto
          </button>
        ) : undefined}
        description="Clientes, contactos, ubicaciones y cotizaciones relacionadas."
        eyebrow="Operaciones"
        title="Proyectos"
      />
      <div className="toolbar toolbar-filters">
        <AutocompleteInput
          ariaLabel="Buscar proyectos"
          onChange={(value) => { setQuery(value); setPage(1); }}
          onSelect={(option) => { setQuery(option.label); setPage(1); }}
          options={projects.slice(0, 8).map((project) => ({ id: project.id, label: project.name, secondary: project.businessName }))}
          placeholder="Escribe un proyecto, cliente o dirección…"
          value={query}
        />
        <select
          aria-label="Filtrar estado"
          onChange={(event) => { setStatus(event.target.value); setPage(1); }}
          value={status}
        >
          <option value="">Todos los estados</option>
          {["active", "planned", "on_hold", "completed", "cancelled"].map(
            (value) => (
              <option key={value} value={value}>{projectStatusLabels[value]}</option>
            ),
          )}
        </select>
        <PageSizeControl label="Proyectos por página" onChange={(value) => { setPageSizeValue(value); setPage(1); }} value={pageSizeValue} />
        <span className="record-count"><strong>{rows.length}</strong> proyectos</span>
      </div>
      {status && <div className="active-filter-row"><ActiveFilterChip label={`Estado: ${projectStatusLabels[status] ?? status}`} onClear={() => { setStatus(""); setPage(1); }} /></div>}
      {error && (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      {showForm && (
        <Modal
          onClose={() => setShowForm(false)}
          title={editing ? "Editar proyecto" : "Nuevo proyecto"}
          wide
        >
          <ProjectForm
            businesses={businesses}
            busy={busy}
            contacts={contacts}
            currentUserEmail={currentUserEmail}
            error={error}
            onCancel={() => setShowForm(false)}
            onSubmit={submit}
            project={editing}
          />
        </Modal>
      )}
      <section className="panel">
        {loading ? (
          <LoadingState text="Cargando proyectos…" />
        ) : rows.length ? (
          <div className="table-wrap">
            <table className="responsive-table collection-table projects-table">
              <thead>
                <tr>
                  <th><SortHeader column="name" direction={direction as "asc" | "desc"} label="Proyecto" onSort={sortBy} sort={sort} /></th>
                  <th><SortHeader column="business" direction={direction as "asc" | "desc"} label="Cliente" onSort={sortBy} sort={sort} /></th>
                  <th><SortHeader column="contact" direction={direction as "asc" | "desc"} label="Contacto" onSort={sortBy} sort={sort} /></th>
                  <th>Dirección</th>
                  <th>Servicio</th>
                  <th><SortHeader column="status" direction={direction as "asc" | "desc"} label="Estado" onSort={sortBy} sort={sort} /></th>
                  <th><SortHeader column="quotes" direction={direction as "asc" | "desc"} label="Cotizaciones" onSort={sortBy} sort={sort} /></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((project) => (
                  <tr
                    className="clickable-row"
                    key={project.id}
                    onClick={() => setSelectedId(project.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(project.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td data-label="Proyecto">
                      <strong title={project.name}>{project.name}</strong>
                      <span>{project.projectType}</span>
                    </td>
                    <td data-label="Cliente">{project.businessName}</td>
                    <td data-label="Contacto">{project.contactName || "—"}</td>
                    <td data-label="Dirección">
                      {project.projectAddress || "—"}
                    </td>
                    <td data-label="Servicio">
                      {project.serviceCategory || "—"}
                    </td>
                    <td data-label="Estado">
                      <FilterableStatus className={`status-${project.status}`} label={projectStatusLabels[project.status] ?? project.status} onFilter={() => { setStatus(project.status); setPage(1); }} />
                    </td>
                    <td data-label="Cotizaciones">{project.quotationCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No hay proyectos normalizados." />
        )}
        <Pagination onPageChange={setPage} page={page} totalPages={totalPages} />
      </section>
    </>
  );
}

function ProjectForm({
  project,
  businesses,
  contacts,
  currentUserEmail,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  project: ProjectSummary | null;
  businesses: BusinessRow[];
  contacts: ContactRow[];
  currentUserEmail: string;
  busy: boolean;
  error: string;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  return (
    <form className="record-form" onSubmit={onSubmit}>
      {error && (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      <div className="form-grid">
        <label className="wide">
          Proyecto
          <input defaultValue={project?.name} name="name" required />
        </label>
        <label>
          Cliente
          <select defaultValue={project?.businessId} name="businessId" required>
            <option value="">Selecciona</option>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Contacto principal
          <select
            defaultValue={project?.primaryContactId ?? ""}
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
          Tipo de proyecto
          <input defaultValue={project?.projectType} name="projectType" />
        </label>
        <label>
          Categoría de servicio
          <input
            defaultValue={project?.serviceCategory}
            name="serviceCategory"
          />
        </label>
        <label>
          Estado
          <select defaultValue={project?.status ?? "active"} name="status">
            {["active", "planned", "on_hold", "completed", "cancelled"].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </select>
        </label>
        <label className="wide">
          Descripción
          <textarea
            defaultValue={project?.description}
            name="description"
            rows={3}
          />
        </label>
        <label className="wide">
          Dirección de proyecto
          <input
            defaultValue={project?.projectAddress ?? ""}
            name="projectAddress"
          />
        </label>
        <label>
          Edificio
          <input defaultValue={project?.building ?? ""} name="building" />
        </label>
        <label>
          Apartamento
          <input defaultValue={project?.apartment ?? ""} name="apartment" />
        </label>
        <label>
          Piso
          <input defaultValue={project?.floor ?? ""} name="floor" />
        </label>
        <label>
          Área
          <input defaultValue={project?.area ?? ""} name="area" />
        </label>
        <label>
          Habitación
          <input defaultValue={project?.room ?? ""} name="room" />
        </label>
        <label>
          Balcón
          <input defaultValue={project?.balcony ?? ""} name="balcony" />
        </label>
        <label>
          Responsable
          <input
            defaultValue={project?.ownerEmail ?? currentUserEmail}
            name="ownerEmail"
            type="email"
          />
        </label>
        <label className="wide">
          Notas
          <textarea defaultValue={project?.notes} name="notes" rows={3} />
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function Related({
  title,
  rows,
  render,
  href,
}: {
  title: string;
  rows: Array<Record<string, unknown>>;
  render(item: Record<string, unknown>): string;
  href?: (item: Record<string, unknown>) => string;
}) {
  return (
    <article className="detail-card">
      <h2>{title}</h2>
      {rows.length ? (
        <ul className="history-list">
          {rows.map((row, index) => (
            <li key={String(row.id ?? index)}>
              {href ? <a href={href(row)}>{render(row)}</a> : render(row)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Sin registros.</p>
      )}
    </article>
  );
}
