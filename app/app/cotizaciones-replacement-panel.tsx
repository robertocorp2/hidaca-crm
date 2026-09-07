"use client";

import { useState, type ChangeEvent } from "react";

type DryRun = {
  sourceRows: number;
  validRows: number;
  rowsToInsert: number;
  rowsToUpdate: number;
  rowsToSkip: number;
  rowsBlocked: number;
  targetCount: number;
  duplicateQuotationNumbers: Array<{ number: string; count: number }>;
};

export function CotizacionesReplacementPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    setFile(event.target.files?.[0] ?? null);
    setDryRun(null);
    setMessage("");
  }

  async function submit(action: "dry-run" | "replace") {
    if (!file) return;
    setBusy(true);
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("action", action);
    if (action === "replace") form.set("confirm", "REEMPLAZAR");
    try {
      const response = await fetch("/api/cotizaciones/replace", { method: "POST", body: form });
      const result = (await response.json()) as { error?: string; dryRun?: DryRun; finalCount?: number; deleted?: number; imported?: number; backupObjectKey?: string };
      if (!response.ok) throw new Error(result.error ?? "No se pudo procesar el libro.");
      if (action === "dry-run" && result.dryRun) {
        setDryRun(result.dryRun);
        setMessage(`Simulación validada: el libro está listo para reemplazar las ${result.dryRun.targetCount} Cotizaciones actuales, incluidas las archivadas.`);
      } else {
        setMessage(`Reemplazo completado: se eliminaron ${result.deleted ?? 0} registros y se importaron ${result.imported ?? 0}. Total final: ${result.finalCount ?? 0}.`);
        window.setTimeout(() => window.location.reload(), 700);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo procesar el libro.");
    } finally {
      setBusy(false);
    }
  }

  // The API is the authority for the current target count and relationship
  // safeguards. Keep the client gate focused on the validated source rows so
  // a stale count field cannot leave an otherwise safe replacement disabled.
  const clean = Boolean(
    dryRun
    && dryRun.sourceRows === 133
    && dryRun.validRows === 133
    && dryRun.rowsToInsert === 133
    && !dryRun.rowsToUpdate
    && !dryRun.rowsToSkip
    && !dryRun.rowsBlocked,
  );
  return (
    <section className="panel" aria-label="Reemplazar Cotizaciones desde Excel">
      <h2>Reemplazar Cotizaciones desde Excel</h2>
      <p>Solo administración. Primero valida el libro; el reemplazo elimina exclusivamente todas las Cotizaciones actuales, incluidas las archivadas.</p>
      <input accept=".xlsx" aria-label="Libro de Cotizaciones" onChange={onFileChange} type="file" />
      <div className="form-actions">
        <button className="secondary-button" disabled={!file || busy} onClick={() => void submit("dry-run")} type="button">{busy ? "Procesando…" : "Validar libro"}</button>
        <button className="danger-button" disabled={!clean || busy} onClick={() => void submit("replace")} type="button">Reemplazar {dryRun?.targetCount ?? 0} por 133</button>
      </div>
      {dryRun && <p>{dryRun.sourceRows} filas fuente · {dryRun.rowsToInsert} por insertar · {dryRun.duplicateQuotationNumbers.length} grupos con número repetido.</p>}
      {message && <p className="inline-alert" role="status">{message}</p>}
    </section>
  );
}

function parseCotizacionSource(metadata: string) {
  try {
    const parsed = JSON.parse(metadata) as { kind?: string; sourceRowNumber?: number; fields?: Record<string, string | null> };
    return parsed.kind === "cotizaciones_spreadsheet" && parsed.fields ? parsed : null;
  } catch {
    return null;
  }
}

export function CotizacionSourceDetails({ metadata }: { metadata: string }) {
  const parsed = parseCotizacionSource(metadata);
  if (!parsed?.fields) return null;
  const documentUrl = parsed.fields["Enlace al Documento"];
  return <details><summary>Datos del libro fuente (fila {parsed.sourceRowNumber})</summary><dl>{Object.entries(parsed.fields).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>{documentUrl && <a href={documentUrl} rel="noreferrer" target="_blank">Abrir documento fuente</a>}</details>;
}
