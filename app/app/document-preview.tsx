"use client";

import { useEffect, useState } from "react";
import type { PdfDocumentData } from "../lib/document-pdf";
import { createDocumentPdf } from "../lib/document-pdf";
import { Modal } from "./ui";

export function DocumentPreviewModal({
  document,
  onClose,
}: {
  document: PdfDocumentData;
  onClose(): void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    void createDocumentPdf(document)
      .then((bytes) => {
        if (!active) return;
        const copy = new Uint8Array(bytes.length);
        copy.set(bytes);
        objectUrl = URL.createObjectURL(
          new Blob([copy.buffer as ArrayBuffer], { type: "application/pdf" }),
        );
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active)
          setError("No se pudo generar la vista previa del documento.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [document]);

  function download() {
    if (!url) return;
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `${document.kind === "invoice" ? "factura" : "cotizacion"}-${document.number || "documento"}.pdf`;
    anchor.click();
  }

  function print() {
    if (!url) return;
    const printWindow = window.open(url, "_blank", "noopener,noreferrer");
    printWindow?.addEventListener("load", () => printWindow.print(), {
      once: true,
    });
  }

  return (
    <Modal
      eyebrow="Documento guardado"
      onClose={onClose}
      title={
        document.kind === "invoice"
          ? "Vista previa de factura"
          : "Vista previa de cotización"
      }
      wide
    >
      <div className="document-preview">
        {error && (
          <div className="inline-alert" role="alert">
            {error}
          </div>
        )}
        {url ? (
          <iframe title="Vista previa PDF" src={url} />
        ) : (
          !error && <p className="muted">Generando vista previa…</p>
        )}
        <div className="form-actions">
          <button
            className="secondary-button"
            disabled={!url}
            onClick={download}
            type="button"
          >
            Descargar PDF
          </button>
          <button
            className="secondary-button"
            disabled={!url}
            onClick={print}
            type="button"
          >
            Imprimir
          </button>
          <button className="primary-button" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function StoredDocumentPreviewModal({
  id,
  name,
  contentType,
  onClose,
}: {
  id: string;
  name: string;
  contentType: string;
  onClose(): void;
}) {
  const src = `/api/documents/${encodeURIComponent(id)}?disposition=inline`;
  const image = contentType.toLowerCase().startsWith("image/");
  return (
    <Modal eyebrow="Documento relacionado" onClose={onClose} title={name} wide>
      <div className="stored-document-preview">
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt={name} height={900} src={src} width={1200} />
        ) : (
          <iframe title={`Vista previa de ${name}`} src={src} />
        )}
        <div className="form-actions">
          <a
            className="secondary-button"
            href={`/api/documents/${encodeURIComponent(id)}`}
            download
          >
            Descargar
          </a>
          <a
            className="secondary-button"
            href={src}
            rel="noreferrer"
            target="_blank"
          >
            Abrir en otra pestaña
          </a>
          <button className="primary-button" onClick={onClose} type="button">
            Cerrar
          </button>
        </div>
      </div>
    </Modal>
  );
}
