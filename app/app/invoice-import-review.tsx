"use client";

import { useState } from "react";

type ImportRow = Record<string, unknown> & {
  normalized_values?: Record<string, unknown>;
};

export function InvoiceImportReview({
  batchId,
  busy,
  canAccept,
  canWrite,
  importFileId,
  onAccept,
  onReview,
  rows,
  setError,
  setMessage,
  total,
}: {
  batchId: string;
  busy: boolean;
  canAccept: boolean;
  canWrite: boolean;
  importFileId: string;
  onAccept: () => Promise<void>;
  onReview: (rowId: string, outcome: "ready" | "skipped") => Promise<void>;
  rows: ImportRow[];
  setError: (value: string) => void;
  setMessage: (value: string) => void;
  total: number;
}) {
  const [report, setReport] = useState<Record<string, unknown> | null>(null);

  async function loadReport(kind: "reconciliation" | "post-validation") {
    const response = await fetch(`/api/imports/${batchId}/${kind}`);
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setError(String(payload.error ?? "No se pudo generar el informe."));
      return;
    }
    setReport(payload);
    setMessage(
      kind === "reconciliation"
        ? "Conciliación recalculada desde staging y datos canónicos."
        : "Validación posterior completada.",
    );
  }

  return (
    <>
      <section className="detail-card source-section">
        <div className="page-heading compact-heading">
          <div>
            <p className="eyebrow">Cola de facturación</p>
            <h2>{total} filas detectadas</h2>
            <p>
              Solo identificadores exactos pueden vincularse automáticamente.
              Las correcciones conservan siempre el valor crudo.
            </p>
          </div>
          <div className="page-actions">
            <button
              className="secondary-button"
              onClick={() => void loadReport("reconciliation")}
              type="button"
            >
              Conciliar
            </button>
            <button
              className="secondary-button"
              onClick={() => void loadReport("post-validation")}
              type="button"
            >
              Validar lote
            </button>
            <a
              className="secondary-button"
              href={`/api/imports/${batchId}/reconciliation?format=csv`}
            >
              Exportar conciliación
            </a>
            {canAccept && (
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void onAccept()}
                type="button"
              >
                Aceptar piloto
              </button>
            )}
          </div>
        </div>
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Factura / referencia</th>
                <th>Cliente</th>
                <th>Fecha</th>
                <th>Total</th>
                <th>Resultado</th>
                <th>Revisión</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const values = object(row.normalized_values);
                return (
                  <tr key={text(row.id)}>
                    <td>{labelKind(text(row.document_kind))}</td>
                    <td>
                      {text(values.invoice_number) ||
                        text(values.receipt_number) ||
                        "—"}
                    </td>
                    <td>{text(values.business_name) || text(values.rnc) || "—"}</td>
                    <td>
                      {text(values.issue_date) ||
                        text(values.payment_date) ||
                        "—"}
                    </td>
                    <td>
                      {formatAmount(
                        values.total_amount ?? values.payment_amount,
                      )}
                    </td>
                    <td>
                      <span className={`status status-${text(row.outcome)}`}>
                        {outcomeLabel(text(row.outcome))}
                      </span>
                    </td>
                    <td>
                      {canWrite &&
                      ["manual_review", "pending", "duplicate_candidate"].includes(
                        text(row.outcome),
                      ) ? (
                        <div className="review-actions">
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              void onReview(text(row.id), "ready")
                            }
                            type="button"
                          >
                            Aprobar
                          </button>
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              void onReview(text(row.id), "skipped")
                            }
                            type="button"
                          >
                            Omitir
                          </button>
                        </div>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <small>
          Archivo de staging: {importFileId}. Avance y Pendiente nunca se
          convierten en pagos sin evidencia transaccional.
        </small>
      </section>
      {report && (
        <section className="detail-card source-section">
          <h2>Informe verificable</h2>
          <pre className="json-report">{JSON.stringify(report, null, 2)}</pre>
        </section>
      )}
    </>
  );
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function formatAmount(value: unknown) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat("es-DO", {
        style: "currency",
        currency: "DOP",
      }).format(amount)
    : "—";
}
function labelKind(value: string) {
  return (
    {
      invoice: "Factura",
      receipt: "Recibo",
      payment_evidence: "Evidencia de pago",
      credit_note: "Nota de crédito",
      invoice_register: "Matriz",
    }[value] ?? value
  );
}
function outcomeLabel(value: string) {
  return (
    {
      ready: "Lista",
      imported: "Importada",
      matched: "Vinculada",
      duplicate_candidate: "Duplicado",
      manual_review: "Revisión manual",
      skipped: "Omitida",
      failed: "Fallida",
      pending: "Pendiente",
    }[value] ?? value
  );
}
