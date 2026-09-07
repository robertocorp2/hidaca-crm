"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, CircleX, ListChecks, RefreshCw, Sparkles } from "lucide-react";
import { dateTime } from "./ui";

type BriefItem = {
  itemKey: string;
  section: "today" | "risks" | "followups" | "collections" | "projects";
  entityType: string;
  entityId: string;
  title: string;
  reason: string;
  priorityScore: number;
  suggestedAction: { type: "create_activity"; title: string; relatedType?: string; relatedId?: string; dueOffsetHours: number };
  status: string;
};
type Brief = { id: string; briefDate: string; summary: string; provider: string; model: string; generatedAt: string; items: BriefItem[] };
type Approval = { id: string; actionType: string; proposedAction: string; status: string };

const sectionLabels: Record<BriefItem["section"], string> = { today: "Hoy", risks: "Requiere atención", followups: "AI recomienda", collections: "Cobranza", projects: "Proyectos" };
const entityViews: Record<string, string> = { business: "businesses", contact: "contacts", project: "projects", lead: "leads", opportunity: "opportunities", quotation: "quotations", invoice: "facturas", case: "ordenes-cambio", activity: "schedule" };

function targetHref(item: BriefItem) {
  const view = entityViews[item.entityType];
  return view ? `/app?view=${encodeURIComponent(view)}&record=${encodeURIComponent(item.entityId)}` : "#";
}

function futureActivityWindow(offsetHours: number) {
  const start = new Date(new Date().getTime() + offsetHours * 3_600_000);
  return { startAt: start, endAt: new Date(start.getTime() + 30 * 60_000) };
}

export function DailyBriefPanel({ canApprove, canCreate }: { canApprove: boolean; canCreate: boolean }) {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai/daily-brief");
      const body = await response.json() as { brief?: Brief | null; error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo cargar el brief.");
      if (body.brief) setBrief(body.brief);
      const approvalResponse = await fetch("/api/ai/approvals");
      const approvalBody = await approvalResponse.json() as { approvals?: Approval[] };
      setApprovals(approvalResponse.ok ? approvalBody.approvals ?? [] : []);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el brief."); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);

  async function generate() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/ai/daily-brief", { method: "POST" });
      const body = await response.json() as { brief?: Brief; error?: string };
      if (!response.ok || !body.brief) throw new Error(body.error ?? "No se pudo generar el brief.");
      setBrief(body.brief);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo generar el brief."); }
    finally { setLoading(false); }
  }

  async function dismiss(item: BriefItem) {
    if (!brief || busyKey) return;
    setBusyKey(item.itemKey);
    try {
      const response = await fetch("/api/ai/daily-brief", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ briefId: brief.id, itemKey: item.itemKey, status: "dismissed" }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo descartar.");
      setBrief((current) => current ? { ...current, items: current.items.map((entry) => entry.itemKey === item.itemKey ? { ...entry, status: "dismissed" } : entry) } : current);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo descartar."); }
    finally { setBusyKey(""); }
  }

  async function prepare(item: BriefItem) {
    if (!canCreate || busyKey) return;
    setBusyKey(item.itemKey);
    try {
      const { startAt: start, endAt: end } = futureActivityWindow(item.suggestedAction.dueOffsetHours);
      const target = item.suggestedAction.relatedType && item.suggestedAction.relatedId ? { relatedType: item.suggestedAction.relatedType, relatedId: item.suggestedAction.relatedId } : {};
      const response = await fetch("/api/ai/actions/propose", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: `brief:${brief?.id}:${item.itemKey}`, action: { type: "create_activity", input: { title: item.suggestedAction.title, description: item.reason, startAt: start.toISOString(), endAt: end.toISOString(), status: "planned", ...target } } }) });
      const body = await response.json() as { approvals?: Approval[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "No se pudo preparar el seguimiento.");
      setApprovals((current) => [...(body.approvals ?? []), ...current.filter((entry) => !body.approvals?.some((next) => next.id === entry.id))]);
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo preparar el seguimiento."); }
    finally { setBusyKey(""); }
  }

  async function decide(approval: Approval, decision: "approved" | "rejected") {
    if (!canApprove || busyKey) return;
    setBusyKey(approval.id);
    try {
      const response = await fetch("/api/ai/approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: approval.id, decision }) });
      const body = await response.json() as { approval?: Approval; error?: string };
      if (!response.ok || !body.approval) throw new Error(body.error ?? "No se pudo resolver la aprobación.");
      setApprovals((current) => current.map((entry) => entry.id === approval.id ? body.approval! : entry));
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "No se pudo resolver la aprobación."); }
    finally { setBusyKey(""); }
  }

  const activeItems = useMemo(() => (brief?.items ?? []).filter((item) => item.status !== "dismissed"), [brief]);
  const groups = useMemo(() => (Object.keys(sectionLabels) as BriefItem["section"][]).map((section) => ({ section, items: activeItems.filter((item) => item.section === section) })).filter((group) => group.items.length), [activeItems]);

  return <section className="panel daily-brief-panel" aria-labelledby="daily-brief-title">
    <div className="panel-heading"><div><span className="eyebrow">HIDACA Daily Brief</span><h2 id="daily-brief-title">¿En qué debería enfocarme hoy?</h2></div><button className="secondary-button" disabled={loading} onClick={() => void generate()} type="button"><RefreshCw aria-hidden="true" size={15} /> {loading ? "Actualizando…" : "Actualizar"}</button></div>
    {error && <div className="inline-alert" role="alert">{error}</div>}
    {!brief && !loading && <div className="daily-brief-empty"><Sparkles aria-hidden="true" size={22} /><p>Genera un brief con agenda, riesgos, cotizaciones, cobranza y proyectos usando datos reales del CRM.</p><button className="primary-button" onClick={() => void generate()} type="button">Generar Daily Brief</button></div>}
    {brief && <>
      <div className="daily-brief-summary"><strong>{brief.summary}</strong><small>Generado {dateTime(brief.generatedAt, true)} · fuente {brief.provider === "deterministic" ? "CRM determinístico" : brief.provider}</small></div>
      <div className="daily-brief-groups">{groups.map((group) => <section className="daily-brief-group" key={group.section}><h3>{sectionLabels[group.section]}</h3>{group.items.map((item) => <article className="daily-brief-item" key={item.itemKey}><div className="daily-brief-item-main"><strong>{item.title}</strong><span>{item.reason}</span><small>Prioridad {item.priorityScore}/100</small></div><div className="daily-brief-item-actions"><a className="text-button" href={targetHref(item)}><ArrowUpRight aria-hidden="true" size={14} /> Ver</a>{canCreate && <button className="text-button" disabled={busyKey === item.itemKey} onClick={() => void prepare(item)} type="button"><ListChecks aria-hidden="true" size={14} /> Preparar seguimiento</button>}<button className="text-button" disabled={busyKey === item.itemKey} onClick={() => void dismiss(item)} type="button"><CircleX aria-hidden="true" size={14} /> Descartar</button></div></article>)}</section>)}</div>
    </>}
    {approvals.length > 0 && <section className="daily-brief-approvals"><div className="panel-heading"><div><span className="eyebrow">Aprobaciones</span><h3>Acciones propuestas</h3></div><span>{approvals.filter((item) => item.status === "pending" || item.status === "approved").length}</span></div>{approvals.filter((item) => item.status === "pending" || item.status === "approved").map((approval) => { let action: Record<string, unknown> = {}; try { action = JSON.parse(approval.proposedAction) as Record<string, unknown>; } catch { /* malformed data remains reviewable */ } const input = (action.input ?? {}) as Record<string, unknown>; return <article className="daily-brief-approval" key={approval.id}><div><strong>{String(input.title ?? "Actividad propuesta")}</strong><span>{String(input.startAt ?? "Fecha no definida")} · aún no ejecutada</span></div>{canApprove ? <div><button className="primary-button" disabled={busyKey === approval.id} onClick={() => void decide(approval, "approved")} type="button"><Check aria-hidden="true" size={14} /> Aprobar</button><button className="secondary-button" disabled={busyKey === approval.id} onClick={() => void decide(approval, "rejected")} type="button">Rechazar</button></div> : <small className="muted">Pendiente de un aprobador autorizado</small>}</article>; })}</section>}
  </section>;
}
