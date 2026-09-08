"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Archive,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  ClipboardList,
  ContactRound,
  FileText,
  FolderKanban,
  Hash,
  History,
  Mail,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Phone,
  Plus,
  Receipt,
  Smartphone,
  UserRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";
import type {
  ActivityRow,
  BusinessDetailResponse,
  BusinessRow,
  ContactDetailResponse,
  ContactRow,
  DetailRelation,
  RecordHistoryEntry,
} from "./types";
import { StoredDocumentPreviewModal } from "./document-preview";
import { RecordAiPanel } from "./record-ai-panel";
import { DocumentRow, dateTime, money } from "./ui";

type WorkspaceKind = "business" | "contact";

type WorkspaceProps = {
  kind: WorkspaceKind;
  record: BusinessRow | ContactRow;
  businesses: BusinessRow[];
  activities: ActivityRow[];
  canWrite: boolean;
  canViewActivity: boolean;
  canCreateActivity: boolean;
  canAskAi: boolean;
  canProposeAi: boolean;
  canApproveAi: boolean;
  onOpenActivity(id: string): void;
  onCreateActivity(relatedType: "business" | "contact", relatedId: string): void;
  onNavigate(view: string, id: string): void;
  confirm(message: string, confirmLabel: string, action: () => Promise<void>): void;
  onEdit(): void;
  onArchived(): void;
  setMessage(message: string): void;
};

type TimelineEvent = {
  id: string;
  date: string;
  label: string;
  title: string;
  detail?: string;
  actor?: string;
  activityId?: string;
  tone?: string;
};

type RelationConfig = {
  key: string;
  title: string;
  icon: LucideIcon;
  view?: string;
  createLabel?: string;
  emptyTitle: string;
  emptyDescription: string;
  render(item: DetailRelation): string;
  href?: (item: DetailRelation) => string | undefined;
};

type PreviewDocument = { id: string; name: string; contentType: string };

function text(value: unknown, fallback = "—") {
  const result = String(value ?? "").trim();
  return result || fallback;
}

function relationRows(
  data: BusinessDetailResponse | ContactDetailResponse,
  key: string,
) {
  if (key === "business" && "business" in data) {
    return data.business ? [data.business as unknown as DetailRelation] : [];
  }
  return ((data as unknown as Record<string, DetailRelation[]>)[key] ?? []).filter(
    Boolean,
  );
}

function relationHref(view: string, id: string) {
  return `/app?view=${view}&record=${encodeURIComponent(id)}`;
}

function statusText(value: unknown) {
  return text(value).replaceAll("_", " ");
}

function isPreviewableDocument(item: DetailRelation) {
  const contentType = String(item.contentType ?? "").toLowerCase();
  return Boolean(item.id) && (contentType === "application/pdf" || contentType.startsWith("image/"));
}

function relationConfigs(kind: WorkspaceKind): RelationConfig[] {
  const common: RelationConfig[] = [
    {
      key: "projects",
      title: "Proyectos",
      icon: FolderKanban,
      view: "projects",
      createLabel: "Crear proyecto",
      emptyTitle: "No hay proyectos relacionados",
      emptyDescription: "Aún no hay proyectos asociados a este registro.",
      render: (item) => `${text(item.name)} · ${statusText(item.status)}`,
    },
    {
      key: "opportunities",
      title: "Oportunidades",
      icon: BriefcaseBusiness,
      view: "opportunities",
      createLabel: "Crear oportunidad",
      emptyTitle: "No hay oportunidades relacionadas",
      emptyDescription: "Aún no hay oportunidades asociadas a este registro.",
      render: (item) => `${text(item.title)} · ${statusText(item.stage)}`,
    },
    {
      key: "quotations",
      title: "Cotizaciones",
      icon: ClipboardList,
      view: "cotizaciones",
      createLabel: "Crear cotización",
      emptyTitle: "No hay cotizaciones relacionadas",
      emptyDescription: "Aún no hay cotizaciones asociadas a este registro.",
      render: (item) =>
        `${text(item.quotationNumber)} · ${text(item.title)} · ${statusText(item.status)}`,
    },
    {
      key: "invoices",
      title: "Facturas",
      icon: Receipt,
      view: "facturas",
      createLabel: "Crear factura",
      emptyTitle: "No hay facturas relacionadas",
      emptyDescription: "Aún no hay facturas asociadas a este registro.",
      render: (item) =>
        `${text(item.invoiceNumberRaw)} · ${money(Number(item.totalAmount ?? 0))} · ${statusText(item.status)}`,
    },
    {
      key: "documents",
      title: "Documentos",
      icon: FileText,
      emptyTitle: "No hay documentos relacionados",
      emptyDescription: "Aún no hay documentos asociados a este registro.",
      render: (item) => text(item.originalFilename ?? item.name),
      href: (item) => item.id
        ? `/api/documents/${encodeURIComponent(String(item.id))}`
        : /^https:\/\//i.test(String(item.originalUri ?? "")) ? String(item.originalUri) : undefined,
    },
    {
      key: "cases",
      title: "Casos",
      icon: ClipboardList,
      view: "cases",
      createLabel: "Crear caso",
      emptyTitle: "No hay casos relacionados",
      emptyDescription: "Aún no hay casos asociados a este registro.",
      render: (item) => `${text(item.title)} · ${statusText(item.status)}`,
    },
  ];
  if (kind === "contact") {
    return [
      {
        key: "business",
        title: "Empresa",
        icon: Building2,
        view: "businesses",
        emptyTitle: "Sin empresa asociada",
        emptyDescription: "Este contacto todavía no tiene una empresa asociada.",
        render: (item) => `${text(item.name)} · Empresa asociada`,
      },
      ...common,
    ];
  }
  return [
    {
      key: "contacts",
      title: "Contactos",
      icon: ContactRound,
      view: "contacts",
      emptyTitle: "No hay contactos relacionados",
      emptyDescription: "Aún no hay contactos asociados a esta empresa.",
      render: (item) =>
        `${text(item.name)}${item.title ? ` · ${text(item.title)}` : ""}${item.email ? ` · ${text(item.email)}` : ""}`,
    },
    {
      key: "addresses",
      title: "Direcciones",
      icon: MapPin,
      emptyTitle: "No hay direcciones relacionadas",
      emptyDescription: "Aún no hay direcciones registradas para esta empresa.",
      render: (item) => `${text(item.label ?? item.type)} · ${text(item.line1)}`,
    },
    ...common,
    {
      key: "payments",
      title: "Pagos",
      icon: WalletCards,
      view: "pagos",
      emptyTitle: "No hay pagos relacionados",
      emptyDescription: "Aún no hay pagos registrados para esta empresa.",
      render: (item) =>
        `${text(item.label ?? item.type)} · ${money(Number(item.amount ?? 0), String(item.currency ?? "DOP"))} · ${statusText(item.status)}`,
    },
  ];
}

function getRelatedId(item: DetailRelation) {
  return String(item.id ?? "");
}

function RecordAvatar({ name, kind }: { name: string; kind: WorkspaceKind }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || (kind === "business" ? "EM" : "CO");
  return <span className="record-avatar" aria-hidden="true">{initials}</span>;
}

export function RecordActions({
  canWrite,
  canViewActivity,
  canCreateActivity,
  onEdit,
  onArchive,
  onNavigate,
  onCreateActivity,
  recordType,
  recordId,
}: {
  canWrite: boolean;
  canViewActivity: boolean;
  canCreateActivity: boolean;
  onEdit(): void;
  onArchive(): void;
  onNavigate(view: string, id: string): void;
  onCreateActivity(relatedType: "business" | "contact", relatedId: string): void;
  recordType: "business" | "contact";
  recordId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="record-actions" aria-label="Acciones del registro">
      {canWrite && <button className="primary-button compact-action" onClick={onEdit} type="button"><Pencil aria-hidden="true" size={14} />Editar</button>}
      {canCreateActivity ? (
        <button className="secondary-button compact-action" onClick={() => onCreateActivity(recordType, recordId)} type="button">
          <Plus aria-hidden="true" size={14} />Actividad
        </button>
      ) : canViewActivity ? (
        <a className="secondary-button compact-action" href="/app?view=schedule" onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onNavigate("schedule", "");
        }}>Actividades</a>
      ) : null}
      {canWrite && (
        <div className="record-action-menu">
          <button
            aria-expanded={open}
            aria-haspopup="menu"
            className="ghost-button compact-action"
            onClick={() => setOpen((current) => !current)}
            type="button"
          >
            Más <MoreHorizontal aria-hidden="true" size={15} />
          </button>
          {open && (
            <div className="record-action-menu-popover" role="menu">
              <button className="danger-menu-item" onClick={() => { setOpen(false); onArchive(); }} role="menuitem" type="button">
                <Archive aria-hidden="true" size={14} />Eliminar / archivar
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RecordHeader({
  kind,
  name,
  subtitle,
}: {
  kind: WorkspaceKind;
  name: string;
  subtitle: string;
}) {
  return (
    <div className="record-heading">
      <RecordAvatar kind={kind} name={name} />
      <div>
        <p className="eyebrow">CRM · {kind === "business" ? "Empresa" : "Contacto"}</p>
        <h1 title={name || undefined}>{name || "Registro sin nombre"}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

export function RecordTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: Array<{ key: string; label: string; count?: number }>;
  active: string;
  onChange(key: string): void;
}) {
  return (
    <nav className="record-tabs" role="tablist" aria-label="Información del registro">
      {tabs.map((item) => (
        <button
          aria-controls={`record-tab-${item.key}`}
          aria-selected={active === item.key}
          className={active === item.key ? "active" : undefined}
          id={`record-tab-button-${item.key}`}
          key={item.key}
          onClick={() => onChange(item.key)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
            event.preventDefault();
            const index = tabs.findIndex((tab) => tab.key === item.key);
            const nextIndex = event.key === "ArrowRight"
              ? (index + 1) % tabs.length
              : (index - 1 + tabs.length) % tabs.length;
            const next = tabs[nextIndex];
            onChange(next.key);
            document.getElementById(`record-tab-button-${next.key}`)?.focus();
          }}
          role="tab"
          type="button"
        >{item.label}{typeof item.count === "number" && <span className="record-tab-count">{item.count}</span>}</button>
      ))}
    </nav>
  );
}

export function RecordPropertyList({
  properties,
  onNavigate,
}: {
  properties: Array<[string, unknown, boolean?, { view: string; id: string }?]>;
  onNavigate?: (view: string, id: string) => void;
}) {
  const icons: Record<string, LucideIcon> = {
    "Nombre de la empresa": Building2,
    "Empresa asociada": Building2,
    Nombre: ContactRound,
    Tipo: Building2,
    "RNC / cédula": Hash,
    Correo: Mail,
    Teléfono: Phone,
    Celular: Smartphone,
    Dirección: MapPin,
    Responsable: UserRound,
    "Última actualización": CalendarClock,
    Cargo: UserRound,
  };
  return (
    <dl className="record-properties">
      {properties
        .filter(([, value, lowPriority]) => !lowPriority || String(value ?? "").trim())
        .map(([label, value, , relation]) => (
          <div key={label}>
            <span className="record-property-icon" aria-hidden="true">{(() => { const Icon = icons[label]; return Icon ? <Icon size={17} strokeWidth={1.8} /> : null; })()}</span>
            <dt>{label}</dt>
            <dd>
              {relation && onNavigate ? (
                <a href={relationHref(relation.view, relation.id)} onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                  event.preventDefault();
                  onNavigate(relation.view, relation.id);
                }}>{text(value)}</a>
              ) : text(value)}
            </dd>
          </div>
        ))}
    </dl>
  );
}

function RecordQuickSummary({
  kind,
  owner,
  phone,
  updatedAt,
}: {
  kind: WorkspaceKind;
  owner?: string | null;
  phone?: string | null;
  updatedAt?: string | null;
}) {
  const items = [
    { label: "Responsable", value: text(owner), icon: UserRound },
    { label: kind === "business" ? "Teléfono / celular" : "Celular", value: text(phone), icon: Smartphone },
    { label: "Actualización", value: updatedAt ? dateTime(updatedAt) : "—", icon: CalendarClock },
  ];
  return (
    <div className="record-quick-summary" aria-label="Resumen rápido del registro">
      {items.map(({ label, value, icon: Icon }) => (
        <div className="record-quick-summary-item" key={label}>
          <Icon aria-hidden="true" size={15} strokeWidth={1.8} />
          <span>{label}</span>
          <strong title={value}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function RelationshipEmptyState({
  config,
  canWrite,
  onCreate,
}: {
  config: RelationConfig;
  canWrite: boolean;
  onCreate?: () => void;
}) {
  const Icon = config.icon;
  return (
    <div className="relationship-empty-state">
      <span className="relationship-empty-icon" aria-hidden="true"><Icon size={30} strokeWidth={1.7} /></span>
      <strong>{config.emptyTitle}</strong>
      <p>{config.emptyDescription}</p>
      {canWrite && config.createLabel && onCreate && (
        <button className="primary-button relationship-empty-action" onClick={onCreate} type="button">
          <Plus aria-hidden="true" size={15} />
          {config.createLabel}
        </button>
      )}
    </div>
  );
}

export function ActivityTimeline({ events, onOpenActivity }: { events: TimelineEvent[]; onOpenActivity(id: string): void }) {
  if (!events.length) {
    return <p className="workspace-empty">Aún no hay actividad registrada.</p>;
  }
  return (
    <ol className="record-timeline">
      {events.map((event) => (
        <li key={event.id} className={event.tone ? `timeline-${event.tone}` : undefined}>
          <span className="timeline-dot" aria-hidden="true" />
          <div className="timeline-body">
            <div className="timeline-meta">
              <span>{event.label}</span>
              <time dateTime={event.date}>{dateTime(event.date, true)}</time>
            </div>
            {event.activityId ? (
              <button className="timeline-link" onClick={() => onOpenActivity(event.activityId!)} type="button">
                {event.title}
              </button>
            ) : (
              <strong>{event.title}</strong>
            )}
            {event.detail && <p>{event.detail}</p>}
            {event.actor && <small>{event.actor}</small>}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function RelatedRecordSection({
  config,
  rows,
  onNavigate,
  openByDefault = false,
  canWrite = false,
  onCreate,
  fullEmptyState = false,
  onPreviewDocument,
}: {
  config: RelationConfig;
  rows: DetailRelation[];
  onNavigate(view: string, id: string): void;
  openByDefault?: boolean;
  canWrite?: boolean;
  onCreate?: () => void;
  fullEmptyState?: boolean;
  onPreviewDocument?: (document: PreviewDocument) => void;
}) {
  const Icon = config.icon;
  return (
    <details className="related-record-section" open={openByDefault}>
      <summary>
        <span className="related-section-label"><Icon aria-hidden="true" size={16} strokeWidth={1.8} />{config.title}</span>
        <span className="related-section-meta"><span className="related-count">{rows.length}</span><ArrowRight aria-hidden="true" size={15} /></span>
      </summary>
      {rows.length ? (
        <ul>
          {rows.slice(0, 8).map((item) => {
            const id = getRelatedId(item);
            const href = config.href?.(item) ?? (config.view ? relationHref(config.view, id) : undefined);
            const content = config.render(item);
            return (
              <li key={id || content}>
                {config.key === "documents" ? (
                  <DocumentRow
                    href={href}
                    metadata={text(item.contentType ?? item.extension ?? "Documento")}
                    name={content}
                    onClick={(event) => {
                      if (!isPreviewableDocument(item) || !onPreviewDocument) return;
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                      event.preventDefault();
                      onPreviewDocument({ id, name: content, contentType: String(item.contentType ?? "application/pdf") });
                    }}
                    rel={href?.startsWith("http") ? "noreferrer" : undefined}
                    target={href?.startsWith("http") ? "_blank" : undefined}
                  />
                ) : href ? (
                  <a
                    href={href}
                    onClick={(event) => {
                      if (config.href || !config.view || event.metaKey || event.ctrlKey || event.shiftKey) return;
                      event.preventDefault();
                      onNavigate(config.view, id);
                    }}
                  >
                    <strong>{content}</strong>
                  </a>
                ) : (
                  <span>{content}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : fullEmptyState ? (
        <RelationshipEmptyState config={config} canWrite={canWrite} onCreate={onCreate} />
      ) : (
        <p className="related-empty">Sin registros</p>
      )}
      {rows.length > 8 && config.view && (
        <a className="related-see-all" href={relationHref(config.view, "")} onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onNavigate(config.view!, "");
        }}>Ver todos</a>
      )}
    </details>
  );
}

function RelatedTimelineSection({
  title,
  events,
  onOpenActivity,
  icon: Icon,
}: {
  title: string;
  events: TimelineEvent[];
  onOpenActivity(id: string): void;
  icon: LucideIcon;
}) {
  return (
    <details className="related-record-section" open={events.length > 0}>
      <summary>
        <span className="related-section-label"><Icon aria-hidden="true" size={16} strokeWidth={1.8} />{title}</span>
        <span className="related-section-meta"><span className="related-count">{events.length}</span><ArrowRight aria-hidden="true" size={15} /></span>
      </summary>
      {events.length ? <ActivityTimeline events={events.slice(0, 4)} onOpenActivity={onOpenActivity} /> : <p className="related-empty">Sin registros</p>}
      {events.length > 4 && <p className="related-see-all">Mostrando las 4 más recientes</p>}
    </details>
  );
}

function RelatedNotesSection({ notes }: { notes?: string }) {
  return (
    <details className="related-record-section" open={Boolean(notes)}>
      <summary>
        <span className="related-section-label"><NotebookPen aria-hidden="true" size={16} strokeWidth={1.8} />Notas</span>
        <span className="related-section-meta"><span className="related-count">{notes ? 1 : 0}</span><ArrowRight aria-hidden="true" size={15} /></span>
      </summary>
      {notes ? <p className="record-notes related-inline-notes">{notes}</p> : <p className="related-empty">Sin registros</p>}
    </details>
  );
}

function makeTimeline(
  kind: WorkspaceKind,
  record: BusinessRow | ContactRow,
  activities: ActivityRow[],
  data: BusinessDetailResponse | ContactDetailResponse,
) {
  const id = record.id;
  const events: TimelineEvent[] = activities
    .filter((activity) => activity.relatedType === kind && activity.relatedId === id)
    .map((activity) => ({
      id: `activity-${activity.id}`,
      date: activity.startAt || activity.createdAt,
      label: "Actividad",
      title: activity.title,
      detail: activity.description || activity.notes,
      actor: activity.ownerEmail,
      activityId: activity.id,
      tone: "activity",
    }));
  const history = (data.history ?? []).map((entry: RecordHistoryEntry, index) => ({
    id: `history-${entry.entityId ?? "record"}-${entry.createdAt}-${index}`,
    date: entry.createdAt,
    label: entry.action === "create" ? "Creación" : entry.action === "update" ? "Actualización" : "Historial",
    title: `${statusText(entry.action)}${entry.reason ? ` · ${entry.reason}` : ""}`,
    actor: entry.actorEmail,
  }));
  const lifecycle: TimelineEvent[] = [];
  const createdAt = String(record.createdAt ?? "").trim();
  const updatedAt = String(record.updatedAt ?? "").trim();
  const recordLabel = kind === "business" ? "Empresa" : "Contacto";
  const actor = String(record.createdBy || record.ownerEmail || "").trim() || undefined;
  if (createdAt) {
    lifecycle.push({
      id: `lifecycle-created-${id}`,
      date: createdAt,
      label: "Creación",
      title: `${recordLabel} creada`,
      actor,
      tone: "history",
    });
  }
  if (updatedAt && updatedAt !== createdAt) {
    lifecycle.push({
      id: `lifecycle-updated-${id}`,
      date: updatedAt,
      label: "Actualización",
      title: `${recordLabel} actualizada`,
      actor,
      tone: "history",
    });
  }
  const relationLabels: Array<[string, string]> = [
    ["projects", "Proyecto"],
    ["opportunities", "Oportunidad"],
    ["quotations", "Cotización"],
    ["invoices", "Factura"],
    ["payments", "Pago"],
    ["cases", "Caso"],
    ["documents", "Documento"],
  ];
  const relatedEvents = relationLabels.flatMap(([key, label]) =>
    relationRows(data, key).map((item, index) => ({
      id: `relation-${key}-${getRelatedId(item)}-${index}`,
      date: String(item.updatedAt ?? item.createdAt ?? item.issueDate ?? item.paymentDate ?? ""),
      label,
      title: String(item.name ?? item.title ?? item.quotationNumber ?? item.invoiceNumberRaw ?? item.label ?? "Registro relacionado"),
      detail: String(item.status ?? item.stage ?? ""),
      actor: String(item.ownerEmail ?? item.createdBy ?? ""),
    })),
  );
  const combined = [...events, ...lifecycle, ...history, ...relatedEvents]
    .filter((event) => event.date)
    .sort((left, right) => right.date.localeCompare(left.date));
  const seen = new Set<string>();
  return combined.filter((event) => {
    const key = `${event.label}|${event.date}|${event.title}|${event.actor ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function RecordWorkspace({
  kind,
  record,
  businesses,
  activities,
  canWrite,
  canViewActivity,
  canCreateActivity,
  canAskAi,
  canProposeAi,
  canApproveAi,
  onOpenActivity,
  onCreateActivity,
  onNavigate,
  confirm,
  onEdit,
  onArchived,
  setMessage,
}: WorkspaceProps) {
  const [data, setData] = useState<BusinessDetailResponse | ContactDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [loadedRecordId, setLoadedRecordId] = useState<string | null>(null);
  const [tab, setTab] = useState("projects");
  const [previewDocument, setPreviewDocument] = useState<PreviewDocument | null>(null);
  const endpoint = kind === "business" ? "businesses" : "contacts";
  const name = record.name;
  const contact = kind === "contact" ? (record as ContactRow) : null;
  const business = kind === "business" ? (record as BusinessRow) : null;
  const associatedBusiness = contact?.businessId ? businesses.find((item) => item.id === contact.businessId) : null;
  const visibleData = loadedRecordId === record.id ? data : null;
  const visibleError = loadedRecordId === record.id ? error : "";
  const responseBusiness = visibleData && "business" in visibleData && visibleData.business ? visibleData.business : null;
  const summaryLabel = "Acerca de";

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/${endpoint}/${encodeURIComponent(record.id)}`, { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "No se pudieron cargar las relaciones.");
        setData(result as BusinessDetailResponse | ContactDetailResponse);
        setError("");
        setLoadedRecordId(record.id);
      })
      .catch((reason) => {
        if ((reason as Error).name !== "AbortError") {
          setError((reason as Error).message);
          setLoadedRecordId(record.id);
        }
      });
    return () => controller.abort();
  }, [endpoint, record.id]);

  const timeline = useMemo(
    () => (visibleData ? makeTimeline(kind, record, activities, visibleData) : []),
    [activities, kind, record, visibleData],
  );
  const relations = visibleData ? relationConfigs(kind).map((config) => ({ config, rows: relationRows(visibleData, config.key) })) : [];
  const properties = kind === "business"
    ? [
        ["Nombre de la empresa", business?.name],
        ["Tipo", business?.customerType === "individual" ? "Persona" : "Organización"],
        ["RNC / cédula", business?.rnc],
        ["Correo", business?.email],
        ["Teléfono", business?.phone],
        ["Celular", business?.mobilePhone],
        ["Dirección", business?.address],
        ["Responsable", business?.ownerEmail],
        ["Última actualización", business?.updatedAt ? dateTime(business.updatedAt) : "—"],
      ] as Array<[string, unknown, boolean?, { view: string; id: string }?]>
    : [
        ["Nombre", contact?.name],
        [
          "Empresa asociada",
          responseBusiness?.name ?? associatedBusiness?.name,
          false,
          responseBusiness?.id || associatedBusiness?.id
            ? { view: "businesses", id: responseBusiness?.id ?? associatedBusiness!.id }
            : undefined,
        ],
        ["Cargo", contact?.title, true],
        ["Correo", contact?.email],
        ["Teléfono", contact?.phone],
        ["Celular", contact?.mobilePhone],
        ["Responsable", contact?.ownerEmail],
        ["Última actualización", contact?.updatedAt ? dateTime(contact.updatedAt) : "—"],
      ] as Array<[string, unknown, boolean?, { view: string; id: string }?]>;
  const notes = record.notes?.trim();
  const tabs = [
    { key: "projects", label: "Proyectos", count: visibleData ? relationRows(visibleData, "projects").length : undefined },
    { key: "opportunities", label: "Oportunidades", count: visibleData ? relationRows(visibleData, "opportunities").length : undefined },
    { key: "quotations", label: "Cotizaciones", count: visibleData ? relationRows(visibleData, "quotations").length : undefined },
    { key: "invoices", label: "Facturas", count: visibleData ? relationRows(visibleData, "invoices").length : undefined },
    { key: "cases", label: "Casos", count: visibleData ? relationRows(visibleData, "cases").length : undefined },
  ];
  const currentRows = visibleData ? relationRows(visibleData, tab) : [];
  const currentConfig = relations.find(({ config }) => config.key === tab)?.config;
  const centerRelationKeys = new Set(["projects", "opportunities", "quotations", "invoices", "cases"]);
  const relatedPanelRelations = relations.filter(({ config }) => !centerRelationKeys.has(config.key));
  const visibleRelationKeys = new Set(["documents"]);
  const relatedCount = relatedPanelRelations.reduce((total, item) => total + item.rows.length, 0)
    + timeline.filter((event) => event.label === "Actividad" || event.label === "Historial").length
    + (notes ? 1 : 0);
  const summaryPhone = kind === "business"
    ? (business?.mobilePhone || business?.phone)
    : contact?.mobilePhone;

  async function archive() {
    if (!canWrite) return;
    confirm(
      `¿Archivar este ${kind === "business" ? "empresa" : "contacto"}?`,
      "Archivar",
      async () => {
        const response = await fetch(`/api/${endpoint}/${encodeURIComponent(record.id)}`, { method: "DELETE" });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) {
          setMessage(result.error ?? "No se pudo archivar el registro.");
          return;
        }
        setMessage(`${kind === "business" ? "Empresa" : "Contacto"} archivado.`);
        onArchived();
      },
    );
  }

  return (
    <section className="record-workspace" aria-label={`Espacio de trabajo de ${name}`}>
      <aside className="record-summary-panel">
        <RecordHeader
          kind={kind}
          name={name}
          subtitle={kind === "business" ? "Organización y cliente comercial" : (contact?.title || "Persona de contacto")}
        />
        <RecordActions
          canCreateActivity={canCreateActivity}
          canViewActivity={canViewActivity}
          canWrite={canWrite}
          onArchive={() => void archive()}
          onCreateActivity={onCreateActivity}
          onEdit={onEdit}
          onNavigate={onNavigate}
          recordId={record.id}
          recordType={kind}
        />
        <RecordAiPanel
          canApprove={canApproveAi}
          canAsk={canAskAi}
          canPropose={canProposeAi && canCreateActivity}
          entityId={record.id}
          entityType={kind}
          title={name}
        />
        <details className="record-about" open>
          <summary>{summaryLabel} {kind === "business" ? "esta empresa" : "este contacto"}</summary>
          <RecordPropertyList onNavigate={onNavigate} properties={properties} />
        </details>
        <RecordQuickSummary
          kind={kind}
          owner={record.ownerEmail}
          phone={summaryPhone}
          updatedAt={record.updatedAt}
        />
      </aside>

      <div className="record-content-area">
        <RecordTabs active={tab} onChange={setTab} tabs={tabs} />

        <div className="record-content-grid">
          <section className="record-center-panel">
            <div className="record-tab-panel" id={`record-tab-${tab}`} role="tabpanel" aria-labelledby={`record-tab-button-${tab}`} tabIndex={0}>
              {visibleError ? <div className="inline-alert" role="alert">{visibleError}</div> : !visibleData ? <p className="workspace-empty">Cargando relaciones…</p> : currentConfig ? <RelatedRecordSection
                canWrite={canWrite}
                config={currentConfig}
                onCreate={currentConfig.view ? () => onNavigate(currentConfig.view!, "") : undefined}
                onNavigate={onNavigate}
                openByDefault
                rows={currentRows}
                fullEmptyState
                onPreviewDocument={setPreviewDocument}
              /> : null}
            </div>
            <section className="record-recent-activity" aria-labelledby="record-recent-activity-title">
              <div className="record-recent-activity-heading">
                <div>
                  <p className="eyebrow">Seguimiento</p>
                  <h2 id="record-recent-activity-title">Actividad reciente</h2>
                </div>
                <span className="activity-filter-label"><History aria-hidden="true" size={14} /> Todas las actividades</span>
              </div>
              <ActivityTimeline events={timeline.slice(0, 8)} onOpenActivity={onOpenActivity} />
            </section>
          </section>

          <aside className="record-related-panel" aria-label="Registros relacionados">
            <div className="related-panel-heading"><h2>Relacionados</h2><span>{relatedCount}</span></div>
            {!visibleData ? <p className="workspace-empty">Cargando…</p> : <>
              <RelatedTimelineSection icon={CalendarClock} title="Actividades" events={timeline.filter((event) => event.label === "Actividad")} onOpenActivity={onOpenActivity} />
              <RelatedNotesSection notes={notes} />
              <RelatedTimelineSection icon={History} title="Historial" events={timeline.filter((event) => event.label === "Historial")} onOpenActivity={onOpenActivity} />
              {relatedPanelRelations.map(({ config, rows }) => <RelatedRecordSection config={config} key={config.key} rows={rows} onNavigate={onNavigate} onPreviewDocument={setPreviewDocument} openByDefault={rows.length > 0 && visibleRelationKeys.has(config.key)} />)}
            </>}
          </aside>
        </div>
      </div>
      {previewDocument && <StoredDocumentPreviewModal contentType={previewDocument.contentType} id={previewDocument.id} name={previewDocument.name} onClose={() => setPreviewDocument(null)} />}
    </section>
  );
}
