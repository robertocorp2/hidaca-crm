"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCheck,
  CircleAlert,
  FileText,
  MessageCircle,
  Paperclip,
  RefreshCw,
  Send,
  UserRound,
} from "lucide-react";
import { formatBusinessDate } from "./ui";

type Conversation = {
  id: string;
  displayName: string;
  waId: string;
  status: string;
  unreadCount: number;
  matchState: string;
  serviceWindowExpiresAt?: string | null;
  lastMessageAt?: string | null;
  assignedUserId?: number | null;
};
type Message = {
  id: string;
  direction: string;
  type: string;
  body: string;
  caption?: string;
  status: string;
  createdAt: string;
  fileName?: string | null;
};
type Template = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  quality?: string | null;
};
type Campaign = {
  id: string;
  name: string;
  status: string;
  total: number;
  sent: number;
  failed: number;
  processed: number;
  templateName: string;
};
type Health = {
  enabled?: boolean;
  configured?: boolean;
  campaignsEnabled?: boolean;
  phoneNumberId?: string;
  wabaId?: string;
  secretsPresent?: boolean;
  status?:
    | "UNCONFIGURED"
    | "PARTIALLY_CONFIGURED"
    | "CONNECTED"
    | "ERROR"
    | "DISABLED";
};

const statusLabels: Record<string, string> = {
  open: "Abierta",
  pending: "Pendiente",
  closed: "Cerrada",
  matched: "Vinculada",
  created_prospect: "Prospecto creado",
  ambiguous: "Revisión requerida",
  received: "Recibido",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "Fallido",
};

export function WhatsAppView({
  canWrite,
  isAdmin,
}: {
  canWrite: boolean;
  isAdmin: boolean;
}) {
  const [section, setSection] = useState<
    "inbox" | "templates" | "campaigns" | "admin"
  >("inbox");
  const tabKeys = ["inbox", "templates", "campaigns", "admin"] as const;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [composer, setComposer] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [health, setHealth] = useState<Health>({});
  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    null;

  const loadInbox = useCallback(async () => {
    const response = await fetch("/api/whatsapp/conversations", {
      cache: "no-store",
    });
    if (!response.ok) return;
    const data = (await response.json()) as { conversations?: Conversation[] };
    setConversations(data.conversations ?? []);
    setSelectedId((current) => current ?? data.conversations?.[0]?.id ?? null);
    setLoading(false);
  }, []);
  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    const response = await fetch(`/api/whatsapp/conversations/${selectedId}`, {
      cache: "no-store",
    });
    if (response.ok)
      setMessages(
        ((await response.json()) as { messages?: Message[] }).messages ?? [],
      );
  }, [selectedId]);
  // Polling and focus refresh intentionally synchronize remote inbox state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void loadInbox();
    const timer = window.setInterval(() => void loadInbox(), 5000);
    const onFocus = () => void loadInbox();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [loadInbox]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);
  useEffect(() => {
    if (section === "templates")
      void fetch("/api/whatsapp/templates")
        .then((response) => (response.ok ? response.json() : { templates: [] }))
        .then((data: unknown) =>
          setTemplates((data as { templates?: Template[] }).templates ?? []),
        );
    if (section === "campaigns")
      void fetch("/api/whatsapp/campaigns")
        .then((response) => (response.ok ? response.json() : { campaigns: [] }))
        .then((data: unknown) =>
          setCampaigns((data as { campaigns?: Campaign[] }).campaigns ?? []),
        );
  }, [section]);
  useEffect(() => {
    void fetch("/api/whatsapp/health")
      .then((response) => (response.ok ? response.json() : {}))
      .then((data: unknown) => setHealth(data as Health));
  }, []);

  async function sendMessage() {
    if (!selectedId || !composer.trim() || !canWrite) return;
    const response = await fetch(
      `/api/whatsapp/conversations/${selectedId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: composer, type: "text" }),
      },
    );
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setNotice(data.error ?? "No se pudo enviar.");
      return;
    }
    setComposer("");
    setNotice("Mensaje enviado.");
    await loadSelected();
    await loadInbox();
  }
  async function syncTemplates() {
    const response = await fetch("/api/whatsapp/templates", { method: "POST" });
    setNotice(
      response.ok
        ? "Plantillas sincronizadas."
        : "No se pudieron sincronizar las plantillas.",
    );
  }
  async function dispatchCampaign(id: string) {
    const response = await fetch(`/api/whatsapp/campaigns/${id}/dispatch`, {
      method: "POST",
    });
    setNotice(
      response.ok
        ? "Lote procesado; puedes continuar mientras la vista esté abierta."
        : "No se pudo procesar el lote.",
    );
    setSection("campaigns");
  }

  return (
    <section className="whatsapp-workspace" aria-label="WhatsApp HIDACA">
      <div className="whatsapp-heading">
        <div>
          <p className="eyebrow">Comunicación</p>
          <h1>WhatsApp</h1>
          <p className="muted">
            Bandeja compartida conectada a Meta Cloud API.
          </p>
        </div>
        <button className="secondary-button" onClick={() => void loadInbox()}>
          <RefreshCw size={16} /> Actualizar
        </button>
      </div>
      <div
        className="whatsapp-tabs"
        role="tablist"
        aria-label="Secciones de WhatsApp"
      >
        {(
          [
            ["inbox", "Bandeja", MessageCircle],
            ["templates", "Plantillas", FileText],
            ["campaigns", "Campañas", Send],
            ["admin", "Administración", CircleAlert],
          ] as const
        ).map(([key, label, Icon], index) => (
          <button
            key={key}
            id={`whatsapp-tab-${key}`}
            role="tab"
            aria-selected={section === key}
            aria-controls={`whatsapp-panel-${key}`}
            tabIndex={section === key ? 0 : -1}
            className={section === key ? "is-active" : ""}
            onClick={() => setSection(key)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                const next = tabKeys[(index + 1) % tabKeys.length];
                setSection(next);
                document.getElementById(`whatsapp-tab-${next}`)?.focus();
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                const next =
                  tabKeys[(index - 1 + tabKeys.length) % tabKeys.length];
                setSection(next);
                document.getElementById(`whatsapp-tab-${next}`)?.focus();
              } else if (event.key === "Home" || event.key === "End") {
                event.preventDefault();
                const next =
                  tabKeys[event.key === "Home" ? 0 : tabKeys.length - 1];
                setSection(next);
                document.getElementById(`whatsapp-tab-${next}`)?.focus();
              }
            }}
          >
            <Icon aria-hidden="true" size={16} /> {label}
          </button>
        ))}
      </div>
      {notice && (
        <p className="whatsapp-notice" role="status">
          {notice}
        </p>
      )}
      {!health.configured && (
        <div className="whatsapp-setup-banner">
          <div>
            <strong>
              WhatsApp · Estado:{" "}
              {health.status === "PARTIALLY_CONFIGURED"
                ? "Configuración incompleta"
                : health.status === "DISABLED"
                  ? "Deshabilitado"
                  : "No configurado"}
            </strong>
            <p>
              El módulo está disponible, pero Meta todavía no está conectado.
              Las acciones externas permanecen desactivadas.
            </p>
          </div>
          <button
            className="secondary-button"
            onClick={() => setSection("admin")}
          >
            Configurar integración
          </button>
        </div>
      )}
      {section === "inbox" && (
        <div
          className="whatsapp-inbox"
          id="whatsapp-panel-inbox"
          role="tabpanel"
          aria-labelledby="whatsapp-tab-inbox"
          tabIndex={0}
        >
          <aside className="whatsapp-list">
            <div className="whatsapp-list-header">
              <strong>Conversaciones</strong>
              <span>{conversations.length}</span>
            </div>
            {loading ? (
              <p className="empty-state">Cargando…</p>
            ) : conversations.length === 0 ? (
              <div className="whatsapp-empty">
                <MessageCircle size={24} />
                <p>No hay conversaciones todavía.</p>
                <small>Cuando Meta entregue un mensaje, aparecerá aquí.</small>
              </div>
            ) : (
              conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  className={`whatsapp-conversation ${selectedId === conversation.id ? "is-selected" : ""}`}
                  onClick={() => setSelectedId(conversation.id)}
                >
                  <span className="whatsapp-avatar">
                    <UserRound size={16} />
                  </span>
                  <span className="whatsapp-conversation-copy">
                    <strong>
                      {conversation.displayName || conversation.waId}
                    </strong>
                    <small>
                      {conversation.waId} ·{" "}
                      {statusLabels[conversation.matchState] ??
                        conversation.matchState}
                    </small>
                  </span>
                  {conversation.unreadCount > 0 && (
                    <b>{conversation.unreadCount}</b>
                  )}
                </button>
              ))
            )}
          </aside>
          <main className="whatsapp-thread">
            {selected ? (
              <>
                <header className="whatsapp-thread-header">
                  <div>
                    <h2>{selected.displayName || selected.waId}</h2>
                    <p>
                      {selected.waId} ·{" "}
                      {statusLabels[selected.status] ?? selected.status}
                    </p>
                  </div>
                  <select
                    aria-label="Estado de conversación"
                    value={selected.status}
                    onChange={async (event) => {
                      await fetch(
                        `/api/whatsapp/conversations/${selected.id}`,
                        {
                          method: "PATCH",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ status: event.target.value }),
                        },
                      );
                      await loadInbox();
                    }}
                  >
                    <option value="open">Abierta</option>
                    <option value="pending">Pendiente</option>
                    <option value="closed">Cerrada</option>
                  </select>
                </header>
                <div className="whatsapp-messages">
                  {messages.map((message) => (
                    <article
                      key={message.id}
                      className={`whatsapp-message ${message.direction === "outbound" ? "is-outbound" : ""}`}
                    >
                      <p>
                        {message.body ||
                          (message.type !== "text"
                            ? `Contenido ${message.type} recibido`
                            : "")}
                      </p>
                      {message.fileName && (
                        <small>
                          <Paperclip size={12} /> {message.fileName}
                        </small>
                      )}
                      <footer>
                        {formatBusinessDate(message.createdAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}{" "}
                        {message.direction === "outbound" && (
                          <>
                            <span> · </span>
                            <CheckCheck aria-hidden="true" size={13} />{" "}
                            {statusLabels[message.status] ?? message.status}
                          </>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
                <div className="whatsapp-composer">
                  <textarea
                    value={composer}
                    onChange={(event) => setComposer(event.target.value)}
                    placeholder="Escribe un mensaje…"
                    aria-label="Mensaje"
                    disabled={!canWrite}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void sendMessage();
                      }
                    }}
                  />
                  <button
                    className="primary-button"
                    onClick={() => void sendMessage()}
                    disabled={!canWrite || !composer.trim()}
                  >
                    <Send size={16} /> Enviar
                  </button>
                </div>
              </>
            ) : (
              <div className="whatsapp-empty whatsapp-thread-empty">
                <MessageCircle size={32} />
                <h2>Selecciona una conversación</h2>
                <p>
                  Las conversaciones nuevas aparecerán en la bandeja compartida.
                </p>
              </div>
            )}
          </main>
          <aside className="whatsapp-details">
            <p className="eyebrow">CRM</p>
            <h3>Vinculación</h3>
            {selected ? (
              <>
                <p className="muted">
                  Estado de coincidencia:{" "}
                  <strong>
                    {statusLabels[selected.matchState] ?? selected.matchState}
                  </strong>
                </p>
                <p className="muted">
                  Asignación:{" "}
                  {selected.assignedUserId
                    ? `Usuario #${selected.assignedUserId}`
                    : "Sin asignar"}
                </p>
                <button
                  className="secondary-button"
                  onClick={() =>
                    setNotice(
                      "La vinculación CRM se gestiona desde la API protegida.",
                    )
                  }
                >
                  Gestionar vínculo
                </button>
              </>
            ) : (
              <p className="muted">
                Selecciona un hilo para ver Empresa, Contacto, Prospecto y
                Oportunidad.
              </p>
            )}
          </aside>
        </div>
      )}
      {section === "templates" && (
        <div
          className="whatsapp-panel"
          id="whatsapp-panel-templates"
          role="tabpanel"
          aria-labelledby="whatsapp-tab-templates"
          tabIndex={0}
        >
          <div className="whatsapp-panel-header">
            <div>
              <h2>Plantillas aprobadas</h2>
              <p className="muted">
                Solo las plantillas aprobadas por Meta pueden usarse fuera de la
                ventana de servicio.
              </p>
            </div>
            {isAdmin && (
              <button
                className="primary-button"
                onClick={() => void syncTemplates()}
              >
                <RefreshCw size={16} /> Sincronizar
              </button>
            )}
          </div>
          {templates.length === 0 ? (
            <div className="whatsapp-empty">
              <FileText size={24} />
              <p>No hay plantillas sincronizadas.</p>
            </div>
          ) : (
            <div className="whatsapp-template-grid">
              {templates.map((template) => (
                <article key={template.id} className="whatsapp-template-card">
                  <div>
                    <strong>{template.name}</strong>
                    <span>
                      {template.language} · {template.category}
                    </span>
                  </div>
                  <span
                    className={`status-pill ${template.status === "APPROVED" ? "is-success" : ""}`}
                  >
                    {template.status}
                  </span>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
      {section === "campaigns" && (
        <div
          className="whatsapp-panel"
          id="whatsapp-panel-campaigns"
          role="tabpanel"
          aria-labelledby="whatsapp-tab-campaigns"
          tabIndex={0}
        >
          <div className="whatsapp-panel-header">
            <div>
              <h2>Campañas inmediatas</h2>
              <p className="muted">
                Audiencias deduplicadas con consentimiento opted_in. El
                procesamiento continúa por lotes mientras esta vista está
                abierta.
              </p>
            </div>
          </div>
          {campaigns.length === 0 ? (
            <div className="whatsapp-empty">
              <Send size={24} />
              <p>No hay campañas creadas.</p>
            </div>
          ) : (
            <div className="whatsapp-campaign-list">
              {campaigns.map((campaign) => (
                <article key={campaign.id}>
                  <div>
                    <strong>{campaign.name}</strong>
                    <span>
                      {campaign.templateName} · {campaign.processed}/
                      {campaign.total} procesados
                    </span>
                  </div>
                  <div>
                    <span className="status-pill">
                      {statusLabels[campaign.status] ?? campaign.status}
                    </span>
                    {canWrite &&
                      ["queued", "running"].includes(campaign.status) && (
                        <button
                          className="secondary-button"
                          onClick={() => void dispatchCampaign(campaign.id)}
                        >
                          Procesar lote
                        </button>
                      )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
      {section === "admin" && (
        <div
          className="whatsapp-panel"
          id="whatsapp-panel-admin"
          role="tabpanel"
          aria-labelledby="whatsapp-tab-admin"
          tabIndex={0}
        >
          <div className="whatsapp-panel-header">
            <div>
              <h2>Administración</h2>
              <p className="muted">
                Diagnóstico de conexión, webhook y sincronización Meta.
              </p>
            </div>
          </div>
          <div className="whatsapp-connection-status">
            <span
              className={`connection-dot ${health.configured ? "is-connected" : ""}`}
              aria-hidden="true"
            />
            <div>
              <strong>
                Estado:{" "}
                {health.status === "CONNECTED"
                  ? "Conectado"
                  : health.status === "PARTIALLY_CONFIGURED"
                    ? "Configuración incompleta"
                    : health.status === "DISABLED"
                      ? "Deshabilitado"
                      : "No configurado"}
              </strong>
              <p>
                {health.configured
                  ? `WABA ${health.wabaId || "configurada"} · número ${health.phoneNumberId || "configurado"}`
                  : "Para activar WhatsApp conecta una cuenta de Meta Business desde los secretos del Site."}
              </p>
            </div>
          </div>
          <div className="whatsapp-admin-grid">
            <div>
              <strong>✓ Módulo HIDACA instalado</strong>
              <span>Permisos y navegación disponibles.</span>
            </div>
            <div>
              <strong>✓ Base de datos preparada</strong>
              <span>Migración aditiva y consentimiento CRM.</span>
            </div>
            <div>
              <strong>○ Cuenta Meta Business</strong>
              <span>Requiere onboarding externo.</span>
            </div>
            <div>
              <strong>○ Credenciales y webhook</strong>
              <span>Se agregan server-side cuando estén disponibles.</span>
            </div>
            <div>
              <strong>○ Plantillas aprobadas</strong>
              <span>Sincronización disponible para administradores.</span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
