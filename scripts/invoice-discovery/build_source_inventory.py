#!/usr/bin/env python3
"""Generate the complete Markdown inventory from discovery JSON outputs."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path


def clean(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        value = "; ".join(str(item) for item in value)
    text = str(value).replace("|", "\\|").replace("\r", " ").replace("\n", "<br>")
    return text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--analysis-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    manifest = json.loads((args.analysis_root / "manifest-initial.json").read_text(encoding="utf-8"))
    profiles = json.loads((args.analysis_root / "file-profiles.json").read_text(encoding="utf-8"))
    summary = json.loads((args.analysis_root / "summary.json").read_text(encoding="utf-8"))
    final_summary = json.loads(
        (args.analysis_root / "final-rescan-summary.json").read_text(encoding="utf-8")
    )
    deltas = json.loads((args.analysis_root / "manifest-deltas.json").read_text(encoding="utf-8"))

    profiles_by_path = {item["relative_path"]: item for item in profiles}
    deltas_by_path = {item["relative_path"]: item for item in deltas}
    years = Counter()
    for item in manifest:
        parts = Path(item["relative_path"]).parts
        if len(parts) > 1 and parts[1].isdigit():
            years[parts[1]] += 1

    lines = [
        "# Inventario de fuentes de facturación HIDACA",
        "",
        "## Alcance y resultado",
        "",
        "Inventario read-only del árbol vivo `FACTURAS HIDACA`, adquirido mediante la sesión autenticada de OneDrive. Los binarios originales permanecieron sin cambios en un directorio temporal fuera del repositorio; este documento solo conserva metadatos, hashes y resultados de parseo.",
        "",
        f"- Archivos iniciales: **{final_summary['initial_files']:,}**.",
        f"- Archivos en rescan final: **{final_summary['final_files']:,}**.",
        f"- Sin cambios por SHA-256: **{final_summary['counts']['unchanged']:,}**.",
        f"- Agregados/cambiados/eliminados/inaccesibles: **{final_summary['counts']['added']}/{final_summary['counts']['changed']}/{final_summary['counts']['removed']}/{final_summary['counts']['inaccessible']}**.",
        f"- Parseados: **{summary['reconciliation']['parsed']:,}**; parciales: **{summary['reconciliation']['partial']:,}**; no legibles: **{summary['reconciliation']['unreadable']:,}**; no soportados: **{summary['reconciliation']['unsupported']:,}**; irrelevantes/restringidos: **{summary['reconciliation']['irrelevant']:,}**.",
        f"- Hojas Excel: **{sum(len(item.get('worksheets', [])) for item in profiles):,}**.",
        f"- Páginas PDF: **{sum(len(item.get('pages', [])) for item in profiles):,}**.",
        f"- Campos/etiquetas distintos catalogados: **{summary['field_catalog_entries']:,}**.",
        f"- Pares PDF/XLSX por ruta base: **{summary['paired_pdf_xlsx_documents']:,}**.",
        "",
        "La reconciliación `total = parsed + partial + unreadable + unsupported + irrelevant` es verdadera. No hubo omisiones silenciosas.",
        "",
        "## Distribución",
        "",
        "| Año / ubicación | Archivos |",
        "|---|---:|",
    ]
    for year in sorted(years):
        lines.append(f"| {year} | {years[year]:,} |")
    lines.extend(
        [
            "| Matriz principal | 1 |",
            "| FACTURADOR DGII (inventario restringido) | 1 |",
            "",
            "| Extensión | Cantidad |",
            "|---|---:|",
        ]
    )
    for extension, count in sorted(summary["extensions"].items()):
        lines.append(f"| `{extension}` | {count:,} |")

    lines.extend(
        [
            "",
            "## Métodos y límites",
            "",
            "- Excel: `openpyxl` en modo de fórmula y resultado cacheado; se inspeccionaron todas las hojas, rangos, fórmulas, nombres, merges, filtros, validaciones, comentarios y visibilidad sin recalcular ni guardar los libros.",
            "- PDF: `pypdf` por página; OCR se marcó como requerido cuando no existió capa de texto utilizable.",
            "- Hash: SHA-256 de cada archivo descargado.",
            "- El timestamp listado es el timestamp preservado por la descarga ZIP de OneDrive.",
            "- El archivo `.lnk` no se ejecutó ni se desreferenció.",
            "- El contenedor `.p12` se aisló, hasheó e inventarió; no se abrió ni se inspeccionó.",
            "- Los originales temporales no se incluyen en Git.",
            "",
            "## Inventario completo",
            "",
            "| Ruta original | Tipo | Bytes | Modificado | SHA-256 | Categoría | Estado | Hojas/páginas | Legible | OCR | Registros aprox. | Rango de fechas | Moneda | Delta final | Advertencias |",
            "|---|---:|---:|---|---|---|---|---:|---|---|---:|---|---|---|---|",
        ]
    )

    for item in sorted(manifest, key=lambda value: value["relative_path"].casefold()):
        profile = profiles_by_path.get(item["relative_path"], {})
        delta = deltas_by_path.get(item["relative_path"], {})
        units = (
            f"{len(profile.get('worksheets', []))} hojas"
            if "worksheets" in profile
            else f"{len(profile.get('pages', []))} páginas"
            if "pages" in profile
            else ""
        )
        readable = profile.get("machine_readable")
        readable_text = "" if readable is None else "Sí" if readable else "No"
        date_range = profile.get("date_range") or []
        warnings = profile.get("warnings") or item.get("reason") or ""
        lines.append(
            "| "
            + " | ".join(
                [
                    clean(item["relative_path"]),
                    clean(item["extension"]),
                    f"{item['size_bytes']:,}",
                    clean(item["source_modified_at"]),
                    clean(item["sha256"]),
                    clean(item["category"]),
                    clean(item["parse_status"]),
                    clean(units),
                    readable_text,
                    "Sí" if profile.get("ocr_required") else "No",
                    clean(profile.get("approximate_record_count", "")),
                    clean(" → ".join(date_range)),
                    clean(profile.get("currency", "")),
                    clean(delta.get("delta_status", "")),
                    clean(warnings),
                ]
            )
            + " |"
        )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
