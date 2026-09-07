"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  financialModules,
  isModuleKey,
  modules,
  recordStatuses,
  type ModuleKey,
} from "../lib/modules";
import type { AuthorizedUser } from "../lib/authorization";
import {
  activityStatusLabels,
  leadStatusLabels,
  opportunityStageLabels,
} from "../lib/crm";
import { AgendaView } from "./agenda-view";
import { BusinessesView, ContactsView } from "./entity-views";
import { BillingView } from "./billing-view";
import { GlobalSearch } from "./global-search";
import { LeadsView } from "./leads-view";
import { ImportsView } from "./imports-view";
import { OpportunitiesView } from "./opportunities-view";
import { ProjectsView } from "./projects-view";
import { QuotationsView } from "./quotation-view";
import {
  CotizacionesReplacementPanel,
  CotizacionSourceDetails,
} from "./cotizaciones-replacement-panel";
import type {
  ActivityRow,
  BusinessRow,
  ContactRow,
  DocumentRow,
  LeadHistoryRow,
  LeadRow,
  OpportunityHistoryRow,
  OpportunityQuoteLink,
  OpportunityRow,
  RecordRow,
  StaffUser,
} from "./types";
import {
  Empty,
  Modal,
  Pagination,
  dateTime,
  money,
  useFormGuard,
  usePagination,
  useUrlState,
} from "./ui";

type View =
  | "resumen"
  | ModuleKey
  | "leads"
  | "opportunities"
  | "schedule"
  | "calendar"
  | "quotations"
  | "imports"
  | "credit-notes"
  | "receivables"
  | "collections"
  | "documentos"
  | "usuarios";

type SuccessLinks = {
  message: string;
  businessId: string;
  contactId: string;
  opportunityId: string;
} | null;

const emptyRecordForm = {
  title: "",
  status: "Activo",
  customerName: "",
  contact: "",
  amount: "0",
  balance: "0",
  dueDate: "",
  notes: "",
};

const crmModuleKeys = new Set<ModuleKey>([
  "clientes",
  "contactos",
  "proyectos",
  "ordenes-cambio",
]);
const invoiceOnlyViews = new Set<View>([
  "credit-notes",
  "receivables",
  "collections",
]);

export function OperationsClient({
  currentUser,
  initialRecords,
  initialDocuments,
  initialUsers,
  initialBusinesses,
  initialContacts,
  initialLeads,
  initialLeadHistory,
  initialOpportunities,
  initialOpportunityHistory,
  initialActivities,
  initialOpportunityQuotes,
  initialView,
  initialRecord,
  invoiceFeatureEnabled,
  signOutHref,
}: {
  currentUser: AuthorizedUser;
  initialRecords: RecordRow[];
  initialDocuments: DocumentRow[];
  initialUsers: StaffUser[];
  initialBusinesses: BusinessRow[];
  initialContacts: ContactRow[];
  initialLeads: LeadRow[];
  initialLeadHistory: LeadHistoryRow[];
  initialOpportunities: OpportunityRow[];
  initialOpportunityHistory: OpportunityHistoryRow[];
  initialActivities: ActivityRow[];
  initialOpportunityQuotes: OpportunityQuoteLink[];
  initialView?: string;
  initialRecord?: string;
  invoiceFeatureEnabled: boolean;
  signOutHref: string;
}) {
  const parsedInitialView = parseView(initialView ?? null);
  const requestedInitialView =
    !invoiceFeatureEnabled && invoiceOnlyViews.has(parsedInitialView)
      ? "resumen"
      : parsedInitialView;
  const requestedInitialRecord = initialRecord ?? null;
  const [view, setView] = useState<View>(requestedInitialView);
  const [records, setRecords] = useState(initialRecords);
  const [documents, setDocuments] = useState(initialDocuments);
  const [users, setUsers] = useState(initialUsers);
  const [businesses, setBusinesses] = useState(initialBusinesses);
  const [contacts, setContacts] = useState(initialContacts);
  const [leads, setLeads] = useState(initialLeads);
  const [leadHistory, setLeadHistory] = useState(initialLeadHistory);
  const [opportunities, setOpportunities] = useState(initialOpportunities);
  const [opportunityHistory, setOpportunityHistory] = useState(
    initialOpportunityHistory,
  );
  const [activities, setActivities] = useState(initialActivities);
  const [opportunityQuotes, setOpportunityQuotes] = useState(
    initialOpportunityQuotes,
  );
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(
    requestedInitialView === "clientes" ? requestedInitialRecord : null,
  );
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    requestedInitialView === "contactos" ? requestedInitialRecord : null,
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    requestedInitialView === "proyectos" ? requestedInitialRecord : null,
  );
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(
    requestedInitialView === "leads" ? requestedInitialRecord : null,
  );
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<
    string | null
  >(requestedInitialView === "opportunities" ? requestedInitialRecord : null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(
    requestedInitialView === "schedule" || requestedInitialView === "calendar"
      ? requestedInitialRecord
      : null,
  );
  const [selectedQuotationId, setSelectedQuotationId] = useState<string | null>(
    requestedInitialView === "quotations" ? requestedInitialRecord : null,
  );
  const [selectedImportId, setSelectedImportId] = useState<string | null>(
    requestedInitialView === "imports" ? requestedInitialRecord : null,
  );
  const [highlightRecordId, setHighlightRecordId] = useState<string | null>(
    requestedInitialRecord &&
      ![
        "clientes",
        "contactos",
        "proyectos",
        "leads",
        "opportunities",
        "schedule",
        "calendar",
        "quotations",
        "imports",
      ].includes(requestedInitialView)
      ? requestedInitialRecord
      : null,
  );
  const [search, setSearch] = useUrlState("q");
  const [editing, setEditing] = useState<RecordRow | null>(null);
  const [form, setForm] = useState(emptyRecordForm);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [successLinks, setSuccessLinks] = useState<SuccessLinks>(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerNavigation, setDrawerNavigation] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const canWrite = currentUser.role !== "viewer";
  const isAdmin = currentUser.role === "admin";

  const visibleRecords = useMemo(() => {
    const term = search.toLowerCase().trim();
    return records.filter((record) => {
      const inView = view === "resumen" || record.module === view;
      const matches =
        !term ||
        `${record.title} ${record.customerName} ${record.contact} ${record.notes} ${record.metadata}`
          .toLowerCase()
          .includes(term);
      return inView && matches;
    });
  }, [records, search, view]);

  const totals = useMemo(
    () => ({
      projects: records.filter(
        (record) =>
          record.module === "proyectos" &&
          !["Completado", "Cancelado"].includes(record.status),
      ).length,
      receivable: records
        .filter((record) => record.module === "facturas")
        .reduce((sum, record) => sum + record.balance, 0),
      leads: leads.filter(
        (lead) => !["converted", "unqualified"].includes(lead.status),
      ).length,
      opportunities: opportunities.filter(
        (opportunity) => opportunity.stage !== "closed",
      ).length,
      businesses: businesses.length,
      upcoming: activities.filter(
        (activity) =>
          activity.status === "planned" &&
          new Date(activity.endAt).getTime() >= Date.now(),
      ).length,
    }),
    [activities, businesses, leads, opportunities, records],
  );

  useEffect(() => {
    function applyUrl() {
      const params = new URLSearchParams(window.location.search);
      const parsedView = parseView(params.get("view"));
      const nextView =
        !invoiceFeatureEnabled && invoiceOnlyViews.has(parsedView)
          ? "resumen"
          : parsedView;
      const record = params.get("record");
      applySelection(nextView, record, false);
    }
    applyUrl();
    window.addEventListener("popstate", applyUrl);
    return () => window.removeEventListener("popstate", applyUrl);
    // Initial URL is consumed exactly once; later state is controlled by navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!highlightRecordId) return;
    document
      .getElementById(`record-${highlightRecordId}`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightRecordId, view]);

  useEffect(() => {
    const mediumDesktop = window.matchMedia(
      "(min-width: 1101px) and (max-width: 1320px)",
    );
    const applyDefault = () => setSidebarCollapsed(mediumDesktop.matches);
    applyDefault();
    mediumDesktop.addEventListener("change", applyDefault);
    return () => mediumDesktop.removeEventListener("change", applyDefault);
  }, []);

  useEffect(() => {
    const drawer = window.matchMedia("(max-width: 1100px)");
    const applyNavigationMode = () => {
      setDrawerNavigation(drawer.matches);
      if (!drawer.matches) setMobileNav(false);
    };
    applyNavigationMode();
    drawer.addEventListener("change", applyNavigationMode);
    return () => drawer.removeEventListener("change", applyNavigationMode);
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    function closeProfile(event: PointerEvent) {
      if (!profileRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    function closeProfileWithEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }
    document.addEventListener("pointerdown", closeProfile);
    document.addEventListener("keydown", closeProfileWithEscape);
    return () => {
      document.removeEventListener("pointerdown", closeProfile);
      document.removeEventListener("keydown", closeProfileWithEscape);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!mobileSearchOpen) return;
    const frame = window.requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>(".topbar-search-open input")
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [mobileSearchOpen]);

  useEffect(() => {
    if (!mobileNav) return;
    const sidebar = sidebarRef.current;
    const trigger = menuButtonRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    let focusReadyFrame = 0;
    const focusFrame = window.requestAnimationFrame(() => {
      focusReadyFrame = window.requestAnimationFrame(() => {
        sidebar
          ?.querySelector<HTMLElement>("a[href]")
          ?.focus({ preventScroll: true });
      });
    });
    const focusTimer = window.setTimeout(() => {
      sidebar
        ?.querySelector<HTMLElement>("a[href]")
        ?.focus({ preventScroll: true });
    }, 220);

    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileNav(false);
        return;
      }
      if (event.key !== "Tab" || !sidebar) return;
      const focusable = [
        ...sidebar.querySelectorAll<HTMLElement>(
          "a[href], button:not(:disabled)",
        ),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keydown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.cancelAnimationFrame(focusReadyFrame);
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      trigger?.focus();
    };
  }, [mobileNav]);

  function clearSelections() {
    setSelectedBusinessId(null);
    setSelectedContactId(null);
    setSelectedProjectId(null);
    setSelectedLeadId(null);
    setSelectedOpportunityId(null);
    setSelectedActivityId(null);
    setSelectedQuotationId(null);
    setSelectedImportId(null);
    setHighlightRecordId(null);
  }

  function applySelection(next: View, record: string | null, push = true) {
    clearSelections();
    setView(next);
    setSearch("");
    setShowForm(false);
    setEditing(null);
    setMobileNav(false);
    if (next === "clientes") setSelectedBusinessId(record);
    else if (next === "contactos") setSelectedContactId(record);
    else if (next === "proyectos") setSelectedProjectId(record);
    else if (next === "leads") setSelectedLeadId(record);
    else if (next === "opportunities") setSelectedOpportunityId(record);
    else if (next === "schedule" || next === "calendar")
      setSelectedActivityId(record);
    else if (next === "quotations") setSelectedQuotationId(record);
    else if (next === "imports") setSelectedImportId(record);
    else if (record) setHighlightRecordId(record);
    if (push) {
      const params = new URLSearchParams();
      if (next !== "resumen") params.set("view", publicViewName(next));
      if (record) params.set("record", record);
      const url = params.size ? `/app?${params}` : "/app";
      window.history.pushState({}, "", url);
      window.dispatchEvent(new Event("hidaca:urlstate"));
    }
  }

  function selectView(next: View) {
    setMessage("");
    setSuccessLinks(null);
    applySelection(next, null);
  }

  function navigateView(
    event: ReactMouseEvent<HTMLAnchorElement>,
    next: View,
    record: string | null = null,
  ) {
    if (isModifiedClick(event)) return;
    event.preventDefault();
    if (record) applySelection(next, record);
    else selectView(next);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyRecordForm);
    setShowForm(true);
  }

  function openEdit(record: RecordRow) {
    setEditing(record);
    setForm({
      title: record.title,
      status: record.status,
      customerName: record.customerName,
      contact: record.contact,
      amount: String(record.amount),
      balance: String(record.balance),
      dueDate: record.dueDate?.slice(0, 10) ?? "",
      notes: record.notes,
    });
    setShowForm(true);
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (!isModuleKey(view)) return;
    setBusy(true);
    setMessage("");
    const response = await fetch(
      editing ? `/api/records/${editing.id}` : "/api/records",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, module: view }),
      },
    );
    const result = (await response.json()) as {
      record?: RecordRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.record) {
      setMessage(result.error ?? "No se pudo guardar.");
      return;
    }
    setRecords(
      editing
        ? records.map((item) =>
            item.id === result.record!.id ? result.record! : item,
          )
        : [result.record, ...records],
    );
    setShowForm(false);
    setEditing(null);
    setMessage("Registro guardado.");
  }

  async function archiveRecord(record: RecordRow) {
    setConfirmation({
      message: `¿Archivar “${record.title}”?`,
      confirmLabel: "Archivar",
      action: async () => {
        const response = await fetch(`/api/records/${record.id}`, {
          method: "DELETE",
        });
        if (response.ok) {
          setRecords(records.filter((item) => item.id !== record.id));
          setMessage("Registro archivado.");
        } else {
          const result = (await response.json()) as { error?: string };
          setMessage(result.error ?? "No se pudo archivar.");
        }
      },
    });
  }

  async function uploadDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/documents", {
      method: "POST",
      body: data,
    });
    const result = (await response.json()) as {
      document?: DocumentRow;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.document) {
      setMessage(result.error ?? "No se pudo cargar el documento.");
      return;
    }
    setDocuments([result.document, ...documents]);
    event.currentTarget.reset();
    setMessage("Documento cargado.");
  }

  async function deleteDocument(document: DocumentRow) {
    setConfirmation({
      message: `¿Eliminar “${document.name}” del almacenamiento?`,
      confirmLabel: "Eliminar",
      action: async () => {
        const response = await fetch(`/api/documents/${document.id}`, {
          method: "DELETE",
        });
        if (response.ok) {
          setDocuments(documents.filter((item) => item.id !== document.id));
          setMessage("Documento eliminado.");
        } else {
          const result = (await response.json()) as { error?: string };
          setMessage(result.error ?? "No se pudo eliminar el documento.");
        }
      },
    });
  }

  async function addUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(data)),
    });
    const result = (await response.json()) as {
      user?: StaffUser;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.user) {
      setMessage(result.error ?? "No se pudo guardar el usuario.");
      return;
    }
    setUsers([
      result.user,
      ...users.filter((item) => item.id !== result.user!.id),
    ]);
    event.currentTarget.reset();
    setMessage("Acceso actualizado.");
  }

  async function toggleUser(user: StaffUser) {
    const response = await fetch(`/api/users/${user.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ active: !user.active }),
    });
    const result = (await response.json()) as {
      user?: StaffUser;
      error?: string;
    };
    if (!response.ok || !result.user) {
      setMessage(result.error ?? "No se pudo actualizar el usuario.");
      return;
    }
    setUsers(
      users.map((item) => (item.id === result.user!.id ? result.user! : item)),
    );
  }

  const activeModule = modules.find((module) => module.key === view);
  const operationalModules = modules.filter(
    (module) => !crmModuleKeys.has(module.key),
  );

  return (
    <div
      className={
        sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"
      }
    >
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      {confirmation && (
        <Modal
          eyebrow="Confirmación requerida"
          onClose={() => {
            if (!busy) setConfirmation(null);
          }}
          role="alertdialog"
          title="Confirma la acción"
        >
          <p>{confirmation.message}</p>
          <div className="confirm-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirmation(null)}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="danger-button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await confirmation.action();
                setBusy(false);
                setConfirmation(null);
              }}
              type="button"
            >
              {busy ? "Procesando…" : confirmation.confirmLabel}
            </button>
          </div>
        </Modal>
      )}
      {mobileNav && (
        <div
          aria-hidden="true"
          className="nav-backdrop"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside
        className={mobileNav ? "sidebar sidebar-open" : "sidebar"}
        ref={sidebarRef}
      >
        <div className="sidebar-brand">
          <span>H</span>
          <div>
            <strong>HIDACA</strong>
            <small>Operaciones</small>
          </div>
        </div>
        <nav aria-label="Módulos">
          <NavLink
            active={view === "resumen"}
            href={viewHref("resumen")}
            icon="IN"
            label="Inicio"
            onClick={(event) => navigateView(event, "resumen")}
          />
          <p>CRM</p>
          <NavLink
            active={view === "clientes"}
            href={viewHref("clientes")}
            icon="EM"
            label="Empresas"
            onClick={(event) => navigateView(event, "clientes")}
          />
          <NavLink
            active={view === "contactos"}
            href={viewHref("contactos")}
            icon="CO"
            label="Contactos"
            onClick={(event) => navigateView(event, "contactos")}
          />
          <NavLink
            active={view === "proyectos"}
            href={viewHref("proyectos")}
            icon="PR"
            label="Proyectos"
            onClick={(event) => navigateView(event, "proyectos")}
          />
          <NavLink
            active={view === "leads"}
            href={viewHref("leads")}
            icon="PS"
            label="Prospectos"
            onClick={(event) => navigateView(event, "leads")}
          />
          <NavLink
            active={view === "opportunities"}
            href={viewHref("opportunities")}
            icon="OP"
            label="Oportunidades"
            onClick={(event) => navigateView(event, "opportunities")}
          />
          <NavLink
            active={view === "ordenes-cambio"}
            href={viewHref("ordenes-cambio")}
            icon="CS"
            label="Casos"
            onClick={(event) => navigateView(event, "ordenes-cambio")}
          />
          <p>Operaciones</p>
          {operationalModules.map((module) => (
            <NavLink
              active={view === module.key}
              href={viewHref(module.key)}
              icon={module.icon}
              key={module.key}
              label={module.label}
              onClick={(event) => navigateView(event, module.key)}
            />
          ))}
          {invoiceFeatureEnabled && (
            <>
              <p>Facturación y cobros</p>
              <NavLink
                active={view === "credit-notes"}
                href={viewHref("credit-notes")}
                icon="NC"
                label="Notas de crédito"
                onClick={(event) => navigateView(event, "credit-notes")}
              />
              <NavLink
                active={view === "receivables"}
                href={viewHref("receivables")}
                icon="CC"
                label="Cuentas por cobrar"
                onClick={(event) => navigateView(event, "receivables")}
              />
              <NavLink
                active={view === "collections"}
                href={viewHref("collections")}
                icon="CB"
                label="Cobranza"
                onClick={(event) => navigateView(event, "collections")}
              />
            </>
          )}
          <p>Agenda</p>
          <NavLink
            active={view === "schedule"}
            href={viewHref("schedule")}
            icon="AC"
            label="Actividades"
            onClick={(event) => navigateView(event, "schedule")}
          />
          <NavLink
            active={view === "calendar"}
            href={viewHref("calendar")}
            icon="CL"
            label="Calendario"
            onClick={(event) => navigateView(event, "calendar")}
          />
          <p>Archivos y acceso</p>
          <NavLink
            active={view === "quotations"}
            href={viewHref("quotations")}
            icon="QT"
            label="Cotizaciones fuente"
            onClick={(event) => navigateView(event, "quotations")}
          />
          <NavLink
            active={view === "imports"}
            href={viewHref("imports")}
            icon="IM"
            label="Importaciones"
            onClick={(event) => navigateView(event, "imports")}
          />
          <NavLink
            active={view === "documentos"}
            href={viewHref("documentos")}
            icon="DO"
            label="Documentos"
            onClick={(event) => navigateView(event, "documentos")}
          />
          {isAdmin && (
            <NavLink
              active={view === "usuarios"}
              href={viewHref("usuarios")}
              icon="US"
              label="Usuarios"
              onClick={(event) => navigateView(event, "usuarios")}
            />
          )}
        </nav>
      </aside>

      <div
        aria-hidden={mobileNav ? "true" : undefined}
        className="app-main"
        inert={mobileNav}
      >
        <header className="topbar">
          <div className="topbar-leading">
            <button
              aria-expanded={mobileNav}
              aria-label={
                mobileNav
                  ? "Cerrar navegación"
                  : drawerNavigation
                    ? "Abrir navegación"
                  : sidebarCollapsed
                    ? "Expandir navegación"
                    : "Contraer navegación"
              }
              className="menu-button"
              onClick={() => {
                if (drawerNavigation) {
                  setMobileNav((value) => !value);
                } else {
                  setSidebarCollapsed((value) => !value);
                }
              }}
              ref={menuButtonRef}
              type="button"
            >
              <span aria-hidden="true">☰</span>
            </button>
            <DashboardLink
              className="topbar-brand"
              href={viewHref("resumen")}
              onNavigate={() => applySelection("resumen", null)}
            >
              <span aria-hidden="true">H</span>
              <strong>HIDACA</strong>
            </DashboardLink>
          </div>
          <div
            className={
              mobileSearchOpen
                ? "topbar-search topbar-search-open"
                : "topbar-search"
            }
          >
            <GlobalSearch
              onNavigate={(item) => {
                const next = searchEntityView(item.entityType);
                applySelection(next, item.entityId);
                setMobileSearchOpen(false);
              }}
            />
          </div>
          <button
            aria-expanded={mobileSearchOpen}
            aria-label={
              mobileSearchOpen ? "Cerrar búsqueda" : "Abrir búsqueda global"
            }
            className="mobile-search-button"
            onClick={() => setMobileSearchOpen((value) => !value)}
            type="button"
          >
            <span aria-hidden="true">⌕</span>
          </button>
          <div className="profile-menu" ref={profileRef}>
            <button
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-label={`Perfil de ${currentUser.displayName}`}
              className="profile-trigger"
              onClick={() => setProfileOpen((value) => !value)}
              type="button"
            >
              <span className="profile-avatar" aria-hidden="true">
                {currentUser.displayName.trim().charAt(0).toUpperCase() || "H"}
              </span>
              <span className="user-summary">
                <strong>{currentUser.displayName}</strong>
                <small>{roleLabel(currentUser.role)}</small>
              </span>
              <span className="profile-chevron" aria-hidden="true">
                ▾
              </span>
            </button>
            {profileOpen && (
              <div className="profile-dropdown" role="menu">
                <div>
                  <strong>{currentUser.displayName}</strong>
                  <small>{roleLabel(currentUser.role)}</small>
                </div>
                <a href={signOutHref} role="menuitem">
                  Cerrar sesión
                </a>
              </div>
            )}
          </div>
        </header>

        <main className="workspace" id="main-content" tabIndex={-1}>
          {message && (
            <div className="flash" role="status">
              {message}
            </div>
          )}
          {successLinks && (
            <div className="flash action-flash" role="status">
              <span>{successLinks.message}</span>
              <div>
                <a
                  href={`${viewHref("clientes")}&record=${encodeURIComponent(successLinks.businessId)}`}
                  onClick={(event) =>
                    navigateView(event, "clientes", successLinks.businessId)
                  }
                >
                  Abrir empresa
                </a>
                <a
                  href={`${viewHref("contactos")}&record=${encodeURIComponent(successLinks.contactId)}`}
                  onClick={(event) =>
                    navigateView(event, "contactos", successLinks.contactId)
                  }
                >
                  Abrir contacto
                </a>
                <a
                  href={`${viewHref("opportunities")}&record=${encodeURIComponent(successLinks.opportunityId)}`}
                  onClick={(event) =>
                    navigateView(
                      event,
                      "opportunities",
                      successLinks.opportunityId,
                    )
                  }
                >
                  Abrir oportunidad
                </a>
              </div>
            </div>
          )}
          {view === "resumen" ? (
            <Dashboard
              activities={activities}
              businesses={businesses}
              leads={leads}
              opportunities={opportunities}
              records={records}
              totals={totals}
              onNavigate={(next, record) => {
                if (record) applySelection(next, record);
                else selectView(next);
              }}
            />
          ) : view === "clientes" ? (
            <BusinessesView
              activities={activities}
              businesses={businesses}
              canWrite={canWrite}
              currentUserEmail={currentUser.email}
              onOpenActivity={(id) => applySelection("schedule", id)}
              selectedId={selectedBusinessId}
              setBusinesses={setBusinesses}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedBusinessId(id);
                if (id)
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=businesses&record=${encodeURIComponent(id)}`,
                  );
              }}
            />
          ) : view === "contactos" ? (
            <ContactsView
              activities={activities}
              businesses={businesses}
              canWrite={canWrite}
              contacts={contacts}
              currentUserEmail={currentUser.email}
              onOpenActivity={(id) => applySelection("schedule", id)}
              selectedId={selectedContactId}
              setContacts={setContacts}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedContactId(id);
                if (id)
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=contacts&record=${encodeURIComponent(id)}`,
                  );
              }}
            />
          ) : view === "proyectos" ? (
            <ProjectsView
              businesses={businesses}
              canWrite={canWrite}
              contacts={contacts}
              currentUserEmail={currentUser.email}
              selectedId={selectedProjectId}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedProjectId(id);
                if (id) {
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=projects&record=${encodeURIComponent(id)}`,
                  );
                }
              }}
            />
          ) : view === "leads" ? (
            <LeadsView
              activities={activities}
              businesses={businesses}
              canWrite={canWrite}
              contacts={contacts}
              currentUserEmail={currentUser.email}
              history={leadHistory}
              isAdmin={isAdmin}
              leads={leads}
              onConverted={(result) => {
                if (!businesses.some((item) => item.id === result.business.id))
                  setBusinesses([result.business, ...businesses]);
                if (!contacts.some((item) => item.id === result.contact.id))
                  setContacts([result.contact, ...contacts]);
                setOpportunities([result.opportunity, ...opportunities]);
                setSuccessLinks({
                  message:
                    "Lead converted successfully. Business, Contact, and Opportunity are linked.",
                  businessId: result.business.id,
                  contactId: result.contact.id,
                  opportunityId: result.opportunity.id,
                });
                setMessage("");
                applySelection("opportunities", result.opportunity.id);
              }}
              onOpenActivity={(id) => applySelection("schedule", id)}
              selectedId={selectedLeadId}
              setHistory={setLeadHistory}
              setLeads={setLeads}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedLeadId(id);
                if (id)
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=leads&record=${encodeURIComponent(id)}`,
                  );
              }}
            />
          ) : view === "opportunities" ? (
            <OpportunitiesView
              activities={activities}
              businesses={businesses}
              canWrite={canWrite}
              contacts={contacts}
              currentUserEmail={currentUser.email}
              history={opportunityHistory}
              isAdmin={isAdmin}
              onOpenActivity={(id) => applySelection("schedule", id)}
              opportunities={opportunities}
              quoteLinks={opportunityQuotes}
              records={records}
              selectedId={selectedOpportunityId}
              setHistory={setOpportunityHistory}
              setMessage={setMessage}
              setOpportunities={setOpportunities}
              setQuoteLinks={setOpportunityQuotes}
              setRecords={setRecords}
              setSelectedId={(id) => {
                setSelectedOpportunityId(id);
                if (id)
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=opportunities&record=${encodeURIComponent(id)}`,
                  );
              }}
            />
          ) : view === "schedule" || view === "calendar" ? (
            <AgendaView
              activities={activities}
              businesses={businesses}
              canWrite={canWrite}
              contacts={contacts}
              currentUserEmail={currentUser.email}
              leads={leads}
              mode={view}
              opportunities={opportunities}
              records={records}
              selectedId={selectedActivityId}
              setActivities={setActivities}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedActivityId(id);
                if (id)
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=${view}&record=${encodeURIComponent(id)}`,
                  );
              }}
            />
          ) : view === "quotations" ? (
            <QuotationsView
              businesses={businesses}
              canWrite={canWrite}
              contacts={contacts}
              selectedId={selectedQuotationId}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedQuotationId(id);
                if (id) {
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=quotations&record=${encodeURIComponent(id)}`,
                  );
                }
              }}
            />
          ) : view === "imports" ? (
            <ImportsView
              canWrite={canWrite}
              isAdmin={isAdmin}
              onAccepted={(links) => {
                setMessage(
                  "Importación aceptada; los registros se crearon de forma atómica.",
                );
                if (links.quotationId) {
                  applySelection("quotations", links.quotationId);
                } else {
                  setSelectedImportId(null);
                }
              }}
              selectedId={selectedImportId}
              setMessage={setMessage}
              setSelectedId={(id) => {
                setSelectedImportId(id);
                if (id) {
                  window.history.pushState(
                    {},
                    "",
                    `/app?view=imports&record=${encodeURIComponent(id)}`,
                  );
                }
              }}
            />
          ) : invoiceFeatureEnabled &&
            (view === "facturas" ||
              view === "pagos" ||
              view === "credit-notes" ||
              view === "receivables" ||
              view === "collections") ? (
            <BillingView
              businesses={businesses}
              canWrite={canWrite}
              currentUserEmail={currentUser.email}
              mode={view}
              setMessage={setMessage}
            />
          ) : view === "documentos" ? (
            <DocumentsView
              busy={busy}
              canWrite={canWrite}
              documents={documents}
              highlightId={highlightRecordId}
              onDelete={deleteDocument}
              onUpload={uploadDocument}
              records={records}
            />
          ) : view === "usuarios" ? (
            <UsersView
              busy={busy}
              onAdd={addUser}
              onToggle={toggleUser}
              users={users}
            />
          ) : (
            <>
              <div className="breadcrumbs">
                <span>Inicio</span>
                <i>/</i>
                <span aria-current="page">{activeModule?.label}</span>
              </div>
              <div className="page-heading">
                <div>
                  <p className="eyebrow">Gestión</p>
                  <h1>{activeModule?.label}</h1>
                  <p>Consulta, registra y actualiza información.</p>
                </div>
                {canWrite && (
                  <button className="primary-button" onClick={openCreate}>
                    Nuevo registro
                  </button>
                )}
              </div>
              {view === "cotizaciones" && isAdmin && (
                <CotizacionesReplacementPanel />
              )}
              <div className="toolbar">
                <input
                  aria-label="Buscar registros"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por título, empresa o contacto…"
                  value={search}
                />
                <span>{visibleRecords.length} registros</span>
              </div>
              {showForm && (
                <RecordForm
                  busy={busy}
                  editing={Boolean(editing)}
                  financial={financialModules.has(view as ModuleKey)}
                  form={form}
                  onCancel={() => setShowForm(false)}
                  onSubmit={saveRecord}
                  setForm={setForm}
                />
              )}
              <section className="panel">
                <RecordsTable
                  canWrite={canWrite}
                  highlightId={highlightRecordId}
                  onArchive={archiveRecord}
                  onEdit={openEdit}
                  records={visibleRecords}
                />
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function NavLink({
  active,
  href,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  href: string;
  icon: string;
  label: string;
  onClick(event: ReactMouseEvent<HTMLAnchorElement>): void;
}) {
  return (
    <a
      aria-current={active ? "page" : undefined}
      className={active ? "active" : ""}
      href={href}
      onClick={onClick}
    >
      <span>{icon}</span> {label}
    </a>
  );
}

function DashboardLink({
  children,
  className,
  href,
  onNavigate,
}: {
  children: ReactNode;
  className?: string;
  href: string;
  onNavigate(): void;
}) {
  return (
    <a
      className={className}
      href={href}
      onClick={(event) => {
        if (isModifiedClick(event)) return;
        event.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}

function Dashboard({
  totals,
  records,
  leads,
  opportunities,
  activities,
  businesses,
  onNavigate,
}: {
  totals: {
    projects: number;
    receivable: number;
    leads: number;
    opportunities: number;
    businesses: number;
    upcoming: number;
  };
  records: RecordRow[];
  leads: LeadRow[];
  opportunities: OpportunityRow[];
  activities: ActivityRow[];
  businesses: BusinessRow[];
  onNavigate(view: View, record?: string): void;
}) {
  const upcomingActivities = activities
    .filter((activity) => activity.status === "planned")
    .sort(
      (first, second) =>
        new Date(first.startAt).getTime() - new Date(second.startAt).getTime(),
    )
    .slice(0, 6);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Panel operativo</p>
          <h1>Resumen</h1>
          <p>CRM, agenda, proyectos y finanzas de HIDACA.</p>
        </div>
      </div>
      <section className="metric-grid metric-grid-six">
        <DashboardLink
          className="metric-card"
          href={viewHref("clientes")}
          onNavigate={() => onNavigate("clientes")}
        >
          <span className="metric-heading">
            <span className="metric-icon" aria-hidden="true">
              EM
            </span>
            <span>Empresas</span>
          </span>
          <strong>{totals.businesses}</strong>
          <small>Clientes registrados</small>
        </DashboardLink>
        <DashboardLink
          className="metric-card"
          href={viewHref("leads")}
          onNavigate={() => onNavigate("leads")}
        >
          <span className="metric-heading">
            <span className="metric-icon" aria-hidden="true">
              PR
            </span>
            <span>Prospectos abiertos</span>
          </span>
          <strong>{totals.leads}</strong>
          <small>Por calificar o convertir</small>
        </DashboardLink>
        <DashboardLink
          className="metric-card"
          href={viewHref("opportunities")}
          onNavigate={() => onNavigate("opportunities")}
        >
          <span className="metric-heading">
            <span className="metric-icon" aria-hidden="true">
              OP
            </span>
            <span>Oportunidades abiertas</span>
          </span>
          <strong>{totals.opportunities}</strong>
          <small>En el pipeline comercial</small>
        </DashboardLink>
        <DashboardLink
          className="metric-card"
          href={viewHref("schedule")}
          onNavigate={() => onNavigate("schedule")}
        >
          <span className="metric-heading">
            <span className="metric-icon" aria-hidden="true">
              AC
            </span>
            <span>Próximas actividades</span>
          </span>
          <strong>{totals.upcoming}</strong>
          <small>Programadas desde hoy</small>
        </DashboardLink>
        <DashboardLink
          className="metric-card"
          href={viewHref("proyectos")}
          onNavigate={() => onNavigate("proyectos")}
        >
          <span className="metric-heading">
            <span className="metric-icon" aria-hidden="true">
              PY
            </span>
            <span>Proyectos activos</span>
          </span>
          <strong>{totals.projects}</strong>
          <small>En ejecución o seguimiento</small>
        </DashboardLink>
        <DashboardLink
          className="metric-card metric-card-currency"
          href={viewHref("facturas")}
          onNavigate={() => onNavigate("facturas")}
        >
          <span className="metric-heading">
            <span className="metric-icon" aria-hidden="true">
              RD$
            </span>
            <span>Balance por cobrar</span>
          </span>
          <strong title={money(totals.receivable)}>
            {money(totals.receivable)}
          </strong>
          <small>Facturas con balance pendiente</small>
        </DashboardLink>
      </section>
      <section className="dashboard-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Resumen del pipeline</h2>
              <p>Prospectos y oportunidades en seguimiento.</p>
            </div>
            <DashboardLink
              className="panel-action"
              href={viewHref("opportunities")}
              onNavigate={() => onNavigate("opportunities")}
            >
              Ver pipeline
            </DashboardLink>
          </div>
          <div className="snapshot-list">
            {leads.slice(0, 4).map((lead) => (
              <DashboardLink
                className="snapshot-row snapshot-lead"
                href={`${viewHref("leads")}&record=${encodeURIComponent(lead.id)}`}
                key={lead.id}
                onNavigate={() => onNavigate("leads", lead.id)}
              >
                <span className="snapshot-type" aria-hidden="true">
                  PR
                </span>
                <span className="snapshot-copy">
                  <small className="type-label">Prospecto</small>
                  <strong>{lead.businessName}</strong>
                  <small>{lead.contactName || "Sin contacto asignado"}</small>
                </span>
                <span className={`status status-${lead.status}`}>
                  {leadStatusLabels[lead.status]}
                </span>
              </DashboardLink>
            ))}
            {opportunities.slice(0, 4).map((opportunity) => (
              <DashboardLink
                className="snapshot-row snapshot-opportunity"
                href={`${viewHref("opportunities")}&record=${encodeURIComponent(opportunity.id)}`}
                key={opportunity.id}
                onNavigate={() => onNavigate("opportunities", opportunity.id)}
              >
                <span className="snapshot-type" aria-hidden="true">
                  OP
                </span>
                <span className="snapshot-copy">
                  <small className="type-label">Oportunidad</small>
                  <strong>{opportunity.title}</strong>
                  <small>
                    {
                      businesses.find(
                        (business) => business.id === opportunity.businessId,
                      )?.name
                    }
                  </small>
                  <small className="snapshot-meta">
                    {money(opportunity.estimatedValue)}
                    {opportunity.expectedCloseDate
                      ? ` · Próxima acción: cierre previsto ${dateTime(opportunity.expectedCloseDate)}`
                      : " · Próxima acción sin fecha"}
                  </small>
                </span>
                <span className={`status status-${opportunity.stage}`}>
                  {opportunityStageLabels[opportunity.stage]}
                </span>
              </DashboardLink>
            ))}
            {!leads.length && !opportunities.length && (
              <Empty text="No hay actividad en el pipeline." />
            )}
          </div>
        </article>
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Próximas actividades</h2>
              <p>Seguimiento operativo y comercial programado.</p>
            </div>
            <DashboardLink
              className="panel-action"
              href={viewHref("calendar")}
              onNavigate={() => onNavigate("calendar")}
            >
              Ver calendario
            </DashboardLink>
          </div>
          <div className="snapshot-list">
            {upcomingActivities.map((activity) => (
              <DashboardLink
                className="snapshot-row snapshot-activity"
                href={`${viewHref("schedule")}&record=${encodeURIComponent(activity.id)}`}
                key={activity.id}
                onNavigate={() => onNavigate("schedule", activity.id)}
              >
                <span className="snapshot-type" aria-hidden="true">
                  AC
                </span>
                <span className="snapshot-copy">
                  <small className="type-label">
                    {activity.allDay ? "Día completo" : "Actividad"}
                  </small>
                  <strong>{activity.title}</strong>
                  <small>{dateTime(activity.startAt, true)}</small>
                  <small className="snapshot-meta">
                    Responsable: {activity.ownerEmail}
                    {activity.relatedType && activity.relatedId
                      ? ` · ${relatedRecordLabel(
                          activity,
                          businesses,
                          leads,
                          opportunities,
                          records,
                        )}`
                      : " · Sin registro relacionado"}
                  </small>
                </span>
                <span className={`status status-${activity.status}`}>
                  {activityStatusLabels[activity.status]}
                </span>
              </DashboardLink>
            ))}
            {!upcomingActivities.length && (
              <Empty text="No hay actividades programadas." />
            )}
          </div>
        </article>
      </section>
      <section className="panel dashboard-recent">
        <div className="panel-heading">
          <h2>Actividad reciente</h2>
          <p>Últimos registros operativos.</p>
        </div>
        <RecordsTable
          canWrite={false}
          highlightId={null}
          onArchive={() => undefined}
          onEdit={() => undefined}
          records={records.slice(0, 10)}
        />
      </section>
    </>
  );
}

function roleLabel(role: AuthorizedUser["role"]) {
  if (role === "admin") return "Administrador";
  if (role === "operator") return "Operador";
  return "Solo lectura";
}

function relatedRecordLabel(
  activity: ActivityRow,
  businesses: BusinessRow[],
  leads: LeadRow[],
  opportunities: OpportunityRow[],
  records: RecordRow[],
) {
  if (!activity.relatedType || !activity.relatedId) {
    return "Sin registro relacionado";
  }
  if (activity.relatedType === "business") {
    return `Empresa: ${
      businesses.find((item) => item.id === activity.relatedId)?.name ??
      "Registro no disponible"
    }`;
  }
  if (activity.relatedType === "lead") {
    return `Prospecto: ${
      leads.find((item) => item.id === activity.relatedId)?.businessName ??
      "Registro no disponible"
    }`;
  }
  if (activity.relatedType === "opportunity") {
    return `Oportunidad: ${
      opportunities.find((item) => item.id === activity.relatedId)?.title ??
      "Registro no disponible"
    }`;
  }
  const record = records.find((item) => item.id === activity.relatedId);
  return `${relatedTypeLabel(activity.relatedType)}: ${
    record?.title ?? "Registro relacionado"
  }`;
}

function relatedTypeLabel(type: string) {
  const labels: Record<string, string> = {
    contact: "Contacto",
    case: "Caso",
    project: "Proyecto",
  };
  return labels[type] ?? "Registro";
}

function DocumentsView({
  documents,
  records,
  canWrite,
  busy,
  highlightId,
  onUpload,
  onDelete,
}: {
  documents: DocumentRow[];
  records: RecordRow[];
  canWrite: boolean;
  busy: boolean;
  highlightId: string | null;
  onUpload(event: FormEvent<HTMLFormElement>): void;
  onDelete(document: DocumentRow): void;
}) {
  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">Documentos</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">R2 privado</p>
          <h1>Documentos</h1>
          <p>Archivos vinculados a la operación.</p>
        </div>
      </div>
      {canWrite && (
        <form className="upload-panel" onSubmit={onUpload}>
          <label>
            Archivo
            <input
              accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,.xlsx"
              name="file"
              required
              type="file"
            />
          </label>
          <label>
            Registro relacionado (opcional)
            <select defaultValue="" name="recordId">
              <option value="">Sin relación</option>
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title}
                </option>
              ))}
            </select>
          </label>
          <button className="primary-button" disabled={busy}>
            Cargar
          </button>
          <small>PDF, imagen, DOCX o XLSX. Máximo 10 MB.</small>
        </form>
      )}
      <section className="panel">
        <div className="document-list">
          {documents.length === 0 ? (
            <Empty text="No hay documentos cargados." />
          ) : (
            documents.map((document) => (
              <article
                className={highlightId === document.id ? "highlight-row" : ""}
                id={`record-${document.id}`}
                key={document.id}
              >
                <div className="file-icon">DOC</div>
                <div>
                  <strong>{document.name}</strong>
                  <span>
                    {formatBytes(document.size)} ·{" "}
                    {dateTime(document.createdAt)} · {document.createdBy}
                  </span>
                </div>
                <a href={`/api/documents/${document.id}`}>Descargar</a>
                {canWrite && (
                  <button
                    className="danger-link"
                    onClick={() => onDelete(document)}
                  >
                    Eliminar
                  </button>
                )}
              </article>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function UsersView({
  users,
  busy,
  onAdd,
  onToggle,
}: {
  users: StaffUser[];
  busy: boolean;
  onAdd(event: FormEvent<HTMLFormElement>): void;
  onToggle(user: StaffUser): void;
}) {
  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">Usuarios</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">Seguridad</p>
          <h1>Usuarios autorizados</h1>
          <p>La identidad de ChatGPT se valida contra esta lista D1.</p>
        </div>
      </div>
      <form className="user-form" onSubmit={onAdd}>
        <label>
          Nombre
          <input autoComplete="name" name="name" required />
        </label>
        <label>
          Correo de ChatGPT
          <input
            autoComplete="email"
            name="email"
            required
            spellCheck={false}
            type="email"
          />
        </label>
        <label>
          Rol
          <select defaultValue="operator" name="role">
            <option value="operator">Operador</option>
            <option value="viewer">Solo lectura</option>
            <option value="admin">Administrador</option>
          </select>
        </label>
        <button className="primary-button" disabled={busy}>
          Autorizar
        </button>
      </form>
      <section className="panel">
        <div className="user-list">
          {users.map((user) => (
            <article key={user.id}>
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <span className={`status ${user.active ? "status-active" : ""}`}>
                {user.active ? "Activo" : "Inactivo"}
              </span>
              <span>{user.role}</span>
              <button className="text-button" onClick={() => onToggle(user)}>
                {user.active ? "Desactivar" : "Activar"}
              </button>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function RecordsTable({
  records,
  canWrite,
  highlightId,
  onEdit,
  onArchive,
}: {
  records: RecordRow[];
  canWrite: boolean;
  highlightId: string | null;
  onEdit(record: RecordRow): void;
  onArchive(record: RecordRow): void;
}) {
  const { page, pageItems, setPage, totalPages } = usePagination(records);
  if (records.length === 0)
    return <Empty text="No hay registros en esta vista." />;
  return (
    <>
      <div className="table-wrap">
        <table className="responsive-table">
          <thead>
            <tr>
              <th>Registro</th>
              <th>Estado</th>
              <th>Empresa / contacto</th>
              <th>Monto</th>
              <th>Balance</th>
              <th>Fecha</th>
              {canWrite && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((record) => (
              <tr
                className={highlightId === record.id ? "highlight-row" : ""}
                id={`record-${record.id}`}
                key={record.id}
              >
                <td data-label="Registro">
                  <strong>{record.title}</strong>
                  <span>
                    {modules.find((item) => item.key === record.module)
                      ?.label ?? record.module}
                  </span>
                  {record.module === "cotizaciones" && (
                    <CotizacionSourceDetails metadata={record.metadata} />
                  )}
                </td>
                <td data-label="Estado">
                  <span className="status">{record.status || "—"}</span>
                </td>
                <td data-label="Empresa / contacto">
                  {record.customerName || record.contact || "—"}
                </td>
                <td data-label="Monto">
                  {record.amount ? money(record.amount) : "—"}
                </td>
                <td data-label="Balance">
                  {record.balance ? money(record.balance) : "—"}
                </td>
                <td data-label="Fecha">
                  {dateTime(record.dueDate ?? record.updatedAt)}
                </td>
                {canWrite && (
                  <td data-label="Acciones">
                    <button
                      className="text-button"
                      onClick={() => onEdit(record)}
                    >
                      Editar
                    </button>
                    <button
                      className="danger-link"
                      onClick={() => onArchive(record)}
                    >
                      Archivar
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
    </>
  );
}

function RecordForm({
  form,
  setForm,
  editing,
  financial,
  busy,
  onSubmit,
  onCancel,
}: {
  form: typeof emptyRecordForm;
  setForm(value: typeof emptyRecordForm): void;
  editing: boolean;
  financial: boolean;
  busy: boolean;
  onSubmit(event: FormEvent): void;
  onCancel(): void;
}) {
  function field(name: keyof typeof emptyRecordForm, value: string) {
    setForm({ ...form, [name]: value });
  }
  const { formProps, requestCancel } = useFormGuard(onCancel);
  return (
    <form {...formProps} className="record-form" onSubmit={onSubmit}>
      <div className="form-heading">
        <h2>{editing ? "Editar registro" : "Nuevo registro"}</h2>
        <button aria-label="Cerrar" onClick={requestCancel} type="button">
          ×
        </button>
      </div>
      <div className="form-grid">
        <label className="wide">
          Título
          <input
            autoComplete="off"
            name="title"
            onChange={(event) => field("title", event.target.value)}
            required
            value={form.title}
          />
        </label>
        <label>
          Estado
          <select
            onChange={(event) => field("status", event.target.value)}
            value={form.status}
          >
            {recordStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          Fecha límite
          <input
            onChange={(event) => field("dueDate", event.target.value)}
            type="date"
            value={form.dueDate}
          />
        </label>
        <label>
          Empresa
          <input
            autoComplete="organization"
            name="customerName"
            onChange={(event) => field("customerName", event.target.value)}
            value={form.customerName}
          />
        </label>
        <label>
          Contactos
          <input
            autoComplete="name"
            name="contact"
            onChange={(event) => field("contact", event.target.value)}
            value={form.contact}
          />
        </label>
        {financial && (
          <>
            <label>
              Monto (DOP)
              <input
                min="0"
                onChange={(event) => field("amount", event.target.value)}
                step="0.01"
                type="number"
                value={form.amount}
              />
            </label>
            <label>
              Balance (DOP)
              <input
                min="0"
                onChange={(event) => field("balance", event.target.value)}
                step="0.01"
                type="number"
                value={form.balance}
              />
            </label>
          </>
        )}
        <label className="wide">
          Notas
          <textarea
            onChange={(event) => field("notes", event.target.value)}
            rows={4}
            value={form.notes}
          />
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

function parseView(value: string | null): View {
  if (value === "businesses") return "clientes";
  if (value === "contacts") return "contactos";
  if (value === "projects") return "proyectos";
  if (value === "cases") return "ordenes-cambio";
  if (
    value === "leads" ||
    value === "opportunities" ||
    value === "schedule" ||
    value === "calendar" ||
    value === "quotations" ||
    value === "imports" ||
    value === "credit-notes" ||
    value === "receivables" ||
    value === "collections" ||
    value === "documentos" ||
    value === "usuarios"
  )
    return value;
  return value && isModuleKey(value) ? value : "resumen";
}

function publicViewName(view: View) {
  if (view === "clientes") return "businesses";
  if (view === "contactos") return "contacts";
  if (view === "proyectos") return "projects";
  if (view === "ordenes-cambio") return "cases";
  return view;
}

function viewHref(view: View) {
  return view === "resumen" ? "/app" : `/app?view=${publicViewName(view)}`;
}

function isModifiedClick(event: {
  altKey: boolean;
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}) {
  return (
    event.button !== 0 ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  );
}

function searchEntityView(entityType: string): View {
  const mapping: Record<string, View> = {
    business: "clientes",
    contact: "contactos",
    lead: "leads",
    opportunity: "opportunities",
    case: "ordenes-cambio",
    project: "proyectos",
    quote: "cotizaciones",
    quotation: "quotations",
    invoice: "facturas",
    payment: "pagos",
    credit_note: "credit-notes",
    task: "tareas",
    milestone: "hitos",
    daily_report: "reportes-diarios",
    equipment: "equipos",
    staff: "personal",
    supplier: "suplidores",
    document: "documentos",
    activity: "schedule",
  };
  return mapping[entityType] ?? "resumen";
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
