"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CalendarPlus, CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { Modal } from "./ui";

type RecordContext = {
  entityType: string;
  entityId: string;
  primary: Record<string, unknown>;
  relations: Record<string, Array<Record<string, unknown>>>;
  activities: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
};

type Approval = { id: string; status: string; proposedAction: string };

function localInputDate(offsetHours: number) {
  const date = new Date(Date.now() + offsetHours * 3_600_000);
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function relatedTarget(context: RecordContext | null) {
  if (!context) return {};
  if (["business", "contact", "project", "lead", "opportunity", "case"].includes(context.entityType)) {
    return { relatedType: context.entityType, relatedId: context.entityId };
  }
  const primary = context.primary;
  if (primary.projectId) return { relatedType: "project", relatedId: String(primary.projectId) };
  if (primary.businessId) return { relatedType: "business", relatedId: String(primary.businessId) };
  return {};
}

const quickPrompts: Record<string, string[]> = {
  business: ["Resumir empresa", "Próximas acciones", "Buscar riesgos", "Ver historial resumido"],
  contact: ["Resumir contacto", "Preparar seguimiento", "Ver relaciones", "Ver actividad reciente"],
  project: ["Resumir proyecto", "Estado actual", "Próximas acciones", "Buscar riesgos"],
  lead: ["Resumir prospecto", "Evaluar seguimiento", "Riesgo de abandono", "Próxima acción recomendada"],
  opportunity: ["Resumir oportunidad", "Próxima acción", "Identificar bloqueo", "Ver historial"],
  quotation: ["Resumir cotización", "Estado y seguimiento", "Buscar riesgos", "Ver historial relacionado"],
  invoice: ["Resumir factura", "Estado de pago", "Seguimiento recomendado", "Ver historial relacionado"],
  case: ["Resumir caso", "Estado actual", "Próxima acción", "Riesgos"],
};

export function RecordAiPanel({
  canApprove,
  canAsk,
  canPropose,
  entityId,
  entityType,
  title,
}: {
  canApprove: boolean;
  canAsk: boolean;
  canPropose: boolean;
  entityId: string;
  entityType: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<RecordContext | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [approval, setApproval] = useState<Approval | null>(null);
  const [activityTitle, setActivityTitle] = useState(`Seguimiento: ${title}`.slice(0, 200));
  const [activityStart, setActivityStart] = useState("");

  useEffect(() => {
    setActivityStart(localInputDate(24));
  }, []);

  const relationCount = useMemo(
    () => Object.values(context?.relations ?? {}).reduce((total, rows) => total + rows.length, 0),
    [context],
  );

  async function show() {
    setOpen(true);
    if (context || loading) return;
    setLoading(true);
    setError("");
    try {
      const [contextResponse, providersResponse] = await Promise.all([
        fetch(`/api/ai/context?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`),
        fetch("/api/ai/providers"),
      ]);
      const contextBody = await contextResponse.json() as { context?: RecordContext; error?: string };
      const providersBody = await providersResponse.json() as { enabled?: boolean };
      if (!contextResponse.ok || !contextBody.context) throw new Error(contextBody.error ?? "No se pudo preparar el contexto.");
      setContext(contextBody.context);
      setEnabled(Boolean(providersBody.enabled));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo preparar el contexto.");
    } finally { setLoading(false); }
  }

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, entityId, messages: [{ role: "user", content: question.trim() }], allowFallback: true }) });
      const body = await response.json() as { result?: { text?: string }; error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo consultar el registro.");
      setAnswer(body.result?.text ?? "No se recibió contenido.");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo consultar el registro."); }
    finally { setBusy(false); }
  }

  async function proposeActivity() {
    if (busy || !activityTitle.trim()) return;
    const startAt = new Date(activityStart);
    if (Number.isNaN(startAt.getTime())) { setError("Selecciona una fecha válida."); return; }
    const endAt = new Date(startAt.getTime() + 30 * 60_000);
    setBusy(true);
    setError("");
    try {
      const target = relatedTarget(context);
      const response = await fetch("/api/ai/actions/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: `record:${entityType}:${entityId}:${activityStart}:${activityTitle}`, action: { type: "create_activity", input: { title: activityTitle.trim(), description: `Actividad preparada desde el contexto de ${title}.`, startAt: startAt.toISOString(), endAt: endAt.toISOString(), status: "planned", ...target } } }) });
      const body = await response.json() as { approvals?: Approval[]; error?: string };
      if (!response.ok || !body.approvals?.[0]) throw new Error(body.error ?? "No se pudo preparar la actividad.");
      setApproval(body.approvals[0]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo preparar la actividad."); }
    finally { setBusy(false); }
  }

  async function decide(decision: "approved" | "rejected") {
    if (!approval || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/ai/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: approval.id, decision }) });
      const body = await response.json() as { approval?: Approval; error?: string };
      if (!response.ok || !body.approval) throw new Error(body.error ?? "No se pudo resolver la aprobación.");
      setApproval(body.approval);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo resolver la aprobación."); }
    finally { setBusy(false); }
  }

  if (!canAsk) return null;
  return <>
    <button aria-label={`Abrir acciones de IA para ${title}`} className="secondary-button record-ai-trigger" onClick={() => void show()} type="button"><Sparkles aria-hidden="true" size={16} /> AI</button>
    {open && <Modal eyebrow="Contexto seguro" onClose={() => setOpen(false)} title={`IA · ${title}`} wide>
      <div className="record-ai-panel">
        {loading ? <p className="muted">Preparando contexto autorizado…</p> : null}
        {error && <div className="inline-alert" role="alert">{error}</div>}
        {context && <section className="record-ai-context-summary" aria-label="Resumen del contexto utilizado">
          <div><Bot aria-hidden="true" size={20} /><strong>Contexto limitado al registro</strong></div>
          <ul><li>{relationCount} registros relacionados</li><li>{context.activities.length} actividades</li><li>{context.notes.length} notas</li><li>{context.documents.length} documentos</li></ul>
          <small><ShieldCheck aria-hidden="true" size={14} /> Las notas y documentos se tratan como datos no confiables; nunca como instrucciones.</small>
        </section>}
        <div className="record-ai-quick-actions" aria-label="Acciones rápidas de IA">{(quickPrompts[entityType] ?? ["Resumir", "Próximas acciones", "Preguntar a AI"]).map((prompt) => <button className="suggestion-chip" key={prompt} onClick={() => setQuestion(prompt)} type="button">{prompt}</button>)}</div>
        <form className="record-ai-question" onSubmit={ask}>
          <label htmlFor={`record-ai-question-${entityId}`}>Pregunta sobre este registro</label>
          <textarea id={`record-ai-question-${entityId}`} disabled={!enabled || busy} maxLength={16000} onChange={(event) => setQuestion(event.target.value)} placeholder="Ej.: ¿Qué seguimientos están pendientes y qué datos faltan?" value={question} />
          {!enabled && <small className="muted">El contexto determinístico está disponible, pero las respuestas IA permanecen desactivadas hasta configurar un proveedor.</small>}
          <button className="primary-button" disabled={!enabled || busy || !question.trim()}>{busy ? "Consultando…" : "Consultar"}</button>
        </form>
        {answer && <section className="record-ai-answer" aria-live="polite"><strong>Respuesta</strong><p>{answer}</p></section>}
        {canPropose && <section className="record-ai-action">
          <div><CalendarPlus aria-hidden="true" size={20} /><div><strong>Preparar actividad</strong><small>La propuesta no modifica el CRM hasta ser aprobada.</small></div></div>
          <label>Título<input maxLength={200} onChange={(event) => setActivityTitle(event.target.value)} value={activityTitle} /></label>
          <label>Fecha y hora<input onChange={(event) => setActivityStart(event.target.value)} type="datetime-local" value={activityStart} /></label>
          {!approval && <button className="secondary-button" disabled={busy || !activityTitle.trim()} onClick={() => void proposeActivity()} type="button">Preparar para aprobación</button>}
          {approval && <div className="record-ai-approval" role="status"><CheckCircle2 aria-hidden="true" size={18} /><span>{approval.status === "executed" ? "Actividad creada y auditada." : approval.status === "rejected" ? "Propuesta rechazada." : "Propuesta pendiente de aprobación."}</span>{canApprove && (approval.status === "pending" || approval.status === "approved") && <div><button className="primary-button" disabled={busy} onClick={() => void decide("approved")} type="button">Aprobar y crear</button><button className="secondary-button" disabled={busy} onClick={() => void decide("rejected")} type="button">Rechazar</button></div>}</div>}
        </section>}
      </div>
    </Modal>}
  </>;
}
