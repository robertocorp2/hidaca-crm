"use client";

import { useEffect, useState } from "react";
import { dateTime, PageHeader } from "./ui";

type Provider = {
  provider: string;
  configured: boolean;
  enabled: boolean;
  connectionStatus: string;
  defaultModel: string;
  chatModel: string;
  draftingModel: string;
  transcriptionModel: string;
  usageCount: number;
  estimatedCost: number;
  lastSuccessfulRequest: string | null;
};
type SettingsPayload = {
  settings: {
    enabled: boolean;
    effectiveEnabled: boolean;
    defaultProvider: string;
    fallbackEnabled: boolean;
    gatewayEnabled: boolean;
    toolAccess: string;
    destructiveActions: boolean;
  };
  providers: Provider[];
};
const labels: Record<string, string> = {
  openai: "OpenAI",
  google: "Gemini",
  deepseek: "DeepSeek",
  gateway: "Cloudflare AI Gateway",
};

export function AiSettingsView() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<SettingsPayload | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/ai/settings", { cache: "no-store" })
      .then(async (response) => ({
        response,
        body: (await response.json()) as SettingsPayload & { error?: string },
      }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok)
          throw new Error(
            body.error ?? "No fue posible cargar la configuración.",
          );
        setData(body);
        setDraft(JSON.parse(JSON.stringify(body)) as SettingsPayload);
      })
      .catch((loadError) => {
        if (active)
          setError(
            loadError instanceof Error
              ? loadError.message
              : "No fue posible cargar la configuración.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  function updateProvider(
    index: number,
    field: keyof Provider,
    value: string | boolean,
  ) {
    setDraft((current) =>
      current
        ? {
            ...current,
            providers: current.providers.map((provider, providerIndex) =>
              providerIndex === index
                ? { ...provider, [field]: value }
                : provider,
            ),
          }
        : current,
    );
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: draft.settings,
          providers: draft.providers.filter(
            (provider) => provider.provider !== "gateway",
          ),
        }),
      });
      const body = (await response.json()) as SettingsPayload & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          body.error ?? "No fue posible guardar la configuración.",
        );
      setData(body);
      setDraft(JSON.parse(JSON.stringify(body)) as SettingsPayload);
      setMessage(
        "Configuración IA guardada. La activación efectiva depende del secreto y la bandera de runtime.",
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "No fue posible guardar la configuración.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function testConnection(provider: Provider) {
    setTesting(provider.provider);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/ai/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          provider: provider.provider,
          model: provider.chatModel,
        }),
      });
      const body = (await response.json()) as {
        status?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error ?? "La prueba de conexión falló.");
      setMessage(
        `${labels[provider.provider] ?? provider.provider}: ${body.status === "connected" ? "conexión exitosa" : body.status === "blocked_by_feature_flag" ? "bloqueado por AI_ENABLED" : "sin credencial configurada"}.`,
      );
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "La prueba de conexión falló.",
      );
    } finally {
      setTesting("");
    }
  }

  if (!draft || !data)
    return (
      <>
        <PageHeader
          description="Configuración segura de proveedores, modelos y límites del asistente."
          eyebrow="Configuración"
          title="Inteligencia Artificial"
        />
        <p className="muted">Cargando configuración…</p>
      </>
    );
  return (
    <>
      <PageHeader
        action={
          <button
            className="primary-button"
            disabled={busy}
            onClick={() => void save()}
            type="button"
          >
            {busy ? "Guardando…" : "Guardar configuración"}
          </button>
        }
        description="Las claves permanecen en secretos server-side y nunca se muestran aquí."
        eyebrow="Configuración"
        title="Inteligencia Artificial"
      />
      {message && (
        <div className="flash" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="flash" role="alert">
          {error}
        </div>
      )}
      <section className="panel ai-settings-global">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Política</span>
            <h2>Controles globales</h2>
          </div>
          <span
            className={`connection-dot ${draft.settings.effectiveEnabled ? "is-connected" : ""}`}
            aria-label={
              draft.settings.effectiveEnabled ? "IA activa" : "IA inactiva"
            }
          />
        </div>
        <div className="settings-grid">
          <label className="toggle-field">
            <input
              checked={draft.settings.enabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  settings: {
                    ...draft.settings,
                    enabled: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>IA habilitada en configuración</span>
          </label>
          <label>
            Proveedor predeterminado
            <select
              value={draft.settings.defaultProvider}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  settings: {
                    ...draft.settings,
                    defaultProvider: event.target.value,
                  },
                })
              }
            >
              <option value="openai">OpenAI</option>
              <option value="google">Gemini</option>
              <option value="deepseek">DeepSeek</option>
            </select>
          </label>
          <label className="toggle-field">
            <input
              checked={draft.settings.fallbackEnabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  settings: {
                    ...draft.settings,
                    fallbackEnabled: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>Fallback automático para lectura</span>
          </label>
          <label className="toggle-field">
            <input
              checked={draft.settings.gatewayEnabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  settings: {
                    ...draft.settings,
                    gatewayEnabled: event.target.checked,
                  },
                })
              }
              type="checkbox"
            />
            <span>Cloudflare AI Gateway</span>
          </label>
          <div className="settings-note">
            <strong>Herramientas</strong>
            <span>Solo lectura</span>
            <strong>Acciones destructivas</strong>
            <span>Prohibidas</span>
            <strong>Runtime efectivo</strong>
            <span>
              {data.settings.effectiveEnabled
                ? "Activo"
                : "Desactivado por bandera o configuración"}
            </span>
          </div>
        </div>
      </section>
      <div className="ai-provider-grid">
        {draft.providers.map((provider, index) => (
          <section className="panel ai-provider-card" key={provider.provider}>
            <div className="panel-heading">
              <div>
                <span className="eyebrow">Proveedor</span>
                <h2>{labels[provider.provider] ?? provider.provider}</h2>
              </div>
              <span
                className={`status ${provider.configured ? "status-success" : ""}`}
              >
                {provider.connectionStatus === "healthy"
                  ? "Conectado"
                  : provider.configured
                    ? "Configurado"
                    : "Sin credencial"}
              </span>
            </div>
            <label className="toggle-field">
              <input
                checked={provider.enabled}
                disabled={provider.provider === "gateway"}
                onChange={(event) =>
                  updateProvider(index, "enabled", event.target.checked)
                }
                type="checkbox"
              />
              <span>Habilitado</span>
            </label>
            {provider.provider !== "gateway" && (
              <>
                <label>
                  Modelo predeterminado
                  <input
                    value={provider.defaultModel}
                    onChange={(event) =>
                      updateProvider(index, "defaultModel", event.target.value)
                    }
                    placeholder="ID de modelo"
                  />
                </label>
                <label>
                  Modelo de chat
                  <input
                    value={provider.chatModel}
                    onChange={(event) =>
                      updateProvider(index, "chatModel", event.target.value)
                    }
                    placeholder="ID de modelo"
                  />
                </label>
                <label>
                  Modelo de borradores
                  <input
                    value={provider.draftingModel}
                    onChange={(event) =>
                      updateProvider(index, "draftingModel", event.target.value)
                    }
                    placeholder="ID de modelo"
                  />
                </label>
                <label>
                  Modelo de transcripción
                  <input
                    value={provider.transcriptionModel}
                    onChange={(event) =>
                      updateProvider(
                        index,
                        "transcriptionModel",
                        event.target.value,
                      )
                    }
                    placeholder="ID de modelo"
                  />
                </label>
                <button
                  className="secondary-button"
                  disabled={
                    !provider.configured || testing === provider.provider
                  }
                  onClick={() => void testConnection(provider)}
                  type="button"
                >
                  {testing === provider.provider
                    ? "Probando…"
                    : "Probar conexión"}
                </button>
              </>
            )}
            <div className="provider-metrics">
              <span>Uso estimado</span>
              <strong>
                {provider.usageCount} solicitudes · $
                {provider.estimatedCost.toFixed(4)}
              </strong>
              <span>Última solicitud exitosa</span>
              <strong>
                {provider.lastSuccessfulRequest
                  ? dateTime(provider.lastSuccessfulRequest, true)
                  : "—"}
              </strong>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
