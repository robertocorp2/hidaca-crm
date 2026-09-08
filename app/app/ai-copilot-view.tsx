"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "./ui";
import { DailyBriefPanel } from "./daily-brief-panel";

type Provider = {
  provider: string;
  configured: boolean;
  defaultModel: string;
  gatewayAvailable: boolean;
  transport: string;
};
type Message = { role: "user" | "assistant"; content: string };
const suggestedPrompts = [
  "¿Qué oportunidades necesitan seguimiento esta semana?",
  "Resume las cotizaciones recientes y sus próximos pasos.",
  "¿Qué facturas vencidas requieren atención?",
  "Prepara mi agenda y prioridades de los próximos 7 días.",
];

export function AiCopilotView({
  canApprove,
  canCreate,
  isAdmin,
}: {
  canApprove: boolean;
  canCreate: boolean;
  isAdmin: boolean;
}) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [prompt, setPrompt] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    fetch("/api/ai/providers")
      .then(async (response) => {
        const body = (await response.json()) as {
          enabled?: boolean;
          providers?: Provider[];
        };
        setEnabled(Boolean(body.enabled));
        setProviders(body.providers ?? []);
      })
      .catch(() => setError("No fue posible consultar la configuración IA."));
  }, []);

  const configured = useMemo(
    () => providers.filter((item) => item.configured),
    [providers],
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const content = prompt.trim();
    if (!content || busy || !canCreate) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setPrompt("");
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          provider: provider || undefined,
          allowFallback: true,
        }),
      });
      const body = (await response.json()) as {
        result?: { text?: string };
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Solicitud IA fallida.");
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: body.result?.text ?? "No se recibió contenido.",
        },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Solicitud IA fallida.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleRecording() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setVoiceStatus("Este navegador no permite grabar audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const form = new FormData();
        form.append("file", blob, "hidaca-voice.webm");
        form.append("source", "browser");
        setVoiceStatus("Guardando y transcribiendo…");
        try {
          const response = await fetch("/api/ai/voice", {
            method: "POST",
            body: form,
          });
          const body = (await response.json()) as {
            transcription?: { text?: string };
            error?: string;
          };
          if (!response.ok && response.status !== 202)
            throw new Error(body.error ?? "No fue posible procesar el audio.");
          const transcriptionText = body.transcription?.text;
          if (transcriptionText)
            setPrompt(
              (current) =>
                `${current}${current ? "\n" : ""}${transcriptionText}`,
            );
          setVoiceStatus(
            response.status === 202
              ? "Audio guardado; falta configurar un proveedor de transcripción."
              : "Transcripción lista para revisar.",
          );
        } catch (voiceError) {
          setVoiceStatus(
            voiceError instanceof Error
              ? voiceError.message
              : "No fue posible procesar el audio.",
          );
        }
        setRecording(false);
      };
      recorderRef.current = recorder;
      streamRef.current = stream;
      recorder.start();
      setVoiceStatus("Grabando… pulsa Detener para procesar.");
      setRecording(true);
    } catch {
      setVoiceStatus("No se pudo acceder al micrófono.");
    }
  }

  return (
    <>
      <PageHeader
        description="Consulta información operativa y prepara borradores con proveedores configurados por HIDACA."
        eyebrow="Productividad"
        title="Asistente IA"
      />
      {!enabled && (
        <div className="flash" role="status">
          El asistente IA está desactivado. Un administrador debe habilitar
          AI_ENABLED después de configurar los proveedores.
          {isAdmin && (
            <a
              className="secondary-button ai-configure-link"
              href="/app?view=ai-settings"
            >
              Configurar IA
            </a>
          )}
        </div>
      )}
      {error && (
        <div className="flash" role="alert">
          {error}
        </div>
      )}
      <DailyBriefPanel canApprove={canApprove} canCreate={canCreate} />
      <section className="panel" aria-label="Configuración de proveedores IA">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Proveedores</span>
            <h2>Disponibilidad del entorno</h2>
          </div>
        </div>
        <div className="summary-grid">
          {providers.map((item) => (
            <div className="summary-card" key={item.provider}>
              <span>
                {item.provider === "google"
                  ? "Google Gemini"
                  : item.provider === "deepseek"
                    ? "DeepSeek"
                    : "OpenAI"}
              </span>
              <strong>{item.configured ? "Configurado" : "Pendiente"}</strong>
              <small>
                {item.transport}
                {item.defaultModel
                  ? ` · ${item.defaultModel}`
                  : " · modelo pendiente"}
              </small>
            </div>
          ))}
        </div>
      </section>
      <section
        className="panel ai-copilot-panel"
        aria-label="Conversación con el asistente"
      >
        <div className="panel-heading">
          <div>
            <span className="eyebrow">Copilot</span>
            <h2>Consulta segura y revisable</h2>
          </div>
          <label>
            Proveedor
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
            >
              <option value="">Predeterminado</option>
              {configured.map((item) => (
                <option key={item.provider} value={item.provider}>
                  {item.provider}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ai-messages" aria-live="polite">
          {messages.length === 0 ? (
            <>
              <p className="empty-state">
                Escribe una consulta sobre clientes, proyectos, agenda o cuentas
                por cobrar.
              </p>
              <div className="ai-suggestions" aria-label="Consultas sugeridas">
                {suggestedPrompts.map((suggestion) => (
                  <button
                    className="suggestion-chip"
                    key={suggestion}
                    onClick={() => setPrompt(suggestion)}
                    type="button"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </>
          ) : (
            messages.map((message, index) => (
              <div
                className={`ai-message ai-message-${message.role}`}
                key={`${message.role}-${index}`}
              >
                <strong>{message.role === "user" ? "Tú" : "HIDACA IA"}</strong>
                <p>{message.content}</p>
              </div>
            ))
          )}
        </div>
        <form className="ai-composer" onSubmit={submit}>
          <label htmlFor="ai-prompt">Consulta</label>
          <textarea
            id="ai-prompt"
            disabled={!canCreate || !enabled || busy}
            maxLength={16000}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Ej.: Resume las actividades pendientes de esta semana."
            value={prompt}
          />
          <div className="ai-composer-actions">
            <button
              className="secondary-button"
              disabled={!canCreate || !enabled || busy}
              onClick={() => void toggleRecording()}
              type="button"
            >
              {recording ? "Detener grabación" : "Grabar voz"}
            </button>
            <button
              className="primary-button"
              disabled={!canCreate || !enabled || busy || !prompt.trim()}
              type="submit"
            >
              {busy ? "Consultando…" : "Consultar"}
            </button>
          </div>
          {voiceStatus && (
            <small className="muted" role="status">
              {voiceStatus}
            </small>
          )}
        </form>
      </section>
    </>
  );
}
