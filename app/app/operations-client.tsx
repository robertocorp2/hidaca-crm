"use client";

import {
  Fragment,
  createContext,
  useContext,
  useCallback,
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
  moduleForView,
  modules,
  recordStatuses,
  type EffectivePermissions,
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
import { InvoiceView } from "./invoice-view";
import { GlobalSearch } from "./global-search";
import { LeadsView } from "./leads-view";
import { ImportsView } from "./imports-view";
import { OpportunitiesView } from "./opportunities-view";
import { ProjectsView } from "./projects-view";
import { QuotationsView } from "./quotation-view";
import { CotizacionesView } from "./cotizaciones-view";
import { CotizacionSourceDetails } from "./cotizaciones-replacement-panel";
import { UsersAdminView } from "./users-admin-view";
import { WhatsAppView } from "./whatsapp-view";
import { AiCopilotView } from "./ai-copilot-view";
import { AiSettingsView } from "./ai-settings-view";
import { RecordAiPanel } from "./record-ai-panel";
import {
  navigationGroups,
  type NavigationGroup,
  type NavigationItem,
  type NavigationView,
} from "./navigation";
// CotizacionesView owns the admin-only CotizacionesReplacementPanel while this shell preserves the source detail contract.
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
  ActiveFilterChip,
  Empty,
  AppearancePreferences,
  AutocompleteInput,
  ColumnFilterPopover,
  FilterableStatus,
  Modal,
  PageHeader,
  PageSizeControl,
  Pagination,
  SortHeader,
  dateTime,
  money,
  useFormGuard,
  usePagination,
  useUrlState,
  useFontPreference,
  useColumnFilters,
  type ColumnFilterDefinition,
} from "./ui";

type View = NavigationView;
type ActivityCreateContext = {
  relatedType: "business" | "contact";
  relatedId: string;
};

const PermissionContext = createContext<EffectivePermissions | null>(null);

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

const genericStatusLabels: Record<string, string> = {
  active: "Activo",
  inactive: "Inactivo",
  planned: "Planificado",
  pending: "Pendiente",
  in_progress: "En progreso",
  on_hold: "En pausa",
  completed: "Completado",
  cancelled: "Cancelado",
  closed: "Cerrado",
  draft: "Borrador",
  sent: "Enviado",
  approved: "Aprobado",
  rejected: "Rechazado",
  paid: "Pagado",
  overdue: "Vencido",
};

function displayGenericStatus(value: string) {
  return genericStatusLabels[value.toLowerCase()] ?? (value || "—");
}

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
  initialReceivableBalance,
  initialNow,
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
  initialReceivableBalance: number | null;
  initialNow: number;
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
  const [receivableBalance, setReceivableBalance] = useState<number | null>(
    initialReceivableBalance,
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
    requestedInitialView === "quotations" ||
      requestedInitialView === "cotizaciones"
      ? requestedInitialRecord
      : null,
  );
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(
    requestedInitialView === "facturas" ? requestedInitialRecord : null,
  );
  const [invoiceFromQuotationId, setInvoiceFromQuotationId] = useState<
    string | null
  >(null);
  const [pendingActivityContext, setPendingActivityContext] =
    useState<ActivityCreateContext | null>(null);
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
  const [sort, setSort] = useUrlState("sort", "title");
  const [direction, setDirection] = useUrlState("dir", "asc");
  const [recordStatusFilter, setRecordStatusFilter] = useUrlState("status");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const [, setGenericPage] = useUrlState("page", "1");
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
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);
  const fontPreference = useFontPreference();
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const activePermissionModule = moduleForView(view) ?? "inicio";
  const activePermissions = currentUser.permissions[activePermissionModule];
  const canWrite = activePermissions.create || activePermissions.edit;
  const canEcfGenerate = currentUser.permissions.facturas.ecf_generate;
  const canEcfXml = currentUser.permissions.facturas.ecf_xml;
  const canCreateInvoice = currentUser.permissions.facturas.create;
  const isAdmin = currentUser.role === "admin" && activePermissions.administer;
  const canManageUsers =
    currentUser.role === "admin" && currentUser.permissions.usuarios.view;

  const refreshReceivableBalance = useCallback(async () => {
    if (
      !invoiceFeatureEnabled ||
      !currentUser.permissions["cuentas-cobrar"].view
    ) {
      return;
    }
    const response = await fetch("/api/receivables?summary=1", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const result = (await response.json()) as { totalBalance?: number };
    if (typeof result.totalBalance === "number") {
      setReceivableBalance(result.totalBalance);
    }
  }, [currentUser.permissions, invoiceFeatureEnabled]);

  useEffect(() => {
    if (view === "resumen") void refreshReceivableBalance();
  }, [refreshReceivableBalance, view]);
  const visibleNavigationGroups = (
    navigationGroups as readonly NavigationGroup[]
  )
    .map((group) => ({
      ...group,
      items: group.items.filter((item: NavigationItem) => {
        if (item.feature === "invoices" && !invoiceFeatureEnabled) return false;
        if (item.adminOnly && !canManageUsers) return false;
        const permissionModule = moduleForView(item.view);
        return (
          !permissionModule || currentUser.permissions[permissionModule].view
        );
      }),
    }))
    .filter((group) => group.items.length > 0);

  const baseVisibleRecords = useMemo(() => {
    const term = search.toLowerCase().trim();
    return records.filter((record) => {
      const inView = view === "resumen" || record.module === view;
      const matchesStatus =
        !recordStatusFilter || record.status === recordStatusFilter;
      const matches =
        !term ||
        `${record.title} ${record.customerName} ${record.contact} ${record.notes} ${record.metadata}`
          .toLowerCase()
          .includes(term);
      return inView && matchesStatus && matches;
    });
  }, [recordStatusFilter, records, search, view]);
  const genericFilterDefinitions = useMemo<ColumnFilterDefinition<RecordRow>[]>(
    () => [
      { key: "title", label: "Registro", getValue: (record) => record.title },
      {
        key: "customer",
        label: "Empresa / contacto",
        getValue: (record) => `${record.customerName} ${record.contact}`,
      },
      {
        key: "amount",
        label: "Monto mínimo",
        kind: "number",
        getValue: (record) => record.amount,
      },
      {
        key: "balance",
        label: "Balance mínimo",
        kind: "number",
        getValue: (record) => record.balance,
      },
      {
        key: "date",
        label: "Desde fecha",
        kind: "date",
        getValue: (record) => record.dueDate ?? record.updatedAt,
      },
    ],
    [],
  );
  const {
    filtered: filteredRecords,
    values: genericFilterValues,
    setFilter: setGenericFilter,
    active: activeGenericFilters,
    clear: clearGenericFilters,
  } = useColumnFilters(
    `records-${view}`,
    baseVisibleRecords,
    genericFilterDefinitions,
  );
  const visibleRecords = useMemo(() => {
    const multiplier = direction === "desc" ? -1 : 1;
    return filteredRecords.toSorted((left, right) => {
      const leftValue =
        sort === "status"
          ? left.status
          : sort === "customer"
            ? `${left.customerName} ${left.contact}`
            : sort === "amount"
              ? String(left.amount)
              : sort === "balance"
                ? String(left.balance)
                : sort === "date"
                  ? (left.dueDate ?? left.updatedAt)
                  : left.title;
      const rightValue =
        sort === "status"
          ? right.status
          : sort === "customer"
            ? `${right.customerName} ${right.contact}`
            : sort === "amount"
              ? String(right.amount)
              : sort === "balance"
                ? String(right.balance)
                : sort === "date"
                  ? (right.dueDate ?? right.updatedAt)
                  : right.title;
      if (["amount", "balance"].includes(sort))
        return multiplier * (Number(leftValue) - Number(rightValue));
      return (
        multiplier *
        leftValue.localeCompare(rightValue, "es", { sensitivity: "base" })
      );
    });
  }, [direction, filteredRecords, sort]);
  const genericStatuses = [
    ...new Set(
      records
        .filter((record) => view === "resumen" || record.module === view)
        .map((record) => record.status)
        .filter(Boolean),
    ),
  ].sort();
  const genericPageSize =
    pageSizeValue === "all"
      ? Math.max(visibleRecords.length, 1)
      : Number(pageSizeValue) || 10;

  function sortBy(column: string) {
    if (sort === column) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSort(column);
      setDirection("asc");
    }
  }

  const totals = useMemo(
    () => ({
      projects: records.filter(
        (record) =>
          record.module === "proyectos" &&
          !["Completado", "Cancelado"].includes(record.status),
      ).length,
      receivable:
        receivableBalance ??
        records
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
          new Date(activity.endAt).getTime() >= initialNow,
      ).length,
      overdue: activities.filter(
        (activity) =>
          activity.status === "planned" &&
          new Date(activity.endAt).getTime() < initialNow,
      ).length,
    }),
    [
      activities,
      businesses,
      leads,
      opportunities,
      records,
      initialNow,
      receivableBalance,
    ],
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
    setSelectedInvoiceId(null);
    setSelectedImportId(null);
    setHighlightRecordId(null);
  }

  function applySelection(next: View, record: string | null, push = true) {
    clearSelections();
    if (next !== "schedule" && next !== "calendar")
      setPendingActivityContext(null);
    if (next !== "facturas") setInvoiceFromQuotationId(null);
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
    else if (next === "quotations" || next === "cotizaciones")
      setSelectedQuotationId(record);
    else if (next === "facturas") setSelectedInvoiceId(record);
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
    if (view === "resumen") void refreshReceivableBalance();
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

  const activeModule = modules.find((module) => module.key === view);
  const allNavigationItems = (
    navigationGroups as readonly NavigationGroup[]
  ).flatMap((group) => group.items) as readonly NavigationItem[];
  const activeNavigationItem = allNavigationItems.find(
    (item) => item.view === view,
  );
  // Keep the five mobile shortcuts aligned with the shared permission-filtered registry.
  const mobileQuickViews: NavigationView[] = [
    "resumen",
    "clientes",
    "cotizaciones",
    "facturas",
  ];

  return (
    <PermissionContext.Provider value={currentUser.permissions}>
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
        {appearanceOpen && (
          <Modal
            eyebrow="Preferencias"
            onClose={() => setAppearanceOpen(false)}
            title="Apariencia"
          >
            <AppearancePreferences
              onChange={fontPreference.setValue}
              onClose={() => setAppearanceOpen(false)}
              value={fontPreference.value}
            />
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
            {visibleNavigationGroups.map((group) => (
              <Fragment key={group.key}>
                {group.label && <p>{group.label}</p>}
                {group.items.map((item) => (
                  <NavLink
                    active={view === item.view}
                    href={viewHref(item.view)}
                    icon={item.icon}
                    key={item.view}
                    label={item.label}
                    onClick={(event) => navigateView(event, item.view)}
                  />
                ))}
              </Fragment>
            ))}
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
              <span className="mobile-current-module" aria-live="polite">
                {activeNavigationItem?.label ?? activeModule?.label ?? "HIDACA"}
              </span>
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
                  {currentUser.displayName.trim().charAt(0).toUpperCase() ||
                    "H"}
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
                  <button
                    onClick={() => {
                      setAppearanceOpen(true);
                      setProfileOpen(false);
                    }}
                    role="menuitem"
                    type="button"
                  >
                    Preferencias de apariencia
                  </button>
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
                initialNow={initialNow}
                onNavigate={(next, record) => {
                  if (record) applySelection(next, record);
                  else selectView(next);
                }}
              />
            ) : view === "clientes" ? (
              <BusinessesView
                activities={activities}
                businesses={businesses}
                canCreateActivity={currentUser.permissions.agenda.create}
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={currentUser.permissions.ai.create}
                canApproveAi={currentUser.permissions.ai.approve}
                canViewActivity={currentUser.permissions.agenda.view}
                canWrite={canWrite}
                currentUserEmail={currentUser.email}
                confirm={(message, confirmLabel, action) =>
                  setConfirmation({ message, confirmLabel, action })
                }
                onNavigate={(next, record) => {
                  if (record) applySelection(next as View, record);
                  else selectView(next as View);
                }}
                onOpenActivity={(id) => applySelection("schedule", id)}
                onCreateActivity={(relatedType, relatedId) => {
                  setPendingActivityContext({ relatedType, relatedId });
                  applySelection("schedule", null);
                }}
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
                canCreateActivity={currentUser.permissions.agenda.create}
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={currentUser.permissions.ai.create}
                canApproveAi={currentUser.permissions.ai.approve}
                canViewActivity={currentUser.permissions.agenda.view}
                canWrite={canWrite}
                contacts={contacts}
                currentUserEmail={currentUser.email}
                confirm={(message, confirmLabel, action) =>
                  setConfirmation({ message, confirmLabel, action })
                }
                onNavigate={(next, record) => {
                  if (record) applySelection(next as View, record);
                  else selectView(next as View);
                }}
                onOpenActivity={(id) => applySelection("schedule", id)}
                onCreateActivity={(relatedType, relatedId) => {
                  setPendingActivityContext({ relatedType, relatedId });
                  applySelection("schedule", null);
                }}
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
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={
                  currentUser.permissions.ai.create &&
                  currentUser.permissions.agenda.create
                }
                canApproveAi={currentUser.permissions.ai.approve}
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
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={
                  currentUser.permissions.ai.create &&
                  currentUser.permissions.agenda.create
                }
                canApproveAi={currentUser.permissions.ai.approve}
                contacts={contacts}
                currentUserEmail={currentUser.email}
                history={leadHistory}
                isAdmin={isAdmin}
                leads={leads}
                onConverted={(result) => {
                  if (
                    !businesses.some((item) => item.id === result.business.id)
                  )
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
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={
                  currentUser.permissions.ai.create &&
                  currentUser.permissions.agenda.create
                }
                canApproveAi={currentUser.permissions.ai.approve}
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
                initialCreateContext={pendingActivityContext}
                leads={leads}
                mode={view}
                opportunities={opportunities}
                records={records}
                selectedId={selectedActivityId}
                setActivities={setActivities}
                setMessage={setMessage}
                onCreateContextConsumed={() => setPendingActivityContext(null)}
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
            ) : view === "cotizaciones" ? (
              <CotizacionesView
                businesses={businesses}
                canWrite={canWrite}
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={
                  currentUser.permissions.ai.create &&
                  currentUser.permissions.agenda.create
                }
                canApproveAi={currentUser.permissions.ai.approve}
                canCreateInvoice={canCreateInvoice}
                contacts={contacts}
                isAdmin={isAdmin}
                legacyRecords={records.filter(
                  (record) => record.module === "cotizaciones",
                )}
                onLegacyArchived={(id) =>
                  setRecords((current) =>
                    current.filter((record) => record.id !== id),
                  )
                }
                onLegacyUpdated={(record) =>
                  setRecords((current) =>
                    current.map((item) =>
                      item.id === record.id ? record : item,
                    ),
                  )
                }
                onCreateInvoice={(quotationId) => {
                  setInvoiceFromQuotationId(quotationId);
                  applySelection("facturas", null);
                }}
                onOpenInvoice={(invoiceId) =>
                  applySelection("facturas", invoiceId)
                }
                selectedId={selectedQuotationId}
                setMessage={setMessage}
                setSelectedId={(id) => {
                  setSelectedQuotationId(id);
                  const params = new URLSearchParams();
                  params.set("view", "cotizaciones");
                  if (id) params.set("record", id);
                  window.history.pushState({}, "", `/app?${params}`);
                  window.dispatchEvent(new Event("hidaca:urlstate"));
                }}
              />
            ) : invoiceFeatureEnabled && view === "facturas" ? (
              <InvoiceView
                businesses={businesses}
                canWrite={canWrite}
                canAskAi={currentUser.permissions.ai.view}
                canProposeAi={
                  currentUser.permissions.ai.create &&
                  currentUser.permissions.agenda.create
                }
                canApproveAi={currentUser.permissions.ai.approve}
                canEcfGenerate={canEcfGenerate}
                canEcfXml={canEcfXml}
                fromQuotationId={invoiceFromQuotationId}
                onNavigate={(next, id) => applySelection(next as View, id)}
                selectedId={selectedInvoiceId}
                setSelectedId={(id) => {
                  setSelectedInvoiceId(id);
                  const params = new URLSearchParams();
                  params.set("view", "facturas");
                  if (id) params.set("record", id);
                  window.history.pushState({}, "", `/app?${params}`);
                  window.dispatchEvent(new Event("hidaca:urlstate"));
                }}
                setMessage={setMessage}
              />
            ) : invoiceFeatureEnabled &&
              (view === "pagos" ||
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
              <UsersAdminView
                access={currentUser.permissions.usuarios}
                currentUserEmail={currentUser.email}
                confirm={(message, confirmLabel, action) =>
                  setConfirmation({ message, confirmLabel, action })
                }
                setMessage={setMessage}
                setUsers={setUsers}
                users={users}
              />
            ) : view === "whatsapp" ? (
              <WhatsAppView
                canWrite={currentUser.permissions.whatsapp.create}
                isAdmin={isAdmin}
              />
            ) : view === "ai" ? (
              <AiCopilotView
                canApprove={currentUser.permissions.ai.approve}
                canCreate={
                  currentUser.permissions.ai.create &&
                  currentUser.permissions.agenda.create
                }
                isAdmin={isAdmin}
              />
            ) : view === "ai-settings" ? (
              <AiSettingsView />
            ) : (
              <>
                <div className="breadcrumbs">
                  <span>Inicio</span>
                  <i>/</i>
                  <span aria-current="page">{activeModule?.label}</span>
                </div>
                <PageHeader
                  action={
                    canWrite ? (
                      <button className="primary-button" onClick={openCreate}>
                        Nuevo registro
                      </button>
                    ) : undefined
                  }
                  description="Consulta, registra y actualiza información."
                  eyebrow="Gestión"
                  title={activeModule?.label ?? "Registros"}
                />
                <div className="toolbar toolbar-filters">
                  <AutocompleteInput
                    ariaLabel={`Buscar en ${activeModule?.label ?? "registros"}`}
                    onChange={(value) => {
                      setSearch(value);
                      setGenericPage("1");
                    }}
                    onSelect={(option) => {
                      setSearch(option.label);
                      setGenericPage("1");
                    }}
                    options={visibleRecords.slice(0, 8).map((record) => ({
                      id: record.id,
                      label: record.title,
                      secondary: record.customerName || record.contact,
                    }))}
                    placeholder="Escribe un título, empresa o contacto…"
                    value={search}
                  />
                  <select
                    aria-label="Filtrar por estado"
                    onChange={(event) => {
                      setRecordStatusFilter(event.target.value);
                      setGenericPage("1");
                    }}
                    value={recordStatusFilter}
                  >
                    <option value="">Todos los estados</option>
                    {genericStatuses.map((status) => (
                      <option key={status} value={status}>
                        {displayGenericStatus(status)}
                      </option>
                    ))}
                  </select>
                  <PageSizeControl
                    label="Registros por página"
                    onChange={(value) => {
                      setPageSizeValue(value);
                      setGenericPage("1");
                    }}
                    value={pageSizeValue}
                  />
                  <span className="record-count">
                    <strong>{visibleRecords.length}</strong> registros
                  </span>
                </div>
                {(recordStatusFilter || activeGenericFilters.length > 0) && (
                  <div className="active-filter-row">
                    {recordStatusFilter && (
                      <ActiveFilterChip
                        label={`Estado: ${displayGenericStatus(recordStatusFilter)}`}
                        onClear={() => {
                          setRecordStatusFilter("");
                          setGenericPage("1");
                        }}
                      />
                    )}
                    {activeGenericFilters.map(([key, value]) => (
                      <ActiveFilterChip
                        key={key}
                        label={`${genericFilterDefinitions.find((definition) => definition.key === key)?.label ?? key}: ${value}`}
                        onClear={() => {
                          setGenericFilter(key, "");
                          setGenericPage("1");
                        }}
                      />
                    ))}
                    {activeGenericFilters.length > 1 && (
                      <button
                        className="text-button"
                        onClick={() => {
                          clearGenericFilters();
                          setGenericPage("1");
                        }}
                        type="button"
                      >
                        Limpiar filtros
                      </button>
                    )}
                  </div>
                )}
                {showForm && (
                  <Modal
                    onClose={() => setShowForm(false)}
                    title={editing ? "Editar registro" : "Nuevo registro"}
                    wide
                  >
                    <RecordForm
                      busy={busy}
                      financial={financialModules.has(view as ModuleKey)}
                      form={form}
                      onCancel={() => setShowForm(false)}
                      onSubmit={saveRecord}
                      setForm={setForm}
                    />
                  </Modal>
                )}
                <section className="panel">
                  <RecordsTable
                    canWrite={canWrite}
                    canAskAi={currentUser.permissions.ai.view}
                    canProposeAi={
                      currentUser.permissions.ai.create &&
                      currentUser.permissions.agenda.create
                    }
                    canApproveAi={currentUser.permissions.ai.approve}
                    highlightId={highlightRecordId}
                    onArchive={archiveRecord}
                    onEdit={openEdit}
                    direction={direction as "asc" | "desc"}
                    onStatusFilter={(status) => {
                      setRecordStatusFilter(status);
                      setGenericPage("1");
                    }}
                    onSort={sortBy}
                    pageSize={genericPageSize}
                    sort={sort}
                    records={visibleRecords}
                    filterDefinitions={genericFilterDefinitions}
                    filterValues={genericFilterValues}
                    onColumnFilter={(key, value) => {
                      setGenericFilter(key, value);
                      setGenericPage("1");
                    }}
                  />
                </section>
              </>
            )}
          </main>
        </div>
        <MobileBottomNav
          currentView={view}
          items={mobileQuickViews}
          onMore={() => setMobileNav(true)}
          onNavigate={(next) => selectView(next)}
        />
      </div>
    </PermissionContext.Provider>
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
  icon: NavigationItem["icon"];
  label: string;
  onClick(event: ReactMouseEvent<HTMLAnchorElement>): void;
}) {
  const permissions = useContext(PermissionContext);
  const requested = parseView(
    new URL(href, "https://hidaca.local").searchParams.get("view"),
  );
  const permissionModule = moduleForView(requested);
  if (permissions && permissionModule && !permissions[permissionModule].view)
    return null;
  const Icon = icon;
  return (
    <a
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={active ? "active" : ""}
      href={href}
      onClick={onClick}
    >
      <span aria-hidden="true" className="sidebar-nav-icon">
        <Icon focusable="false" size={18} strokeWidth={2} />
      </span>
      <span className="sidebar-nav-label">{label}</span>
    </a>
  );
}

function MobileBottomNav({
  currentView,
  items,
  onMore,
  onNavigate,
}: {
  currentView: NavigationView;
  items: readonly NavigationView[];
  onMore(): void;
  onNavigate(view: NavigationView): void;
}) {
  const permissions = useContext(PermissionContext);
  const allNavigationItems = (
    navigationGroups as readonly NavigationGroup[]
  ).flatMap((group) => group.items) as readonly NavigationItem[];
  const destinations = items
    .map((view) => allNavigationItems.find((item) => item.view === view))
    .filter((item): item is NavigationItem => Boolean(item))
    .filter((item) => {
      const permissionModule = moduleForView(item.view);
      return (
        !permissions || !permissionModule || permissions[permissionModule].view
      );
    });

  return (
    <nav aria-label="Accesos móviles" className="mobile-bottom-nav">
      {destinations.map((item) => {
        const Icon = item.icon;
        return (
          <a
            aria-current={currentView === item.view ? "page" : undefined}
            aria-label={item.label}
            className={currentView === item.view ? "active" : undefined}
            href={viewHref(item.view)}
            key={item.view}
            onClick={(event) => {
              if (isModifiedClick(event)) return;
              event.preventDefault();
              onNavigate(item.view);
            }}
          >
            <Icon
              aria-hidden="true"
              focusable="false"
              size={19}
              strokeWidth={2}
            />
            <span>{item.label}</span>
          </a>
        );
      })}
      <button aria-label="Más módulos" onClick={onMore} type="button">
        <span aria-hidden="true" className="mobile-bottom-more-icon">
          ⋯
        </span>
        <span>Más</span>
      </button>
    </nav>
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
  const permissions = useContext(PermissionContext);
  const requested = parseView(
    new URL(href, "https://hidaca.local").searchParams.get("view"),
  );
  const permissionModule = moduleForView(requested);
  if (permissions && permissionModule && !permissions[permissionModule].view)
    return null;
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
  initialNow,
}: {
  totals: {
    projects: number;
    receivable: number;
    leads: number;
    opportunities: number;
    businesses: number;
    upcoming: number;
    overdue: number;
  };
  records: RecordRow[];
  leads: LeadRow[];
  opportunities: OpportunityRow[];
  activities: ActivityRow[];
  businesses: BusinessRow[];
  onNavigate(view: View, record?: string): void;
  initialNow: number;
}) {
  const upcomingActivities = activities
    .filter(
      (activity) =>
        activity.status === "planned" &&
        new Date(activity.endAt).getTime() >= initialNow,
    )
    .sort(
      (first, second) =>
        new Date(first.startAt).getTime() - new Date(second.startAt).getTime(),
    )
    .slice(0, 6);
  const overdueActivities = activities
    .filter(
      (activity) =>
        activity.status === "planned" &&
        new Date(activity.endAt).getTime() < initialNow,
    )
    .sort(
      (first, second) =>
        new Date(first.endAt).getTime() - new Date(second.endAt).getTime(),
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
      <section
        className={`dashboard-attention panel${overdueActivities.length ? " has-overdue" : ""}`}
        aria-label="Trabajo que requiere atención"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Seguimiento</p>
            <h2>Trabajo vencido</h2>
            <p>
              {overdueActivities.length
                ? `${totals.overdue} actividad${totals.overdue === 1 ? "" : "es"} requiere${totals.overdue === 1 ? "" : "n"} atención.`
                : "No hay actividades vencidas."}
            </p>
          </div>
          <DashboardLink
            className="panel-action"
            href={viewHref("schedule")}
            onNavigate={() => onNavigate("schedule")}
          >
            Ver agenda
          </DashboardLink>
        </div>
        {overdueActivities.length > 0 && (
          <div className="snapshot-list">
            {overdueActivities.map((activity) => (
              <DashboardLink
                className="snapshot-row snapshot-activity overdue-row"
                href={`${viewHref("schedule")}&record=${encodeURIComponent(activity.id)}`}
                key={activity.id}
                onNavigate={() => onNavigate("schedule", activity.id)}
              >
                <span className="snapshot-type" aria-hidden="true">
                  !
                </span>
                <span className="snapshot-copy">
                  <small className="type-label">Actividad vencida</small>
                  <strong>{activity.title}</strong>
                  <small>{dateTime(activity.endAt, true)}</small>
                  <small className="snapshot-meta">
                    Responsable: {activity.ownerEmail}
                  </small>
                </span>
                <span className="status status-overdue">Vencida</span>
              </DashboardLink>
            ))}
          </div>
        )}
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
          onOpenRecord={(record) =>
            onNavigate(record.module as View, record.id)
          }
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
  const [query, setQuery] = useUrlState("q");
  const [pageSizeValue, setPageSizeValue] = useUrlState("pageSize", "10");
  const filteredDocuments = useMemo(
    () =>
      documents
        .filter((document) =>
          `${document.name} ${document.createdBy}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
        .toSorted((left, right) =>
          right.createdAt.localeCompare(left.createdAt),
        ),
    [documents, query],
  );
  const pageSize =
    pageSizeValue === "all"
      ? Math.max(filteredDocuments.length, 1)
      : Number(pageSizeValue) || 10;
  const { page, pageItems, setPage, totalPages } = usePagination(
    filteredDocuments,
    pageSize,
  );
  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">Documentos</span>
      </div>
      <PageHeader
        description="Archivos vinculados a la operación."
        eyebrow="R2 privado"
        title="Documentos"
      />
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
      <div className="toolbar toolbar-filters">
        <AutocompleteInput
          ariaLabel="Buscar documentos"
          onChange={(value) => {
            setQuery(value);
            setPage(1);
          }}
          onSelect={(option) => {
            setQuery(option.label);
            setPage(1);
          }}
          options={filteredDocuments.slice(0, 8).map((document) => ({
            id: document.id,
            label: document.name,
            secondary: document.createdBy,
          }))}
          placeholder="Escribe un nombre de archivo o responsable…"
          value={query}
        />
        <PageSizeControl
          label="Documentos por página"
          onChange={(value) => {
            setPageSizeValue(value);
            setPage(1);
          }}
          value={pageSizeValue}
        />
        <span className="record-count">
          <strong>{filteredDocuments.length}</strong> documentos
        </span>
      </div>
      <section className="panel">
        <div className="document-list">
          {filteredDocuments.length === 0 ? (
            <Empty
              text={
                query
                  ? "No hay documentos que coincidan con la búsqueda."
                  : "No hay documentos cargados."
              }
            />
          ) : (
            pageItems.map((document) => (
              <article
                className={highlightId === document.id ? "highlight-row" : ""}
                id={`record-${document.id}`}
                key={document.id}
              >
                <div className="file-icon">DOC</div>
                <div>
                  <strong title={document.name}>{document.name}</strong>
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
        <Pagination
          onPageChange={setPage}
          page={page}
          totalPages={totalPages}
        />
      </section>
    </>
  );
}

function RecordsTable({
  records,
  canWrite,
  canAskAi = false,
  canProposeAi = false,
  canApproveAi = false,
  highlightId,
  onEdit,
  onArchive,
  sort,
  direction,
  onSort,
  pageSize = 10,
  onStatusFilter,
  filterDefinitions,
  filterValues,
  onColumnFilter,
  onOpenRecord,
}: {
  records: RecordRow[];
  canWrite: boolean;
  canAskAi?: boolean;
  canProposeAi?: boolean;
  canApproveAi?: boolean;
  highlightId: string | null;
  onEdit(record: RecordRow): void;
  onArchive(record: RecordRow): void;
  sort?: string;
  direction?: "asc" | "desc";
  onSort?(column: string): void;
  pageSize?: number;
  onStatusFilter?(status: string): void;
  filterDefinitions?: ColumnFilterDefinition<RecordRow>[];
  filterValues?: Record<string, string>;
  onColumnFilter?(key: string, value: string): void;
  onOpenRecord?(record: RecordRow): void;
}) {
  const { page, pageItems, setPage, totalPages } = usePagination(
    records,
    pageSize,
  );
  const filter = (key: string) => {
    const definition = filterDefinitions?.find((item) => item.key === key);
    if (!definition || !onColumnFilter) return null;
    return (
      <ColumnFilterPopover
        definition={definition}
        value={filterValues?.[key] ?? ""}
        onChange={(value) => onColumnFilter(key, value)}
      />
    );
  };
  if (records.length === 0)
    return <Empty text="No hay registros en esta vista." />;
  return (
    <>
      <div className="table-wrap">
        <table className="responsive-table collection-table records-table">
          <thead>
            <tr>
              <th>
                <span className="table-header-with-filter">
                  {onSort ? (
                    <SortHeader
                      column="title"
                      direction={direction ?? "asc"}
                      label="Registro"
                      onSort={onSort}
                      sort={sort ?? "title"}
                    />
                  ) : (
                    <span>Registro</span>
                  )}
                  {filter("title")}
                </span>
              </th>
              <th>
                {onSort ? (
                  <SortHeader
                    column="status"
                    direction={direction ?? "asc"}
                    label="Estado"
                    onSort={onSort}
                    sort={sort ?? "title"}
                  />
                ) : (
                  "Estado"
                )}
              </th>
              <th>
                <span className="table-header-with-filter">
                  {onSort ? (
                    <SortHeader
                      column="customer"
                      direction={direction ?? "asc"}
                      label="Empresa / contacto"
                      onSort={onSort}
                      sort={sort ?? "title"}
                    />
                  ) : (
                    <span>Empresa / contacto</span>
                  )}
                  {filter("customer")}
                </span>
              </th>
              <th>
                <span className="table-header-with-filter">
                  {onSort ? (
                    <SortHeader
                      column="amount"
                      direction={direction ?? "asc"}
                      label="Monto"
                      onSort={onSort}
                      sort={sort ?? "title"}
                    />
                  ) : (
                    <span>Monto</span>
                  )}
                  {filter("amount")}
                </span>
              </th>
              <th>
                <span className="table-header-with-filter">
                  {onSort ? (
                    <SortHeader
                      column="balance"
                      direction={direction ?? "asc"}
                      label="Balance"
                      onSort={onSort}
                      sort={sort ?? "title"}
                    />
                  ) : (
                    <span>Balance</span>
                  )}
                  {filter("balance")}
                </span>
              </th>
              <th>
                <span className="table-header-with-filter">
                  {onSort ? (
                    <SortHeader
                      column="date"
                      direction={direction ?? "asc"}
                      label="Fecha"
                      onSort={onSort}
                      sort={sort ?? "title"}
                    />
                  ) : (
                    <span>Fecha</span>
                  )}
                  {filter("date")}
                </span>
              </th>
              {(canWrite || canAskAi) && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {pageItems.map((record) => (
              <tr
                className={`${highlightId === record.id ? "highlight-row" : ""}${onOpenRecord ? " clickable-row" : ""}`}
                id={`record-${record.id}`}
                key={record.id}
                onClick={onOpenRecord ? () => onOpenRecord(record) : undefined}
                onKeyDown={
                  onOpenRecord
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpenRecord(record);
                        }
                      }
                    : undefined
                }
                tabIndex={onOpenRecord ? 0 : undefined}
              >
                <td data-label="Registro">
                  <strong title={record.title}>{record.title}</strong>
                  <span>
                    {modules.find((item) => item.key === record.module)
                      ?.label ?? record.module}
                  </span>
                  {record.module === "cotizaciones" && (
                    <CotizacionSourceDetails metadata={record.metadata} />
                  )}
                </td>
                <td data-label="Estado">
                  <FilterableStatus
                    label={displayGenericStatus(record.status)}
                    onFilter={
                      onStatusFilter && record.status
                        ? () => onStatusFilter(record.status)
                        : undefined
                    }
                  />
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
                {(canWrite || canAskAi) && (
                  <td data-label="Acciones">
                    {canAskAi && record.module === "ordenes-cambio" && (
                      <RecordAiPanel
                        canApprove={canApproveAi}
                        canAsk
                        canPropose={canProposeAi}
                        entityId={record.id}
                        entityType="case"
                        title={record.title}
                      />
                    )}
                    <button
                      className="text-button"
                      hidden={!canWrite}
                      onClick={() => onEdit(record)}
                    >
                      Editar
                    </button>
                    <button
                      className="danger-link"
                      hidden={!canWrite}
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
  financial,
  busy,
  onSubmit,
  onCancel,
}: {
  form: typeof emptyRecordForm;
  setForm(value: typeof emptyRecordForm): void;
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
    value === "usuarios" ||
    value === "ai-settings"
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
