import { calculateFinancialSummary, calculateLineTotal } from "../financials";
import {
  inferCustomerType,
  normalizeCurrency,
  normalizeRnc,
  normalizeSourceValue,
  parseLocaleNumber,
  parseSourceDate,
  quotationIdentity,
  valueStateOf,
  type CanonicalSourceValue,
  type ImportIssueDraft,
} from "../source-domain";
import type {
  ExtractedCell,
  ExtractedSheet,
  ImportExtraction,
  NormalizedCharge,
  NormalizedImportPreview,
  NormalizedLineItem,
  NormalizedMaterialComponent,
} from "./types";

type SourceText = {
  text: string;
  location: string;
  sheet?: string;
  page?: number;
  cell?: ExtractedCell;
};

type LabeledValue = SourceText & {
  label: string;
  value: string;
};

const LABEL_PATTERN =
  /(?:^|\s)(Cliente|Business Name|Nombre del cliente|RNC|Direcci[oó]n(?: de Proyecto)?|Tel[eé]fonos?|Celular|Correo|Email|Fecha|Cotizaci[oó]n|Contacto|Proyecto)\s*:/giu;

const componentPatterns: Array<{
  pattern: RegExp;
  type: NormalizedMaterialComponent["componentType"];
}> = [
  { pattern: /\b(?:laminas?|láminas?|slats?)\b/i, type: "slat" },
  { pattern: /\b(?:cajones?|cajón|boxes?)\b/i, type: "box" },
  { pattern: /\b(?:tubos?|tubes?)\b/i, type: "tube" },
  { pattern: /\b(?:motores?|motors?)\b/i, type: "motor" },
  {
    pattern: /\b(?:tapas? laterales?|testeros?|side caps?)\b/i,
    type: "side_cap",
  },
  { pattern: /\b(?:controles?|switch|botoneros?)\b/i, type: "control" },
  { pattern: /\b(?:receptores?|receivers?)\b/i, type: "receiver" },
  {
    pattern: /\b(?:instalacion|instalación|produccion|producción)\b/i,
    type: "labor",
  },
  {
    pattern: /\b(?:material|riel|felpa|tirante|clip|rodamiento|embudo)\b/i,
    type: "material",
  },
];

function sourceTexts(extraction: ImportExtraction): SourceText[] {
  const sources: SourceText[] = [];
  for (const sheet of extraction.sheets) {
    for (const cell of sheet.cells) {
      const text = cell.displayValue || String(cell.rawValue ?? "");
      if (!text.trim() && !cell.formula) continue;
      sources.push({
        text,
        location: `${sheet.name}!${cell.address}`,
        sheet: sheet.name,
        cell,
      });
    }
  }
  for (const page of extraction.pages) {
    page.text.split(/\r?\n/).forEach((text, index) => {
      if (!text.trim()) return;
      sources.push({
        text,
        location: `Página ${page.pageNumber}, línea ${index + 1}`,
        page: page.pageNumber,
      });
    });
  }
  return sources;
}

function labeledValues(source: SourceText): LabeledValue[] {
  const matches = [...source.text.matchAll(LABEL_PATTERN)];
  return matches.map((match, index) => {
    const valueStart = (match.index ?? 0) + match[0].length;
    const valueEnd = matches[index + 1]?.index ?? source.text.length;
    return {
      ...source,
      label: match[1],
      value: source.text.slice(valueStart, valueEnd).trim(),
    };
  });
}

function compactLabel(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function cellRows(sheet: ExtractedSheet) {
  const rows = new Map<number, ExtractedCell[]>();
  for (const cell of sheet.cells) {
    const row = rows.get(cell.row) ?? [];
    row.push(cell);
    rows.set(cell.row, row);
  }
  for (const row of rows.values()) row.sort((a, b) => a.column - b.column);
  return rows;
}

function cellText(cell: ExtractedCell | undefined) {
  return cell?.displayValue || String(cell?.rawValue ?? "");
}

function cellNumber(cell: ExtractedCell | undefined) {
  return parseLocaleNumber(cell?.rawValue ?? cell?.displayValue);
}

function rangeForRow(sheet: string, cells: ExtractedCell[]) {
  if (cells.length === 0) return sheet;
  return `${sheet}!${cells[0].address}:${cells[cells.length - 1].address}`;
}

function columnWith(cells: ExtractedCell[], pattern: RegExp) {
  return cells.find((cell) => pattern.test(compactLabel(cellText(cell))))
    ?.column;
}

function standardLineItem(
  row: ExtractedCell[],
  columns: {
    description: number;
    code?: number;
    quantity?: number;
    meters?: number;
    location?: number;
    openingWidth?: number;
    openingHeight?: number;
    finishedWidth?: number;
    finishedHeight?: number;
    area?: number;
    price?: number;
    total?: number;
  },
  mode: "unit" | "square_meter",
  sheetName: string,
): NormalizedLineItem | null {
  const byColumn = new Map(row.map((cell) => [cell.column, cell]));
  const description = cellText(byColumn.get(columns.description)).trim();
  const quantity = cellNumber(byColumn.get(columns.quantity ?? -1));
  const sourceTotal = cellNumber(byColumn.get(columns.total ?? -1));
  const price = cellNumber(byColumn.get(columns.price ?? -1));
  const area = cellNumber(byColumn.get(columns.area ?? -1));
  if (
    !description &&
    quantity === null &&
    sourceTotal === null &&
    price === null
  ) {
    return null;
  }
  if (
    description &&
    quantity === null &&
    sourceTotal === null &&
    price === null &&
    area === null
  ) {
    return null;
  }
  if (
    /^(?:sub-?\s*total|itbis|total\b|instalaci[oó]n|reparaci[oó]n|mantenimiento)$/i.test(
      description,
    )
  ) {
    return null;
  }
  const values = {
    description,
    quantity: cellText(byColumn.get(columns.quantity ?? -1)),
    meters: cellText(byColumn.get(columns.meters ?? -1)),
    location: cellText(byColumn.get(columns.location ?? -1)),
    openingWidthCm: cellText(byColumn.get(columns.openingWidth ?? -1)),
    openingHeightCm: cellText(byColumn.get(columns.openingHeight ?? -1)),
    finishedWidthCm: cellText(byColumn.get(columns.finishedWidth ?? -1)),
    finishedHeightCm: cellText(byColumn.get(columns.finishedHeight ?? -1)),
    areaSqm: cellText(byColumn.get(columns.area ?? -1)),
    price: cellText(byColumn.get(columns.price ?? -1)),
    sourceLineTotal: cellText(byColumn.get(columns.total ?? -1)),
  };
  const input = {
    quantity,
    areaSqm: area,
    priceBasis:
      mode === "square_meter" ? ("square_meter" as const) : ("unit" as const),
    unitPrice: mode === "unit" ? price : null,
    pricePerSqm: mode === "square_meter" ? price : null,
    sourceLineTotal: sourceTotal,
  };
  const calculation = calculateLineTotal(input);
  return {
    sourceSheet: sheetName,
    sourceRange: rangeForRow(sheetName, row),
    description: description || "Partida sin descripción",
    itemCode: cellText(byColumn.get(columns.code ?? -1)).trim(),
    category: mode === "square_meter" ? "installation" : "repair_maintenance",
    location: values.location,
    quantity,
    unitOfMeasure: "",
    meters: cellNumber(byColumn.get(columns.meters ?? -1)),
    openingWidthCm: cellNumber(byColumn.get(columns.openingWidth ?? -1)),
    openingHeightCm: cellNumber(byColumn.get(columns.openingHeight ?? -1)),
    finishedWidthCm: cellNumber(byColumn.get(columns.finishedWidth ?? -1)),
    finishedHeightCm: cellNumber(byColumn.get(columns.finishedHeight ?? -1)),
    areaSqm: area,
    priceBasis: calculation.basis,
    unitPrice: mode === "unit" ? price : null,
    pricePerSqm: mode === "square_meter" ? price : null,
    flatFee: null,
    sourceLineTotal: sourceTotal,
    calculatedLineTotal: calculation.total,
    currency: "DOP",
    notes: "",
    valueStates: calculation.valueStates,
    sourceValues: values,
  };
}

function extractSpreadsheetLineItems(
  sheet: ExtractedSheet,
  mappedLocations: Set<string>,
): NormalizedLineItem[] {
  const rows = cellRows(sheet);
  const sortedRows = [...rows.entries()].sort(([a], [b]) => a - b);
  const items: NormalizedLineItem[] = [];
  for (const [rowNumber, header] of sortedRows) {
    const headerText = header.map(cellText).join(" | ");
    const normalized = compactLabel(headerText);
    const hasDescription = /\bdescripcion\b/.test(normalized);
    const hasQuantity = /\b(?:cantidad|cant)\b/.test(normalized);
    const hasTotal = /\btotal\b/.test(normalized);
    if (!hasQuantity || !hasTotal) continue;

    const descriptionColumn =
      columnWith(header, /\bdescripcion\b/) ??
      (normalized.includes("ubicacion") || normalized.includes("area") ? 0 : 1);
    const quantityColumn = columnWith(header, /\b(?:cantidad|cant)\b/) ?? 2;
    const totalColumn = columnWith(header, /\btotal\b/) ?? 10;
    const isInstallation =
      normalized.includes("ubicacion") ||
      normalized.includes("area") ||
      header.filter((cell) => compactLabel(cellText(cell)).includes("ancho"))
        .length >= 2;
    const columns = isInstallation
      ? {
          description: descriptionColumn,
          quantity: quantityColumn,
          location: quantityColumn + 1,
          openingWidth: quantityColumn + 2,
          openingHeight: quantityColumn + 3,
          finishedWidth: quantityColumn + 4,
          finishedHeight: quantityColumn + 5,
          area: quantityColumn + 6,
          price: quantityColumn + 7,
          total: totalColumn,
        }
      : {
          description: descriptionColumn,
          code: columnWith(header, /\bcodigo\b/) ?? 0,
          quantity: quantityColumn,
          meters: columnWith(header, /\bmts?\b/) ?? 3,
          price: columnWith(header, /\bprecio\b/) ?? 4,
          total: totalColumn,
        };
    for (
      let current = rowNumber + 1;
      current <= rowNumber + 200;
      current += 1
    ) {
      const row = rows.get(current);
      if (!row) continue;
      const text = row.map(cellText).join(" ");
      if (
        /\b(?:sub-?\s*total|itbis|total\s*\(?rd|condiciones de pago)\b/i.test(
          text,
        )
      ) {
        break;
      }
      const item = standardLineItem(
        row,
        columns,
        isInstallation ? "square_meter" : "unit",
        sheet.name,
      );
      if (!item) continue;
      items.push(item);
      for (const cell of row) {
        mappedLocations.add(`${sheet.name}!${cell.address}`);
      }
    }
    if (items.length > 0 || hasDescription) break;
  }
  return items;
}

function extractPdfLineItems(
  extraction: ImportExtraction,
  mappedLocations: Set<string>,
): NormalizedLineItem[] {
  const items: NormalizedLineItem[] = [];
  for (const page of extraction.pages) {
    const lines = page.text.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(
        /^(.+?)\s+(\d+(?:[.,]\d+)?)\s+(?:RD\$?\s*)?([\d.,]+)\s*(?:RD\$?)?\s+(?:RD\$?\s*)?([\d.,]+)\s*(?:RD\$?)?\s*$/i,
      );
      if (
        !match ||
        /codigo|descripcion|sub-?\s*total|itbis|total/i.test(line)
      ) {
        continue;
      }
      const quantity = parseLocaleNumber(match[2]);
      const price = parseLocaleNumber(match[3]);
      const sourceTotal = parseLocaleNumber(match[4]);
      const calculation = calculateLineTotal({
        quantity,
        unitPrice: price,
        priceBasis: "unit",
      });
      const location = `Página ${page.pageNumber}, línea ${index + 1}`;
      mappedLocations.add(location);
      items.push({
        sourceSheet: "",
        sourceRange: location,
        description: match[1].trim(),
        itemCode: "",
        category: "repair_maintenance",
        location: "",
        quantity,
        unitOfMeasure: "",
        meters: null,
        openingWidthCm: null,
        openingHeightCm: null,
        finishedWidthCm: null,
        finishedHeightCm: null,
        areaSqm: null,
        priceBasis: "unit",
        unitPrice: price,
        pricePerSqm: null,
        flatFee: null,
        sourceLineTotal: sourceTotal,
        calculatedLineTotal: calculation.total,
        currency: normalizeCurrency(line),
        notes: "",
        valueStates: calculation.valueStates,
        sourceValues: {
          description: match[1],
          quantity: match[2],
          unitPrice: match[3],
          sourceLineTotal: match[4],
        },
      });
    }
  }
  return items;
}

function financialRows(
  extraction: ImportExtraction,
  sources: SourceText[],
  mappedLocations: Set<string>,
) {
  const charges: NormalizedCharge[] = [];
  let sourceSubtotal: number | null = null;
  let sourceTaxRate: number | null = null;
  let sourceTaxAmount: number | null = null;
  let sourceTotal: number | null = null;
  const sourceValues: Record<string, string> = {};

  for (const source of sources) {
    const normalized = compactLabel(source.text);
    const cells =
      source.sheet && source.cell
        ? (extraction.sheets
            .find((sheet) => sheet.name === source.sheet)
            ?.cells.filter((cell) => cell.row === source.cell?.row)
            .sort((a, b) => a.column - b.column) ?? [])
        : [];
    const following = source.cell
      ? cells
          .filter((cell) => cell.column > source.cell!.column)
          .map(cellText)
          .join(" ")
      : source.text;
    const amountCandidates = [
      ...following.matchAll(/(?:RD|US)?\$?\s*([\d,.]+(?:\.\d{2})?)/gi),
    ]
      .map((match) => parseLocaleNumber(match[1]))
      .filter((value): value is number => value !== null);
    const amount = amountCandidates.at(-1) ?? null;
    if (/\bsub-?\s*total\b/.test(normalized) && sourceSubtotal === null) {
      sourceSubtotal = amount;
      sourceValues.sourceSubtotal = source.text;
      mappedLocations.add(source.location);
    } else if (/\bitbis\b|\bimpuesto\b/.test(normalized)) {
      const rate = source.text.match(/(\d+(?:[.,]\d+)?)\s*%/);
      sourceTaxRate = rate ? (parseLocaleNumber(rate[1]) ?? 0) / 100 : null;
      sourceTaxAmount = amount;
      sourceValues.sourceTaxAmount = source.text;
      mappedLocations.add(source.location);
      charges.push({
        type: "tax",
        label: "ITBIS",
        sourceAmount: amount,
        calculatedAmount: null,
        rate: sourceTaxRate,
        currency: normalizeCurrency(source.text),
        valueState: valueStateOf(amount),
        sourceLocation: source.location,
      });
    } else if (
      /\btotal\s*(?:\(rd\$\))?\b/.test(normalized) &&
      !/\bsub/.test(normalized)
    ) {
      sourceTotal = amount;
      sourceValues.sourceTotal = source.text;
      mappedLocations.add(source.location);
    } else {
      const type = /\binstalacion\b/.test(normalized)
        ? "installation"
        : /\breparacion\b/.test(normalized)
          ? "repair"
          : /\bmantenimiento\b/.test(normalized)
            ? "maintenance"
            : null;
      if (type && amount !== null) {
        charges.push({
          type,
          label: source.text,
          sourceAmount: amount,
          calculatedAmount: null,
          rate: null,
          currency: normalizeCurrency(source.text),
          valueState: valueStateOf(amount),
          sourceLocation: source.location,
        });
        mappedLocations.add(source.location);
      }
    }
  }
  return {
    charges,
    sourceSubtotal,
    sourceTaxRate,
    sourceTaxAmount,
    sourceTotal,
    sourceValues,
  };
}

function extractTerms(sources: SourceText[], mappedLocations: Set<string>) {
  const terms = {
    quotationValidity: "",
    paymentConditions: "",
    warranty: "",
    returnPolicy: "",
    installationObservations: "",
    maintenanceDisclaimer: "",
    unforeseenPartsDisclaimer: "",
    additionalCostNotice: "",
    originalSpanishText: "",
  };
  const collected: string[] = [];
  for (const source of sources) {
    const text = source.text.trim();
    const normalized = compactLabel(text);
    let field: keyof Omit<typeof terms, "originalSpanishText"> | null = null;
    if (/cotizacion valida|validez/.test(normalized))
      field = "quotationValidity";
    else if (/condiciones de pago|con la orden|pago/.test(normalized)) {
      field = "paymentConditions";
    } else if (/garantia/.test(normalized)) field = "warranty";
    else if (/no aceptamos devoluciones|devolucion/.test(normalized)) {
      field = "returnPolicy";
    } else if (/gastos de instalacion no|observacion/.test(normalized)) {
      field = "installationObservations";
    } else if (/mantenimiento|danos visibles/.test(normalized)) {
      field = "maintenanceDisclaimer";
    } else if (
      /piezas danadas|piezas adicionales|no contempla las piezas/.test(
        normalized,
      )
    ) {
      field = "unforeseenPartsDisclaimer";
    } else if (
      /costos? adicional|gastos? .* no previstos|factura final/.test(normalized)
    ) {
      field = "additionalCostNotice";
    }
    if (!field) continue;
    terms[field] = terms[field] ? `${terms[field]}\n${text}` : text;
    collected.push(text);
    mappedLocations.add(source.location);
  }
  terms.originalSpanishText = collected.join("\n");
  return terms;
}

function extractPayments(
  extraction: ImportExtraction,
  sources: SourceText[],
  currency: string,
  mappedLocations: Set<string>,
): NormalizedImportPreview["payments"] {
  const payments: NormalizedImportPreview["payments"] = [];
  const seen = new Set<string>();
  const eventPattern =
    /\b(?:anticipo|abono|cuota\s*\d*|pago\s+(?:recibido|parcial|final)|saldo\s+pagado|reembolso|ajuste\s+de\s+pago)\b/i;

  for (const source of sources) {
    const normalized = compactLabel(source.text);
    if (!eventPattern.test(normalized) || seen.has(source.location)) continue;
    const rowCells =
      source.sheet && source.cell
        ? (extraction.sheets
            .find((sheet) => sheet.name === source.sheet)
            ?.cells.filter((cell) => cell.row === source.cell?.row)
            .sort((a, b) => a.column - b.column) ?? [])
        : [];
    const followingCells = source.cell
      ? rowCells.filter((cell) => cell.column > source.cell!.column)
      : [];
    const numericCell = followingCells.find(
      (cell) =>
        cellNumber(cell) !== null &&
        !/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(cellText(cell)),
    );
    const currencyAmounts = [
      ...source.text.matchAll(/(?:RD|US)?\$\s*([\d.,]+(?:\.\d{2})?)/gi),
    ]
      .map((match) => parseLocaleNumber(match[1]))
      .filter((value): value is number => value !== null);
    const amount = numericCell
      ? cellNumber(numericCell)
      : (currencyAmounts.at(-1) ?? null);
    if (amount === null) continue;

    const rowText = rowCells.length
      ? rowCells.map(cellText).filter(Boolean).join(" | ")
      : source.text;
    const parsedDate = parseSourceDate(rowText);
    const method =
      rowText.match(
        /\b(?:transferencia|efectivo|cheque|tarjeta|dep[oó]sito|wire|cash|check)\b/i,
      )?.[0] ?? "";
    const type = /\breembolso\b/i.test(normalized)
      ? ("refund" as const)
      : /\banticipo\b/i.test(normalized)
        ? ("advance" as const)
        : /\b(?:abono|cuota|pago parcial)\b/i.test(normalized)
          ? ("partial" as const)
          : /\b(?:pago final|saldo pagado)\b/i.test(normalized)
            ? ("final" as const)
            : ("adjustment" as const);
    const status = /\b(?:recibido|pagado|aplicado|completado)\b/i.test(
      normalized,
    )
      ? ("received" as const)
      : /\bpendiente\b/i.test(normalized)
        ? ("pending" as const)
        : ("unknown" as const);
    const installmentReference =
      rowText.match(/\bcuota\s*(?:no\.?|núm(?:ero)?\.?|#)?\s*(\d+)\b/i)?.[1] ??
      "";

    payments.push({
      type,
      amount,
      currency,
      paymentDate: parsedDate.iso,
      method,
      status,
      label: cellText(source.cell) || source.text,
      installmentReference,
      notes: "",
      sourceLocation: source.location,
      sourceValues: Object.fromEntries(
        rowCells.length
          ? rowCells.map((cell) => [cell.address, cellText(cell)])
          : [["text", source.text]],
      ),
    });
    seen.add(source.location);
    for (const cell of rowCells) {
      mappedLocations.add(`${source.sheet}!${cell.address}`);
    }
    mappedLocations.add(source.location);
  }
  return payments;
}

function componentType(value: string) {
  return (
    componentPatterns.find(({ pattern }) => pattern.test(value))?.type ??
    "other"
  );
}

function extractManufacturing(
  extraction: ImportExtraction,
  filename: string,
  mappedLocations: Set<string>,
): NormalizedImportPreview["manufacturing"] {
  const productionFile = /despiece|producci[oó]n|hoja de produccion/i.test(
    filename,
  );
  return extraction.sheets
    .filter(
      (sheet) =>
        productionFile ||
        /despiece|producci[oó]n|material|bom/i.test(sheet.name),
    )
    .map((sheet) => {
      const rows = cellRows(sheet);
      const components: NormalizedMaterialComponent[] = [];
      const formulaSummary: Record<string, string> = {};
      let broken = false;
      for (const cell of sheet.cells) {
        if (!cell.formula) continue;
        formulaSummary[cell.address] = cell.formula;
        if (/#REF!|#VALUE!|#DIV\/0!|#NAME\?/i.test(cell.formula)) broken = true;
      }
      for (const row of rows.values()) {
        const texts = row.map(cellText).filter(Boolean);
        const name = texts.find((value) => componentType(value) !== "other");
        if (!name) continue;
        const numbers = row
          .map((cell) => cellNumber(cell))
          .filter((value): value is number => value !== null);
        const formulaCell = row.find((cell) => cell.formula);
        const resultCell = formulaCell
          ? formulaCell
          : row.findLast((cell) => cellNumber(cell) !== null);
        const formula = formulaCell?.formula ?? "";
        const formulaBroken =
          /#REF!|#VALUE!|#DIV\/0!|#NAME\?/i.test(formula) ||
          resultCell?.cellType === "e";
        if (formulaBroken) broken = true;
        components.push({
          name,
          componentType: componentType(name),
          quantity: numbers[0] ?? null,
          unitCost: numbers.length > 1 ? numbers.at(-2)! : null,
          totalCost: numbers.at(-1) ?? null,
          sourceFormula: formula,
          formulaResult: resultCell ? cellText(resultCell) : "",
          formulaStatus: formulaBroken
            ? "broken"
            : formula
              ? "valid"
              : "not_calculated",
          sourceSheet: sheet.name,
          sourceRange: rangeForRow(sheet.name, row),
          sourceValues: Object.fromEntries(
            row.map((cell) => [cell.address, cellText(cell)]),
          ),
        });
        for (const cell of row) {
          mappedLocations.add(`${sheet.name}!${cell.address}`);
        }
      }
      return {
        name: sheet.name,
        worksheetType: /despiece/i.test(sheet.name)
          ? ("material_breakdown" as const)
          : ("production" as const),
        sourceSheet: sheet.name,
        sourceRange: sheet.range,
        calculationStatus: broken
          ? ("broken" as const)
          : Object.keys(formulaSummary).length > 0
            ? ("valid" as const)
            : ("not_calculated" as const),
        components,
        formulaSummary,
      };
    });
}

function templateType(
  filename: string,
  extraction: ImportExtraction,
  allText: string,
): NormalizedImportPreview["templateType"] {
  const names = extraction.sheets.map((sheet) => sheet.name).join(" ");
  if (/registro|numeros de cotizaciones/i.test(`${filename} ${names}`)) {
    return "register";
  }
  if (
    /despiece|producci[oó]n|hoja de produccion/i.test(`${filename} ${names}`)
  ) {
    if (!/instalaci[oó]n|cotizaci[oó]n/i.test(allText)) return "production";
  }
  if (/reparaci[oó]n|mantenimiento/i.test(`${names} ${allText}`)) {
    return "repair_maintenance";
  }
  if (/instalaci[oó]n|shutter|perma|screen|toldo/i.test(allText)) {
    return "installation";
  }
  return "unknown";
}

function quotationTypeFrom(
  template: NormalizedImportPreview["templateType"],
  allText: string,
): NormalizedImportPreview["quotation"]["quotationType"] {
  const repair = /reparaci[oó]n/.test(allText);
  const maintenance = /mantenimiento/.test(allText);
  const install = /instalaci[oó]n/.test(allText);
  if ([repair, maintenance, install].filter(Boolean).length > 1) return "mixed";
  if (maintenance) return "maintenance";
  if (repair) return "repair";
  if (install || template === "installation") return "installation";
  return "other";
}

export function mapHidacaExtraction(
  filename: string,
  extraction: ImportExtraction,
): NormalizedImportPreview {
  const sources = sourceTexts(extraction);
  const allText = sources.map((source) => source.text).join("\n");
  const normalizedAllText = compactLabel(allText);
  const mappedLocations = new Set<string>();
  const sourceValues: CanonicalSourceValue[] = [];
  const issues: ImportIssueDraft[] = extraction.warnings.map((warning) => ({
    type: "security_limit",
    severity: "warning",
    title: "El archivo se procesó parcialmente.",
    detail: warning,
  }));
  const company = {
    legalName: "",
    rnc: "",
    address: "",
    phone: "",
    email: "",
    salesRepresentative: "",
    department: "",
  };
  const business = {
    name: "",
    customerType: "organization" as const,
    rnc: "",
    email: "",
    phone: "",
    mobilePhone: "",
    address: "",
  };
  const contact = { name: "", email: "", phone: "", mobilePhone: "" };
  const project = {
    name: "",
    description: "",
    serviceCategory: "",
    address: "",
  };
  let quotationNumber = "";
  let sourceDateRaw = "";
  let quotationDate: string | null = null;
  let seenCustomer = false;

  const assign = (
    labeled: LabeledValue,
    entity: string,
    field: string,
    setter: (value: string) => void,
    transformation = "trim",
  ) => {
    const value = labeled.value.trim();
    const target = normalizeSourceValue(value, {
      entity,
      field,
      sourceLabel: labeled.label,
      sourceSheet: labeled.sheet,
      sourcePage: labeled.page,
      sourceCell: labeled.cell?.address,
      confidence: "high",
      transformation,
    });
    sourceValues.push(target);
    mappedLocations.add(labeled.location);
    setter(target.normalizedValue ?? value);
  };

  for (const source of sources) {
    for (const labeled of labeledValues(source)) {
      const label = compactLabel(labeled.label);
      if (
        label === "cliente" ||
        label === "business name" ||
        label === "nombre del cliente"
      ) {
        seenCustomer = true;
        assign(labeled, "business", "name", (value) => {
          if (!business.name) business.name = labeled.value.trim() || value;
        });
      } else if (label === "rnc") {
        const isCompanyHeader =
          !seenCustomer &&
          ((labeled.cell?.row ?? 99) < 8 || labeled.page === 1);
        assign(
          labeled,
          isCompanyHeader ? "company_settings" : "business",
          "rnc",
          (value) => {
            if (isCompanyHeader) company.rnc ||= normalizeRnc(value);
            else business.rnc ||= normalizeRnc(value);
          },
          "digits_only",
        );
      } else if (label.startsWith("direccion de proyecto")) {
        assign(labeled, "address", "line1", (value) => {
          project.address ||= labeled.value.trim() || value;
        });
      } else if (label === "direccion") {
        assign(labeled, "address", "line1", (value) => {
          business.address ||= labeled.value.trim() || value;
        });
      } else if (label.startsWith("telefono")) {
        assign(labeled, "business", "phone", (value) => {
          business.phone ||= labeled.value.trim() || value;
          contact.phone ||= labeled.value.trim() || value;
        });
      } else if (label === "celular") {
        assign(labeled, "business", "mobile_phone", (value) => {
          business.mobilePhone ||= labeled.value.trim() || value;
          contact.mobilePhone ||= labeled.value.trim() || value;
        });
      } else if (label === "correo" || label === "email") {
        assign(labeled, "business", "email", (value) => {
          business.email ||= value;
          contact.email ||= value;
        });
      } else if (label === "contacto") {
        assign(labeled, "contact", "name", (value) => {
          contact.name ||= labeled.value.trim() || value;
        });
      } else if (label === "proyecto") {
        assign(labeled, "project", "name", (value) => {
          project.name ||= labeled.value.trim() || value;
        });
      } else if (label === "cotizacion") {
        assign(labeled, "quotation", "quotation_number", (value) => {
          quotationNumber ||= labeled.value.trim() || value;
        });
      } else if (label === "fecha") {
        assign(
          labeled,
          "quotation_revision",
          "quotation_date",
          () => {
            sourceDateRaw ||= labeled.value.trim();
            const parsed = parseSourceDate(labeled.value);
            quotationDate ||= parsed.iso;
            if (parsed.suspicious) {
              issues.push({
                type: "suspicious_date",
                severity: "warning",
                title: "La fecha requiere revisión.",
                detail: labeled.value,
                sourceLocation: labeled.location,
              });
            }
          },
          "date_dd_mm_yyyy",
        );
      }
    }
  }

  const lineItems = extraction.sheets.flatMap((sheet) =>
    extractSpreadsheetLineItems(sheet, mappedLocations),
  );
  if (lineItems.length === 0 && extraction.pages.length > 0) {
    lineItems.push(...extractPdfLineItems(extraction, mappedLocations));
  }

  const finances = financialRows(extraction, sources, mappedLocations);
  const currency = /\b(?:US\$|USD|d[oó]lar)\b/i.test(allText) ? "USD" : "DOP";
  for (const item of lineItems) item.currency = currency;
  const summary = calculateFinancialSummary({
    lines: lineItems.map((item) => ({
      quantity: item.quantity,
      areaSqm: item.areaSqm,
      priceBasis: item.priceBasis,
      unitPrice: item.unitPrice,
      pricePerSqm: item.pricePerSqm,
      flatFee: item.flatFee,
      sourceLineTotal: item.sourceLineTotal,
    })),
    charges: finances.charges.filter((charge) => charge.type !== "tax"),
    taxRate: finances.sourceTaxRate,
    sourceSubtotal: finances.sourceSubtotal,
    sourceTaxAmount: finances.sourceTaxAmount,
    sourceTotal: finances.sourceTotal,
    currency,
  });
  issues.push(...summary.issues);
  const terms = extractTerms(sources, mappedLocations);
  const payments = extractPayments(
    extraction,
    sources,
    currency,
    mappedLocations,
  );
  const receivedAmount = payments
    .filter((payment) => ["received", "cleared"].includes(payment.status))
    .reduce((total, payment) => total + (payment.amount ?? 0), 0);
  const paymentStatus =
    finances.sourceTotal === null
      ? ("unknown" as const)
      : receivedAmount <= 0
        ? ("unpaid" as const)
        : receivedAmount + 0.01 >= finances.sourceTotal
          ? ("paid" as const)
          : ("partial" as const);
  const manufacturing = extractManufacturing(
    extraction,
    filename,
    mappedLocations,
  );
  for (const worksheet of manufacturing) {
    if (worksheet.calculationStatus === "broken") {
      issues.push({
        type: "formula_error",
        severity: "error",
        title: `La hoja ${worksheet.name} contiene fórmulas rotas.`,
        detail: "Los valores y fórmulas se conservaron para revisión.",
        sourceLocation: worksheet.sourceSheet,
      });
    }
  }

  for (const source of sources) {
    if (mappedLocations.has(source.location)) continue;
    if (source.cell) {
      sourceValues.push(
        normalizeSourceValue(source.cell.rawValue, {
          sourceSheet: source.sheet,
          sourceCell: source.cell.address,
          sourceFormula: source.cell.formula,
          confidence: "manual_review",
        }),
      );
    } else {
      sourceValues.push(
        normalizeSourceValue(source.text, {
          sourcePage: source.page,
          sourceCell: source.location,
          confidence: "manual_review",
        }),
      );
    }
  }

  const unmappedCount = sourceValues.filter(
    (value) => value.mappingStatus === "unmapped",
  ).length;
  if (unmappedCount > 0) {
    issues.push({
      type: "unmapped_field",
      severity: "warning",
      title: `${unmappedCount} valores requieren confirmar su mapeo.`,
      detail: "Los valores se conservaron sin descartarlos.",
    });
  }
  if (!business.name) {
    issues.push({
      type: "missing_required",
      severity: "blocking",
      title: "Falta el nombre del cliente.",
    });
  }
  if (!quotationNumber) {
    const fromFilename = quotationIdentity(filename);
    if (fromFilename.year) {
      quotationNumber =
        fromFilename.raw.match(/[A-Z]{0,3}\d+-\d{4}(?:-\d+)?/i)?.[0] ?? "";
    }
  }
  if (!quotationNumber) {
    issues.push({
      type: "missing_required",
      severity: "blocking",
      title: "Falta el número de cotización.",
    });
  }
  if (extraction.hasMacros) {
    issues.push({
      type: "unsupported_calculation",
      severity: "info",
      title: "El libro contiene macros.",
      detail:
        "Las macros se conservaron en el archivo original y no se ejecutaron.",
    });
  }

  const identity = quotationIdentity(quotationNumber || filename);
  const detectedTemplate = templateType(
    filename,
    extraction,
    normalizedAllText,
  );
  const quoteType = quotationTypeFrom(detectedTemplate, normalizedAllText);
  business.customerType = inferCustomerType(
    business.name,
    business.rnc,
  ) as "organization";
  project.serviceCategory = /shutter/i.test(allText)
    ? "Shutters"
    : /perma/i.test(allText)
      ? "Permas"
      : /cortina|screen|blackout/i.test(allText)
        ? "Cortinas"
        : "";

  return {
    templateType: detectedTemplate,
    company,
    business,
    contact,
    project: {
      ...project,
      description: project.name,
    },
    quotation: {
      quotationNumber: quotationNumber || identity.baseNumber,
      baseNumber: identity.baseNumber,
      quotationYear: identity.year,
      title: project.name || `${identity.baseNumber} - ${business.name}`.trim(),
      quotationType: quoteType,
      serviceCategory: project.serviceCategory,
      currency,
    },
    revision: {
      revisionNumber: identity.revisionHint ?? 1,
      revisionLabel: identity.revisionHint
        ? `Revisión ${identity.revisionHint}`
        : "Original",
      alternativeLabel: /manual/i.test(filename)
        ? "Manual"
        : /motorizad|motor/i.test(filename)
          ? "Motorizada"
          : "",
      scopeLabel: project.name,
      quotationDate,
      sourceDateRaw,
      identityKey: [
        identity.familyKey,
        identity.revisionHint ?? 1,
        /manual/i.test(filename)
          ? "manual"
          : /motorizad|motor/i.test(filename)
            ? "motorized"
            : "base",
        compactLabel(project.name),
      ].join(":"),
    },
    lineItems,
    financials: {
      currency,
      sourceSubtotal: finances.sourceSubtotal,
      calculatedSubtotal: summary.calculatedSubtotal,
      discountRate: null,
      discountAmount: null,
      sourceTaxRate: finances.sourceTaxRate,
      sourceTaxAmount: finances.sourceTaxAmount,
      calculatedTaxAmount: summary.calculatedTaxAmount,
      sourceTotal: finances.sourceTotal,
      calculatedTotal: summary.calculatedTotal,
      discrepancyAmount: summary.discrepancyAmount,
      paymentStatus,
      valueStates: {
        sourceSubtotal: valueStateOf(finances.sourceSubtotal),
        sourceTaxRate: valueStateOf(finances.sourceTaxRate),
        sourceTaxAmount: valueStateOf(finances.sourceTaxAmount),
        sourceTotal: valueStateOf(finances.sourceTotal),
      },
      sourceValues: finances.sourceValues,
    },
    charges: finances.charges,
    payments,
    terms,
    manufacturing,
    sourceValues,
    issues,
  };
}
