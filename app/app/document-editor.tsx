"use client";

import { useMemo, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import type { BusinessRow, ContactRow } from "./types";
import { calculateDocument, calculateDocumentLine, type DocumentCalculation } from "../lib/document-calculations";
import { money } from "./ui";

export type DocumentKind = "invoice" | "quotation";
type DataRow = Record<string, unknown>;

export type LineDraft = {
  id: string;
  description: string;
  quantity: string;
  widthCm: string;
  heightCm: string;
  unitPrice: string;
  itemCode?: string;
  location?: string;
};

export type DocumentEditorState = {
  id?: string;
  fields: Record<string, string>;
  lines: LineDraft[];
  financials: {
    discount: string;
    additionalChargeLabel: string;
    additionalChargeAmount: string;
    taxRate: string;
    advance: string;
  };
  terms: {
    paymentConditions: string;
    customerFacingNotes: string;
    internalNotes: string;
  };
};

export type DocumentSavePayload = {
  fields: Record<string, string>;
  lines: Array<LineDraft & { areaSqm: number | null; lineTotal: number }>;
  calculation: DocumentCalculation;
  financials: DocumentEditorState["financials"];
  terms: DocumentEditorState["terms"];
};

export function emptyDocumentLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    description: "",
    quantity: "1",
    widthCm: "",
    heightCm: "",
    unitPrice: "",
  };
}

export function todayInputValue(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function duplicateDocumentLine(lines: LineDraft[], index: number) {
  const source = lines[index];
  if (!source) return lines;
  return [
    ...lines.slice(0, index + 1),
    { ...source, id: crypto.randomUUID() },
    ...lines.slice(index + 1),
  ];
}

export function removeDocumentLine(lines: LineDraft[], index: number) {
  return lines.length <= 1 ? lines : lines.filter((_, lineIndex) => lineIndex !== index);
}

export function emptyDocumentState(kind: DocumentKind): DocumentEditorState {
  return {
    fields: kind === "invoice"
      ? { businessId: "", invoiceNumberRaw: "", issueDate: todayInputValue(), dueDate: "", status: "issued", ncfRaw: "", paymentTermsRaw: "", purchaseOrderNumber: "", salesRepresentative: "", contactId: "", projectId: "", quotationId: "", currency: "DOP" }
      : { businessId: "", quotationNumber: "", quotationYear: String(new Date().getFullYear()), quotationDate: todayInputValue(), validityUntil: "", status: "draft", quotationType: "other", serviceCategory: "", currency: "DOP", primaryContactId: "", projectId: "", revisionLabel: "", alternativeLabel: "", scopeLabel: "" },
    lines: [emptyDocumentLine()],
    financials: { discount: "", additionalChargeLabel: "Cargo adicional", additionalChargeAmount: "", taxRate: "18", advance: "" },
    terms: { paymentConditions: "", customerFacingNotes: "", internalNotes: "" },
  };
}

export function DocumentEditor({
  kind,
  businesses,
  contacts,
  projects,
  quotations = [],
  initial,
  busy = false,
  onCancel,
  onSave,
  onError,
}: {
  kind: DocumentKind;
  businesses: BusinessRow[];
  contacts: Array<ContactRow | DataRow>;
  projects: DataRow[];
  quotations?: DataRow[];
  initial?: DocumentEditorState;
  busy?: boolean;
  onCancel(): void;
  onSave(payload: DocumentSavePayload): Promise<void>;
  onError?(message: string): void;
}) {
  const [state, setState] = useState<DocumentEditorState>(initial ?? emptyDocumentState(kind));
  const [saving, setSaving] = useState(false);
  const [lineError, setLineError] = useState("");
  const currentBusinessId = state.fields.businessId;
  const relatedContacts = contacts.filter((item) => String(item.businessId ?? (item as DataRow).business_id ?? "") === currentBusinessId);
  const relatedProjects = projects.filter((item) => String(item.businessId ?? item.business_id ?? "") === currentBusinessId);
  const relatedQuotations = quotations.filter((item) => String(item.businessId ?? item.business_id ?? "") === currentBusinessId);
  const calculation = useMemo(() => calculateDocument({
    lines: state.lines,
    discount: state.financials.discount,
    additionalCharge: state.financials.additionalChargeAmount,
    taxRate: state.financials.taxRate,
    advance: state.financials.advance,
  }), [state.financials, state.lines]);

  function updateField(name: string, value: string) {
    setState((current) => ({ ...current, fields: { ...current.fields, [name]: value } }));
  }

  function updateFinancial(name: keyof DocumentEditorState["financials"], value: string) {
    setState((current) => ({ ...current, financials: { ...current.financials, [name]: value } }));
  }

  function updateTerm(name: keyof DocumentEditorState["terms"], value: string) {
    setState((current) => ({ ...current, terms: { ...current.terms, [name]: value } }));
  }

  function updateLine(index: number, name: keyof LineDraft, value: string) {
    setState((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [name]: value } : line),
    }));
    setLineError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const documentNumberField = kind === "invoice" ? "invoiceNumberRaw" : "quotationNumber";
    if (!state.fields.businessId) {
      setLineError("Selecciona una Empresa antes de guardar.");
      return;
    }
    if (!state.fields[documentNumberField]?.trim()) {
      setLineError(`Escribe el número de ${kind === "invoice" ? "factura" : "cotización"} antes de guardar.`);
      return;
    }
    const activeLines = state.lines.filter((line) => line.description.trim());
    const errors = calculation.errors;
    if (!activeLines.length) {
      setLineError("Agrega al menos una partida con descripción.");
      return;
    }
    if (errors.length) {
      setLineError(errors[0]);
      return;
    }
    setSaving(true);
    setLineError("");
    try {
      await onSave({
        fields: state.fields,
        lines: activeLines.map((line) => {
          const calculated = calculateDocumentLine(line);
          return { ...line, areaSqm: calculated.areaTotal, lineTotal: calculated.lineTotal };
        }),
        calculation,
        financials: state.financials,
        terms: state.terms,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el documento.";
      setLineError(message);
      onError?.(message);
    } finally {
      setSaving(false);
    }
  }

  const labels = kind === "invoice"
    ? { document: "Factura", number: "Factura No.", save: "Guardar factura" }
    : { document: "Cotización", number: "Cotización No.", save: "Guardar cotización" };

  return (
    <form className="invoice-editor" onSubmit={submit}>
      {lineError && <div className="inline-alert" role="alert">{lineError}</div>}
      <fieldset>
        <legend>{labels.document}</legend>
        <div className="form-grid">
          <SelectField label="Empresa" name="businessId" required value={state.fields.businessId} onChange={updateField}>
            <option value="">Seleccionar</option>
            {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}{business.rnc ? ` · ${business.rnc}` : ""}</option>)}
          </SelectField>
          <TextField label={labels.number} name={kind === "invoice" ? "invoiceNumberRaw" : "quotationNumber"} required value={state.fields[kind === "invoice" ? "invoiceNumberRaw" : "quotationNumber"] ?? ""} onChange={updateField} />
          {kind === "invoice" && <TextField label="NCF" name="ncfRaw" value={state.fields.ncfRaw ?? ""} onChange={updateField} />}
          {kind === "quotation" && <TextField label="Año" name="quotationYear" type="number" value={state.fields.quotationYear ?? ""} onChange={updateField} />}
          <TextField label="Fecha" name={kind === "invoice" ? "issueDate" : "quotationDate"} type="date" value={state.fields[kind === "invoice" ? "issueDate" : "quotationDate"] ?? ""} onChange={updateField} />
          <TextField label={kind === "invoice" ? "Vencimiento" : "Fecha límite"} name={kind === "invoice" ? "dueDate" : "validityUntil"} type="date" value={state.fields[kind === "invoice" ? "dueDate" : "validityUntil"] ?? ""} onChange={updateField} />
          <SelectField label="Estado" name="status" value={state.fields.status ?? "draft"} onChange={updateField}>
            {(kind === "invoice" ? [["draft", "Borrador"], ["issued", "Emitida"], ["partial", "Pago parcial"], ["paid", "Pagada"], ["overdue", "Vencida"], ["cancelled", "Anulada"]] : [["draft", "Borrador"], ["sent", "Enviada"], ["accepted", "Aceptada"], ["rejected", "Rechazada"], ["expired", "Vencida"], ["cancelled", "Cancelada"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </SelectField>
          {kind === "quotation" && <>
            <SelectField label="Tipo" name="quotationType" value={state.fields.quotationType ?? "other"} onChange={updateField}>
              <option value="installation">Instalación</option><option value="repair">Reparación</option><option value="maintenance">Mantenimiento</option><option value="mixed">Mixto</option><option value="other">Otro</option>
            </SelectField>
            <TextField label="Servicio" name="serviceCategory" value={state.fields.serviceCategory ?? ""} onChange={updateField} />
            <TextField label="Moneda" name="currency" value={state.fields.currency ?? "DOP"} onChange={updateField} />
          </>}
          <TextField label={kind === "invoice" ? "Condiciones de pago" : "Condiciones"} name="paymentTermsRaw" value={state.fields.paymentTermsRaw ?? ""} onChange={updateField} />
          {kind === "invoice" && <>
            <TextField label="Moneda" name="currency" value={state.fields.currency ?? "DOP"} onChange={updateField} />
            <TextField label="Orden de compra" name="purchaseOrderNumber" value={state.fields.purchaseOrderNumber ?? ""} onChange={updateField} />
            <TextField label="Representante" name="salesRepresentative" value={state.fields.salesRepresentative ?? ""} onChange={updateField} />
          </>}
          <SelectField label="Contacto" name={kind === "invoice" ? "contactId" : "primaryContactId"} value={state.fields[kind === "invoice" ? "contactId" : "primaryContactId"] ?? ""} onChange={updateField}>
            <option value="">Sin contacto</option>
            {relatedContacts.map((contact) => <option key={String(contact.id)} value={String(contact.id)}>{String(contact.name ?? "Contacto")}</option>)}
          </SelectField>
          <SelectField label="Proyecto relacionado" name="projectId" value={state.fields.projectId ?? ""} onChange={updateField}>
            <option value="">Sin proyecto</option>
            {relatedProjects.map((project) => <option key={String(project.id)} value={String(project.id)}>{String(project.name ?? "Proyecto")}</option>)}
          </SelectField>
          {kind === "invoice" && <SelectField label="Cotización relacionada" name="quotationId" value={state.fields.quotationId ?? ""} onChange={updateField}>
            <option value="">Sin relación</option>
            {relatedQuotations.map((quotation) => <option key={String(quotation.id)} value={String(quotation.id)}>{String(quotation.quotationNumber ?? quotation.quotation_number ?? "Cotización")}</option>)}
          </SelectField>}
          {kind === "quotation" && <>
            <TextField label="Revisión" name="revisionLabel" value={state.fields.revisionLabel ?? ""} onChange={updateField} />
            <TextField label="Alternativa" name="alternativeLabel" value={state.fields.alternativeLabel ?? ""} onChange={updateField} />
            <TextField label="Alcance" name="scopeLabel" value={state.fields.scopeLabel ?? ""} onChange={updateField} />
          </>}
        </div>
      </fieldset>

      <fieldset>
        <legend>Conceptos</legend>
        <div className="invoice-line-editor">
          {state.lines.map((line, index) => {
            const calculated = calculation.lines[index] ?? calculateDocumentLine(line);
            return <div className="invoice-line-editor-row" key={line.id}>
              <TextField label="Cantidad" inputMode="numeric" type="number" min="1" step="1" value={line.quantity} onChange={(_, value) => updateLine(index, "quantity", value)} />
              <TextField label="Descripción" required value={line.description} onChange={(_, value) => updateLine(index, "description", value)} />
              <TextField label="Ancho (cm)" type="number" min="0" value={line.widthCm} onChange={(_, value) => updateLine(index, "widthCm", value)} />
              <TextField label="Altura (cm)" type="number" min="0" value={line.heightCm} onChange={(_, value) => updateLine(index, "heightCm", value)} />
              <label>Área (m²)<input aria-readonly="true" readOnly value={calculated.areaTotal ?? ""} /></label>
              <TextField label="Precio" type="number" min="0" step="0.01" value={line.unitPrice} onChange={(_, value) => updateLine(index, "unitPrice", value)} />
              <div className="invoice-line-total"><span>Total</span><strong>{money(calculated.lineTotal)}</strong></div>
              {calculated.errors.length > 0 && <p className="line-validation" role="alert">{calculated.errors[0]}</p>}
              <div className="line-actions">
                <button className="text-button" onClick={() => setState((current) => ({ ...current, lines: duplicateDocumentLine(current.lines, index) }))} type="button">Duplicar</button>
                <button className="danger-link" disabled={state.lines.length === 1} onClick={() => setState((current) => ({ ...current, lines: removeDocumentLine(current.lines, index) }))} type="button">Eliminar</button>
              </div>
            </div>;
          })}
          <button className="secondary-button" onClick={() => setState((current) => ({ ...current, lines: [...current.lines, emptyDocumentLine()] }))} type="button">Agregar</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>Resumen financiero</legend>
        <div className="invoice-financial-editor">
          <TextField label="Descuento" type="number" min="0" step="0.01" value={state.financials.discount} onChange={(_, value) => updateFinancial("discount", value)} />
          <TextField label="Concepto del cargo" value={state.financials.additionalChargeLabel} onChange={(_, value) => updateFinancial("additionalChargeLabel", value)} />
          <TextField label="Cargo adicional" type="number" min="0" step="0.01" value={state.financials.additionalChargeAmount} onChange={(_, value) => updateFinancial("additionalChargeAmount", value)} />
          <TextField label="ITBIS %" type="number" min="0" step="0.01" value={state.financials.taxRate} onChange={(_, value) => updateFinancial("taxRate", value)} />
          <TextField label="Avance / pagado" type="number" min="0" step="0.01" value={state.financials.advance} onChange={(_, value) => updateFinancial("advance", value)} />
          <dl className="invoice-editor-summary">
            <SummaryValue label="Sub-Total" value={calculation.subtotal} />
            <SummaryValue label="Descuento" value={calculation.discount} />
            <SummaryValue label="Cargo adicional" value={calculation.additionalCharge} />
            <SummaryValue label={`ITBIS ${calculation.taxRate}%`} value={calculation.taxAmount} />
            <SummaryValue strong label="Total" value={calculation.total} />
            <SummaryValue label="Avance / pagado" value={calculation.advance} />
            <SummaryValue strong label="Balance" value={calculation.balance} />
          </dl>
        </div>
      </fieldset>

      <fieldset>
        <legend>{kind === "quotation" ? "Términos y notas" : "Notas"}</legend>
        <div className="form-grid">
          <TextAreaField label={kind === "quotation" ? "Condiciones de pago" : "Notas"} value={state.terms.paymentConditions} onChange={(value) => updateTerm("paymentConditions", value)} />
          <TextAreaField label="Notas para el cliente" value={state.terms.customerFacingNotes} onChange={(value) => updateTerm("customerFacingNotes", value)} />
          {kind === "quotation" && <TextAreaField label="Notas internas" value={state.terms.internalNotes} onChange={(value) => updateTerm("internalNotes", value)} />}
        </div>
      </fieldset>

      <div className="form-actions">
        <button className="secondary-button" onClick={onCancel} type="button">Cancelar</button>
        <button className="primary-button" disabled={busy || saving}>{saving ? "Guardando…" : labels.save}</button>
      </div>
    </form>
  );
}

function TextField({ label, value, onChange, name, type = "text", inputMode, required = false, min, step }: {
  label: string; value: string; onChange: (nameOrValue: string, value: string) => void; name?: string; type?: string; inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"]; required?: boolean; min?: string; step?: string;
}) {
  return <label>{label}<input inputMode={inputMode} name={name} required={required} min={min} step={step} type={type} value={value} onChange={(event) => onChange(name ?? "", event.target.value)} /></label>;
}

function TextAreaField({ label, value, onChange }: { label: string; value: string; onChange(value: string): void }) {
  return <label className="wide">{label}<textarea rows={3} value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function SelectField({ label, name, value, onChange, required = false, children }: { label: string; name: string; value: string; onChange(name: string, value: string): void; required?: boolean; children: ReactNode }) {
  return <label>{label}<select name={name} required={required} value={value} onChange={(event) => onChange(name, event.target.value)}>{children}</select></label>;
}

function SummaryValue({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={strong ? "invoice-total-strong" : undefined}><dt>{label}</dt><dd>{money(value)}</dd></div>;
}
