"use client";

import { useEffect, useState } from "react";

type Provider = { provider: string; enabled?: boolean; configured: boolean; defaultModel?: string; baseUrl?: string; capabilities?: Record<string, boolean> };
type Model = { id: string; capabilities: Record<string, boolean> };

export function AiClient({ role }: { role: string }) {
  const [provider, setProvider] = useState<Provider | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { void fetch("/api/ai/providers", { cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error("No autorizado"); const data = await r.json() as { providers: Provider[] }; const selected = data.providers.find((item) => item.provider === "ollama-cloud") ?? data.providers[0]; setProvider(selected ?? null); setModel(selected?.defaultModel ?? ""); }).catch((e: unknown) => setError(e instanceof Error ? e.message : "No se pudo cargar el proveedor.")); }, []);
  const discover = async () => { setError(""); try { const r = await fetch("/api/ai/models", { cache: "no-store" }); const data = await r.json() as { models?: Model[]; error?: { message?: string } }; if (!r.ok) throw new Error(data.error?.message ?? "No se pudieron cargar los modelos."); setModels(data.models ?? []); if (!model && data.models?.[0]) setModel(data.models[0].id); } catch (e) { setError(e instanceof Error ? e.message : "No se pudieron cargar los modelos."); } };
  const send = async () => { if (!prompt.trim() || !model || busy) return; setBusy(true); setError(""); try { const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ollama-cloud", model, messages: [{ role: "user", content: prompt.trim() }], stream: false }) }); const data = await r.json() as { result?: { text?: string }; data?: { message?: { content?: string } }; error?: { message?: string } }; if (!r.ok) throw new Error(data.error?.message ?? "La solicitud falló."); setAnswer(data.result?.text ?? data.data?.message?.content ?? ""); } catch (e) { setError(e instanceof Error ? e.message : "La solicitud falló."); } finally { setBusy(false); } };
  if (role !== "admin" && role !== "operator") return <main><h1>IA</h1><p>Se requiere un rol operativo.</p></main>;
  return <main><h1>IA</h1><p>Proveedor: <strong>{provider?.provider ?? "Cargando…"}</strong> · Estado: <strong>{provider?.configured ? "Configurado" : "No configurado"}</strong></p><p>Base URL: {provider?.baseUrl ?? "https://ollama.com/api"} · structured output: no disponible en Ollama Cloud.</p><button onClick={() => void discover()} disabled={busy}>Cargar modelos</button><label>Modelo<select value={model} onChange={e => setModel(e.target.value)}><option value="">Selecciona un modelo</option>{models.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label><label>Mensaje<textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={100000} /></label><button onClick={() => void send()} disabled={busy || !model || !prompt.trim()}>{busy ? "Enviando…" : "Enviar"}</button>{error && <p role="alert">{error}</p>}{answer && <article><h2>Respuesta</h2><p>{answer}</p></article>}</main>;
}
