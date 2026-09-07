"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { BusinessRow, ContactRow, RecordRow } from "./types";
import { DocumentEditor, emptyDocumentState, type DocumentEditorState, type DocumentSavePayload } from "./document-editor";
import { DocumentPreviewModal } from "./document-preview";
import type { PdfDocumentData } from "../lib/document-pdf";
import { Empty, Modal, dateTime, money } from "./ui";
import { CotizacionesReplacementPanel } from "./cotizaciones-replacement-panel";
import { RecordAiPanel } from "./record-ai-panel";

type DataRow = Record<string, unknown>;
type ProjectOption = { id: string; name: string; businessId: string; businessName: string };

export function CotizacionesView({ businesses, contacts, canWrite, canCreateInvoice = false, canAskAi = false, canProposeAi = false, canApproveAi = false, isAdmin, legacyRecords, onLegacyUpdated, onLegacyArchived, selectedId = null, setSelectedId, onCreateInvoice, onOpenInvoice, setMessage }: { businesses: BusinessRow[]; contacts: ContactRow[]; canWrite: boolean; canCreateInvoice?: boolean; canAskAi?: boolean; canProposeAi?: boolean; canApproveAi?: boolean; isAdmin: boolean; legacyRecords: RecordRow[]; onLegacyUpdated(record: RecordRow): void; onLegacyArchived(id: string): void; selectedId?: string | null; setSelectedId?: (id: string | null) => void; onCreateInvoice?: (quotationId: string) => void; onOpenInvoice?: (invoiceId: string) => void; setMessage(value: string): void }) {
  const [quotes, setQuotes] = useState<DataRow[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<DataRow | null>(null);
  const [detail, setDetail] = useState<DataRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [legacyEditing, setLegacyEditing] = useState<RecordRow | null>(null);
  const [preview, setPreview] = useState<PdfDocumentData | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/projects?limit=500", { cache: "no-store" }).then((response) => response.json()).then((payload) => { const result = payload as DataRow; if (active) setProjects(array(result.projects) as ProjectOption[]); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true);
      const params = new URLSearchParams({ limit: "250" });
      if (query.trim()) params.set("q", query.trim());
      void fetch(`/api/quotations?${params}`, { cache: "no-store" }).then((response) => response.json()).then((payload) => { const result = payload as DataRow; setQuotes(array(result.quotations)); if (!result.quotations && result.error) setMessage(String(result.error)); }).catch(() => setMessage("No se pudieron cargar las cotizaciones.")).finally(() => setLoading(false));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, setMessage]);
  useEffect(() => {
    if (!selectedId || !quotes.length || String(selected?.id ?? "") === selectedId) return;
    const quote = quotes.find((item) => String(item.id) === selectedId);
    if (quote) void openQuote(quote);
  }, [quotes, selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleLegacy = useMemo(() => {
    const term = query.toLowerCase().trim();
    return legacyRecords.filter((record) => !term || `${record.title} ${record.customerName} ${record.contact} ${record.notes}`.toLowerCase().includes(term));
  }, [legacyRecords, query]);

  async function openQuote(quote: DataRow) {
    setSelected(quote); setDetail(null);
    setSelectedId?.(String(quote.id));
    const response = await fetch(`/api/quotations/${encodeURIComponent(String(quote.id))}`, { cache: "no-store" });
    const payload = await response.json() as DataRow;
    if (response.ok) setDetail(payload); else setMessage(String(payload.error ?? "No se pudo abrir la cotización."));
  }

  async function saveDocument(payload: DocumentSavePayload) {
    const editingQuote = selected && !selected.legacy ? selected : null;
    const response = await fetch(editingQuote ? `/api/quotations/${String(editingQuote.id)}` : "/api/quotations", {
      method: editingQuote ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload.fields, ...payload.financials, ...payload.terms, discountAmount: payload.calculation.discount, additionalChargeAmount: payload.calculation.additionalCharge, taxRate: payload.calculation.taxRate, taxAmount: payload.calculation.taxAmount, subtotalAmount: payload.calculation.subtotal, totalAmount: payload.calculation.total, paidAmountSnapshot: payload.calculation.advance, balanceAmountSnapshot: payload.calculation.balance, lines: payload.lines }),
    });
    const result = await response.json() as DataRow;
    if (!response.ok) throw new Error(String(result.error ?? "No se pudo guardar la cotización."));
    const savedId = String(result.quotationId ?? editingQuote?.id ?? "");
    const detailResponse = await fetch(`/api/quotations/${encodeURIComponent(savedId)}`, { cache: "no-store" });
    const savedDetail = await detailResponse.json() as DataRow;
    setCreating(false); setEditing(false); setSelected(null); setDetail(null); setMessage(editingQuote ? "Cotización actualizada correctamente." : "Cotización creada correctamente.");
    if (detailResponse.ok) setPreview(quotationPdfData(savedDetail));
    const listResponse = await fetch(`/api/quotations?limit=250${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`, { cache: "no-store" });
    const listPayload = await listResponse.json() as DataRow;
    setQuotes(array(listPayload.quotations));
  }

  return <div className="quotations-view">
    <div className="breadcrumbs"><span>Inicio</span><i>/</i><span aria-current="page">Cotizaciones</span></div>
    <div className="page-heading quotations-heading"><div><p className="eyebrow">Gestión comercial</p><h1>Cotizaciones</h1><p>Construye propuestas detalladas, conserva el historial importado y genera documentos listos para compartir.</p></div>{canWrite && <button className="primary-button" onClick={() => setCreating(true)}>Nueva cotización</button>}</div>
    {isAdmin && <CotizacionesReplacementPanel />}
    <div className="toolbar quotations-toolbar"><label className="quotations-search"><span className="search-glyph" aria-hidden="true">⌕</span><span className="visually-hidden">Buscar cotizaciones</span><input aria-label="Buscar cotizaciones" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por número, título, empresa o contacto…" value={query} /></label><span className="record-count"><strong>{quotes.length + visibleLegacy.length}</strong> registros</span></div>
    <section className="panel quotations-table-panel"><div className="table-panel-heading"><div><p className="eyebrow">Historial</p><h2>Registro de cotizaciones</h2></div><span>Selecciona una fila para ver el detalle</span></div><div className="table-wrap"><table className="responsive-table quotations-table"><thead><tr><th>Fecha</th><th>Cotización</th><th>Empresa</th><th>Estado</th><th className="number-column">Total</th><th>Origen</th><th>Acciones</th></tr></thead><tbody>{quotes.map((quote) => <tr className="clickable-row quotation-row" key={`quote-${String(quote.id)}`} onClick={() => void openQuote(quote)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openQuote(quote); } }} tabIndex={0}><Cell label="Fecha">{formatDate(quote.quotationDate)}</Cell><Cell label="Cotización"><strong>{display(quote.quotationNumber)}</strong><small>{display(quote.title, "Sin título")}</small></Cell><Cell label="Empresa">{display(quote.businessName)}</Cell><Cell label="Estado"><span className="status">{quoteStatus(String(quote.status ?? ""))}</span></Cell><Cell label="Total" numeric>{formatMoney(quote.calculatedTotal ?? quote.sourceTotal)}</Cell><Cell label="Origen">Normalizada</Cell><Cell label="Acciones"><button className="text-button" onClick={(event) => { event.stopPropagation(); void openQuote(quote); }}>Ver</button></Cell></tr>)}{visibleLegacy.map((record) => <tr className="quotation-row" key={`legacy-${record.id}`}><Cell label="Fecha">{formatDate(record.dueDate ?? record.updatedAt)}</Cell><Cell label="Cotización"><strong>{record.title}</strong><small>Registro legacy</small></Cell><Cell label="Empresa">{record.customerName || record.contact || "—"}</Cell><Cell label="Estado"><span className="status">{record.status || "—"}</span></Cell><Cell label="Total" numeric>{record.amount ? money(record.amount) : "—"}</Cell><Cell label="Origen">Importada</Cell><Cell label="Acciones">{canWrite && <><button className="text-button" onClick={() => setLegacyEditing(record)}>Editar</button><button className="danger-link" onClick={() => void archiveLegacy(record)}>Archivar</button></>}</Cell></tr>)}</tbody></table></div>{loading && <p className="muted">Cargando…</p>}{!loading && !quotes.length && !visibleLegacy.length && <Empty text="No hay cotizaciones para esta búsqueda." />}</section>

    {(creating || (selected && editing)) && <Modal eyebrow="Gestión comercial" onClose={() => { setCreating(false); setEditing(false); }} title={creating ? "Nueva cotización" : `Editar ${display(selected?.quotationNumber)}`} wide><DocumentEditor kind="quotation" businesses={businesses} contacts={contacts} projects={projects} initial={creating ? emptyDocumentState("quotation") : quotationEditorState(detail)} onCancel={() => { setCreating(false); setEditing(false); }} onSave={saveDocument} /></Modal>}
    {selected && !editing && <Modal eyebrow="Cotización" onClose={() => { setSelected(null); setDetail(null); setSelectedId?.(null); }} title={display(selected.quotationNumber)} wide><QuotationDetail canApproveAi={canApproveAi} canAskAi={canAskAi} canProposeAi={canProposeAi} detail={detail} onCreateInvoice={onCreateInvoice} onOpenInvoice={onOpenInvoice} onEdit={() => setEditing(true)} onPrint={() => { if (detail) setPreview(quotationPdfData(detail)); }} canCreateInvoice={canCreateInvoice} canWrite={canWrite} /></Modal>}
    {legacyEditing && <LegacyQuotationModal record={legacyEditing} onClose={() => setLegacyEditing(null)} onSaved={(record) => { onLegacyUpdated(record); setLegacyEditing(null); setMessage("Cotización legacy actualizada."); }} onArchived={(id) => { onLegacyArchived(id); setLegacyEditing(null); }} />}
    {preview && <DocumentPreviewModal document={preview} onClose={() => setPreview(null)} />}
  </div>;

  async function archiveLegacy(record: RecordRow) {
    if (!window.confirm(`¿Archivar “${record.title}”?`)) return;
    const response = await fetch(`/api/records/${record.id}`, { method: "DELETE" });
    if (response.ok) { onLegacyArchived(record.id); setMessage("Cotización archivada."); } else setMessage("No se pudo archivar la cotización.");
  }
}

function QuotationDetail({ detail, onEdit, onPrint, onCreateInvoice, onOpenInvoice, canCreateInvoice, canWrite, canAskAi, canProposeAi, canApproveAi }: { detail: DataRow | null; onEdit(): void; onPrint(): void; onCreateInvoice?: (quotationId: string) => void; onOpenInvoice?: (invoiceId: string) => void; canCreateInvoice: boolean; canWrite: boolean; canAskAi: boolean; canProposeAi: boolean; canApproveAi: boolean }) {
  const [linkedInvoices, setLinkedInvoices] = useState<DataRow[]>([]);
  const quotationId = text(object(detail?.quotation).id);
  useEffect(() => {
    if (!quotationId) return;
    let active = true;
    void fetch(`/api/invoices?quotationId=${encodeURIComponent(quotationId)}&limit=50`, { cache: "no-store" }).then((response) => response.json()).then((payload) => { const result = payload as DataRow; if (active) setLinkedInvoices(array(result.invoices)); }).catch(() => { if (active) setLinkedInvoices([]); });
    return () => { active = false; };
  }, [quotationId]);
  if (!detail) return <p className="muted">Cargando detalle…</p>;
  const quote = object(detail.quotation); const revision = object(detail.revision); const financials = object(detail.financials); const lines = array(detail.lineItems);
  return <div className="invoice-detail"><div className="invoice-detail-actions"><span className="status">{quoteStatus(text(quote.status))}</span><div className="invoice-detail-buttons"><RecordAiPanel canApprove={canApproveAi} canAsk={canAskAi} canPropose={canProposeAi} entityId={text(quote.id)} entityType="quotation" title={display(quote.quotationNumber)} /><button className="secondary-button" onClick={onPrint}>Imprimir</button>{canCreateInvoice && text(quote.status) === "accepted" && onCreateInvoice && <button aria-label="Convertir esta cotización en factura" className="primary-button" onClick={() => onCreateInvoice(text(quote.id))}>Convertir a factura</button>}{canWrite && <button className="secondary-button" onClick={onEdit}>Editar cotización</button>}</div></div><DetailSection title="Cotización"><DetailValue label="Empresa" value={display(quote.businessName)} /><DetailValue label="Contacto" value={display(quote.contactName)} /><DetailValue label="Proyecto" value={display(quote.projectName)} /><DetailValue label="Fecha" value={formatDate(revision.quotationDate)} /><DetailValue label="Fecha límite" value={formatDate(revision.validityUntil)} /><DetailValue label="Tipo" value={display(quote.quotationType)} /></DetailSection><section className="invoice-section"><div className="invoice-section-heading"><h3>Facturas vinculadas</h3><span>{linkedInvoices.length}</span></div>{linkedInvoices.length ? <ul className="linked-invoice-list">{linkedInvoices.map((invoice) => <li key={text(invoice.id)}><a href={`/app?view=facturas&record=${encodeURIComponent(text(invoice.id))}`} onClick={(event) => { if (!onOpenInvoice || event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onOpenInvoice(text(invoice.id)); }}><strong>{display(invoice.invoiceNumberRaw)}</strong><span>{formatMoney(invoice.totalAmount)} · {display(invoice.status)}</span></a></li>)}</ul> : <p className="muted">Aún no hay facturas vinculadas.</p>}</section><section className="invoice-section"><div className="invoice-section-heading"><h3>Partidas</h3><span>{lines.length}</span></div>{lines.length ? <div className="table-wrap"><table className="invoice-lines-table responsive-table"><thead><tr><th>Descripción</th><th>Cantidad</th><th>Ancho</th><th>Altura</th><th>Área</th><th>Precio</th><th>Total</th></tr></thead><tbody>{lines.map((line) => <tr key={text(line.id)}><Cell label="Descripción"><strong>{display(line.description)}</strong></Cell><Cell label="Cantidad" numeric>{display(line.quantity)}</Cell><Cell label="Ancho">{dimension(line.finishedWidthCm ?? line.openingWidthCm, "cm")}</Cell><Cell label="Altura">{dimension(line.finishedHeightCm ?? line.openingHeightCm, "cm")}</Cell><Cell label="Área">{dimension(line.areaSqm, "m²")}</Cell><Cell label="Precio" numeric>{formatMoney(line.unitPrice)}</Cell><Cell label="Total" numeric>{formatMoney(line.calculatedLineTotal)}</Cell></tr>)}</tbody></table></div> : <p className="muted">No hay partidas en esta revisión.</p>}</section><section className="invoice-section invoice-financial-section"><p className="eyebrow">Resumen financiero</p><dl className="invoice-totals"><TotalValue label="Sub-Total" value={financials.calculatedSubtotal} /><TotalValue label="Descuento" value={financials.discountAmount} /><TotalValue label="ITBIS" value={financials.calculatedTaxAmount} /><TotalValue strong label="Total" value={financials.calculatedTotal ?? financials.sourceTotal} /><TotalValue label="Avance / pagado" value={financials.amountPaid} /><TotalValue strong label="Balance" value={financials.remainingBalance} /></dl></section></div>;
}

function LegacyQuotationModal({ record, onClose, onSaved, onArchived }: { record: RecordRow; onClose(): void; onSaved(record: RecordRow): void; onArchived(id: string): void }) {
  const [form, setForm] = useState({ title: record.title, status: record.status, customerName: record.customerName, contact: record.contact, amount: String(record.amount), balance: String(record.balance), dueDate: record.dueDate?.slice(0, 10) ?? "", notes: record.notes });
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); const response = await fetch(`/api/records/${record.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); const payload = await response.json() as { record?: RecordRow; error?: string }; setBusy(false); if (response.ok && payload.record) onSaved(payload.record); }
  return <Modal eyebrow="Registro legacy" onClose={onClose} title="Editar cotización" wide><form className="invoice-editor" onSubmit={submit}><fieldset><legend>Datos existentes</legend><div className="form-grid"><TextField label="Título" value={form.title} onChange={(value) => setForm({ ...form, title: value })} /><TextField label="Estado" value={form.status} onChange={(value) => setForm({ ...form, status: value })} /><TextField label="Empresa" value={form.customerName} onChange={(value) => setForm({ ...form, customerName: value })} /><TextField label="Contacto" value={form.contact} onChange={(value) => setForm({ ...form, contact: value })} /><TextField label="Monto" type="number" value={form.amount} onChange={(value) => setForm({ ...form, amount: value })} /><TextField label="Balance" type="number" value={form.balance} onChange={(value) => setForm({ ...form, balance: value })} /><TextField label="Fecha límite" type="date" value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} /><label className="wide">Notas<textarea rows={4} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label></div></fieldset><div className="form-actions"><button className="secondary-button" onClick={onClose} type="button">Cancelar</button><button className="danger-button" onClick={() => onArchived(record.id)} type="button">Archivar</button><button className="primary-button" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div></form></Modal>;
}

function quotationEditorState(detail: DataRow | null): DocumentEditorState {
  const state = emptyDocumentState("quotation"); const quote = object(detail?.quotation); const revision = object(detail?.revision); const terms = object(detail?.terms); const financials = object(detail?.financials);
  state.fields = { businessId: text(quote.businessId), quotationNumber: text(quote.quotationNumber), quotationYear: text(quote.quotationYear), quotationDate: text(revision.quotationDate).slice(0, 10), validityUntil: text(revision.validityUntil).slice(0, 10), status: text(quote.status) || "draft", quotationType: text(quote.quotationType) || "other", serviceCategory: text(quote.serviceCategory), currency: text(quote.currency) || "DOP", primaryContactId: text(quote.primaryContactId), projectId: text(quote.projectId), revisionLabel: text(revision.revisionLabel), alternativeLabel: text(revision.alternativeLabel), scopeLabel: text(revision.scopeLabel) };
  const lines = array(detail?.lineItems).map((line) => ({ id: crypto.randomUUID(), description: text(line.description), quantity: text(line.quantity) || "1", widthCm: text(line.finishedWidthCm ?? line.openingWidthCm), heightCm: text(line.finishedHeightCm ?? line.openingHeightCm), unitPrice: text(line.unitPrice), itemCode: text(line.itemCode), location: text(line.location) }));
  if (lines.length) state.lines = lines;
  state.financials = { discount: text(financials.discountAmount), additionalChargeLabel: text(array(detail?.charges)[0]?.label) || "Cargo adicional", additionalChargeAmount: text(array(detail?.charges)[0]?.calculatedAmount), taxRate: text(financials.sourceTaxRate) || "18", advance: text(financials.amountPaid) };
  state.terms = { paymentConditions: text(terms.paymentConditions), customerFacingNotes: text(revision.customerFacingNotes), internalNotes: text(revision.internalNotes) };
  return state;
}

function quotationPdfData(detail: DataRow): PdfDocumentData { const quote = object(detail.quotation); const revision = object(detail.revision); const financials = object(detail.financials); const charge = array(detail.charges)[0]; return { kind: "quotation", number: text(quote.quotationNumber), date: text(revision.quotationDate), dueDate: text(revision.validityUntil), currency: text(quote.currency) || "DOP", businessName: text(quote.businessName), businessRnc: text(quote.rnc), contactName: text(quote.contactName), contactPhone: text(quote.contactPhone), contactEmail: text(quote.contactEmail), projectName: text(quote.projectName), paymentTerms: text(object(detail.terms).paymentConditions), notes: text(revision.customerFacingNotes), lines: array(detail.lineItems).map((line) => ({ id: text(line.id), description: line.description, quantity: line.quantity, widthCm: line.finishedWidthCm ?? line.openingWidthCm, heightCm: line.finishedHeightCm ?? line.openingHeightCm, unitPrice: line.unitPrice })), discount: financials.discountAmount, additionalCharge: charge?.calculatedAmount, additionalChargeLabel: text(charge?.label), taxRate: financials.sourceTaxRate, advance: financials.amountPaid }; }

function TextField({ label, value, onChange, type = "text" }: { label: string; value: string; onChange(value: string): void; type?: string }) { return <label>{label}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} /></label>; }
function DetailSection({ children, title }: { children: ReactNode; title: string }) { return <section className="invoice-section"><h3>{title}</h3><dl className="invoice-detail-grid">{children}</dl></section>; }
function DetailValue({ label, value }: { label: string; value: ReactNode }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function TotalValue({ label, value, strong = false }: { label: string; value: unknown; strong?: boolean }) { return <div className={strong ? "invoice-total-strong" : undefined}><dt>{label}</dt><dd>{formatMoney(value)}</dd></div>; }
function Cell({ children, label, numeric = false }: { children: ReactNode; label: string; numeric?: boolean }) { return <td className={numeric ? "number-column" : undefined} data-label={label}>{children}</td>; }
function text(value: unknown) { return value === null || value === undefined ? "" : String(value); }
function display(value: unknown, fallback = "—") { return text(value).trim() || fallback; }
function formatDate(value: unknown) { return text(value) ? dateTime(text(value)) : "—"; }
function formatMoney(value: unknown) { const result = Number(value); return Number.isFinite(result) ? money(result) : "—"; }
function dimension(value: unknown, unit: string) { const result = Number(value); return Number.isFinite(result) ? `${value} ${unit}` : "—"; }
function quoteStatus(value: string) { return (({ draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada", expired: "Vencida", cancelled: "Cancelada", unknown: "Por revisar" } as Record<string, string>)[value] ?? value) || "—"; }
function array(value: unknown): DataRow[] { return Array.isArray(value) ? value as DataRow[] : []; }
function object(value: unknown): DataRow { return value && typeof value === "object" && !Array.isArray(value) ? value as DataRow : {}; }
