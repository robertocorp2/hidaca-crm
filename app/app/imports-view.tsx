"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  ImportCandidate,
  ImportDetail,
  ImportSummary,
  RegisterImportData,
  SourceFieldValue,
} from "./source-types";
import { Empty, dateTime } from "./ui";
import { RegisterImportReview } from "./register-import-review";
import { InvoiceImportReview } from "./invoice-import-review";
import { InvoiceReplacementPanel } from "./invoice-replacement-panel";

export function ImportsView({
  canWrite,
  isAdmin,
  selectedId,
  setSelectedId,
  setMessage,
  onAccepted,
}: {
  canWrite: boolean;
  isAdmin: boolean;
  selectedId: string | null;
  setSelectedId(value: string | null): void;
  setMessage(value: string): void;
  onAccepted(links: Record<string, string>): void;
}) {
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [detail, setDetail] = useState<ImportDetail | null>(null);
  const [registerData, setRegisterData] = useState<RegisterImportData | null>(
    null,
  );
  const [invoiceData, setInvoiceData] = useState<{
    rows: Array<Record<string, unknown>>;
    total: number;
  } | null>(null);
  const [acceptProgress, setAcceptProgress] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadList() {
    setLoading(true);
    const response = await fetch("/api/imports", {
      headers: { accept: "application/json" },
    });
    const result = (await response.json()) as {
      imports?: ImportSummary[];
      error?: string;
    };
    setLoading(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo cargar la cola.");
      return;
    }
    setImports(result.imports ?? []);
  }

  async function loadDetail(id: string) {
    setLoading(true);
    setError("");
    const response = await fetch(`/api/imports/${encodeURIComponent(id)}`, {
      headers: { accept: "application/json" },
    });
    const result = (await response.json()) as ImportDetail & { error?: string };
    setLoading(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo cargar la revisión.");
      return;
    }
    setDetail(result);
    if (result.import.templateType === "register") {
      await loadRegisterRows(id, {});
      setInvoiceData(null);
    } else if (
      [
        "invoice",
        "receipt",
        "payment_evidence",
        "credit_note",
        "invoice_register",
      ].includes(result.import.documentKind)
    ) {
      const rowsResponse = await fetch(
        `/api/imports/${encodeURIComponent(id)}/rows`,
      );
      const rowsResult = (await rowsResponse.json()) as {
        rows?: Array<Record<string, unknown>>;
        total?: number;
      };
      setInvoiceData({
        rows: rowsResult.rows ?? [],
        total: rowsResult.total ?? 0,
      });
      setRegisterData(null);
    } else {
      setRegisterData(null);
      setInvoiceData(null);
    }
  }

  async function loadRegisterRows(
    id: string,
    options: {
      offset?: number;
      outcome?: string;
      origin?: string;
      q?: string;
    },
  ) {
    const params = new URLSearchParams({
      limit: "100",
      offset: String(options.offset ?? 0),
    });
    if (options.outcome) params.set("outcome", options.outcome);
    if (options.origin) params.set("origin", options.origin);
    if (options.q) params.set("q", options.q);
    const response = await fetch(
      `/api/imports/${encodeURIComponent(id)}/rows?${params.toString()}`,
      { headers: { accept: "application/json" } },
    );
    const result = (await response.json()) as RegisterImportData & {
      error?: string;
    };
    if (!response.ok) {
      setError(result.error ?? "No se pudieron cargar las filas del registro.");
      return;
    }
    setRegisterData(result);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadList(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedId) void loadDetail(selectedId);
      else setDetail(null);
    }, 0);
    return () => window.clearTimeout(timer);
    // loadDetail deliberately reads the latest queue state when the selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const formData = new FormData(form);
    const selectedFile = formData.get("file");
    const registerUpload =
      selectedFile instanceof File &&
      /registro combinado/i.test(selectedFile.name);
    const response = await fetch(
      registerUpload ? "/api/imports/register" : "/api/imports",
      {
        method: "POST",
        body: formData,
      },
    );
    const result = (await response.json()) as {
      import?: ImportSummary;
      error?: string;
      warning?: string;
    };
    setBusy(false);
    if (!response.ok && response.status !== 202) {
      setError(result.error ?? "No se pudo importar el archivo.");
      return;
    }
    form.reset();
    await loadList();
    if (result.import) setSelectedId(result.import.id);
    setMessage(
      result.warning ??
        "Archivo conservado, analizado y enviado a la cola de revisión.",
    );
  }

  async function invoiceDryRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const response = await fetch("/api/imports/invoices/dry-run", {
      method: "POST",
      body: new FormData(form),
    });
    const result = (await response.json()) as {
      preview?: {
        reconciliation?: {
          invoiceCount?: number;
          reviewCount?: number;
          duplicateCount?: number;
        };
      };
      reused?: boolean;
      error?: string;
    };
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo completar la simulación.");
      return;
    }
    form.reset();
    await loadList();
    const reconciliation = result.preview?.reconciliation;
    setMessage(
      `${result.reused ? "Simulación reutilizada" : "Simulación creada"}: ${
        reconciliation?.invoiceCount ?? 0
      } facturas, ${reconciliation?.reviewCount ?? 0} por revisar y ${
        reconciliation?.duplicateCount ?? 0
      } duplicados. No se modificaron datos canónicos.`,
    );
  }

  async function review(payload: Record<string, unknown>) {
    if (!detail) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/${detail.import.id}/review`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo guardar la revisión.");
      return;
    }
    await Promise.all([loadDetail(detail.import.id), loadList()]);
    setMessage("Revisión guardada con trazabilidad.");
  }

  async function accept() {
    if (!detail) return;
    if (detail.import.templateType === "register") {
      setBusy(true);
      setError("");
      setAcceptProgress("Preparando lote…");
      let done = false;
      let processed = 0;
      try {
        while (!done) {
          const response = await fetch(
            `/api/imports/${detail.import.id}/accept-register`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ limit: 75 }),
            },
          );
          const result = (await response.json()) as {
            processed?: number;
            done?: boolean;
            error?: string;
          };
          if (!response.ok) {
            throw new Error(result.error ?? "No se pudo continuar el lote.");
          }
          processed += result.processed ?? 0;
          done = Boolean(result.done) || (result.processed ?? 0) === 0;
          setAcceptProgress(
            `${processed.toLocaleString("es-DO")} filas procesadas…`,
          );
        }
        await Promise.all([loadDetail(detail.import.id), loadList()]);
        setMessage(
          "Importación ejecutada. Las filas inciertas permanecen en revisión manual.",
        );
      } catch (acceptError) {
        setError(
          acceptError instanceof Error
            ? acceptError.message
            : "No se pudo completar el lote.",
        );
      } finally {
        setBusy(false);
        setAcceptProgress("");
      }
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/${detail.import.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const result = (await response.json()) as {
      links?: Record<string, string>;
      error?: string;
    };
    setBusy(false);
    if (!response.ok || !result.links) {
      setError(result.error ?? "No se pudo aceptar la importación.");
      return;
    }
    await loadList();
    onAccepted(result.links);
  }

  async function retry() {
    if (!detail) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/${detail.import.id}/retry`, {
      method: "POST",
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo reprocesar el archivo.");
      return;
    }
    await Promise.all([loadDetail(detail.import.id), loadList()]);
    setMessage("Archivo reprocesado desde el original conservado en R2.");
  }

  async function reviewRegisterRow(
    rowId: string,
    outcome: "ready" | "skipped",
  ) {
    if (!detail) return;
    setBusy(true);
    setError("");
    const response = await fetch(`/api/imports/${detail.import.id}/rows`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        rowId,
        outcome,
        resolution:
          outcome === "ready"
            ? "Valores verificados por el operador."
            : "Fila omitida explícitamente por el operador.",
      }),
    });
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo guardar la decisión.");
      return;
    }
    if (invoiceData) {
      const rowsResponse = await fetch(`/api/imports/${detail.import.id}/rows`);
      const rowsResult = (await rowsResponse.json()) as {
        rows?: Array<Record<string, unknown>>;
        total?: number;
      };
      setInvoiceData({
        rows: rowsResult.rows ?? [],
        total: rowsResult.total ?? 0,
      });
    } else {
      await loadRegisterRows(detail.import.id, {
        offset: registerData?.offset ?? 0,
      });
    }
    setMessage("Decisión de fila guardada con trazabilidad.");
  }

  async function acceptInvoicePilot() {
    if (!detail) return;
    setBusy(true);
    setError("");
    const response = await fetch(
      `/api/imports/${detail.batch.id}/accept-invoices`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `invoice-pilot-${detail.batch.id}`,
        },
        body: JSON.stringify({ confirm: "ACEPTAR PILOTO" }),
      },
    );
    const result = (await response.json()) as { error?: string };
    setBusy(false);
    if (!response.ok) {
      setError(result.error ?? "No se pudo aceptar el piloto.");
      return;
    }
    await Promise.all([loadDetail(detail.import.id), loadList()]);
    setMessage("Piloto aceptado de forma atómica y auditable.");
  }

  if (detail && selectedId) {
    const blocking = detail.issues.filter(
      (issue) => issue.status === "open" && issue.severity === "blocking",
    ).length;
    return (
      <>
        <div className="breadcrumbs">
          <span>Inicio</span>
          <i>/</i>
          <button onClick={() => setSelectedId(null)} type="button">
            Importaciones
          </button>
          <i>/</i>
          <span aria-current="page">{detail.import.filename}</span>
        </div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">Revisión de origen</p>
            <h1>{detail.import.filename}</h1>
            <p>
              {detail.import.templateType || "Plantilla sin clasificar"} ·{" "}
              {detail.import.parserName || "Análisis pendiente"}
            </p>
          </div>
          {canWrite &&
            !invoiceData &&
            detail.import.status !== "accepted" && (
            <div className="page-actions">
              {["failed", "partial"].includes(detail.import.status) && (
                <button
                  className="secondary-button"
                  disabled={busy}
                  onClick={() => void retry()}
                  type="button"
                >
                  Reprocesar original
                </button>
              )}
              <button
                className="primary-button"
                disabled={
                  busy ||
                  (detail.import.templateType !== "register" && blocking > 0) ||
                  detail.import.status === "failed"
                }
                onClick={() => void accept()}
                type="button"
              >
                {busy
                  ? acceptProgress || "Procesando…"
                  : detail.import.templateType === "register"
                    ? "Importar filas listas"
                    : "Aceptar y crear registros"}
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="inline-alert" role="alert">
            {error}
          </div>
        )}
        {blocking > 0 && detail.import.templateType !== "register" && (
          <div className="inline-warning" role="status">
            Resuelve {blocking} advertencia{blocking === 1 ? "" : "s"}{" "}
            bloqueante
            {blocking === 1 ? "" : "s"} antes de aceptar.
          </div>
        )}
        <section className="source-summary-grid">
          <SummaryCard label="Estado" value={detail.import.status} />
          <SummaryCard
            label="Ruta de origen"
            value={detail.document.sourcePath || "Carga manual"}
          />
          <SummaryCard
            label="Tamaño"
            value={formatBytes(detail.document.size)}
          />
          <SummaryCard
            label="SHA-256"
            value={detail.document.sha256.slice(0, 16) + "…"}
          />
        </section>
        {invoiceData && (
          <>
            {detail.issues.length > 0 && (
              <section className="detail-card source-section">
                <h2>Incidencias del archivo</h2>
                <div className="review-list">
                  {detail.issues.map((issue) => (
                    <article key={issue.id}>
                      <span className={`status status-${issue.severity}`}>
                        {issue.severity}
                      </span>
                      <div>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail || issue.sourceLocation}</p>
                      </div>
                      {canWrite && issue.status === "open" && (
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() =>
                            void review({
                              issueId: issue.id,
                              issueAction: "resolve",
                              resolution:
                                "Verificado explícitamente en la revisión del lote de facturas.",
                            })
                          }
                          type="button"
                        >
                          Resolver
                        </button>
                      )}
                    </article>
                  ))}
                </div>
              </section>
            )}
            <InvoiceImportReview
              batchId={detail.batch.id}
              busy={busy}
              canAccept={isAdmin}
              canWrite={canWrite}
              importFileId={detail.import.id}
              onAccept={acceptInvoicePilot}
              onReview={reviewRegisterRow}
              rows={invoiceData.rows}
              setError={setError}
              setMessage={setMessage}
              total={invoiceData.total}
            />
          </>
        )}
        {!invoiceData &&
          detail.import.templateType === "register" &&
          registerData && (
          <RegisterImportReview
            busy={busy}
            canWrite={canWrite}
            data={registerData}
            onAccept={accept}
            onLoad={(options) => loadRegisterRows(detail.import.id, options)}
            onReview={reviewRegisterRow}
            progress={acceptProgress}
          />
        )}
        {!invoiceData && detail.import.templateType !== "register" && (
          <>
            <section className="detail-card source-section">
              <h2>Advertencias y decisiones</h2>
              {detail.issues.length ? (
                <div className="review-list">
                  {detail.issues.map((issue) => (
                    <article key={issue.id}>
                      <span className={`status status-${issue.severity}`}>
                        {issue.severity}
                      </span>
                      <div>
                        <strong>{issue.title}</strong>
                        <p>{issue.detail || issue.sourceLocation}</p>
                        {issue.status !== "open" && (
                          <small>
                            {issue.status}: {issue.resolution}
                          </small>
                        )}
                      </div>
                      {canWrite && issue.status === "open" && (
                        <div className="review-actions">
                          <button
                            className="secondary-button"
                            disabled={busy}
                            onClick={() =>
                              void review({
                                issueId: issue.id,
                                issueAction: "resolve",
                                resolution:
                                  "Verificado durante la revisión de importación.",
                              })
                            }
                            type="button"
                          >
                            Resolver
                          </button>
                          {issue.severity !== "blocking" && (
                            <button
                              className="secondary-button"
                              disabled={busy}
                              onClick={() =>
                                void review({
                                  issueId: issue.id,
                                  issueAction: "dismiss",
                                  resolution:
                                    "Falso positivo confirmado por el revisor.",
                                })
                              }
                              type="button"
                            >
                              Descartar
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="muted">No hay advertencias.</p>
              )}
            </section>
            <section className="detail-card source-section">
              <h2>Posibles coincidencias</h2>
              {detail.candidates.length ? (
                <div className="candidate-grid">
                  {detail.candidates.map((candidate) => (
                    <CandidateCard
                      busy={busy}
                      candidate={candidate}
                      canWrite={canWrite}
                      key={candidate.id}
                      onReview={review}
                    />
                  ))}
                </div>
              ) : (
                <p className="muted">
                  No se detectaron posibles duplicados o revisiones.
                </p>
              )}
            </section>
            <section className="detail-card source-section">
              <h2>Comparación origen → registro</h2>
              <p className="muted">
                Los valores crudos permanecen inmutables; las correcciones solo
                cambian el valor normalizado.
              </p>
              <div className="table-wrap">
                <table className="responsive-table source-values-table">
                  <thead>
                    <tr>
                      <th>Origen</th>
                      <th>Valor crudo</th>
                      <th>Destino</th>
                      <th>Normalizado</th>
                      <th>Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.sourceValues.slice(0, 500).map((value) => (
                      <SourceValueEditor
                        busy={busy}
                        canWrite={canWrite}
                        key={value.id}
                        onSave={review}
                        value={value}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </>
    );
  }

  return (
    <>
      <div className="breadcrumbs">
        <span>Inicio</span>
        <i>/</i>
        <span aria-current="page">Importaciones</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PDF y hojas de cálculo</p>
          <h1>Importaciones</h1>
          <p>
            Conserva el archivo original, revisa coincidencias y crea registros
            normalizados.
          </p>
        </div>
      </div>
      {isAdmin && (
        <InvoiceReplacementPanel
          onCompleted={() => {
            void loadList();
            setMessage("Facturas 2021 reemplazadas y reconciliadas.");
          }}
        />
      )}
      {canWrite && (
        <form className="panel import-upload" onSubmit={invoiceDryRun}>
          <div>
            <p className="eyebrow">Facturas · simulación segura</p>
            <h2>Preparar lote de facturación</h2>
            <p>
              Clasifica, conserva evidencia y crea la cola de revisión sin
              escribir facturas, pagos ni saldos canónicos.
            </p>
          </div>
          <label>
            Archivos (máximo 10)
            <input
              accept=".xlsx,.xlsm,.xlsb"
              multiple
              name="files"
              required
              type="file"
            />
          </label>
          <label>
            Nombre del lote
            <input name="batchName" placeholder="Piloto de facturas 2021" />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? "Simulando…" : "Ejecutar simulación"}
          </button>
          <small>
            La repetición con los mismos archivos reutiliza exactamente la
            misma decisión.
          </small>
        </form>
      )}
      {canWrite && (
        <form className="panel import-upload" onSubmit={upload}>
          <label>
            Archivo
            <input
              accept=".pdf,.xlsx,.xlsm,.xlsb"
              name="file"
              required
              type="file"
            />
          </label>
          <label>
            Ruta o referencia de origen
            <input
              name="sourcePath"
              placeholder="Ej. COTIZACIONES 2025 / Cliente"
            />
          </label>
          <label>
            Nombre del lote
            <input name="batchName" placeholder="Carga histórica julio 2026" />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? "Analizando…" : "Cargar y analizar"}
          </button>
          <small>
            Formatos permitidos: PDF, XLSX, XLSM y XLSB; máximo 32 MB.
          </small>
        </form>
      )}
      {error && (
        <div className="inline-alert" role="alert">
          {error}
        </div>
      )}
      <section className="panel">
        {loading ? (
          <p className="empty-state">Cargando cola…</p>
        ) : imports.length ? (
          <div className="table-wrap">
            <table className="responsive-table">
              <thead>
                <tr>
                  <th>Archivo</th>
                  <th>Plantilla</th>
                  <th>Estado</th>
                  <th>Advertencias</th>
                  <th>Importado</th>
                </tr>
              </thead>
              <tbody>
                {imports.map((item) => (
                  <tr
                    className="clickable-row"
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedId(item.id);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td data-label="Archivo">
                      <strong>{item.filename}</strong>
                      <span>{item.extension}</span>
                    </td>
                    <td data-label="Plantilla">{item.templateType || "—"}</td>
                    <td data-label="Estado">
                      <span className={`status status-${item.status}`}>
                        {item.status}
                      </span>
                    </td>
                    <td data-label="Advertencias">{item.openIssues ?? 0}</td>
                    <td data-label="Importado">{dateTime(item.importedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty text="No hay archivos importados." />
        )}
      </section>
    </>
  );
}

function SourceValueEditor({
  value,
  busy,
  canWrite,
  onSave,
}: {
  value: SourceFieldValue;
  busy: boolean;
  canWrite: boolean;
  onSave(payload: Record<string, unknown>): Promise<void>;
}) {
  const [normalized, setNormalized] = useState(value.normalizedValue);
  const [entity, setEntity] = useState(value.canonicalEntity);
  const [field, setField] = useState(value.canonicalField);
  const changed =
    normalized !== value.normalizedValue ||
    entity !== value.canonicalEntity ||
    field !== value.canonicalField;
  return (
    <tr>
      <td data-label="Origen">
        {[
          value.sourceSheet,
          value.sourcePage ? `Página ${value.sourcePage}` : "",
          value.sourceCell,
        ]
          .filter(Boolean)
          .join(" · ") || "—"}
      </td>
      <td data-label="Valor crudo">{value.displayValue || "∅"}</td>
      <td data-label="Destino">
        {canWrite ? (
          <span className="target-fields">
            <input
              aria-label="Entidad canónica"
              onChange={(event) => setEntity(event.target.value)}
              value={entity}
            />
            <input
              aria-label="Campo canónico"
              onChange={(event) => setField(event.target.value)}
              value={field}
            />
          </span>
        ) : (
          `${entity}.${field}`
        )}
      </td>
      <td data-label="Normalizado">
        {canWrite ? (
          <input
            aria-label="Valor normalizado"
            onChange={(event) => setNormalized(event.target.value)}
            value={normalized}
          />
        ) : (
          normalized || "∅"
        )}
      </td>
      <td data-label="Estado">
        {canWrite && changed ? (
          <button
            className="secondary-button"
            disabled={busy || !entity || !field}
            onClick={() =>
              void onSave({
                sourceFieldValueId: value.id,
                canonicalEntity: entity,
                canonicalField: field,
                normalizedValue: normalized,
                confidence: "manual_review",
              })
            }
            type="button"
          >
            Guardar
          </button>
        ) : (
          <span className="muted">
            {value.mappingStatus} · {value.valueState}
          </span>
        )}
      </td>
    </tr>
  );
}

function CandidateCard({
  candidate,
  busy,
  canWrite,
  onReview,
}: {
  candidate: ImportCandidate;
  busy: boolean;
  canWrite: boolean;
  onReview(payload: Record<string, unknown>): Promise<void>;
}) {
  return (
    <article>
      <span>{candidate.candidateType}</span>
      <strong>{candidate.candidateEntityId}</strong>
      <small>
        {Math.round(candidate.score * 100)}% · {candidate.reasons.join(", ")}
      </small>
      {canWrite && (
        <div className="review-actions">
          <button
            className="secondary-button"
            disabled={busy || candidate.status === "selected"}
            onClick={() =>
              void onReview({
                candidateId: candidate.id,
                candidateAction: "select",
              })
            }
            type="button"
          >
            {candidate.status === "selected"
              ? "Seleccionado"
              : "Usar existente"}
          </button>
          <button
            className="secondary-button"
            disabled={busy || candidate.status === "rejected"}
            onClick={() =>
              void onReview({
                candidateId: candidate.id,
                candidateAction: "reject",
              })
            }
            type="button"
          >
            Rechazar
          </button>
        </div>
      )}
    </article>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <article>
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </article>
  );
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
