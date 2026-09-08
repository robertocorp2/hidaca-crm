"use client";

import { useState, type ChangeEvent } from "react";

const confirmationPhrase = "REEMPLAZAR FACTURAS 2021";

type ReplacementPreview = {
  workbook: {
    filename: string;
    sha256: string;
    invoices: number;
    fiscalIdentities: number;
    totals: { total: number; paid: number; balance: number };
  };
  companies: {
    matchedInvoices: number;
    newInvoices: number;
    new: Array<{ name: string; rnc: string; invoiceNumbers: string[] }>;
    ambiguous: unknown[];
  };
  purge: {
    legacyInvoices: Array<{ id: string; title: string }>;
    batches: Array<{ id: string; name: string; source: string }>;
    files: Array<{ id: string; filename: string; sha256: string }>;
    documents: number;
    storageObjects: number;
  };
  current: {
    invoices: number;
    invoiceLines: number;
    payments: number;
    allocations: number;
    creditNotes: number;
    creditApplications: number;
  };
  preserved: {
    quotationRecords: number;
    quotationBatches: number;
    quotations: number;
  };
  blockers: string[];
  canCommit: boolean;
  stateFingerprint: string;
  alreadyCommitted: null | { batchId: string; invoiceCount: number };
};

export function InvoiceReplacementPanel({
  onCompleted,
}: {
  onCompleted(): void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ReplacementPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setPreview(null);
    setConfirmation("");
    setError("");
    setMessage("");
  }

  async function validate() {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    try {
      const response = await fetch("/api/imports/invoices/replace/preview", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        preview?: ReplacementPreview;
        error?: string;
      };
      if (!response.ok || !result.preview) {
        throw new Error(result.error ?? "No se pudo validar el libro.");
      }
      setPreview(result.preview);
      setMessage(
        result.preview.alreadyCommitted
          ? "Este mismo libro ya fue aplicado; no se volverán a crear registros."
          : result.preview.canCommit
            ? "Previsualización completa. No se modificó ningún dato."
            : "La previsualización encontró bloqueos; no es posible confirmar.",
      );
    } catch (validationError) {
      setPreview(null);
      setError(
        validationError instanceof Error
          ? validationError.message
          : "No se pudo validar el libro.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!file || !preview) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("confirmation", confirmation);
    form.set("workbookHash", preview.workbook.sha256);
    form.set("stateFingerprint", preview.stateFingerprint);
    try {
      const response = await fetch("/api/imports/invoices/replace/commit", {
        method: "POST",
        body: form,
      });
      const result = (await response.json()) as {
        idempotent?: boolean;
        finalCount?: number;
        companiesCreated?: number;
        error?: string;
        preview?: ReplacementPreview;
      };
      if (!response.ok) {
        if (result.preview) setPreview(result.preview);
        throw new Error(result.error ?? "No se pudo completar el reemplazo.");
      }
      setMessage(
        result.idempotent
          ? "El libro ya estaba aplicado; no se duplicó ninguna factura."
          : `Reemplazo completado: ${result.finalCount ?? 92} facturas y ${result.companiesCreated ?? 0} empresas nuevas.`,
      );
      setConfirmation("");
      onCompleted();
    } catch (commitError) {
      setError(
        commitError instanceof Error
          ? commitError.message
          : "No se pudo completar el reemplazo.",
      );
    } finally {
      setBusy(false);
    }
  }

  const confirmed = confirmation === confirmationPhrase;
  return (
    <section className="panel replacement-panel" aria-labelledby="invoice-replacement-title">
      <div>
        <p className="eyebrow">Solo administración · Facturas 2021</p>
        <h2 id="invoice-replacement-title">Reemplazar Facturas desde el libro consolidado</h2>
        <p>
          Valida las 92 facturas y compara empresas, staging y documentos antes de
          habilitar la purga. La previsualización nunca escribe en la base.
        </p>
      </div>
      <label>
        Archivo consolidado
        <input
          accept=".xlsx"
          aria-label="Libro consolidado de Facturas 2021"
          onChange={onFileChange}
          type="file"
        />
      </label>
      <div className="form-actions">
        <button
          className="secondary-button"
          disabled={!file || busy}
          onClick={() => void validate()}
          type="button"
        >
          {busy ? "Validando…" : "Previsualizar reemplazo"}
        </button>
      </div>

      {preview && (
        <div className="replacement-preview">
          <div className="source-summary-grid">
            <Summary label="Facturas válidas" value={preview.workbook.invoices} />
            <Summary label="Identidades fiscales" value={preview.workbook.fiscalIdentities} />
            <Summary label="Empresas existentes" value={preview.companies.matchedInvoices} />
            <Summary label="Empresas nuevas" value={preview.companies.new.length} />
            <Summary label="Lotes a eliminar" value={preview.purge.batches.length} />
            <Summary label="Archivos a eliminar" value={preview.purge.files.length} />
          </div>
          <p>
            Total histórico: {currency(preview.workbook.totals.total)} · Pagado:{" "}
            {currency(preview.workbook.totals.paid)} · Balance:{" "}
            {currency(preview.workbook.totals.balance)}
          </p>
          <details>
            <summary>Ver empresas nuevas ({preview.companies.new.length})</summary>
            <ul>
              {preview.companies.new.map((business) => (
                <li key={`${business.rnc}:${business.name}`}>
                  {business.name}{business.rnc ? ` · ${business.rnc}` : ""} ·{" "}
                  {business.invoiceNumbers.join(", ")}
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary>Ver objetos que se eliminarán</summary>
            <p>
              {preview.purge.legacyInvoices.length} registro heredado ·{" "}
              {preview.purge.documents} documentos · {preview.purge.storageObjects}{" "}
              objetos privados.
            </p>
            <ul>
              {preview.purge.files.map((item) => (
                <li key={item.id}>{item.filename}</li>
              ))}
            </ul>
          </details>
          <p className="muted">
            Se preservan {preview.preserved.quotationRecords} Cotizaciones heredadas,{" "}
            {preview.preserved.quotationBatches} lotes de Cotizaciones y{" "}
            {preview.preserved.quotations} Cotizaciones normalizadas.
          </p>
          {preview.blockers.length > 0 && (
            <div className="inline-warning" role="alert">
              <strong>Reemplazo bloqueado</strong>
              <ul>
                {preview.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          )}
          {preview.canCommit && (
            <div className="replacement-confirmation">
              <p className="inline-warning">
                Esta purga es irreversible y no crea respaldo. El código puede
                revertirse, pero los registros y archivos eliminados no se recuperarán.
              </p>
              <label>
                Escribe <strong>{confirmationPhrase}</strong>
                <input
                  autoComplete="off"
                  onChange={(event) => setConfirmation(event.target.value)}
                  value={confirmation}
                />
              </label>
              <button
                className="danger-button"
                disabled={!confirmed || busy}
                onClick={() => void commit()}
                type="button"
              >
                {busy ? "Revalidando…" : "Confirmar purga y reemplazo"}
              </button>
            </div>
          )}
        </div>
      )}
      {error && <p className="inline-alert" role="alert">{error}</p>}
      {message && <p className="inline-alert" role="status">{message}</p>}
    </section>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <article><span>{label}</span><strong>{value.toLocaleString("es-DO")}</strong></article>;
}

function currency(value: number) {
  return new Intl.NumberFormat("es-DO", {
    style: "currency",
    currency: "DOP",
  }).format(value);
}
