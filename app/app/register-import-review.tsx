"use client";

import { useState, type FormEvent } from "react";
import type { RegisterImportData } from "./source-types";

export function RegisterImportReview({
  data,
  busy,
  canWrite,
  progress,
  onAccept,
  onLoad,
  onReview,
}: {
  data: RegisterImportData;
  busy: boolean;
  canWrite: boolean;
  progress: string;
  onAccept(): Promise<void>;
  onLoad(options: {
    offset?: number;
    outcome?: string;
    origin?: string;
    q?: string;
  }): Promise<void>;
  onReview(rowId: string, outcome: "ready" | "skipped"): Promise<void>;
}) {
  const [outcome, setOutcome] = useState("");
  const [origin, setOrigin] = useState("");
  const [query, setQuery] = useState("");
  const summary = data.batch.summary ?? {};
  const applyFilters = (event: FormEvent) => {
    event.preventDefault();
    void onLoad({ offset: 0, outcome, origin, q: query });
  };
  const start = data.total ? data.offset + 1 : 0;
  const end = Math.min(data.total, data.offset + data.rows.length);
  return (
    <>
      <section
        className="source-summary-grid register-summary"
        aria-label="Resumen del dry run"
      >
        <Summary
          label="Filas descubiertas"
          value={summary.sourceRowsDiscovered ?? data.batch.total_rows ?? 0}
        />
        <Summary
          label="Listas / importadas"
          value={
            summary.rowsImported ??
            summary.rowsReady ??
            data.batch.successful_count ??
            0
          }
        />
        <Summary
          label="Duplicados candidatos"
          value={summary.duplicateCandidates ?? data.batch.duplicate_count ?? 0}
        />
        <Summary
          label="Revisión manual"
          value={summary.manualReviewRecords ?? data.batch.review_count ?? 0}
        />
        <Summary label="Sin fecha" value={summary.missingDates ?? 0} />
        <Summary
          label="Fuentes locales"
          value={summary.unavailableSources ?? 0}
        />
      </section>
      <section
        className="source-summary-grid register-summary"
        aria-label={
          data.batch.dry_run
            ? "Proyección de entidades"
            : "Entidades creadas por la importación"
        }
      >
        {data.batch.dry_run ? (
          <>
            <Summary
              label="Clientes nuevos"
              value={summary.newBusinesses ?? 0}
            />
            <Summary
              label="Clientes existentes"
              value={summary.existingBusinessMatches ?? 0}
            />
            <Summary
              label="Contactos nuevos"
              value={summary.newContacts ?? 0}
            />
            <Summary
              label="Proyectos nuevos"
              value={summary.newProjects ?? 0}
            />
            <Summary
              label="Cotizaciones nuevas"
              value={summary.newQuotations ?? 0}
            />
            <Summary
              label="Revisiones nuevas"
              value={summary.newRevisions ?? 0}
            />
          </>
        ) : (
          <>
            <Summary
              label="Clientes creados"
              value={summary.importedBusinesses ?? 0}
            />
            <Summary
              label="Contactos creados"
              value={summary.importedContacts ?? 0}
            />
            <Summary
              label="Proyectos creados"
              value={summary.importedProjects ?? 0}
            />
            <Summary
              label="Cotizaciones creadas"
              value={summary.importedQuotations ?? 0}
            />
            <Summary
              label="Revisiones creadas"
              value={summary.importedRevisions ?? 0}
            />
          </>
        )}
      </section>

      <section className="detail-card source-section">
        <div className="section-heading">
          <div>
            <h2>Reconciliación por origen</h2>
            <p className="muted">
              Los conteos descubiertos deben coincidir con el resumen del
              workbook.
            </p>
          </div>
          {canWrite && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void onAccept()}
              type="button"
            >
              {busy ? progress || "Importando…" : "Importar filas listas"}
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table className="responsive-table">
            <thead>
              <tr>
                <th>Origen</th>
                <th>Esperadas</th>
                <th>Descubiertas</th>
                <th>Importadas</th>
                <th>Duplicados</th>
                <th>Revisión</th>
                <th>Fallidas</th>
              </tr>
            </thead>
            <tbody>
              {data.sources.map((source) => (
                <tr key={source.origin_label}>
                  <td data-label="Origen">{source.origin_label}</td>
                  <td data-label="Esperadas">{source.expected_rows}</td>
                  <td data-label="Descubiertas">{source.discovered_rows}</td>
                  <td data-label="Importadas">
                    {source.imported_rows + source.matched_rows}
                  </td>
                  <td data-label="Duplicados">{source.duplicate_rows}</td>
                  <td data-label="Revisión">{source.review_rows}</td>
                  <td data-label="Fallidas">{source.failed_rows}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="detail-card source-section">
        <h2>Filas del registro</h2>
        <form className="register-filters" onSubmit={applyFilters}>
          <label>
            Buscar
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Cliente, cotización o archivo"
              value={query}
            />
          </label>
          <label>
            Resultado
            <select
              onChange={(event) => setOutcome(event.target.value)}
              value={outcome}
            >
              <option value="">Todos</option>
              <option value="ready">Lista</option>
              <option value="imported">Importada</option>
              <option value="matched">Coincidencia</option>
              <option value="manual_review">Revisión manual</option>
              <option value="failed">Fallida</option>
              <option value="skipped">Omitida por revisión</option>
            </select>
          </label>
          <label>
            Origen
            <select
              onChange={(event) => setOrigin(event.target.value)}
              value={origin}
            >
              <option value="">Todos</option>
              {data.sources.map((source) => (
                <option key={source.origin_label} value={source.origin_label}>
                  {source.origin_label}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary-button" type="submit">
            Aplicar
          </button>
        </form>
        <p className="muted">
          Mostrando {start}–{end} de {data.total} filas.
        </p>
        <div className="table-wrap">
          <table className="responsive-table register-rows-table">
            <thead>
              <tr>
                <th>Fila</th>
                <th>Resultado</th>
                <th>Fecha</th>
                <th>Cotización</th>
                <th>Cliente</th>
                <th>Origen</th>
                <th>Alertas</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Fila">{row.source_row_number}</td>
                  <td data-label="Resultado">
                    <span className={`status status-${row.outcome}`}>
                      {row.outcome}
                    </span>
                  </td>
                  <td data-label="Fecha">
                    {row.normalized_values.date || "—"}
                  </td>
                  <td data-label="Cotización">
                    {row.normalized_values.quotationNumber || "—"}
                  </td>
                  <td data-label="Cliente">
                    <strong>
                      {row.normalized_values.customerName || "Sin cliente"}
                    </strong>
                    <span>
                      {row.normalized_values.rnc ||
                        row.normalized_values.contactName}
                    </span>
                  </td>
                  <td data-label="Origen">
                    <span>{row.source_origin}</span>
                    <small title={row.source_filename}>
                      {row.source_filename}
                    </small>
                  </td>
                  <td data-label="Alertas">
                    {[...row.errors, ...row.warnings].length
                      ? [...row.errors, ...row.warnings].join(", ")
                      : "—"}
                  </td>
                  <td data-label="Acciones">
                    {canWrite && row.outcome === "manual_review" ? (
                      <div className="review-actions">
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void onReview(row.id, "ready")}
                          type="button"
                        >
                          Marcar lista
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy}
                          onClick={() => void onReview(row.id, "skipped")}
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
              ))}
            </tbody>
          </table>
        </div>
        <div className="pagination-actions">
          <button
            className="secondary-button"
            disabled={busy || data.offset === 0}
            onClick={() =>
              void onLoad({
                offset: Math.max(0, data.offset - data.limit),
                outcome,
                origin,
                q: query,
              })
            }
            type="button"
          >
            Anterior
          </button>
          <button
            className="secondary-button"
            disabled={busy || data.offset + data.limit >= data.total}
            onClick={() =>
              void onLoad({
                offset: data.offset + data.limit,
                outcome,
                origin,
                q: query,
              })
            }
            type="button"
          >
            Siguiente
          </button>
        </div>
      </section>
    </>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <article>
      <span>{label}</span>
      <strong>{Number(value).toLocaleString("es-DO")}</strong>
    </article>
  );
}
