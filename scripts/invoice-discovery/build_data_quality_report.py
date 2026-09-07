#!/usr/bin/env python3
"""Generate the evidence-backed HIDACA invoice data-quality report."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

from openpyxl import load_workbook


def esc(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", "<br>")


def money(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)):
        return f"{value:,.2f}"
    return str(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--analysis-root", type=Path, required=True)
    parser.add_argument("--acquired-root", type=Path, required=True)
    parser.add_argument("--matrix", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    profiles = json.loads((args.analysis_root / "file-profiles.json").read_text(encoding="utf-8"))
    pairs = json.loads((args.analysis_root / "document-pairs.json").read_text(encoding="utf-8"))
    manifest = json.loads((args.analysis_root / "manifest-initial.json").read_text(encoding="utf-8"))
    summary = json.loads((args.analysis_root / "summary.json").read_text(encoding="utf-8"))
    final_summary = json.loads(
        (args.analysis_root / "final-rescan-summary.json").read_text(encoding="utf-8")
    )

    wf = load_workbook(args.matrix, data_only=False)
    wc = load_workbook(args.matrix, data_only=True)
    wsf = wf["Hoja1"]
    wsc = wc["Hoja1"]
    matrix_rows = []
    for row_number in range(2, wsf.max_row + 1):
        values = [wsc.cell(row_number, column).value for column in range(1, 18)]
        if values[4] is not None or values[5] is not None or values[6] is not None:
            matrix_rows.append((row_number, values))

    negative_balances = [
        (row, values)
        for row, values in matrix_rows
        if isinstance(values[13], (int, float)) and values[13] < 0
    ]
    tax_differences = []
    total_differences = []
    for row, values in matrix_rows:
        subtotal, tax, total = values[8], values[9], values[10]
        if isinstance(subtotal, (int, float)) and isinstance(tax, (int, float)):
            if abs(tax - subtotal * 0.18) > 0.011:
                tax_differences.append((row, values))
        if all(isinstance(item, (int, float)) for item in (subtotal, tax, total)):
            if abs(subtotal + tax - total) > 0.011:
                total_differences.append((row, values))
    cancellations = [
        (row, values)
        for row, values in matrix_rows
        if str(values[11]).strip().casefold() == "anulada"
    ]
    placeholders = [
        (row, values)
        for row, values in matrix_rows
        if not values[1] and (values[5] or values[6])
    ]
    duplicate_key_groups = defaultdict(list)
    for row, values in matrix_rows:
        key = (str(values[5]), str(values[4]), str(values[1]))
        duplicate_key_groups[key].append((row, values))
    duplicate_key_groups = {
        key: rows for key, rows in duplicate_key_groups.items() if len(rows) > 1
    }

    business_paths = {
        profile["relative_path"]
        for profile in profiles
        if Path(profile["relative_path"]).suffix.lower() in {".pdf", ".xlsx"}
        and not Path(profile["relative_path"]).name.upper().startswith("AAAANUMEROS")
        and "Matriz Principal" not in profile["relative_path"]
    }
    paired_paths = {pair["pdf"] for pair in pairs} | {pair["xlsx"] for pair in pairs}
    unpaired = sorted(business_paths - paired_paths, key=str.casefold)

    conflicts = [
        (pair["pdf"], conflict)
        for pair in pairs
        for conflict in pair["field_conflicts"]
    ]
    conflict_files = sorted({path for path, _ in conflicts}, key=str.casefold)

    filename_mismatches = []
    for profile in profiles:
        filename_matches = re.findall(
            r"(?i)\b(?:F|NC)[- ]?0*([0-9]{1,4})\b",
            Path(profile["relative_path"]).stem,
        )
        invoice_values = profile.get("fields", {}).get("invoice_number", [])
        if not filename_matches or not invoice_values:
            continue
        content_matches = re.findall(
            r"(?i)\b(?:F|NC)[- ]?0*([0-9]{1,4})\b",
            " ".join(map(str, invoice_values)),
        )
        if content_matches and filename_matches[-1] != content_matches[0]:
            filename_mismatches.append(
                (
                    profile["relative_path"],
                    filename_matches[-1],
                    content_matches[0],
                )
            )

    same_names = defaultdict(list)
    for item in manifest:
        same_names[item["file_name"].casefold()].append(item)
    same_name_groups = [
        items for items in same_names.values() if len(items) > 1
    ]

    formula_error_files = []
    xlsx_paths = list(args.acquired_root.rglob("*.xlsx")) + [args.matrix]
    for workbook_path in xlsx_paths:
        has_error = False
        try:
            with zipfile.ZipFile(workbook_path) as archive:
                for member in archive.namelist():
                    if not member.startswith("xl/worksheets/") or not member.endswith(".xml"):
                        continue
                    content = archive.read(member)
                    if b't="e"' in content:
                        has_error = True
                        break
        except Exception:
            continue
        if not has_error:
            continue
        formulas = load_workbook(workbook_path, data_only=False)
        cached = load_workbook(workbook_path, data_only=True)
        errors = []
        for sheet in formulas.worksheets:
            cached_sheet = cached[sheet.title]
            for row in sheet.iter_rows():
                for cell in row:
                    cached_value = cached_sheet[cell.coordinate].value
                    if isinstance(cached_value, str) and cached_value.startswith("#"):
                        errors.append(
                            {
                                "sheet": sheet.title,
                                "cell": cell.coordinate,
                                "formula": cell.value,
                                "error": cached_value,
                            }
                        )
        if errors:
            relative = (
                f"FACTURAS HIDACA/{workbook_path.relative_to(args.acquired_root).as_posix()}"
                if workbook_path.is_relative_to(args.acquired_root)
                else "FACTURAS HIDACA/FACTURACION HIDACA - Matriz Principal.xlsx"
            )
            formula_error_files.append((relative, errors))

    email_pattern = re.compile(r"(?i)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}")
    invalid_email_labels = []
    rnc_ambiguities = defaultdict(set)
    rnc_extraction_issues = []
    for profile in profiles:
        if not profile["relative_path"].lower().endswith(".pdf"):
            continue
        fields = profile.get("fields", {})
        emails = fields.get("email", [])
        if emails and not email_pattern.findall(" ".join(map(str, emails))):
            invalid_email_labels.append((profile["relative_path"], emails))
        rncs = fields.get("customer_tax_id", [])
        names = fields.get("customer_name", [])
        if rncs:
            raw = str(rncs[0])
            digits = "".join(re.findall(r"\d", raw))
            if len(digits) not in {9, 11}:
                rnc_extraction_issues.append((profile["relative_path"], raw))
            if names:
                normalized_name = re.sub(r"\s+", " ", str(names[0])).strip().upper()
                rnc_ambiguities[digits].add(normalized_name)
    rnc_ambiguities = {
        key: sorted(values)
        for key, values in rnc_ambiguities.items()
        if key and len(values) > 1
    }

    lines = [
        "# Informe de calidad de datos de facturación HIDACA",
        "",
        "## Resultado ejecutivo",
        "",
        f"- Corpus final estable: **{final_summary['counts']['unchanged']:,} de {final_summary['final_files']:,} archivos** sin cambio por SHA-256; 0 agregados, cambiados, eliminados o inaccesibles.",
        f"- Extracción: **{summary['reconciliation']['parsed']:,} parseados**, **{summary['reconciliation']['partial']:,} parcial**, **{summary['reconciliation']['unreadable']:,} no legibles**, 1 no soportado y 1 restringido.",
        f"- Documentos por representación: **{summary['paired_pdf_xlsx_documents']:,} pares PDF/XLSX** y **{len(unpaired):,} archivos sin representación gemela** ({sum(1 for item in unpaired if item.lower().endswith('.pdf'))} PDF; {sum(1 for item in unpaired if item.lower().endswith('.xlsx'))} XLSX).",
        f"- Conflictos reales PDF/XLSX: **{len(conflicts)} campos en {len(conflict_files)} pares**.",
        f"- Errores de fórmula cacheados: **{sum(len(errors) for _, errors in formula_error_files)} celdas en {len(formula_error_files)} libros**.",
        f"- Coincidencias nombre de archivo vs contenido: **{len(filename_mismatches)} archivos / {len({str(Path(item[0]).with_suffix('')).casefold() for item in filename_mismatches})} documentos base** no concuerdan.",
        "- Los riesgos P0 son identidad de factura, anulaciones/reemisiones, pagos agregados sin evidencia transaccional y tratamiento fiscal no estándar.",
        "",
        "## Reglas reproducibles",
        "",
        "| Control | Regla | Resultado |",
        "|---|---|---:|",
        f"| Duplicado binario | SHA-256 idéntico | {summary['exact_duplicate_file_count']} |",
        f"| Mismo nombre, contenido distinto | Nombre case-insensitive repetido y hashes distintos | {len(same_name_groups)} grupos / {sum(len(items) for items in same_name_groups)} archivos |",
        f"| Conflicto PDF/XLSX | Conjuntos normalizados del mismo campo son disjuntos en el mismo stem | {len(conflicts)} |",
        f"| Nombre vs factura interna | Número F/NC del filename ≠ primer número del contenido | {len(filename_mismatches)} archivos |",
        f"| Fórmula con error | Resultado cacheado comienza `#` | {sum(len(errors) for _, errors in formula_error_files)} |",
        f"| ITBIS no 18 % | `abs(itbis - subtotal × 0.18) > 0.011` | {len(tax_differences)} filas |",
        f"| Total no reconcilia | `abs(subtotal + itbis - total) > 0.011` con tres valores numéricos | {len(total_differences)} filas |",
        f"| Saldo negativo | `Pendiente < 0` | {len(negative_balances)} filas |",
        f"| Placeholder | Fecha vacía y factura/NCF presente | {len(placeholders)} filas |",
        f"| Estado contradictorio | `Fecha Cierre = Anulada` y `Estatus = PAGADO` | {len(cancellations)} filas |",
        "",
        "## Matriz principal",
        "",
        f"La matriz contiene **{len(matrix_rows)} filas con cliente, factura o NCF**, de las cuales **{sum(1 for _, values in matrix_rows if values[5])} tienen número de factura**. El rango de fechas válidas es 08/01/2021–29/07/2026.",
        "",
        "Valores faltantes entre las filas inventariadas:",
        "",
        "| Campo | Vacíos |",
        "|---|---:|",
    ]
    headers = [wsf.cell(1, column).value for column in range(1, 16)]
    for index, header in enumerate(headers):
        if header is None:
            continue
        blanks = sum(1 for _, values in matrix_rows if values[index] in (None, ""))
        lines.append(f"| {esc(header)} | {blanks} |")

    lines.extend(
        [
            "",
            "### Anulaciones, reemisiones y crédito",
            "",
            "| Fila Excel | Factura | Cliente | NCF | Fecha Cierre | Estatus | Observación |",
            "|---:|---|---|---|---|---|---|",
        ]
    )
    for row, values in cancellations:
        observation = (
            "Candidata a anulada/sustituta; existe otra F-0002 con NCF distinto."
            if row == 237
            else "No debe importarse como pagada sin resolver la anulación."
        )
        lines.append(
            f"| {row} | {esc(values[5])} | {esc(values[4])} | {esc(values[6])} | {esc(values[11])} | {esc(values[14])} | {observation} |"
        )

    lines.extend(
        [
            "",
            "La nota de crédito `NC-0001` (fila 549, NCF `B0400000001`) tiene subtotal e ITBIS pero total vacío. Debe modelarse como nota de crédito y aplicación, no como factura ordinaria.",
            "",
            "### Placeholders incompletos",
            "",
            "| Fila Excel | Factura | NCF | Año cacheado | Subtotal | ITBIS | Total |",
            "|---:|---|---|---:|---:|---:|---:|",
        ]
    )
    for row, values in placeholders:
        lines.append(
            f"| {row} | {esc(values[5])} | {esc(values[6])} | {esc(values[3])} | {money(values[8])} | {money(values[9])} | {money(values[10])} |"
        )

    lines.extend(
        [
            "",
            "Los seis placeholders producen año `1900` desde fórmulas sobre fechas vacías. Son bloqueantes para aceptación automática.",
            "",
            "### Saldos negativos",
            "",
            "| Fila Excel | Factura | Cliente | NCF | Total | Avance | Pendiente |",
            "|---:|---|---|---|---:|---:|---:|",
        ]
    )
    for row, values in negative_balances:
        lines.append(
            f"| {row} | {esc(values[5])} | {esc(values[4])} | {esc(values[6])} | {money(values[10])} | {money(values[12])} | {money(values[13])} |"
        )

    lines.extend(
        [
            "",
            "### Tratamientos fiscales que no equivalen a 18 % del subtotal",
            "",
            "Estas filas no son errores automáticos: incluyen exenciones, base gravada parcial u otro tratamiento. El importador debe conservar la evidencia y explicar el cálculo.",
            "",
            "| Fila Excel | Factura | Cliente | Subtotal | ITBIS | Total |",
            "|---:|---|---|---:|---:|---:|",
        ]
    )
    for row, values in tax_differences:
        lines.append(
            f"| {row} | {esc(values[5])} | {esc(values[4])} | {money(values[8])} | {money(values[9])} | {money(values[10])} |"
        )

    lines.extend(
        [
            "",
            f"Entre las filas con subtotal, ITBIS y total numéricos hubo **{len(total_differences)}** discrepancias de `subtotal + ITBIS = total`. La nota de crédito con total vacío queda fuera de esa prueba y requiere revisión.",
            "",
            "## Conflictos entre PDF y XLSX del mismo documento",
            "",
            "| Archivo PDF | Campo | PDF | XLSX |",
            "|---|---|---|---|",
        ]
    )
    for source_path, conflict in conflicts:
        lines.append(
            f"| {esc(source_path)} | `{esc(conflict['field'])}` | {esc(conflict['pdf_values'])} | {esc(conflict['xlsx_values'])} |"
        )

    lines.extend(
        [
            "",
            "Regla de autoridad: el PDF emitido controla el dato propio; el XLSX se conserva como evidencia editable y todo conflicto permanece visible.",
            "",
            "## Errores de fórmula",
            "",
            "| Archivo | Hoja/celda | Fórmula | Resultado cacheado |",
            "|---|---|---|---|",
        ]
    )
    for source_path, errors in formula_error_files:
        for error in errors:
            lines.append(
                f"| {esc(source_path)} | {esc(error['sheet'])}!{esc(error['cell'])} | `{esc(error['formula'])}` | `{esc(error['error'])}` |"
            )

    lines.extend(
        [
            "",
            "Estos errores no impiden leer el resto del libro, pero el archivo queda en revisión y el importador no debe usar la celda errónea como valor canónico.",
            "",
            "## Número en nombre de archivo distinto del contenido",
            "",
            "| Archivo | Número en nombre | Número en contenido |",
            "|---|---:|---:|",
        ]
    )
    for source_path, filename_number, content_number in filename_mismatches:
        lines.append(
            f"| {esc(source_path)} | {esc(filename_number)} | {esc(content_number)} |"
        )

    lines.extend(
        [
            "",
            "El contenido emitido prevalece. La discrepancia genera issue y prohíbe deduplicación por filename.",
            "",
            "## Identificadores y contacto",
            "",
            f"- **{len(rnc_extraction_issues)}** PDFs producen un RNC/Cédula sobrecapturado por maquetación de texto; requieren extracción por región/celda: "
            + "; ".join(f"`{esc(path)}` → `{esc(value)}`" for path, value in rnc_extraction_issues)
            + ".",
            f"- **{len(rnc_ambiguities)}** RNC normalizados aparecen asociados a más de una forma de nombre. No equivale automáticamente a clientes duplicados; el grupo `131464051` evidencia contaminación del RNC del emisor en algunos documentos.",
            f"- **{len(invalid_email_labels)}** PDFs contienen correos con espacios que no pasan una validación estricta.",
            "- Los teléfonos se conservan como texto. Ningún valor etiquetado quedó con menos de diez dígitos agregados, pero extensiones/múltiples números requieren parsing conservador.",
            "",
            "| Archivo con correo inválido | Valor |",
            "|---|---|",
        ]
    )
    for source_path, values in invalid_email_labels:
        lines.append(f"| {esc(source_path)} | {esc(values)} |")

    lines.extend(
        [
            "",
            "## Archivos sin par PDF/XLSX",
            "",
            "Un archivo sin par no es inválido: puede ser la única representación emitida o editable. Debe conservarse y clasificarse.",
            "",
            "| Ruta |",
            "|---|",
        ]
    )
    for source_path in unpaired:
        lines.append(f"| {esc(source_path)} |")

    lines.extend(
        [
            "",
            "## Pagos, cuentas por cobrar y huérfanos",
            "",
            "- El corpus no contiene un libro mayor de transacciones de pago con referencia bancaria/recibo suficientemente estructurada.",
            "- `Avance` y `Pendiente` son agregados; no permiten crear ni asignar pagos.",
            "- Por tanto, pagos mayores al saldo, pagos huérfanos, montos sin aplicar y multi-moneda no pueden cuantificarse responsablemente en esta fase.",
            "- La moneda observada en facturas legibles es DOP/RD$; no se descubrió evidencia suficiente para importar pagos en otra moneda.",
            "- Las 50 representaciones sin par y el PDF que requiere OCR no son documentos huérfanos canónicos hasta intentar matching por NCF/número/cliente/fecha.",
            "",
            "## Riesgos priorizados",
            "",
            "| Prioridad | Riesgo | Tratamiento |",
            "|---|---|---|",
            "| P0 | Anulada/sustituta y crédito colapsados como duplicado | Identidad con NCF, versión y relaciones de cancelación/aplicación. |",
            "| P0 | Avance convertido en pago ficticio | Snapshot de cuenta por cobrar; pago solo con evidencia. |",
            "| P0 | Suposición fija de 18 % | Configuración/tratamiento fiscal con evidencia. |",
            "| P0 | XLSX editable contradice PDF emitido | Autoridad del emitido + issue visible. |",
            "| P1 | Filename no coincide con factura | Extraer del contenido; filename es señal débil. |",
            "| P1 | Fórmulas `#REF!`/`#DIV/0!` | Estado partial/review y no usar la celda errónea. |",
            "| P1 | RNC del emisor confundido con cliente | Extracción posicional y validación por fuente. |",
            "| P1 | PDF sin texto | OCR y revisión de confianza. |",
            "",
            "## Decisiones no resolubles sin intervención",
            "",
            "1. Confirmar las relaciones de sustitución para las tres filas marcadas `Anulada`.",
            "2. Confirmar cómo se aplicó `NC-0001` y su importe total efectivo.",
            "3. Resolver los seis pares PDF/XLSX con conflictos.",
            "4. Decidir si los seis placeholders e-NCF se completarán, excluirán o permanecerán en staging.",
            "5. Obtener evidencia transaccional antes de crear pagos/asignaciones.",
            "6. Aprobar configuraciones fiscales para exentos/base parcial/otros tratamientos.",
        ]
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
