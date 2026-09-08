"use client";

import { useState } from "react";
import {
  Activity,
  ArrowRight,
  Building2,
  CalendarClock,
  ChevronRight,
  CircleX,
  FileText,
  FolderKanban,
  History,
  Mail,
  MapPin,
  Menu,
  Phone,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  ActiveFilterChip,
  AutocompleteInput,
  Breadcrumbs,
  DocumentRow,
  Empty,
  ErrorState,
  FilterableStatus,
  InlineAlert,
  LoadingState,
  Modal,
  PageHeader,
  PageSizeControl,
  Pagination,
  SortHeader,
  StatusBadge,
} from "./ui";
import { ActivityTimeline } from "./record-workspace";

const iconSamples: Array<[string, LucideIcon]> = [
  ["Empresas", Building2],
  ["Contactos", UserRound],
  ["Proyectos", FolderKanban],
  ["Cotizaciones", FileText],
  ["Facturas", ReceiptText],
  ["Actividades", Activity],
  ["Calendario", CalendarClock],
  ["Configuración", Settings2],
  ["Asistente IA", Sparkles],
  ["Seguridad", ShieldCheck],
  ["Filtros", SlidersHorizontal],
  ["Búsqueda", Search],
];

const timelineEvents: React.ComponentProps<typeof ActivityTimeline>["events"] =
  [
    {
      id: "created",
      date: "2026-08-25T14:30:00.000Z",
      label: "Creación",
      title: "Empresa creada",
      actor: "operaciones@hidaca.com.do",
      tone: "history",
    },
    {
      id: "quote",
      date: "2026-08-26T16:10:00.000Z",
      label: "Cotización",
      title: "COT-2026-018 · Shutters residenciales",
      detail: "Enviada para revisión",
      actor: "María Rodríguez",
    },
    {
      id: "activity",
      date: "2026-08-28T13:00:00.000Z",
      label: "Actividad",
      title: "Visita técnica",
      detail: "Confirmar medidas y alcance",
      actor: "Equipo HIDACA",
      activityId: "activity-1",
      tone: "activity",
    },
  ];

const tableRows = [
  ["COT-2026-018", "Casa Mirador", "Enviada", "DOP 245,000"],
  ["COT-2026-017", "Oficinas Bayona", "En revisión", "DOP 118,500"],
  ["COT-2026-016", "Residencial Norte", "Aprobada", "DOP 392,000"],
];

function Section({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ds-section">
      <div className="ds-section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <span className="ds-section-index">HIDACA / UI</span>
      </div>
      {children}
    </section>
  );
}

function TokenSwatch({
  name,
  value,
  className = "",
}: {
  name: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="ds-token">
      <span
        className={`ds-swatch ${className}`}
        style={{ background: value }}
      />
      <div>
        <strong>{name}</strong>
        <small>{value}</small>
      </div>
    </div>
  );
}

export function DesignSystemShowcase() {
  const [modalOpen, setModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("Proyectos");
  const [activeFilter, setActiveFilter] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedPage, setSelectedPage] = useState(1);
  const [selectedFont, setSelectedFont] = useState("Inter");

  return (
    <main className="ds-shell">
      <header className="ds-hero">
        <div className="ds-hero-brand">
          <span className="ds-brand-mark">H</span>
          <span>
            <strong>HIDACA</strong>
            <small>Sistema de diseño</small>
          </span>
        </div>
        <div className="ds-hero-meta">
          <span>v1.0.0</span>
          <span>Desarrollo solamente</span>
        </div>
        <div className="ds-hero-copy">
          <p className="eyebrow">HIDACA / Operaciones</p>
          <h1>Una interfaz clara para cada decisión.</h1>
          <p>
            Inventario vivo de tokens, componentes y patrones para construir el
            futuro operativo de HIDACA con una misma voz.
          </p>
          <div className="ds-hero-actions">
            <a className="primary-button" href="#componentes">
              Explorar componentes <ArrowRight aria-hidden="true" size={16} />
            </a>
            <a className="secondary-button" href="#patrones">
              Ver patrones
            </a>
          </div>
        </div>
        <div className="ds-hero-note">
          <ShieldCheck aria-hidden="true" size={18} />
          <span>Base visual extraída del app real · sin datos privados</span>
        </div>
      </header>

      <div className="ds-content">
        <div className="ds-intro-grid">
          <div>
            <p className="eyebrow">Mapa rápido</p>
            <h2>Un lenguaje, muchas superficies.</h2>
          </div>
          <p>
            El sistema conserva la densidad de trabajo del CRM, ordena el
            contraste entre contenido y estado, y hace que cada vista responda
            con la misma lógica en desktop, tablet y móvil.
          </p>
          <div className="ds-stat-row">
            <div>
              <strong>18</strong>
              <span>módulos cubiertos</span>
            </div>
            <div>
              <strong>24</strong>
              <span>primitives documentadas</span>
            </div>
            <div>
              <strong>5</strong>
              <span>breakpoints de referencia</span>
            </div>
          </div>
        </div>
        <div className="ds-page-header-card">
          <Breadcrumbs
            items={[
              { label: "Inicio", href: "#inicio" },
              { label: "Sistema de diseño" },
            ]}
          />
          <PageHeader
            action={
              <button className="primary-button" type="button">
                <Plus aria-hidden="true" size={15} />
                Nueva acción
              </button>
            }
            description="Ejemplo de encabezado compartido para una vista operativa."
            eyebrow="Componente aprobado"
            title="Encabezado de página"
          />
        </div>

        <Section
          eyebrow="Foundations"
          title="Colores y tipografía"
          description="La marca se apoya en verdes profundos, oro como acento y superficies blancas sobre un canvas calmado."
        >
          <div className="ds-foundations-grid">
            <div className="ds-card ds-palette-card">
              <div className="ds-card-label">
                <span>Paleta semántica</span>
                <span>7 roles</span>
              </div>
              <div className="ds-palette">
                <TokenSwatch
                  name="Brand / Forest"
                  value="#052e21"
                  className="ds-swatch-dark"
                />
                <TokenSwatch
                  name="Brand / Primary"
                  value="#0c6747"
                  className="ds-swatch-primary"
                />
                <TokenSwatch name="Brand / Gold" value="#c5a44d" />
                <TokenSwatch name="Background / Canvas" value="#f3f6f4" />
                <TokenSwatch name="Text / Primary" value="#183029" />
                <TokenSwatch name="Border / Default" value="#dce5e0" />
                <TokenSwatch name="Status / Danger" value="#a13636" />
              </div>
            </div>
            <div className="ds-card ds-type-card">
              <div className="ds-card-label">
                <span>Escala tipográfica</span>
                <span>Inter</span>
              </div>
              <div className="ds-type-specimen">
                <div>
                  <span>Display / 52</span>
                  <strong>Operaciones</strong>
                </div>
                <div>
                  <span>Heading / 32</span>
                  <h3>Trabajo que avanza</h3>
                </div>
                <div>
                  <span>Body / 16</span>
                  <p>
                    La información importante debe ser fácil de leer, comparar y
                    convertir en una acción segura.
                  </p>
                </div>
                <div>
                  <span>Label / 12 · 850</span>
                  <b>GESTIÓN OPERATIVA</b>
                </div>
              </div>
            </div>
          </div>
          <div className="ds-card ds-type-controls">
            <div className="ds-card-label">
              <span>Preferencia local</span>
              <span>Referencia: Inter</span>
            </div>
            <div className="ds-font-options">
              {["Inter", "System UI", "Segoe UI"].map((font) => (
                <button
                  className={selectedFont === font ? "selected" : ""}
                  key={font}
                  onClick={() => setSelectedFont(font)}
                  type="button"
                >
                  <span className="ds-radio" />
                  {font}
                  <small>
                    {selectedFont === font ? "Seleccionada" : "Disponible"}
                  </small>
                </button>
              ))}
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Foundations"
          title="Espaciado, radios y elevación"
          description="Una escala corta evita decisiones arbitrarias y mantiene la interfaz tranquila cuando la información crece."
        >
          <div className="ds-foundations-grid ds-foundations-grid-three">
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Espaciado</span>
                <span>base 4px</span>
              </div>
              <div className="ds-spacing-list">
                {[
                  ["2xs", 4],
                  ["xs", 8],
                  ["sm", 12],
                  ["md", 16],
                  ["lg", 24],
                  ["xl", 32],
                ].map(([name, size]) => (
                  <div key={name as string}>
                    <span>{name}</span>
                    <i style={{ width: `${size as number}px` }} />
                    <b>{size}px</b>
                  </div>
                ))}
              </div>
            </div>
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Radios</span>
                <span>soft / useful</span>
              </div>
              <div className="ds-radius-list">
                <div>
                  <i className="ds-radius-sm" />
                  <span>sm / 8</span>
                </div>
                <div>
                  <i className="ds-radius-md" />
                  <span>md / 10</span>
                </div>
                <div>
                  <i className="ds-radius-lg" />
                  <span>lg / 12</span>
                </div>
                <div>
                  <i className="ds-radius-pill" />
                  <span>pill / 999</span>
                </div>
              </div>
            </div>
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Elevación</span>
                <span>green tint</span>
              </div>
              <div className="ds-elevation-list">
                <div className="ds-elevation-xs">Shadow xs</div>
                <div className="ds-elevation-sm">Shadow sm</div>
                <div className="ds-elevation-md">Shadow md</div>
              </div>
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Iconography"
          title="Iconos Lucide"
          description="El sistema existente ya tiene un lenguaje semántico consistente. Las superficies nuevas deben hablar el mismo idioma."
        >
          <div className="ds-card ds-icon-grid">
            {iconSamples.map(([label, Icon]) => (
              <div className="ds-icon-sample" key={label}>
                <span>
                  <Icon aria-hidden="true" size={20} strokeWidth={1.8} />
                </span>
                <strong>{label}</strong>
                <small>Lucide / 20</small>
              </div>
            ))}
          </div>
        </Section>

        <Section
          eyebrow="Components"
          title="Controles, estados y datos"
          description="Cada bloque muestra su estado de uso aprobado y conserva las affordances reales del app."
        >
          <div className="ds-component-grid" id="componentes">
            <div className="ds-card ds-component-card">
              <div className="ds-card-label">
                <span>Buttons</span>
                <span>Approved</span>
              </div>
              <div className="ds-control-stack">
                <div>
                  <button className="primary-button" type="button">
                    <Plus aria-hidden="true" size={16} />
                    Primary action
                  </button>
                  <button className="secondary-button" type="button">
                    Secondary
                  </button>
                </div>
                <div>
                  <button className="text-button" type="button">
                    Ver detalle
                  </button>
                  <button className="danger-button" type="button">
                    <CircleX aria-hidden="true" size={15} />
                    Archivar
                  </button>
                </div>
                <div>
                  <button
                    aria-label="Abrir menú"
                    className="icon-button ds-icon-button"
                    type="button"
                  >
                    <Menu aria-hidden="true" size={18} />
                  </button>
                  <button
                    aria-label="Cerrar"
                    className="icon-button ds-icon-button"
                    type="button"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>
            </div>
            <div className="ds-card ds-component-card">
              <div className="ds-card-label">
                <span>Badges y estados</span>
                <span>Approved</span>
              </div>
              <div className="ds-badge-stack">
                <StatusBadge tone="success" value="Conectado" />
                <StatusBadge tone="warning" value="En revisión" />
                <StatusBadge tone="danger" value="Vencido" />
                <StatusBadge tone="neutral" value="Sin estado" />
                <FilterableStatus
                  className="status-active"
                  label="Activo"
                  onFilter={() => setActiveFilter(!activeFilter)}
                />
              </div>
            </div>
            <div className="ds-card ds-component-card">
              <div className="ds-card-label">
                <span>Forms</span>
                <span>Approved</span>
              </div>
              <div className="ds-form-sample">
                <label>
                  Nombre de la empresa
                  <input placeholder="Ej. Casa Mirador" />
                </label>
                <label>
                  Tipo de servicio
                  <select defaultValue="">
                    <option value="">Selecciona una opción</option>
                    <option>Instalación</option>
                    <option>Mantenimiento</option>
                  </select>
                </label>
                <label>
                  Notas
                  <textarea placeholder="Contexto adicional" rows={3} />
                </label>
              </div>
            </div>
            <div className="ds-card ds-component-card">
              <div className="ds-card-label">
                <span>Search / filters</span>
                <span>Approved</span>
              </div>
              <div className="ds-search-sample">
                <div className="ds-search-input">
                  <Search aria-hidden="true" size={17} />
                  <input
                    aria-label="Buscar componentes"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Buscar en el sistema…"
                    value={query}
                  />
                </div>
                <div className="ds-filter-row">
                  {activeFilter && (
                    <ActiveFilterChip
                      label="Estado: Activo"
                      onClear={() => setActiveFilter(false)}
                    />
                  )}
                  <button className="secondary-button" type="button">
                    <SlidersHorizontal aria-hidden="true" size={15} />
                    Filtros
                  </button>
                </div>
                <AutocompleteInput
                  ariaLabel="Buscar empresa"
                  onChange={() => undefined}
                  onSelect={() => undefined}
                  options={[
                    { id: "1", label: "Casa Mirador", secondary: "Empresa" },
                    { id: "2", label: "Oficinas Bayona", secondary: "Empresa" },
                  ]}
                  placeholder="Autocompletado de relación"
                  value={query}
                />
              </div>
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Feedback"
          title="Empty, loading, error y alertas"
          description="Los estados son parte del producto, no un borde final. Cada uno explica la situación y ofrece el siguiente paso cuando aplica."
        >
          <div className="ds-state-grid">
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Empty state</span>
                <span>Approved</span>
              </div>
              <Empty
                action={
                  <button className="primary-button" type="button">
                    <Plus aria-hidden="true" size={15} />
                    Crear registro
                  </button>
                }
                text="Crea el primer registro para empezar a organizar este espacio."
              />
            </div>
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Loading state</span>
                <span>Approved</span>
              </div>
              <LoadingState text="Cargando relaciones…" />
              <div className="ds-demo-skeleton" />
              <div className="ds-demo-skeleton ds-demo-skeleton-short" />
            </div>
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Error state</span>
                <span>Approved</span>
              </div>
              <ErrorState
                action={
                  <button className="secondary-button" type="button">
                    Intentar de nuevo
                  </button>
                }
                message="No se pudo cargar la información de ejemplo."
              />
            </div>
            <div className="ds-card">
              <div className="ds-card-label">
                <span>Inline alerts</span>
                <span>Approved</span>
              </div>
              <InlineAlert
                message="Cambios guardados correctamente."
                tone="success"
              />
              <InlineAlert
                message="Revisa los campos antes de continuar."
                tone="error"
              />
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Data display"
          title="Tabla, tabs y paginación"
          description="La densidad operativa se mantiene legible mediante alineación, estados de fila y controles persistentes."
        >
          <div className="ds-card ds-table-card">
            <div className="ds-table-toolbar">
              <div>
                <p className="eyebrow">Historial</p>
                <h3>Cotizaciones recientes</h3>
              </div>
              <PageSizeControl
                label="Filas por página"
                onChange={() => undefined}
                value="10"
              />
            </div>
            <div className="table-wrap">
              <table className="collection-table ds-table">
                <thead>
                  <tr>
                    <th>
                      <SortHeader
                        column="quote"
                        direction="asc"
                        label="Cotización"
                        onSort={() => undefined}
                        sort="quote"
                      />
                    </th>
                    <th>Cliente</th>
                    <th>Estado</th>
                    <th className="number-column">Total</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map(([quote, client, status, total]) => (
                    <tr className="clickable-row" key={quote} tabIndex={0}>
                      <td>
                        <strong>{quote}</strong>
                        <small>28 ago 2026</small>
                      </td>
                      <td>{client}</td>
                      <td>
                        <StatusBadge
                          tone={
                            status === "Aprobada"
                              ? "success"
                              : status === "Enviada"
                                ? "neutral"
                                : "warning"
                          }
                          value={status}
                        />
                      </td>
                      <td className="number-column">{total}</td>
                      <td>
                        <button className="text-button" type="button">
                          Ver
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              onPageChange={setSelectedPage}
              page={selectedPage}
              totalPages={3}
            />
          </div>
          <div className="ds-card ds-tabs-card">
            <div className="ds-card-label">
              <span>Tabs</span>
              <span>Selected: {activeTab}</span>
            </div>
            <div className="ds-tabs" role="tablist">
              {["Proyectos", "Cotizaciones", "Facturas", "Casos"].map((tab) => (
                <button
                  aria-selected={activeTab === tab}
                  className={activeTab === tab ? "active" : ""}
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  role="tab"
                  type="button"
                >
                  {tab}
                  <span>
                    {tab === "Proyectos" ? 4 : tab === "Cotizaciones" ? 3 : 0}
                  </span>
                </button>
              ))}
            </div>
            <div className="ds-tab-content">
              <FolderKanban aria-hidden="true" size={20} />
              <div>
                <strong>{activeTab}</strong>
                <p>
                  La pestaña seleccionada conserva el contexto del registro y
                  actualiza su panel asociado.
                </p>
              </div>
              <ArrowRight aria-hidden="true" size={17} />
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Record pattern"
          title="Detalle y relaciones"
          description="El workspace de registro reúne contexto, acción, relaciones e historial en una sola superficie."
        >
          <div className="ds-record-workspace">
            <aside className="record-summary-panel">
              <div className="record-heading">
                <span className="record-avatar">
                  <Building2 aria-hidden="true" size={22} />
                </span>
                <div>
                  <p className="eyebrow">Empresa</p>
                  <h3>Casa Mirador</h3>
                  <p>Organización y cliente comercial</p>
                </div>
              </div>
              <div className="record-actions">
                <button className="primary-button compact-action" type="button">
                  <Plus aria-hidden="true" size={15} />
                  Actividad
                </button>
                <button
                  className="secondary-button compact-action"
                  type="button"
                >
                  Editar
                </button>
              </div>
              <details className="record-about" open>
                <summary>Acerca de esta empresa</summary>
                <dl className="record-properties">
                  <div>
                    <dt>
                      <Mail aria-hidden="true" size={14} />
                      Correo
                    </dt>
                    <dd>contacto@ejemplo.do</dd>
                  </div>
                  <div>
                    <dt>
                      <Phone aria-hidden="true" size={14} />
                      Teléfono
                    </dt>
                    <dd>809-542-2221</dd>
                  </div>
                  <div>
                    <dt>
                      <MapPin aria-hidden="true" size={14} />
                      Dirección
                    </dt>
                    <dd>Santo Domingo Oeste</dd>
                  </div>
                </dl>
              </details>
            </aside>
            <section className="record-center-panel">
              <div className="record-tabs" role="tablist">
                {["Proyectos", "Cotizaciones", "Facturas"].map((tab) => (
                  <button
                    aria-selected={activeTab === tab}
                    className={activeTab === tab ? "active" : ""}
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    role="tab"
                    type="button"
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div className="ds-record-relations">
                <div className="ds-relation-heading">
                  <div>
                    <p className="eyebrow">Relación principal</p>
                    <h3>{activeTab}</h3>
                  </div>
                  <span className="related-count">2</span>
                </div>
                <DocumentRow
                  metadata="PDF · actualizado hoy"
                  name="Propuesta Casa Mirador.pdf"
                  href="#documento"
                />
                <DocumentRow
                  metadata="Registro operativo"
                  name="Visita técnica"
                  href="#actividad"
                />
              </div>
              <section className="record-recent-activity">
                <div className="record-recent-activity-heading">
                  <div>
                    <p className="eyebrow">Seguimiento</p>
                    <h3>Actividad reciente</h3>
                  </div>
                  <span className="activity-filter-label">
                    <History aria-hidden="true" size={14} />
                    Todas
                  </span>
                </div>
                <ActivityTimeline
                  events={timelineEvents}
                  onOpenActivity={() => undefined}
                />
              </section>
            </section>
            <aside className="record-related-panel">
              <div className="related-panel-heading">
                <h3>Relacionados</h3>
                <span>4</span>
              </div>
              <details className="related-record-section" open>
                <summary>
                  <span className="related-section-label">
                    <CalendarClock aria-hidden="true" size={16} />
                    Actividades
                  </span>
                  <span className="related-section-meta">
                    2<ChevronRight aria-hidden="true" size={15} />
                  </span>
                </summary>
                <p className="related-empty">2 actividades recientes</p>
              </details>
              <details className="related-record-section" open>
                <summary>
                  <span className="related-section-label">
                    <FileText aria-hidden="true" size={16} />
                    Documentos
                  </span>
                  <span className="related-section-meta">
                    1<ChevronRight aria-hidden="true" size={15} />
                  </span>
                </summary>
                <p className="related-empty">1 documento disponible</p>
              </details>
            </aside>
          </div>
        </Section>

        <Section
          eyebrow="Patterns"
          title="Overlay y navegación"
          description="La última milla: confirmación, perfil y navegación preservan foco, jerarquía y salida segura."
        >
          <div className="ds-pattern-grid" id="patrones">
            <div className="ds-card ds-overlay-card">
              <div className="ds-card-label">
                <span>Modal / confirmation</span>
                <span>Approved</span>
              </div>
              <div className="ds-modal-preview">
                <div>
                  <p className="eyebrow">Confirmación</p>
                  <h3>¿Archivar este registro?</h3>
                  <p>
                    El registro dejará de aparecer en las listas activas. Puedes
                    restaurarlo desde administración.
                  </p>
                </div>
                <div className="form-actions">
                  <button
                    className="secondary-button"
                    onClick={() => setModalOpen(false)}
                    type="button"
                  >
                    Cancelar
                  </button>
                  <button
                    className="danger-button"
                    onClick={() => setModalOpen(false)}
                    type="button"
                  >
                    Archivar
                  </button>
                </div>
              </div>
              <button
                className="primary-button"
                onClick={() => setModalOpen(true)}
                type="button"
              >
                Abrir modal real
              </button>
            </div>
            <div className="ds-card ds-nav-preview">
              <div className="ds-card-label">
                <span>Navigation</span>
                <span>Approved</span>
              </div>
              <div className="ds-nav-mini">
                <div className="ds-nav-brand">
                  <span className="ds-brand-mark">H</span>
                  <strong>HIDACA</strong>
                </div>
                {["Inicio", "Empresas", "Proyectos", "Cotizaciones"].map(
                  (item, index) => (
                    <a
                      className={index === 1 ? "active" : ""}
                      href={`#${item}`}
                      key={item}
                    >
                      <span>
                        {index === 0 ? (
                          <ShieldCheck aria-hidden="true" size={17} />
                        ) : index === 1 ? (
                          <Building2 aria-hidden="true" size={17} />
                        ) : index === 2 ? (
                          <FolderKanban aria-hidden="true" size={17} />
                        ) : (
                          <FileText aria-hidden="true" size={17} />
                        )}
                      </span>
                      {item}
                    </a>
                  ),
                )}
              </div>
            </div>
          </div>
        </Section>

        <footer className="ds-footer">
          <div>
            <span className="ds-brand-mark">H</span>
            <strong>HIDACA Design System</strong>
          </div>
          <p>
            Fuente de decisión para futuras superficies UI · sin datos privados
            · desarrollo solamente
          </p>
          <a href="/app">
            Volver a Operaciones <ArrowRight aria-hidden="true" size={15} />
          </a>
          <a href="/design-system/editor">
            Editar tokens <ArrowRight aria-hidden="true" size={15} />
          </a>
        </footer>
      </div>
      {modalOpen && (
        <Modal
          eyebrow="Confirmación segura"
          onClose={() => setModalOpen(false)}
          title="¿Archivar este registro?"
        >
          <p>
            Esta acción lo retira de las listas activas. El historial se
            conserva.
          </p>
          <div className="form-actions">
            <button
              className="secondary-button"
              onClick={() => setModalOpen(false)}
              type="button"
            >
              Cancelar
            </button>
            <button
              className="danger-button"
              onClick={() => setModalOpen(false)}
              type="button"
            >
              Archivar registro
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}
