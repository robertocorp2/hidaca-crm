"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { ActivityRow, BusinessRow, ContactRow } from "./types";
import {
  Breadcrumbs,
  DocumentRow,
  EmptyState,
  ErrorState,
  InlineAlert,
  LoadingState,
  Modal,
  OverflowMenu,
  PageHeader,
  Pagination,
  RecordActions,
  RecordField,
  RecordHeader,
  RelatedListItem,
  RelatedTabs,
  SectionCard,
  dateTime,
  money,
  useFormGuard,
  usePagination,
  useUrlState,
} from "./ui";

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "—";
}

function hrefFor(value: string, scheme: "mailto" | "tel") {
  return value ? `${scheme}:${value.replace(/\s+/g, "")}` : undefined;
}

type SharedProps = {
  canWrite: boolean;
  currentUserEmail: string;
  activities: ActivityRow[];
  onOpenActivity(id: string): void;
  setMessage(message: string): void;
};

export function BusinessesView({
  businesses,
  setBusinesses,
  selectedId,
  setSelectedId,
  ...shared
}: SharedProps & {
  businesses: BusinessRow[];
  setBusinesses(value: BusinessRow[]): void;
  selectedId: string | null;
  setSelectedId(value: string | null): void;
}) {
  const [search, setSearch] = useUrlState("q");
  const [sort, setSort] = useUrlState("sort", "name");
  const [editing, setEditing] = useState<BusinessRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const selected = businesses.find((item) => item.id === selectedId) ?? null;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return businesses
      .filter((business) =>
        `${business.name} ${business.rnc} ${business.email} ${business.phone} ${business.mobilePhone} ${business.address}`
          .toLowerCase()
          .includes(term),
      )
      .toSorted((left, right) =>
        sort === "recent"
          ? right.updatedAt.localeCompare(left.updatedAt)
          : left.name.localeCompare(right.name),
      );
  }, [businesses, search, sort]);
  const { page, pageItems, setPage, totalPages } = usePagination(rows);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const payload: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    if (duplicateWarning) payload.confirmDuplicate = true;
    const response = await fetch(
      editing ? `/api/businesses/${editing.id}` : "/api/businesses",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as {
      business?: BusinessRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.business) {
      const error = result.error ?? "No se pudo guardar la empresa.";
      setDuplicateWarning(response.status === 409);
      setFormError(error);
      shared.setMessage(error);
      return;
    }
    const next = editing
      ? businesses.map((item) =>
          item.id === result.business!.id ? result.business! : item,
        )
      : [result.business, ...businesses];
    setBusinesses(next);
    setSelectedId(result.business.id);
    setShowForm(false);
    setEditing(null);
    setFormError("");
    setDuplicateWarning(false);
    shared.setMessage("Empresa guardada.");
  }

  async function archiveSelected() {
    if (!selected || !window.confirm(`¿Archivar la empresa “${selected.name}”?`)) return;
    const response = await fetch(`/api/businesses/${encodeURIComponent(selected.id)}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      shared.setMessage(result.error ?? "No se pudo archivar la empresa.");
      return;
    }
    setBusinesses(businesses.filter((item) => item.id !== selected.id));
    setSelectedId(null);
    shared.setMessage("Empresa archivada.");
  }

  if (selected) {
    const related = shared.activities.filter(
      (activity) =>
        activity.relatedType === "business" &&
        activity.relatedId === selected.id,
    );
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            { label: "Empresas", onClick: () => setSelectedId(null) },
            { label: selected.name },
          ]}
        />
        <RecordHeader
          avatar={initials(selected.name)}
          eyebrow="Empresa"
          subtitle={selected.email || selected.phone || "Ficha comercial"}
          title={selected.name}
          actions={
            <RecordActions>
              {shared.canWrite && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setEditing(selected);
                    setFormError("");
                    setShowForm(true);
                  }}
                  type="button"
                >
                  Editar empresa
                </button>
              )}
              <OverflowMenu
                items={[
                  {
                    danger: true,
                    label: "Archivar empresa",
                    onSelect: () => void archiveSelected(),
                    disabled: !shared.canWrite,
                  },
                ]}
              />
            </RecordActions>
          }
        />
        <div className="detail-grid">
          <SectionCard title="Información de la empresa" description="Datos de identidad, contacto y responsabilidad.">
            <dl className="record-fields">
              <RecordField label="Nombre" value={selected.name} />
              <RecordField label="Tipo" value={selected.customerType === "individual" ? "Persona" : "Organización"} />
              <RecordField label="RNC o cédula" value={selected.rnc} />
              <RecordField label="Correo" href={hrefFor(selected.email, "mailto")} value={selected.email} />
              <RecordField label="Teléfono" href={hrefFor(selected.phone, "tel")} value={selected.phone} />
              <RecordField label="Celular" href={hrefFor(selected.mobilePhone, "tel")} value={selected.mobilePhone} />
              <RecordField label="Dirección" value={selected.address} />
              <RecordField label="Responsable" value={selected.ownerEmail} />
              <RecordField label="Actualizado" value={dateTime(selected.updatedAt)} />
            </dl>
            {selected.notes && <p className="detail-notes">{selected.notes}</p>}
          </SectionCard>
          <SectionCard title="Actividad" description="Seguimiento registrado en el CRM.">
            {related.length ? (
              <ul className="activity-mini-list">
                {related.map((activity) => (
                  <li key={activity.id}>
                    <button onClick={() => shared.onOpenActivity(activity.id)} type="button">
                      <strong>{activity.title}</strong>
                      <span>{dateTime(activity.startAt, true)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sin actividad" description="Todavía no hay actividades relacionadas con esta empresa." />
            )}
          </SectionCard>
        </div>
        <BusinessRelatedSections businessId={selected.id} />
        {showForm && (
          <Modal
            description="Completa los datos comerciales y guarda para actualizar la ficha."
            onClose={() => setShowForm(false)}
            title={editing ? "Editar empresa" : "Nueva empresa"}
            wide
          >
            <BusinessForm
              business={editing}
              busy={busy}
              currentUserEmail={shared.currentUserEmail}
              error={formError}
              duplicateWarning={duplicateWarning}
              onCancel={() => setShowForm(false)}
              onSubmit={submit}
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio" }, { label: "Empresas" }]} />
      <PageHeader
        description="Organizaciones y clientes comerciales."
        eyebrow="CRM"
        title="Empresas"
        actions={
          shared.canWrite && (
            <button
              className="primary-button"
              onClick={() => {
                setEditing(null);
                setFormError("");
                setShowForm(true);
              }}
              type="button"
            >
              Nueva empresa
            </button>
          )
        }
      />
      <div className="toolbar toolbar-filters">
        <input
          aria-label="Buscar empresas"
          autoComplete="off"
          name="q"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por empresa, correo o teléfono…"
          value={search}
        />
        <select
          aria-label="Ordenar empresas"
          onChange={(event) => setSort(event.target.value)}
          value={sort}
        >
          <option value="name">Nombre de la empresa</option>
          <option value="recent">Actualizados recientemente</option>
        </select>
        <span>{rows.length} empresas</span>
      </div>
      {showForm && (
        <Modal
          description="Completa los datos comerciales y guarda para crear la ficha."
          onClose={() => setShowForm(false)}
          title={editing ? "Editar empresa" : "Nueva empresa"}
          wide
        >
          <BusinessForm
            business={editing}
            busy={busy}
            currentUserEmail={shared.currentUserEmail}
            error={formError}
            duplicateWarning={duplicateWarning}
            onCancel={() => setShowForm(false)}
            onSubmit={submit}
          />
        </Modal>
      )}
      <section className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Correo</th>
                  <th>Teléfono</th>
                  <th>Responsable</th>
                  <th>Actualización</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((business) => (
                  <tr
                    className="clickable-row"
                    key={business.id}
                    onClick={() => setSelectedId(business.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(business.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td data-label="Empresa">
                      <strong>{business.name}</strong>
                      <span>{business.address}</span>
                    </td>
                    <td data-label="Correo">{business.email || "—"}</td>
                    <td data-label="Teléfono">{business.phone || "—"}</td>
                    <td data-label="Responsable">{business.ownerEmail}</td>
                    <td data-label="Actualización">{dateTime(business.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No hay empresas en esta vista."
            title="Sin empresas"
            action={
              shared.canWrite ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    setEditing(null);
                    setFormError("");
                    setShowForm(true);
                  }}
                  type="button"
                >
                  Nueva empresa
                </button>
              ) : undefined
            }
          />
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </section>
    </>
  );
}

function BusinessRelatedSections({ businessId }: { businessId: string }) {
  const [data, setData] = useState<Record<
    string,
    Array<Record<string, unknown>>
  > | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState("contacts");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/businesses/${encodeURIComponent(businessId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as Record<string, unknown> & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(
            result.error ?? "No se pudieron cargar las relaciones.",
          );
        setData({
          contacts: (result.contacts as Array<Record<string, unknown>>) ?? [],
          addresses: (result.addresses as Array<Record<string, unknown>>) ?? [],
          projects: (result.projects as Array<Record<string, unknown>>) ?? [],
          opportunities:
            (result.opportunities as Array<Record<string, unknown>>) ?? [],
          invoices: (result.invoices as Array<Record<string, unknown>>) ?? [],
          quotations:
            (result.quotations as Array<Record<string, unknown>>) ?? [],
          payments: (result.payments as Array<Record<string, unknown>>) ?? [],
          documents: (result.documents as Array<Record<string, unknown>>) ?? [],
          history: (result.history as Array<Record<string, unknown>>) ?? [],
        });
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError")
          setError((reason as Error).message);
      });
    return () => controller.abort();
  }, [businessId, reload]);
  if (error) return <ErrorState message={error} onRetry={() => { setError(""); setReload((value) => value + 1); }} />;
  if (!data) return <LoadingState text="Cargando relaciones de la empresa…" />;
  const items = [
    { key: "contacts", label: "Contactos", count: data.contacts.length },
    { key: "projects", label: "Proyectos", count: data.projects.length },
    { key: "opportunities", label: "Oportunidades", count: data.opportunities.length },
    { key: "invoices", label: "Facturas", count: data.invoices.length },
    { key: "quotations", label: "Cotizaciones", count: data.quotations.length },
    { key: "addresses", label: "Direcciones", count: data.addresses.length },
    { key: "payments", label: "Pagos", count: data.payments.length },
    { key: "documents", label: "Documentos", count: data.documents.length },
    { key: "history", label: "Historial", count: data.history.length },
  ];
  const renderRows = () => {
    if (active === "documents") {
      return data.documents.length ? (
        <div className="document-list">
          {data.documents.slice(0, 12).map((item, index) => (
            <DocumentRow
              contentType={String(item.contentType || "")}
              href={`/api/documents/${encodeURIComponent(String(item.id))}`}
              key={String(item.id ?? index)}
              name={String(item.name || "Documento")}
              size={typeof item.size === "number" ? item.size : undefined}
            />
          ))}
        </div>
      ) : <EmptyState title="Sin documentos" description="No hay documentos asociados a esta empresa." />;
    }
    const rows = data[active as keyof typeof data] as Array<Record<string, unknown>>;
    if (!rows?.length) return <EmptyState title="Sin registros" description="No hay información relacionada para mostrar." />;
    const render = active === "contacts"
      ? (item: Record<string, unknown>) => `${item.name}${item.email ? ` · ${item.email}` : ""}`
      : active === "projects"
        ? (item: Record<string, unknown>) => `${item.name} · ${item.status}`
        : active === "opportunities"
          ? (item: Record<string, unknown>) => `${item.title} · ${item.stage}`
          : active === "invoices"
            ? (item: Record<string, unknown>) => `${item.invoiceNumber || "Factura"} · ${item.status || ""}`
            : active === "quotations"
              ? (item: Record<string, unknown>) => `${item.quotationNumber} · ${item.title}`
              : active === "history"
                ? (item: Record<string, unknown>) => `${item.action} · ${dateTime(String(item.createdAt))}`
                : active === "payments"
                  ? (item: Record<string, unknown>) => `${item.label || item.type} · ${typeof item.amount === "number" ? money(item.amount, String(item.currency || "DOP")) : "—"}`
                  : (item: Record<string, unknown>) => `${item.label || item.type}: ${item.line1 || ""}`;
    return <ul className="related-list">{rows.slice(0, 12).map((item, index) => <RelatedListItem key={String(item.id ?? index)} title={render(item)} />)}</ul>;
  };
  return (
    <SectionCard title="Información relacionada" description="Relaciones existentes en el sistema.">
      <RelatedTabs active={active} items={items} onChange={setActive} />
      <div className="related-tab-panel">{renderRows()}</div>
    </SectionCard>
  );
}

function BusinessForm({
  business,
  busy,
  currentUserEmail,
  error,
  duplicateWarning,
  onSubmit,
  onCancel,
}: {
  business: BusinessRow | null;
  busy: boolean;
  currentUserEmail: string;
  error: string;
  duplicateWarning: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  const { formProps, requestCancel } = useFormGuard(onCancel);
  return (
    <form {...formProps} className="record-form" onSubmit={onSubmit}>
      <InlineAlert message={error} />
      {duplicateWarning && (
        <p className="inline-warning">
          Revisa la coincidencia. Si confirmas que es otro cliente, vuelve a
          guardar para conservar ambos registros.
        </p>
      )}
      <div className="form-grid">
        <label className="wide">
          Nombre de la empresa
          <input
            autoComplete="organization"
            defaultValue={business?.name}
            name="name"
            required
          />
        </label>
        <label>
          Tipo de cliente
          <select
            defaultValue={business?.customerType ?? "organization"}
            name="customerType"
          >
            <option value="organization">Organización</option>
            <option value="individual">Persona</option>
          </select>
        </label>
        <label>
          RNC o cédula
          <input defaultValue={business?.rnc} inputMode="numeric" name="rnc" />
        </label>
        <label>
          Correo
          <input
            autoComplete="email"
            defaultValue={business?.email}
            name="email"
            spellCheck={false}
            type="email"
          />
        </label>
        <label>
          Teléfono
          <input
            autoComplete="tel"
            defaultValue={business?.phone}
            inputMode="tel"
            name="phone"
            type="tel"
          />
        </label>
        <label>
          Celular
          <input
            autoComplete="tel"
            defaultValue={business?.mobilePhone}
            inputMode="tel"
            name="mobilePhone"
            type="tel"
          />
        </label>
        <label className="wide">
          Dirección
          <input
            autoComplete="street-address"
            defaultValue={business?.address}
            name="address"
          />
        </label>
        <label>
          Responsable
          <input
            autoComplete="email"
            defaultValue={business?.ownerEmail ?? currentUserEmail}
            name="ownerEmail"
            spellCheck={false}
            type="email"
            required
          />
        </label>
        <label className="wide">
          Notas
          <textarea defaultValue={business?.notes} name="notes" rows={4} />
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

export function ContactsView({
  contacts,
  setContacts,
  businesses,
  selectedId,
  setSelectedId,
  ...shared
}: SharedProps & {
  contacts: ContactRow[];
  setContacts(value: ContactRow[]): void;
  businesses: BusinessRow[];
  selectedId: string | null;
  setSelectedId(value: string | null): void;
}) {
  const [search, setSearch] = useUrlState("q");
  const [businessFilter, setBusinessFilter] = useUrlState("business");
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const selected = contacts.find((item) => item.id === selectedId) ?? null;
  const rows = contacts
    .filter(
      (contact) =>
        (!businessFilter || contact.businessId === businessFilter) &&
        `${contact.name} ${contact.email} ${contact.phone} ${contact.mobilePhone} ${contact.title}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
    )
    .toSorted((left, right) => left.name.localeCompare(right.name));
  const { page, pageItems, setPage, totalPages } = usePagination(rows);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const payload: Record<string, unknown> = Object.fromEntries(
      new FormData(event.currentTarget),
    );
    if (duplicateWarning) payload.confirmDuplicate = true;
    const response = await fetch(
      editing ? `/api/contacts/${editing.id}` : "/api/contacts",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    const result = (await response.json()) as {
      contact?: ContactRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.contact) {
      const error = result.error ?? "No se pudo guardar el contacto.";
      setDuplicateWarning(response.status === 409);
      setFormError(error);
      shared.setMessage(error);
      return;
    }
    setContacts(
      editing
        ? contacts.map((item) =>
            item.id === result.contact!.id ? result.contact! : item,
          )
        : [result.contact, ...contacts],
    );
    setSelectedId(result.contact.id);
    setShowForm(false);
    setEditing(null);
    setFormError("");
    setDuplicateWarning(false);
    shared.setMessage("Contacto guardado.");
  }

  async function archiveSelected() {
    if (!selected || !window.confirm(`¿Archivar el contacto “${selected.name}”?`)) return;
    const response = await fetch(`/api/contacts/${encodeURIComponent(selected.id)}`, {
      method: "DELETE",
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok) {
      shared.setMessage(result.error ?? "No se pudo archivar el contacto.");
      return;
    }
    setContacts(contacts.filter((item) => item.id !== selected.id));
    setSelectedId(null);
    shared.setMessage("Contacto archivado.");
  }

  if (selected) {
    const business = businesses.find((item) => item.id === selected.businessId);
    const related = shared.activities.filter(
      (activity) =>
        activity.relatedType === "contact" &&
        activity.relatedId === selected.id,
    );
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            { label: "Contactos", onClick: () => setSelectedId(null) },
            { label: selected.name },
          ]}
        />
        <RecordHeader
          avatar={initials(selected.name)}
          eyebrow="Contacto"
          subtitle={selected.title || business?.name || "Ficha de contacto"}
          title={selected.name}
          actions={
            <RecordActions>
              {shared.canWrite && (
                <button
                  className="primary-button"
                  onClick={() => {
                    setEditing(selected);
                    setFormError("");
                    setShowForm(true);
                  }}
                  type="button"
                >
                  Editar contacto
                </button>
              )}
              <OverflowMenu
                items={[{
                  danger: true,
                  label: "Archivar contacto",
                  onSelect: () => void archiveSelected(),
                  disabled: !shared.canWrite,
                }]}
              />
            </RecordActions>
          }
        />
        <div className="detail-grid">
          <SectionCard title="Información del contacto" description="Datos personales, empresa y responsabilidad.">
            <dl className="record-fields">
              <RecordField label="Nombre" value={selected.name} />
              <RecordField
                label="Empresa"
                href={business ? `/app?view=businesses&record=${encodeURIComponent(business.id)}` : undefined}
                value={business?.name}
              />
              <RecordField label="Correo" href={hrefFor(selected.email, "mailto")} value={selected.email} />
              <RecordField label="Teléfono" href={hrefFor(selected.phone, "tel")} value={selected.phone} />
              <RecordField label="Celular" href={hrefFor(selected.mobilePhone, "tel")} value={selected.mobilePhone} />
              <RecordField label="Responsable" value={selected.ownerEmail} />
              <RecordField label="Actualizado" value={dateTime(selected.updatedAt)} />
            </dl>
            {selected.notes && <p className="detail-notes">{selected.notes}</p>}
          </SectionCard>
          <SectionCard title="Actividad" description="Seguimiento registrado en el CRM.">
            {related.length ? (
              <ul className="activity-mini-list">
                {related.map((activity) => (
                  <li key={activity.id}>
                    <button onClick={() => shared.onOpenActivity(activity.id)} type="button">
                      <strong>{activity.title}</strong>
                      <span>{dateTime(activity.startAt, true)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Sin actividad" description="Todavía no hay actividades relacionadas con este contacto." />
            )}
          </SectionCard>
        </div>
        <ContactRelatedSections contactId={selected.id} />
        {showForm && (
          <Modal
            description="Completa los datos de contacto y guarda para actualizar la ficha."
            onClose={() => setShowForm(false)}
            title={editing ? "Editar contacto" : "Nuevo contacto"}
            wide
          >
            <ContactForm
              contact={editing}
              businesses={businesses}
              busy={busy}
              currentUserEmail={shared.currentUserEmail}
              duplicateWarning={duplicateWarning}
              error={formError}
              onCancel={() => setShowForm(false)}
              onSubmit={submit}
            />
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <Breadcrumbs items={[{ label: "Inicio" }, { label: "Contactos" }]} />
      <PageHeader
        description="Personas relacionadas con cada empresa."
        eyebrow="CRM"
        title="Contactos"
        actions={
          shared.canWrite && (
            <button
              className="primary-button"
              onClick={() => {
                setEditing(null);
                setFormError("");
                setShowForm(true);
              }}
              type="button"
            >
              Nuevo contacto
            </button>
          )
        }
      />
      <div className="toolbar toolbar-filters">
        <input
          aria-label="Buscar contactos"
          autoComplete="off"
          name="q"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar contactos…"
          value={search}
        />
        <select
          aria-label="Filtrar contactos por empresa"
          onChange={(event) => setBusinessFilter(event.target.value)}
          value={businessFilter}
        >
          <option value="">Todas las empresas</option>
          {businesses.map((business) => (
            <option key={business.id} value={business.id}>
              {business.name}
            </option>
          ))}
        </select>
        <span>{rows.length} contactos</span>
      </div>
      {showForm && (
        <Modal
          description="Completa los datos de contacto y guarda para crear la ficha."
          onClose={() => setShowForm(false)}
          title={editing ? "Editar contacto" : "Nuevo contacto"}
          wide
        >
          <ContactForm
            contact={editing}
            businesses={businesses}
            busy={busy}
            currentUserEmail={shared.currentUserEmail}
            duplicateWarning={duplicateWarning}
            error={formError}
            onCancel={() => setShowForm(false)}
            onSubmit={submit}
          />
        </Modal>
      )}
      <section className="panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Contacto</th>
                  <th>Empresa</th>
                  <th>Correo</th>
                  <th>Teléfono</th>
                  <th>Responsable</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((contact) => (
                  <tr
                    className="clickable-row"
                    key={contact.id}
                    onClick={() => setSelectedId(contact.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(contact.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td data-label="Contacto">
                      <strong>{contact.name}</strong>
                      <span>{contact.title}</span>
                    </td>
                    <td data-label="Empresa">
                      {businesses.find((item) => item.id === contact.businessId)
                        ?.name ?? "—"}
                    </td>
                    <td data-label="Correo">{contact.email || "—"}</td>
                    <td data-label="Teléfono">{contact.phone || "—"}</td>
                    <td data-label="Responsable">{contact.ownerEmail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            description="No hay contactos en esta vista."
            title="Sin contactos"
            action={
              shared.canWrite ? (
                <button
                  className="primary-button"
                  onClick={() => {
                    setEditing(null);
                    setFormError("");
                    setShowForm(true);
                  }}
                  type="button"
                >
                  Nuevo contacto
                </button>
              ) : undefined
            }
          />
        )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      </section>
    </>
  );
}

function ContactRelatedSections({ contactId }: { contactId: string }) {
  const [data, setData] = useState<Record<
    string,
    Array<Record<string, unknown>>
  > | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [active, setActive] = useState("projects");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const result = (await response.json()) as Record<string, unknown> & {
          error?: string;
        };
        if (!response.ok) {
          throw new Error(
            result.error ?? "No se pudieron cargar las relaciones.",
          );
        }
        setData({
          projects: (result.projects as Array<Record<string, unknown>>) ?? [],
          opportunities: (result.opportunities as Array<Record<string, unknown>>) ?? [],
          quotations:
            (result.quotations as Array<Record<string, unknown>>) ?? [],
          invoices: (result.invoices as Array<Record<string, unknown>>) ?? [],
          documents: (result.documents as Array<Record<string, unknown>>) ?? [],
          history: (result.history as Array<Record<string, unknown>>) ?? [],
        });
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setError((reason as Error).message);
        }
      });
    return () => controller.abort();
  }, [contactId, reload]);
  if (error) return <ErrorState message={error} onRetry={() => { setError(""); setReload((value) => value + 1); }} />;
  if (!data) return <LoadingState text="Cargando relaciones del contacto…" />;
  const items = [
    { key: "projects", label: "Proyectos", count: data.projects.length },
    { key: "opportunities", label: "Oportunidades", count: data.opportunities.length },
    { key: "quotations", label: "Cotizaciones", count: data.quotations.length },
    { key: "invoices", label: "Facturas", count: data.invoices.length },
    { key: "documents", label: "Documentos", count: data.documents.length },
    { key: "history", label: "Historial", count: data.history.length },
  ];
  const renderRows = () => {
    if (active === "documents") {
      return data.documents.length ? (
        <div className="document-list">
          {data.documents.slice(0, 12).map((item, index) => (
            <DocumentRow
              contentType={String(item.contentType || "")}
              href={item.id ? `/api/documents/${encodeURIComponent(String(item.id))}` : undefined}
              key={String(item.id ?? index)}
              name={String(item.originalFilename || item.name || "Documento")}
              size={typeof item.size === "number" ? item.size : undefined}
            />
          ))}
        </div>
      ) : <EmptyState title="Sin documentos" description="No hay documentos asociados a este contacto." />;
    }
    const rows = data[active as keyof typeof data] as Array<Record<string, unknown>>;
    if (!rows?.length) return <EmptyState title="Sin registros" description="No hay información relacionada para mostrar." />;
    const render = active === "projects"
      ? (item: Record<string, unknown>) => `${item.name} · ${item.role || item.status}`
      : active === "opportunities"
        ? (item: Record<string, unknown>) => `${item.title} · ${item.stage}`
        : active === "quotations"
          ? (item: Record<string, unknown>) => `${item.quotationNumber} · ${item.status}`
          : active === "invoices"
            ? (item: Record<string, unknown>) => `${item.invoiceNumber || "Factura"} · ${item.status || ""}`
            : (item: Record<string, unknown>) => `${item.action} · ${dateTime(String(item.createdAt))}`;
    return <ul className="related-list">{rows.slice(0, 12).map((item, index) => <RelatedListItem key={String(item.id ?? index)} title={render(item)} />)}</ul>;
  };
  return (
    <SectionCard title="Información relacionada" description="Relaciones existentes en el sistema.">
      <RelatedTabs active={active} items={items} onChange={setActive} />
      <div className="related-tab-panel">{renderRows()}</div>
    </SectionCard>
  );
}

function ContactForm({
  contact,
  businesses,
  busy,
  currentUserEmail,
  error,
  duplicateWarning,
  onSubmit,
  onCancel,
}: {
  contact: ContactRow | null;
  businesses: BusinessRow[];
  busy: boolean;
  currentUserEmail: string;
  error: string;
  duplicateWarning: boolean;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  onCancel(): void;
}) {
  const { formProps, requestCancel } = useFormGuard(onCancel);
  return (
    <form {...formProps} className="record-form" onSubmit={onSubmit}>
      <InlineAlert message={error} />
      {duplicateWarning && (
        <p className="inline-warning">
          Revisa la coincidencia. Si confirmas que es otra persona, vuelve a
          guardar para conservar ambos contactos.
        </p>
      )}
      <div className="form-grid">
        <label className="wide">
          Nombre del contacto
          <input
            autoComplete="name"
            defaultValue={contact?.name}
            name="name"
            required
          />
        </label>
        <label>
          Empresa
          <select
            autoComplete="organization"
            defaultValue={contact?.businessId ?? ""}
            name="businessId"
          >
            <option value="">Sin empresa</option>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cargo
          <input
            autoComplete="organization-title"
            defaultValue={contact?.title}
            name="title"
          />
        </label>
        <label>
          Correo
          <input
            autoComplete="email"
            defaultValue={contact?.email}
            name="email"
            spellCheck={false}
            type="email"
          />
        </label>
        <label>
          Teléfono
          <input
            autoComplete="tel"
            defaultValue={contact?.phone}
            inputMode="tel"
            name="phone"
            type="tel"
          />
        </label>
        <label>
          Celular
          <input
            autoComplete="tel"
            defaultValue={contact?.mobilePhone}
            inputMode="tel"
            name="mobilePhone"
            type="tel"
          />
        </label>
        <label>
          Responsable
          <input
            autoComplete="email"
            defaultValue={contact?.ownerEmail ?? currentUserEmail}
            name="ownerEmail"
            spellCheck={false}
            type="email"
            required
          />
        </label>
        <label className="wide">
          Notas
          <textarea defaultValue={contact?.notes} name="notes" rows={4} />
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
