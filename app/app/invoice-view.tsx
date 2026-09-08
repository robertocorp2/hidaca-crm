"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { BusinessRow } from "./types";
import { DocumentEditor, emptyDocumentState, type DocumentEditorState, type DocumentSavePayload } from "./document-editor";
import { DocumentPreviewModal } from "./document-preview";
import type { PdfDocumentData } from "../lib/document-pdf";
import { Empty, Modal, dateTime, money } from "./ui";
import { RecordAiPanel } from "./record-ai-panel";

type DataRow = Record<string, unknown>;
type SortKey = "issueDate" | "invoiceNumberRaw" | "businessName" | "totalAmount";

const statusLabels: Record<string, string> = {
  draft: "Borrador", issued: "Emitida", partial: "Pago parcial", paid: "Pagada",
  overdue: "Vencida", cancelled: "Anulada", replaced: "Sustituida", credited: "Acreditada", unknown: "Por revisar",
};

export function InvoiceView({ businesses, canWrite, canEcfGenerate, canEcfXml, canAskAi = false, canProposeAi = false, canApproveAi = false, selectedId = null, fromQuotationId = null, setSelectedId, onNavigate, setMessage }: { businesses: BusinessRow[]; canWrite: boolean; canEcfGenerate: boolean; canEcfXml: boolean; canAskAi?: boolean; canProposeAi?: boolean; canApproveAi?: boolean; selectedId?: string | null; fromQuotationId?: string | null; setSelectedId?: (id: string | null) => void; onNavigate?: (view: string, id: string) => void; setMessage(value: string): void }) {
  const [rows, setRows] = useState<DataRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DataRow | null>(null);
  const [detail, setDetail] = useState<DataRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sort, setSort] = useState<SortKey>("issueDate");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [contacts, setContacts] = useState<DataRow[]>([]);
  const [projects, setProjects] = useState<DataRow[]>([]);
  const [quotations, setQuotations] = useState<DataRow[]>([]);
  const [preview, setPreview] = useState<PdfDocumentData | null>(null);
  const [ecfReview, setEcfReview] = useState<DataRow | null>(null);
  const [ecfLoading, setEcfLoading] = useState(false);
  const [conversionQuotationId, setConversionQuotationId] = useState("");
  const [conversionDraft, setConversionDraft] = useState<DocumentEditorState | null>(null);
  const [conversionWarning, setConversionWarning] = useState<DataRow | null>(null);
  const [handledQuotationId, setHandledQuotationId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/invoices?${query.trim() ? `q=${encodeURIComponent(query.trim())}` : ""}`, { cache: "no-store" });
    const payload = await response.json() as DataRow;
    if (!response.ok) setMessage(text(payload.error) || "No se pudieron cargar las facturas.");
    else setRows([...array(payload.invoices), ...array(payload.legacyInvoices)]);
    setLoading(false);
  }, [query, setMessage]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 180); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    if (!selectedId || !rows.length || text(selected?.id) === selectedId) return;
    const row = rows.find((item) => text(item.id) === selectedId);
    if (!row || number(row.legacy)) return;
    void fetch(`/api/invoices/${encodeURIComponent(selectedId)}`, { cache: "no-store" })
      .then(async (response) => ({ response, payload: await response.json() as DataRow }))
      .then(({ response, payload }) => {
        if (response.ok) { setSelected(row); setDetail(payload); }
        else setMessage(text(payload.error) || "No se pudo abrir la factura.");
      })
      .catch(() => setMessage("No se pudo abrir la factura."));
  }, [rows, selectedId, selected, setMessage]);
  useEffect(() => {
    if (!canWrite) return;
    let active = true;
    void Promise.all([
      fetch("/api/contacts?limit=500", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/projects?limit=500", { cache: "no-store" }).then((response) => response.json()),
      fetch("/api/quotations?limit=500", { cache: "no-store" }).then((response) => response.json()),
    ]).then(([contactPayload, projectPayload, quotationPayload]) => {
      if (!active) return;
      setContacts(array(object(contactPayload).contacts));
      setProjects(array(object(projectPayload).projects));
      setQuotations(array(object(quotationPayload).quotations));
    }).catch(() => { if (active) setMessage("Las relaciones opcionales no pudieron cargarse."); });
    return () => { active = false; };
  }, [canWrite, setMessage]);

  const sortedRows = useMemo(() => {
    const multiplier = direction === "asc" ? 1 : -1;
    return [...rows].sort((left, right) => sort === "totalAmount"
      ? (number(left.totalAmount) - number(right.totalAmount)) * multiplier
      : text(left[sort]).localeCompare(text(right[sort]), "es", { numeric: true, sensitivity: "base" }) * multiplier);
  }, [direction, rows, sort]);

  function changeSort(next: SortKey) {
    if (sort === next) setDirection((value) => value === "asc" ? "desc" : "asc");
    else { setSort(next); setDirection(next === "issueDate" || next === "totalAmount" ? "desc" : "asc"); }
  }

  async function openDetail(row: DataRow) {
    setSelected(row); setDetail(null);
    setSelectedId?.(text(row.id));
    if (number(row.legacy)) return;
    const response = await fetch(`/api/invoices/${encodeURIComponent(text(row.id))}`, { cache: "no-store" });
    const payload = await response.json() as DataRow;
    if (response.ok) setDetail(payload); else setMessage(text(payload.error) || "No se pudo abrir la factura.");
  }

  async function openQuotationDraft(quotation: DataRow) {
    const quotationId = text(quotation.id);
    setHandledQuotationId(quotationId);
    const response = await fetch(`/api/quotations/${encodeURIComponent(quotationId)}/invoice-draft`, { cache: "no-store" });
    const payload = await response.json() as DataRow;
    if (!response.ok) {
      setMessage(text(payload.error) || "No se pudo preparar la factura desde la cotización.");
      return;
    }
    const state = object(payload.state);
    const draft: DocumentEditorState = {
      fields: object(state.fields) as Record<string, string>,
      lines: array(state.lines).map((line) => ({ id: crypto.randomUUID(), description: text(line.description), quantity: text(line.quantity) || "1", widthCm: text(line.widthCm), heightCm: text(line.heightCm), unitPrice: text(line.unitPrice), itemCode: text(line.itemCode), location: text(line.location) })),
      financials: object(state.financials) as DocumentEditorState["financials"],
      terms: object(state.terms) as DocumentEditorState["terms"],
    };
    setConversionQuotationId(quotationId);
    setConversionDraft(draft);
    if (array(payload.existingInvoices).length) setConversionWarning(payload);
    else setCreating(true);
  }

  function continueQuotationDraft() {
    setConversionWarning(null);
    setCreating(true);
  }

  useEffect(() => {
    if (!fromQuotationId || handledQuotationId === fromQuotationId || !quotations.length) return;
    const quotation = quotations.find((item) => text(item.id) === fromQuotationId);
    if (!quotation) return;
    window.setTimeout(() => void openQuotationDraft(quotation), 0);
  }, [fromQuotationId, handledQuotationId, quotations]); // eslint-disable-line react-hooks/exhaustive-deps

  async function openEcfReview() {
    if (!selected || number(selected.legacy)) return;
    setEcfLoading(true);
    const response = await fetch(`/api/invoices/${encodeURIComponent(text(selected.id))}/ecf/prevalidate`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ecfType: "31", environment: "test" }),
    });
    const payload = await response.json() as DataRow;
    setEcfLoading(false);
    if (!response.ok) setMessage(text(payload.error) || "No se pudo validar el e-CF.");
    else setEcfReview(payload);
  }

  async function generateEcfFromReview() {
    if (!selected || !ecfReview) return;
    setEcfLoading(true);
    const response = await fetch(`/api/invoices/${encodeURIComponent(text(selected.id))}/ecf`, {
      method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ ecfType: text(ecfReview.ecfType) || "31", environment: text(ecfReview.environment) || "test" }),
    });
    const payload = await response.json() as DataRow;
    setEcfLoading(false);
    if (!response.ok) setMessage(text(payload.error) || "No se pudo generar el e-CF.");
    else {
      setEcfReview({ ...ecfReview, generated: payload, ready: false });
      setMessage(payload.duplicate ? "Ya existe un e-CF vinculado a esta factura." : "e-CF generado en el ambiente de prueba.");
      await openDetail(selected);
    }
  }

  async function saveDocument(payload: DocumentSavePayload) {
    const editingRow = selected && !number(selected.legacy) ? selected : null;
    const response = await fetch(editingRow ? `/api/invoices/${text(editingRow.id)}` : "/api/invoices", {
      method: editingRow ? "PATCH" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload.fields, ...payload.financials, quotationConversion: Boolean(conversionQuotationId), notes: payload.terms.customerFacingNotes, discountAmount: payload.calculation.discount, additionalChargeAmount: payload.calculation.additionalCharge, taxRate: payload.calculation.taxRate, taxAmount: payload.calculation.taxAmount, subtotalAmount: payload.calculation.subtotal, totalAmount: payload.calculation.total, paidAmountSnapshot: payload.calculation.advance, balanceAmountSnapshot: payload.calculation.balance, lines: payload.lines }),
    });
    const result = await response.json() as DataRow;
    if (!response.ok) throw new Error(text(result.error) || "No se pudo guardar la factura.");
    const savedId = text(object(result.invoice).id) || text(editingRow?.id);
    const detailResponse = await fetch(`/api/invoices/${encodeURIComponent(savedId)}`, { cache: "no-store" });
    const savedDetail = await detailResponse.json() as DataRow;
    setCreating(false); setEditing(false); setConversionDraft(null); setConversionQuotationId(""); setSelected(null); setDetail(null); setMessage(editingRow ? "Factura actualizada correctamente." : "Factura creada correctamente.");
    await load();
    if (!editingRow && savedId) setSelectedId?.(savedId);
    if (detailResponse.ok) setPreview(invoicePdfData(savedDetail));
  }

  return <>
    <div className="breadcrumbs"><span>Inicio</span><i>/</i><span aria-current="page">Facturas</span></div>
    <div className="page-heading"><div><p className="eyebrow">Facturación</p><h1>Facturas</h1><p>Registro contable con trazabilidad de la matriz histórica y los documentos emitidos.</p></div>{canWrite && <div className="page-heading-actions"><button className="primary-button" onClick={() => { setConversionDraft(null); setConversionQuotationId(""); setCreating(true); }}>Nueva factura</button></div>}</div>
    <div className="toolbar invoice-toolbar"><input aria-label="Buscar facturas" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por factura, NCF, cliente o RNC…" value={query} /><span>{rows.length} {rows.length === 1 ? "registro" : "registros"}</span></div>
    <section className="panel invoice-list-panel">{loading ? <p className="muted">Cargando…</p> : sortedRows.length ? <div className="table-wrap"><table className="responsive-table invoice-table"><thead><tr><Sortable label="Fecha" name="issueDate" active={sort} direction={direction} onSort={changeSort} /><Sortable label="Factura" name="invoiceNumberRaw" active={sort} direction={direction} onSort={changeSort} /><th>NCF</th><Sortable label="Cliente / Empresa" name="businessName" active={sort} direction={direction} onSort={changeSort} /><th className="number-column">Sub-Total</th><th className="number-column">ITBIS</th><Sortable label="Total" name="totalAmount" active={sort} direction={direction} onSort={changeSort} /><th>Estado</th></tr></thead><tbody>{sortedRows.map((row, index) => <tr className="clickable-row" key={`${text(row.id)}-${index}`} onClick={() => void openDetail(row)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); void openDetail(row); } }} tabIndex={0}><Cell label="Fecha">{formatDate(row.issueDate)}</Cell><Cell label="Factura"><strong>{display(row.invoiceNumberRaw)}</strong></Cell><Cell label="NCF">{display(row.ncfRaw)}</Cell><Cell label="Cliente / Empresa"><span>{display(row.businessName)}</span>{text(row.businessRnc) && <small>RNC {text(row.businessRnc)}</small>}</Cell><Cell label="Sub-Total" numeric>{formatMoney(row.subtotalAmount)}</Cell><Cell label="ITBIS" numeric>{formatMoney(row.taxAmount)}</Cell><Cell label="Total" numeric>{formatMoney(row.totalAmount)}</Cell><Cell label="Estado"><Status value={text(row.status)} legacy={Boolean(number(row.legacy))} /></Cell></tr>)}</tbody></table></div> : <Empty text="No hay facturas para esta búsqueda." />}</section>

    {selected && !editing && <Modal eyebrow={number(selected.legacy) ? "Registro heredado" : "Factura"} onClose={() => { setSelected(null); setDetail(null); setSelectedId?.(null); }} title={display(selected.invoiceNumberRaw)} wide><InvoiceDetail canAskAi={canAskAi} canApproveAi={canApproveAi} canProposeAi={canProposeAi} canWrite={canWrite && !number(selected.legacy)} canEcfGenerate={canEcfGenerate && !number(selected.legacy)} canEcfXml={canEcfXml} detail={detail} onEdit={() => setEditing(true)} onEcf={() => void openEcfReview()} onNavigate={onNavigate} onPrint={() => { if (detail) setPreview(invoicePdfData(detail)); }} row={selected} /></Modal>}
    {ecfReview && <Modal eyebrow="Cumplimiento DGII" onClose={() => setEcfReview(null)} title="Generar factura DGII" wide><EcfReviewPanel review={ecfReview} busy={ecfLoading} onClose={() => setEcfReview(null)} onGenerate={() => void generateEcfFromReview()} canViewXml={canEcfXml} /></Modal>}
    {(creating || (selected && editing)) && <Modal eyebrow="Facturación" onClose={() => { setCreating(false); setEditing(false); setConversionDraft(null); setConversionQuotationId(""); }} title={creating ? "Nueva factura" : `Editar ${display(selected?.invoiceNumberRaw)}`} wide><DocumentEditor kind="invoice" businesses={businesses} contacts={contacts} projects={projects} quotations={quotations} initial={creating ? (conversionDraft ?? emptyDocumentState("invoice")) : invoiceEditorState(detail, selected)} onCancel={() => { setCreating(false); setEditing(false); setConversionDraft(null); setConversionQuotationId(""); }} onSave={saveDocument} /></Modal>}
    {conversionWarning && <Modal eyebrow="Revisión de facturación" onClose={() => setConversionWarning(null)} title="Esta cotización ya tiene facturas"><div className="conversion-warning"><p>{text(conversionWarning.warning)}</p><ul>{array(conversionWarning.existingInvoices).map((invoice) => <li key={text(invoice.id)}><strong>{display(invoice.invoiceNumberRaw)}</strong><span>{formatMoney(invoice.totalAmount)} · {display(invoice.status)}</span></li>)}</ul><div className="form-actions"><button className="secondary-button" onClick={() => setConversionWarning(null)} type="button">Cancelar</button><button className="primary-button" onClick={continueQuotationDraft} type="button">Continuar</button></div></div></Modal>}
    {preview && <DocumentPreviewModal document={preview} onClose={() => setPreview(null)} />}
  </>;
}

function Sortable({ label, name, active, direction, onSort }: { label: string; name: SortKey; active: SortKey; direction: "asc" | "desc"; onSort(value: SortKey): void }) { return <th aria-sort={active === name ? direction === "asc" ? "ascending" : "descending" : "none"}><button className="table-sort" onClick={() => onSort(name)} type="button">{label}<span aria-hidden="true">{active === name ? direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>; }
function Cell({ children, label, numeric = false }: { children: ReactNode; label: string; numeric?: boolean }) { return <td className={numeric ? "number-column" : undefined} data-label={label}>{children}</td>; }
function Status({ value, legacy = false }: { value: string; legacy?: boolean }) { return <span className={`invoice-status invoice-status-${value || "unknown"}`}>{statusLabels[value] ?? display(value)}{legacy && <small> · Heredado</small>}</span>; }

function InvoiceDetail({ canWrite, canEcfGenerate, canEcfXml, detail, onEdit, onEcf, onNavigate, onPrint, row, canAskAi, canProposeAi, canApproveAi }: { canWrite: boolean; canEcfGenerate: boolean; canEcfXml: boolean; detail: DataRow | null; onEdit(): void; onEcf(): void; onNavigate?: (view: string, id: string) => void; onPrint(): void; row: DataRow; canAskAi: boolean; canProposeAi: boolean; canApproveAi: boolean }) {
  if (!detail && !number(row.legacy)) return <p className="muted">Cargando detalle…</p>;
  const invoice = object(detail?.invoice);
  const lines = array(detail?.lines);
  const quotationId = text(invoice.quotation_id);
  const quotationValue = quotationId ? <a href={`/app?view=cotizaciones&record=${encodeURIComponent(quotationId)}`} onClick={(event) => { if (!onNavigate || event.metaKey || event.ctrlKey || event.shiftKey) return; event.preventDefault(); onNavigate("cotizaciones", quotationId); }}>{display(invoice.quotation_number)}</a> : "—";
  const sourceDocumentId = text(invoice.source_document_id);
  const sourceDocument = text(invoice.source_document_name);
  const sourceDocumentValue = sourceDocumentId ? <a href={`/api/documents/${encodeURIComponent(sourceDocumentId)}`} download>{sourceDocument || "Abrir documento"}</a> : sourceDocument || "—";
  return <div className="invoice-detail"><div className="invoice-detail-actions"><Status value={text(invoice.status ?? row.status)} legacy={Boolean(number(row.legacy))} /><div className="invoice-detail-buttons"><RecordAiPanel canApprove={canApproveAi} canAsk={canAskAi} canPropose={canProposeAi} entityId={text(row.id)} entityType="invoice" title={display(invoice.invoice_number_raw ?? row.invoiceNumberRaw)} />{detail && <button className="secondary-button" onClick={onPrint}>Imprimir</button>}{canEcfGenerate && detail && <button className="primary-button" onClick={onEcf}>Generar factura DGII</button>}{canWrite && <button className="secondary-button" onClick={onEdit}>Editar factura</button>}</div></div>{number(row.legacy) && <p className="invoice-notice">Este registro proviene del módulo heredado. Solo se muestran valores presentes en la fuente.</p>}<DetailSection title="Factura"><DetailValue label="Fecha" value={formatDate(invoice.issue_date ?? row.issueDate)} /><DetailValue label="Factura No." value={display(invoice.invoice_number_raw ?? row.invoiceNumberRaw)} /><DetailValue label="NCF" value={display(invoice.ncf_raw ?? row.ncfRaw)} /><DetailValue label="Cotización" value={quotationValue} /><DetailValue label="Documento fuente" value={sourceDocumentValue} /><DetailValue label="Condiciones de pago" value={display(invoice.payment_terms_raw)} /><DetailValue label="Vencimiento" value={formatDate(invoice.due_date ?? row.dueDate)} /></DetailSection><DetailSection title="Cliente"><DetailValue label="Cliente / Empresa" value={display(invoice.business_name ?? row.businessName)} /><DetailValue label="RNC" value={display(invoice.business_rnc ?? row.businessRnc)} /><DetailValue label="Dirección" value={display(invoice.business_address)} /><DetailValue label="Contacto" value={display(invoice.contact_name)} /><DetailValue label="Teléfono" value={display(invoice.contact_phone ?? invoice.business_phone)} /><DetailValue label="Correo" value={display(invoice.contact_email ?? invoice.business_email)} /></DetailSection><section className="invoice-section"><div className="invoice-section-heading"><h3>Conceptos</h3><span>{lines.length} {lines.length === 1 ? "partida" : "partidas"}</span></div>{lines.length ? <div className="table-wrap"><table className="invoice-lines-table responsive-table"><thead><tr><th>Descripción</th><th>Cantidad</th><th>Ancho</th><th>Altura</th><th>Área</th><th>Precio</th><th>Total</th></tr></thead><tbody>{lines.map((line) => <tr key={text(line.id)}><Cell label="Descripción"><strong>{display(line.description)}</strong></Cell><Cell label="Cantidad" numeric>{display(line.quantity)}</Cell><Cell label="Ancho">{dimension(line.width_cm, "cm")}</Cell><Cell label="Altura">{dimension(line.height_cm, "cm")}</Cell><Cell label="Área">{dimension(line.area_sqm, "m²")}</Cell><Cell label="Precio" numeric>{formatMoney(line.unit_price)}</Cell><Cell label="Total" numeric>{formatMoney(line.line_total)}</Cell></tr>)}</tbody></table></div> : <p className="muted">No hay partidas registradas en esta fuente.</p>}</section><section className="invoice-section invoice-financial-section"><div><p className="eyebrow">Resumen financiero</p><h3>Totales de la factura</h3></div><dl className="invoice-totals"><TotalValue label="Sub-Total" value={invoice.subtotal_amount ?? row.subtotalAmount} /><TotalValue label="Descuento" value={invoice.discount_amount} /><TotalValue label="ITBIS" value={invoice.tax_amount ?? row.taxAmount} /><TotalValue strong label="Total" value={invoice.total_amount ?? row.totalAmount} /><TotalValue label="Avance / pagado" value={invoice.paid_amount_snapshot} /><TotalValue strong label="Balance pendiente" value={invoice.balance_amount_snapshot ?? row.balanceAmount} /></dl></section>{canEcfXml && detail && <EcfSummary invoiceId={text(row.id)} />}</div>;
}

function EcfReviewPanel({ review, busy, onClose, onGenerate, canViewXml }: { review: DataRow; busy: boolean; onClose(): void; onGenerate(): void; canViewXml: boolean }) {
  const issues = array(review.issues);
  const generated = object(review.generated);
  return <div className="ecf-review"><p className="muted">El e-CF se generará en el ambiente de prueba. La generación no envía información a producción.</p><dl className="invoice-detail-grid"><DetailValue label="Tipo" value={`E-${text(review.ecfType) || "31"}`} /><DetailValue label="Ambiente" value={text(review.environment) || "test"} /><DetailValue label="Factura origen" value={text(object(review.snapshot).sourceInvoiceNumber) || "—"} /><DetailValue label="Cliente" value={text(object(object(review.snapshot).receiver).name) || "—"} /><DetailValue label="Total" value={formatMoney(object(review.snapshot).totalAmount)} /></dl>{issues.length > 0 && <section className="ecf-issues"><h3>Revisión fiscal</h3><ul>{issues.map((issue, index) => <li className={`ecf-issue-${text(issue.severity)}`} key={`${text(issue.code)}-${index}`}><strong>{text(issue.code)}</strong><span>{text(issue.message)}</span></li>)}</ul></section>}{Boolean(generated.id) ? <p className="success-message">e-CF {text(generated.encf)} generado. La firma y validación XSD oficial permanecen bloqueadas hasta configurar el ambiente.</p> : <div className="modal-actions"><button className="secondary-button" type="button" onClick={onClose}>Cerrar revisión</button><button className="primary-button" type="button" disabled={busy || Boolean(review.ready === false)} onClick={onGenerate}>{busy ? "Generando…" : review.ready ? "Confirmar generación" : "Resolver datos primero"}</button></div>}{canViewXml && Boolean(generated.id) && <p className="muted">El XML se conserva como artefacto privado asociado al e-CF.</p>}</div>;
}

function EcfSummary({ invoiceId }: { invoiceId: string }) {
  const [documents, setDocuments] = useState<DataRow[]>([]);
  const [artifacts, setArtifacts] = useState<Record<string, DataRow[]>>({});
  useEffect(() => { let active = true; void fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/ecf`, { cache: "no-store" }).then((response) => response.json()).then((payload: unknown) => { if (active) setDocuments(array(object(payload).documents)); }).catch(() => undefined); return () => { active = false; }; }, [invoiceId]);
  useEffect(() => { let active = true; if (!documents.length) return () => { active = false; }; void Promise.all(documents.map(async (document) => { const response = await fetch(`/api/ecf/${encodeURIComponent(text(document.id))}`, { cache: "no-store" }); const payload = await response.json() as DataRow; return [text(document.id), array(payload.artifacts)] as const; })).then((entries) => { if (active) setArtifacts(Object.fromEntries(entries)); }).catch(() => undefined); return () => { active = false; }; }, [documents]);
  if (!documents.length) return null;
  return <section className="invoice-section ecf-summary"><div className="invoice-section-heading"><div><p className="eyebrow">Cumplimiento</p><h3>e-CF vinculados</h3></div><span>{documents.length}</span></div>{documents.map((document) => <div className="ecf-summary-row" key={text(document.id)}><strong>{text(document.encf)}</strong><span>{text(document.status)}</span><small>{text(document.environment)}</small>{(artifacts[text(document.id)] ?? []).map((artifact) => <a key={text(artifact.id)} href={`/api/ecf/${encodeURIComponent(text(document.id))}/artifacts/${encodeURIComponent(text(artifact.id))}`} download>{text(artifact.kind) || "Descargar XML"}</a>)}</div>)}</section>;
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) { return <section className="invoice-section"><h3>{title}</h3><dl className="invoice-detail-grid">{children}</dl></section>; }
function DetailValue({ label, value }: { label: string; value: ReactNode }) { return <div><dt>{label}</dt><dd>{value}</dd></div>; }
function TotalValue({ label, value, strong = false }: { label: string; value: unknown; strong?: boolean }) { return <div className={strong ? "invoice-total-strong" : undefined}><dt>{label}</dt><dd>{formatMoney(value)}</dd></div>; }

function invoiceEditorState(detail: DataRow | null, row: DataRow | null): DocumentEditorState {
  const invoice = object(detail?.invoice);
  const manual = object(parseObject(invoice.source_values).manual);
  const state = emptyDocumentState("invoice");
  state.fields = { businessId: text(invoice.business_id ?? row?.businessId), invoiceNumberRaw: text(invoice.invoice_number_raw ?? row?.invoiceNumberRaw), ncfRaw: text(invoice.ncf_raw ?? row?.ncfRaw), issueDate: text(invoice.issue_date ?? row?.issueDate).slice(0, 10), dueDate: text(invoice.due_date ?? row?.dueDate).slice(0, 10), status: text(invoice.status ?? row?.status) || "issued", paymentTermsRaw: text(invoice.payment_terms_raw), purchaseOrderNumber: text(invoice.purchase_order_number), salesRepresentative: text(invoice.sales_representative), contactId: text(invoice.contact_id), projectId: text(invoice.project_id), quotationId: text(invoice.quotation_id), currency: text(invoice.currency) || "DOP" };
  const lines = array(detail?.lines).map((line) => ({ id: crypto.randomUUID(), description: text(line.description), quantity: text(line.quantity) || "1", widthCm: text(line.width_cm), heightCm: text(line.height_cm), unitPrice: text(line.unit_price), itemCode: text(line.item_code), location: text(line.location) }));
  if (lines.length) state.lines = lines;
  state.financials = { discount: text(invoice.discount_amount), additionalChargeLabel: text(manual.additionalChargeLabel) || "Cargo adicional", additionalChargeAmount: text(manual.additionalChargeAmount), taxRate: text(manual.taxRate) || "18", advance: text(invoice.paid_amount_snapshot) };
  state.terms.customerFacingNotes = text(manual.notes);
  return state;
}

function invoicePdfData(detail: DataRow): PdfDocumentData {
  const invoice = object(detail.invoice);
  const manual = object(parseObject(invoice.source_values).manual);
  return { kind: "invoice", number: text(invoice.invoice_number_raw), date: text(invoice.issue_date), dueDate: text(invoice.due_date), currency: text(invoice.currency) || "DOP", businessName: text(invoice.business_name), businessRnc: text(invoice.business_rnc), businessAddress: text(invoice.business_address), contactName: text(invoice.contact_name), contactPhone: text(invoice.contact_phone), contactEmail: text(invoice.contact_email), projectName: text(invoice.project_name), paymentTerms: text(invoice.payment_terms_raw), notes: text(manual.notes), lines: array(detail.lines).map((line) => ({ id: text(line.id), description: line.description, quantity: line.quantity, widthCm: line.width_cm, heightCm: line.height_cm, unitPrice: line.unit_price })), discount: invoice.discount_amount, additionalCharge: manual.additionalChargeAmount, additionalChargeLabel: text(manual.additionalChargeLabel), taxRate: manual.taxRate, advance: invoice.paid_amount_snapshot };
}

function formatDate(value: unknown) { return text(value) ? dateTime(text(value)) : "—"; }
function formatMoney(value: unknown) { const amount = Number(value); return Number.isFinite(amount) ? money(amount) : "—"; }
function dimension(value: unknown, unit: string) { const amount = Number(value); return Number.isFinite(amount) ? `${value} ${unit}` : "—"; }
function display(value: unknown, fallback = "—") { return text(value).trim() || fallback; }
function text(value: unknown) { return value === null || value === undefined ? "" : String(value); }
function number(value: unknown) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function array(value: unknown): DataRow[] { return Array.isArray(value) ? value as DataRow[] : []; }
function object(value: unknown): DataRow { return value && typeof value === "object" && !Array.isArray(value) ? value as DataRow : {}; }
function parseObject(value: unknown): DataRow { if (typeof value !== "string") return object(value); try { return object(JSON.parse(value)); } catch { return {}; } }
