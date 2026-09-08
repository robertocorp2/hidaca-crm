"use client";

import { useMemo, useState, type FormEvent } from "react";
import type { ActivityRow, BusinessRow, ContactRow } from "./types";
import { RecordWorkspace } from "./record-workspace";
import {
  ActiveFilterChip,
  AutocompleteInput,
  Breadcrumbs,
  ColumnFilterPopover,
  Empty,
  InlineAlert,
  Modal,
  Pagination,
  PageSizeControl,
  PageHeader,
  SortHeader,
  dateTime,
  useFormGuard,
  useColumnFilters,
  usePagination,
  useUrlState,
} from "./ui";

type SharedProps = {
  canWrite: boolean;
  canViewActivity: boolean;
  canCreateActivity: boolean;
  canAskAi: boolean;
  canProposeAi: boolean;
  canApproveAi: boolean;
  currentUserEmail: string;
  activities: ActivityRow[];
  onOpenActivity(id: string): void;
  onCreateActivity(relatedType: "business" | "contact", relatedId: string): void;
  onNavigate(view: string, id: string): void;
  confirm(message: string, confirmLabel: string, action: () => Promise<void>): void;
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
  const [direction, setDirection] = useUrlState("dir", "asc");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const [editing, setEditing] = useState<BusinessRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const selected = businesses.find((item) => item.id === selectedId) ?? null;
  const searchedRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return businesses
      .filter((business) =>
        `${business.name} ${business.rnc} ${business.email} ${business.phone} ${business.mobilePhone} ${business.address}`
          .toLowerCase()
          .includes(term),
      );
  }, [businesses, search]);
  const businessFilterDefinitions = useMemo(() => [
    { key: "name", label: "Empresa", getValue: (business: BusinessRow) => business.name },
    { key: "email", label: "Correo", getValue: (business: BusinessRow) => business.email },
    { key: "phone", label: "Teléfono", getValue: (business: BusinessRow) => business.phone },
    { key: "owner", label: "Responsable", getValue: (business: BusinessRow) => business.ownerEmail },
    { key: "updated", label: "Actualización", kind: "date" as const, getValue: (business: BusinessRow) => business.updatedAt },
  ], []);
  const { filtered: filteredBusinesses, values: businessFilterValues, setFilter: setBusinessFilter, active: activeBusinessFilters, clear: clearBusinessFilters } = useColumnFilters("businesses", searchedRows, businessFilterDefinitions);
  const rows = useMemo(() => {
    const multiplier = direction === "desc" ? -1 : 1;
    return filteredBusinesses.toSorted((left, right) => {
      const leftValue = sort === "email" ? left.email : sort === "owner" ? left.ownerEmail : sort === "updated" ? left.updatedAt : left.name;
      const rightValue = sort === "email" ? right.email : sort === "owner" ? right.ownerEmail : sort === "updated" ? right.updatedAt : right.name;
      return multiplier * leftValue.localeCompare(rightValue, "es", { sensitivity: "base" });
    });
  }, [direction, filteredBusinesses, sort]);
  const pageSize = pageSizeValue === "all" ? Math.max(rows.length, 1) : Number(pageSizeValue) || 10;
  const { page, pageItems, setPage, totalPages } = usePagination(rows, pageSize);

  function sortBy(column: string) {
    if (sort === column) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection("asc");
    }
  }

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

  if (selected) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            { label: "Empresas", onClick: () => setSelectedId(null) },
            { label: selected.name },
          ]}
        />
        <RecordWorkspace
          activities={shared.activities}
          businesses={businesses}
          canCreateActivity={shared.canCreateActivity}
          canAskAi={shared.canAskAi}
          canProposeAi={shared.canProposeAi}
          canApproveAi={shared.canApproveAi}
          canViewActivity={shared.canViewActivity}
          canWrite={shared.canWrite}
          kind="business"
          onArchived={() => setSelectedId(null)}
          onEdit={() => {
            setEditing(selected);
            setFormError("");
            setShowForm(true);
          }}
          onNavigate={shared.onNavigate}
          onOpenActivity={shared.onOpenActivity}
          onCreateActivity={shared.onCreateActivity}
          confirm={shared.confirm}
          record={selected}
          setMessage={shared.setMessage}
        />
        {showForm && (
          <Modal
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
        action={shared.canWrite ? (
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
        ) : undefined}
        description="Organizaciones y clientes comerciales."
        eyebrow="CRM"
        title="Empresas"
      />
      <div className="toolbar toolbar-filters">
        <AutocompleteInput
          ariaLabel="Buscar empresas"
          onChange={setSearch}
          onSelect={(option) => setSearch(option.label)}
          options={rows.slice(0, 8).map((business) => ({ id: business.id, label: business.name, secondary: business.address }))}
          placeholder="Escribe una letra o nombre…"
          value={search}
        />
        <PageSizeControl label="Empresas por página" onChange={(value) => { setPageSizeValue(value); setPage(1); }} value={pageSizeValue} />
        <span>{rows.length} empresas</span>
      </div>
      {activeBusinessFilters.length > 0 && <div className="list-filter-summary" aria-label="Filtros activos">
        {activeBusinessFilters.map(([key, value]) => <ActiveFilterChip key={key} label={`${businessFilterDefinitions.find((definition) => definition.key === key)?.label ?? key}: ${value}`} onClear={() => setBusinessFilter(key, "")} />)}
        <button className="text-button" onClick={clearBusinessFilters} type="button">Limpiar filtros</button>
      </div>}
      {showForm && (
        <Modal
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
      <section className="panel list-view-panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th><span className="table-header-with-filter"><SortHeader column="name" direction={direction as "asc" | "desc"} label="Empresa" onSort={sortBy} sort={sort} /><ColumnFilterPopover definition={businessFilterDefinitions[0]} value={businessFilterValues.name ?? ""} onChange={(value) => setBusinessFilter("name", value)} /></span></th>
                  <th><span className="table-header-with-filter"><SortHeader column="email" direction={direction as "asc" | "desc"} label="Correo" onSort={sortBy} sort={sort} /><ColumnFilterPopover definition={businessFilterDefinitions[1]} value={businessFilterValues.email ?? ""} onChange={(value) => setBusinessFilter("email", value)} /></span></th>
                  <th><span className="table-header-with-filter"><span>Teléfono</span><ColumnFilterPopover definition={businessFilterDefinitions[2]} value={businessFilterValues.phone ?? ""} onChange={(value) => setBusinessFilter("phone", value)} /></span></th>
                  <th><span className="table-header-with-filter"><SortHeader column="owner" direction={direction as "asc" | "desc"} label="Responsable" onSort={sortBy} sort={sort} /><ColumnFilterPopover definition={businessFilterDefinitions[3]} value={businessFilterValues.owner ?? ""} onChange={(value) => setBusinessFilter("owner", value)} /></span></th>
                  <th><span className="table-header-with-filter"><SortHeader column="updated" direction={direction as "asc" | "desc"} label="Actualización" onSort={sortBy} sort={sort} /><ColumnFilterPopover definition={businessFilterDefinitions[4]} value={businessFilterValues.updated ?? ""} onChange={(value) => setBusinessFilter("updated", value)} /></span></th>
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
          <Empty
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
            text="No hay empresas en esta vista."
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
      <div className="form-section-heading">
        <strong>Información principal</strong>
        <span>Completa los datos que ya existan para este registro.</span>
      </div>
      <div className="form-grid record-form-grid">
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
  const [sort, setSort] = useUrlState("sort", "name");
  const [direction, setDirection] = useUrlState("dir", "asc");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const [businessQuery, setBusinessQuery] = useState("");
  const [editing, setEditing] = useState<ContactRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState(false);
  const selected = contacts.find((item) => item.id === selectedId) ?? null;
  const searchedRows = contacts
    .filter(
      (contact) =>
        (!businessFilter && !businessQuery.trim() || contact.businessId === businessFilter || (businesses.find((item) => item.id === contact.businessId)?.name ?? "").toLowerCase().includes(businessQuery.trim().toLowerCase())) &&
        `${contact.name} ${contact.email} ${contact.phone} ${contact.mobilePhone} ${contact.title}`
          .toLowerCase()
          .includes(search.toLowerCase().trim()),
    );
  const contactFilterDefinitions = useMemo(() => [
    { key: "name", label: "Contacto", getValue: (contact: ContactRow) => contact.name },
    { key: "email", label: "Correo", getValue: (contact: ContactRow) => contact.email },
    { key: "phone", label: "Teléfono", getValue: (contact: ContactRow) => contact.phone },
    { key: "owner", label: "Responsable", getValue: (contact: ContactRow) => contact.ownerEmail },
  ], []);
  const { filtered: filteredContacts, values: contactFilterValues, setFilter: setContactFilter, active: activeContactFilters, clear: clearContactFilters } = useColumnFilters("contacts", searchedRows, contactFilterDefinitions);
  const rows = filteredContacts
    .toSorted((left, right) => {
      const leftValue = sort === "business" ? (businesses.find((item) => item.id === left.businessId)?.name ?? "") : sort === "email" ? left.email : sort === "owner" ? left.ownerEmail : left.name;
      const rightValue = sort === "business" ? (businesses.find((item) => item.id === right.businessId)?.name ?? "") : sort === "email" ? right.email : sort === "owner" ? right.ownerEmail : right.name;
      const multiplier = direction === "desc" ? -1 : 1;
      return multiplier * leftValue.localeCompare(rightValue, "es", { sensitivity: "base" });
    });
  const pageSize = pageSizeValue === "all" ? Math.max(rows.length, 1) : Number(pageSizeValue) || 10;
  const { page, pageItems, setPage, totalPages } = usePagination(rows, pageSize);
  const selectedBusiness = businesses.find((item) => item.id === businessFilter);

  function sortBy(column: string) {
    if (sort === column) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection("asc");
    }
  }

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

  if (selected) {
    return (
      <>
        <Breadcrumbs
          items={[
            { label: "Inicio" },
            { label: "Contactos", onClick: () => setSelectedId(null) },
            { label: selected.name },
          ]}
        />
        <RecordWorkspace
          activities={shared.activities}
          businesses={businesses}
          canCreateActivity={shared.canCreateActivity}
          canAskAi={shared.canAskAi}
          canProposeAi={shared.canProposeAi}
          canApproveAi={shared.canApproveAi}
          canViewActivity={shared.canViewActivity}
          canWrite={shared.canWrite}
          kind="contact"
          onArchived={() => setSelectedId(null)}
          onEdit={() => {
            setEditing(selected);
            setFormError("");
            setShowForm(true);
          }}
          onNavigate={shared.onNavigate}
          onOpenActivity={shared.onOpenActivity}
          onCreateActivity={shared.onCreateActivity}
          confirm={shared.confirm}
          record={selected}
          setMessage={shared.setMessage}
        />
        {showForm && (
          <Modal
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
        action={shared.canWrite ? (
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
        ) : undefined}
        description="Personas relacionadas con cada empresa."
        eyebrow="CRM"
        title="Contactos"
      />
      <div className="toolbar toolbar-filters">
        <AutocompleteInput
          ariaLabel="Buscar contactos"
          onChange={setSearch}
          onSelect={(option) => setSearch(option.label)}
          options={rows.slice(0, 8).map((contact) => ({ id: contact.id, label: contact.name, secondary: contact.title }))}
          placeholder="Escribe una letra o nombre…"
          value={search}
        />
        <AutocompleteInput
          ariaLabel="Filtrar contactos por empresa"
          onChange={(value) => { setBusinessQuery(value); setBusinessFilter(""); }}
          onSelect={(option) => { setBusinessQuery(option.label); setBusinessFilter(option.id); }}
          options={businesses.filter((business) => business.name.toLowerCase().includes(businessQuery.trim().toLowerCase())).slice(0, 8).map((business) => ({ id: business.id, label: business.name, secondary: business.email }))}
          placeholder="Escribe una empresa…"
          value={businessQuery || selectedBusiness?.name || ""}
        />
        <PageSizeControl label="Contactos por página" onChange={(value) => { setPageSizeValue(value); setPage(1); }} value={pageSizeValue} />
        <span>{rows.length} contactos</span>
      </div>
      {activeContactFilters.length > 0 && <div className="list-filter-summary" aria-label="Filtros activos">
        {activeContactFilters.map(([key, value]) => <ActiveFilterChip key={key} label={`${contactFilterDefinitions.find((definition) => definition.key === key)?.label ?? key}: ${value}`} onClear={() => setContactFilter(key, "")} />)}
        <button className="text-button" onClick={clearContactFilters} type="button">Limpiar filtros</button>
      </div>}
      {showForm && (
        <Modal
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
      <section className="panel list-view-panel">
        {rows.length ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th><span className="table-header-with-filter"><SortHeader column="name" direction={direction as "asc" | "desc"} label="Contacto" onSort={sortBy} sort={sort} /><ColumnFilterPopover definition={contactFilterDefinitions[0]} value={contactFilterValues.name ?? ""} onChange={(value) => setContactFilter("name", value)} /></span></th>
                  <th><SortHeader column="business" direction={direction as "asc" | "desc"} label="Empresa" onSort={sortBy} sort={sort} /></th>
                  <th><span className="table-header-with-filter"><span>Correo</span><ColumnFilterPopover definition={contactFilterDefinitions[1]} value={contactFilterValues.email ?? ""} onChange={(value) => setContactFilter("email", value)} /></span></th>
                  <th><span className="table-header-with-filter"><span>Teléfono</span><ColumnFilterPopover definition={contactFilterDefinitions[2]} value={contactFilterValues.phone ?? ""} onChange={(value) => setContactFilter("phone", value)} /></span></th>
                  <th><span className="table-header-with-filter"><SortHeader column="owner" direction={direction as "asc" | "desc"} label="Responsable" onSort={sortBy} sort={sort} /><ColumnFilterPopover definition={contactFilterDefinitions[3]} value={contactFilterValues.owner ?? ""} onChange={(value) => setContactFilter("owner", value)} /></span></th>
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
          <Empty
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
            text="No hay contactos en esta vista."
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
      <div className="form-section-heading">
        <strong>Información principal</strong>
        <span>Asocia la persona y conserva sus datos de contacto.</span>
      </div>
      <div className="form-grid record-form-grid">
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
