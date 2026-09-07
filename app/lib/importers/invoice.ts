import {
  type ImportExtraction,
  type InvoiceDocumentKind,
  type InvoiceMatchDecision,
  type InvoiceStagingRow,
  type PaymentAllocationDraft,
} from "./types";

type InvoiceIssue = {
  type: string;
  severity: "info" | "warning" | "error" | "blocking";
  sourceLocation: string;
  title: string;
};

export type InvoiceExtractionAnalysis = {
  documentKind: InvoiceDocumentKind;
  rows: InvoiceStagingRow[];
  decisions: InvoiceMatchDecision[];
  allocations: PaymentAllocationDraft[];
  issues: InvoiceIssue[];
};

const aliases: Record<string, string[]> = {
  source_month: ["mes"],
  invoice_number: ["factura", "no factura", "numero factura", "n factura"],
  issue_date: ["fecha", "fecha factura", "fecha emision"],
  business_name: ["nombre", "cliente", "empresa", "razon social"],
  rnc: ["rnc", "rnc cedula", "cedula"],
  ncf: ["ncf", "comprobante fiscal"],
  subtotal_amount: ["subtotal", "sub total"],
  tax_amount: ["itbis", "impuesto"],
  total_amount: ["total", "monto factura", "importe"],
  payment_amount: ["monto pagado", "monto recibido", "valor pagado", "importe"],
  payment_date: ["fecha pago", "fecha transferencia", "fecha recibo"],
  receipt_number: ["recibo", "numero recibo", "no recibo"],
  transaction_reference: [
    "referencia",
    "referencia bancaria",
    "numero transaccion",
  ],
  paid_amount_snapshot: ["avance", "abono acumulado"],
  balance_amount_snapshot: ["pendiente", "balance", "saldo"],
  status: ["estado", "estatus", "status", "pago", "pagado"],
  due_date: ["vencimiento", "fecha vencimiento"],
  payment_terms_raw: ["condiciones de pago", "condicion de pago"],
  purchase_order_number: ["orden de compra", "orden compra"],
  sales_representative: ["representante", "vendedor"],
  quotation_number: ["cotizacion", "cotizacion relacionada"],
  closing_raw: ["fecha cierre", "cierre"],
  replacement_invoice_number: [
    "sustituye factura",
    "reemplaza factura",
    "factura sustituida",
  ],
  affected_invoice_number: [
    "factura afectada",
    "aplica factura",
    "factura relacionada",
  ],
};

export function classifyInvoiceDocument(
  filename: string,
  extraction: ImportExtraction,
): InvoiceDocumentKind {
  const content = extractionText(extraction).toLowerCase();
  const name = normalizeLabel(filename);
  if (/\bnota\s+de\s+cr[eé]dito\b|\bnc[f-]?\d+/i.test(content))
    return "credit_note";
  if (
    /\brecibo\b|\brecepci[oó]n\s+de\s+pago\b/i.test(content) &&
    !/\bfactura\b/i.test(content)
  )
    return "receipt";
  if (
    /\btransferencia\b|\bcomprobante\s+de\s+pago\b/i.test(content) &&
    !/\bfactura\b/i.test(content)
  )
    return "payment_evidence";
  if (hasRegisterShape(extraction)) return "invoice_register";
  if (/\bfactura\b|\bncf\b/i.test(content)) return "invoice";
  if (/nota.*credito/.test(name)) return "credit_note";
  if (/recibo|pago|transferencia/.test(name)) return "payment_evidence";
  if (/matriz|registro|relacion.*factura/.test(name)) return "invoice_register";
  if (/factura/.test(name)) return "invoice";
  return "other";
}

export function analyzeInvoiceExtraction(
  filename: string,
  documentId: string,
  extraction: ImportExtraction,
): InvoiceExtractionAnalysis {
  const documentKind = classifyInvoiceDocument(filename, extraction);
  const issues: InvoiceIssue[] = [];
  if (extraction.format === "pdf") {
    if (!extraction.pages.length) {
      issues.push({
        type: "ocr_required",
        severity: "blocking",
        sourceLocation: filename,
        title: "El PDF no produjo páginas legibles y requiere OCR.",
      });
    }
    for (const page of extraction.pages) {
      if (!page.text.trim()) {
        issues.push({
          type: "ocr_required",
          severity: "blocking",
          sourceLocation: `${filename}:página ${page.pageNumber}`,
          title: "La página requiere OCR antes de crear registros.",
        });
      }
    }
  }
  for (const sheet of extraction.sheets) {
    for (const cell of sheet.cells) {
      if (
        cell.formula &&
        /#(?:REF|VALUE|NAME|DIV\/0|N\/A|NUM|NULL)!?/i.test(
          cell.displayValue,
        )
      ) {
        issues.push({
          type: "formula_error",
          severity: "blocking",
          sourceLocation: `${filename}:${sheet.name}!${cell.address}`,
          title: "La fórmula fuente contiene un error visible.",
        });
      }
    }
  }
  const filenameKind = classifyFilename(filename);
  if (
    filenameKind !== "other" &&
    documentKind !== "other" &&
    filenameKind !== documentKind
  ) {
    issues.push({
      type: "filename_content_mismatch",
      severity: "warning",
      sourceLocation: filename,
      title: "El nombre del archivo no coincide con su contenido.",
    });
  }
  if (extraction.partial) {
    issues.push({
      type: "parser_error",
      severity: "warning",
      sourceLocation: filename,
      title: "La extracción fue parcial.",
    });
  }
  if (documentKind === "other") {
    return {
      documentKind,
      rows: [],
      decisions: [],
      allocations: [],
      issues: [
        ...issues,
        {
          type: "unmapped_field",
          severity: "warning",
          sourceLocation: filename,
          title: "El documento no pudo clasificarse como evidencia de facturación.",
        },
      ],
    };
  }

  const rows =
    documentKind === "invoice_register"
      ? registerRows(extraction, documentId)
      : [documentRow(extraction, documentId, documentKind)];
  const usableRows = rows.filter((row) =>
    Object.values(row.normalizedValues).some(
      (value) => value !== "" && value !== null,
    ),
  );
  for (const row of usableRows) {
    if (
      /^(?:n\/?a|pendiente|sin numero|0|-)?$/i.test(
        String(row.rawValues.invoice_number ?? "").trim(),
      ) &&
      ["invoice", "credit_note"].includes(row.documentKind)
    ) {
      issues.push({
        type: "incomplete_record",
        severity: "blocking",
        sourceLocation: sourceLocation(row) || filename,
        title: "El documento contiene un número provisional o vacío.",
      });
    }
  }
  const decisions = usableRows.map((row) =>
    initialDecision(row, documentKind),
  );
  if (
    documentKind === "invoice_register" &&
    usableRows.some(
      (row) =>
        numeric(row.normalizedValues.paid_amount_snapshot) !== null ||
        numeric(row.normalizedValues.balance_amount_snapshot) !== null,
    )
  ) {
    issues.push({
      type: "payment_evidence_missing",
      severity: "info",
      sourceLocation: filename,
      title:
        "Avance y Pendiente se conservaron como saldos agregados; no se crearon pagos.",
    });
  }
  usableRows.forEach((row, index) => {
    const closing = String(row.normalizedValues.closing_raw ?? "").toLowerCase();
    if (closing.includes("anulad")) {
      row.normalizedValues.status = "cancelled";
      decisions[index] = {
        decision: "manual_review",
        targetEntityType: decisions[index]?.targetEntityType ?? "invoice",
        targetEntityId: null,
        confidence: "manual",
        rule: "cancelled_replacement_requires_review",
        evidence: [row.identityFingerprint],
      };
      issues.push({
        type: "cancelled_replacement_ambiguity",
        severity: "warning",
        sourceLocation: sourceLocation(row),
        title: "La factura figura anulada; debe revisarse su reemplazo.",
      });
    }
    if (numeric(row.normalizedValues.balance_amount_snapshot) !== null &&
        Number(row.normalizedValues.balance_amount_snapshot) < -0.005) {
      issues.push({
        type: "negative_balance",
        severity: "warning",
        sourceLocation: sourceLocation(row),
        title: "El balance fuente es negativo.",
      });
    }
    const subtotal = numeric(row.normalizedValues.subtotal_amount);
    const tax = numeric(row.normalizedValues.tax_amount);
    const total = numeric(row.normalizedValues.total_amount);
    if (
      subtotal !== null &&
      tax !== null &&
      total !== null &&
      Math.abs(subtotal + tax - total) > 0.02
    ) {
      issues.push({
        type: "balance_reconciliation",
        severity: "error",
        sourceLocation: sourceLocation(row),
        title: "Subtotal, impuesto y total no concilian.",
      });
      decisions[index] = {
        decision: "manual_review",
        targetEntityType: decisions[index]?.targetEntityType ?? "invoice",
        targetEntityId: null,
        confidence: "manual",
        rule: "source_totals_do_not_reconcile",
        evidence: [row.identityFingerprint],
      };
    }
  });
  return {
    documentKind,
    rows: usableRows,
    decisions,
    allocations: [],
    issues,
  };
}

export function decideInvoiceMatch(
  row: InvoiceStagingRow,
  candidates: Array<{
    id: string;
    businessId: string;
    invoiceNumberNormalized: string;
    issueYear: number | null;
    ncfNormalized: string;
    versionNumber: number;
    status: string;
  }>,
): InvoiceMatchDecision {
  const values = row.normalizedValues;
  if (row.documentKind === "receipt" || row.documentKind === "payment_evidence")
    return initialDecision(row, row.documentKind);
  const businessId = String(values.business_id ?? "");
  const number = normalizeIdentifier(values.invoice_number);
  const ncf = normalizeIdentifier(values.ncf);
  const year = yearOf(values.issue_date);
  const exact = candidates.filter(
    (candidate) =>
      candidate.businessId === businessId &&
      candidate.invoiceNumberNormalized === number &&
      candidate.issueYear === year &&
      candidate.ncfNormalized === ncf,
  );
  const related = candidates.filter(
    (candidate) =>
      candidate.businessId === businessId &&
      candidate.invoiceNumberNormalized === number &&
      candidate.issueYear === year,
  );
  if (String(values.status) === "cancelled" && related.length) {
    values.version_number =
      Math.max(...related.map((candidate) => candidate.versionNumber)) + 1;
    return {
      decision: "cancelled_replaced",
      targetEntityType: "invoice",
      targetEntityId: related.length === 1 ? related[0].id : null,
      confidence: "manual",
      rule: "cancellation_never_auto_updates_existing_invoice",
      evidence: related.map((item) => item.id),
    };
  }
  if (exact.length === 1) {
    return {
      decision: "link",
      targetEntityType: "invoice",
      targetEntityId: exact[0].id,
      confidence: "exact_unique",
      rule: "business+invoice_number+issue_year+ncf",
      evidence: [row.identityFingerprint],
    };
  }
  if (exact.length > 1) {
    return {
      decision: "manual_review",
      targetEntityType: "invoice",
      targetEntityId: null,
      confidence: "manual",
      rule: "non_unique_exact_identity",
      evidence: exact.map((item) => item.id),
    };
  }
  if (related.length) {
    values.version_number =
      Math.max(...related.map((candidate) => candidate.versionNumber)) + 1;
    return {
      decision: "new_version",
      targetEntityType: "invoice",
      targetEntityId: related.length === 1 ? related[0].id : null,
      confidence: "candidate",
      rule: "same_business_number_year_different_ncf_or_version",
      evidence: related.map((item) => item.id),
    };
  }
  return initialDecision(row, row.documentKind);
}

export function allocationDraftFromEvidence(input: {
  paymentStagingId: string;
  invoiceStagingId: string;
  amount: number | null;
  currency: string;
  allocationDate: string | null;
  evidenceDocumentId: string;
}): PaymentAllocationDraft {
  const ready =
    Boolean(input.evidenceDocumentId) &&
    Boolean(input.invoiceStagingId) &&
    input.amount !== null &&
    input.amount > 0;
  return {
    paymentStagingId: input.paymentStagingId,
    invoiceStagingId: input.invoiceStagingId,
    amount: input.amount ?? 0,
    currency: input.currency || "DOP",
    allocationDate: input.allocationDate,
    evidenceDocumentId: input.evidenceDocumentId,
    decision: ready ? "ready" : "blocked",
  };
}

export function refreshInvoiceIdentityFingerprint(row: InvoiceStagingRow) {
  row.identityFingerprint = identityFingerprint(
    row.documentKind,
    row.normalizedValues,
  );
  return row.identityFingerprint;
}

export function invoiceImportEntityId(
  entityType: "invoice" | "payment" | "credit_note",
  fingerprint: string,
) {
  const prefix = entityType === "credit_note" ? "credit" : entityType;
  return `${prefix}-${fingerprint.replace(/[^a-z0-9-]/gi, "").slice(0, 48)}`;
}

function registerRows(extraction: ImportExtraction, documentId: string) {
  const result: InvoiceStagingRow[] = [];
  for (const sheet of extraction.sheets) {
    const byRow = new Map<number, typeof sheet.cells>();
    for (const cell of sheet.cells) {
      const group = byRow.get(cell.row) ?? [];
      group.push(cell);
      byRow.set(cell.row, group);
    }
    const orderedRows = [...byRow.entries()].sort(([a], [b]) => a - b);
    const header = orderedRows.find(([, cells]) =>
      cells.some((cell) => resolveHeader(cell.displayValue) === "invoice_number"),
    );
    if (!header) continue;
    const headerMap = new Map<number, string>();
    for (const cell of header[1]) {
      const field = resolveHeader(cell.displayValue);
      if (field) headerMap.set(cell.column, field);
    }
    for (const [rowNumber, cells] of orderedRows) {
      if (rowNumber <= header[0]) continue;
      const rawValues: Record<string, unknown> = {};
      const normalizedValues: Record<string, unknown> = {};
      const references: InvoiceStagingRow["sourceReferences"] = [];
      for (const cell of cells) {
        const field = headerMap.get(cell.column);
        if (!field) continue;
        rawValues[field] = cell.displayValue;
        normalizedValues[field] = normalizeField(field, cell.displayValue);
        references.push({
          documentId,
          field,
          sheet: sheet.name,
          row: rowNumber,
          cell: cell.address,
          rawValue: String(cell.rawValue ?? ""),
          displayValue: cell.displayValue,
          formula: cell.formula || undefined,
        });
      }
      if (rawValues.issue_date && rawValues.source_month) {
        normalizedValues.issue_date = normalizeDateWithMonth(
          String(rawValues.issue_date),
          String(rawValues.source_month),
        );
      }
      if (!String(normalizedValues.invoice_number ?? "").trim()) continue;
      normalizedValues.source_authority = "matrix";
      normalizedValues.source_row_number = rowNumber;
      result.push(makeRow("invoice_register", rawValues, normalizedValues, references));
    }
  }
  return result;
}

function documentRow(
  extraction: ImportExtraction,
  documentId: string,
  documentKind: InvoiceDocumentKind,
) {
  const rawValues: Record<string, unknown> = {};
  const normalizedValues: Record<string, unknown> = {};
  const references: InvoiceStagingRow["sourceReferences"] = [];
  const sources = [
    ...extraction.pages.map((page) => ({
      text: page.text,
      page: page.pageNumber,
      sheet: undefined,
    })),
    ...extraction.sheets.map((sheet) => ({
      text: sheetText(sheet.cells),
      page: undefined,
      sheet: sheet.name,
    })),
  ];
  for (const source of sources) {
    for (const [field, fieldAliases] of Object.entries(aliases)) {
      if (normalizedValues[field] !== undefined) continue;
      const match = matchLabelValue(field, source.text, fieldAliases);
      if (!match) continue;
      rawValues[field] = match;
      normalizedValues[field] = normalizeField(field, match);
      references.push({
        documentId,
        field,
        page: source.page,
        sheet: source.sheet,
        rawValue: match,
        displayValue: match,
      });
    }
  }
  const lineItems = extractLineItems(extraction, documentId, references);
  if (lineItems.length) normalizedValues.line_items = lineItems;
  normalizedValues.source_authority =
    documentKind === "invoice" || documentKind === "credit_note"
      ? "issued_document"
      : "payment_evidence";
  return makeRow(documentKind, rawValues, normalizedValues, references);
}

function makeRow(
  documentKind: InvoiceDocumentKind,
  rawValues: Record<string, unknown>,
  normalizedValues: Record<string, unknown>,
  sourceReferences: InvoiceStagingRow["sourceReferences"],
): InvoiceStagingRow {
  return {
    identityFingerprint: identityFingerprint(documentKind, normalizedValues),
    documentKind,
    rawValues,
    normalizedValues,
    sourceReferences,
  };
}

function identityFingerprint(
  documentKind: InvoiceDocumentKind,
  values: Record<string, unknown>,
) {
  const business =
    values.business_id ||
    normalizeIdentifier(values.rnc) ||
    normalizeLabel(values.business_name);
  const identity =
    documentKind === "receipt" || documentKind === "payment_evidence"
      ? [
          business,
          normalizeIdentifier(values.transaction_reference),
          normalizeIdentifier(values.receipt_number),
          values.payment_date ?? "",
          numeric(values.payment_amount ?? values.total_amount),
        ]
      : [
          business,
          normalizeIdentifier(values.invoice_number),
          yearOf(values.issue_date),
          normalizeIdentifier(values.ncf),
          values.version_number ?? 1,
          values.status ?? "",
        ];
  const identityKind =
    documentKind === "invoice_register"
      ? "invoice"
      : documentKind === "receipt" || documentKind === "payment_evidence"
        ? "payment"
        : documentKind;
  return stableFingerprint(`${identityKind}|${identity.join("|")}`);
}

function initialDecision(
  row: InvoiceStagingRow,
  documentKind: InvoiceDocumentKind,
): InvoiceMatchDecision {
  const values = row.normalizedValues;
  if (documentKind === "receipt" || documentKind === "payment_evidence") {
    const paymentReady =
      Boolean(values.business_id || values.rnc) &&
      numeric(values.payment_amount ?? values.total_amount) !== null &&
      Boolean(values.transaction_reference || values.receipt_number);
    return {
      decision: paymentReady ? "create" : "manual_review",
      targetEntityType: "payment",
      targetEntityId: null,
      confidence: paymentReady ? "exact_unique" : "manual",
      rule: paymentReady
        ? "documented_payment_identifiers_complete"
        : "payment_evidence_incomplete",
      evidence: [row.identityFingerprint],
    };
  }
  if (documentKind === "invoice_register") {
    return {
      decision: "manual_review",
      targetEntityType: "invoice",
      targetEntityId: null,
      confidence: "candidate",
      rule: "matrix_is_operational_index",
      evidence: [row.identityFingerprint],
    };
  }
  const required =
    normalizeIdentifier(values.invoice_number) &&
    normalizeIdentifier(values.ncf) &&
    (values.business_id || values.rnc);
  return {
    decision: required ? "create" : "manual_review",
    targetEntityType:
      documentKind === "credit_note" ? "credit_note" : "invoice",
    targetEntityId: null,
    confidence: required ? "exact_unique" : "manual",
    rule: required
      ? "document_identifiers_complete"
      : "missing_unique_exact_identifier",
    evidence: [row.identityFingerprint],
  };
}

function hasRegisterShape(extraction: ImportExtraction) {
  return extraction.sheets.some((sheet) => {
    const labelsByRow = new Map<number, Set<string>>();
    for (const cell of sheet.cells) {
      const field = resolveHeader(cell.displayValue);
      if (!field) continue;
      const labels = labelsByRow.get(cell.row) ?? new Set<string>();
      labels.add(field);
      labelsByRow.set(cell.row, labels);
    }
    return [...labelsByRow.values()].some(
      (labels) =>
        labels.has("invoice_number") &&
        labels.has("business_name") &&
        labels.size >= 3,
    );
  });
}
function classifyFilename(filename: string): InvoiceDocumentKind {
  const name = normalizeLabel(filename);
  if (/nota.*credito/.test(name)) return "credit_note";
  if (/recibo/.test(name)) return "receipt";
  if (/pago|transferencia/.test(name)) return "payment_evidence";
  if (/matriz|registro|relacion.*factura/.test(name)) return "invoice_register";
  if (/factura/.test(name)) return "invoice";
  return "other";
}

function extractLineItems(
  extraction: ImportExtraction,
  documentId: string,
  references: InvoiceStagingRow["sourceReferences"],
) {
  const items: Array<Record<string, unknown>> = [];
  for (const sheet of extraction.sheets) {
    const byRow = new Map<number, typeof sheet.cells>();
    for (const cell of sheet.cells) {
      const group = byRow.get(cell.row) ?? [];
      group.push(cell);
      byRow.set(cell.row, group);
    }
    const ordered = [...byRow.entries()].sort(([a], [b]) => a - b);
    const header = ordered.find(([, cells]) =>
      cells.some((cell) => lineHeader(cell.displayValue) === "description"),
    );
    if (!header) continue;
    const columns = new Map<number, string>();
    for (const cell of header[1]) {
      const field = lineHeader(cell.displayValue);
      if (field) columns.set(cell.column, field);
    }
    for (const [rowNumber, cells] of ordered) {
      if (rowNumber <= header[0]) continue;
      const item: Record<string, unknown> = {};
      for (const cell of cells) {
        const field = columns.get(cell.column);
        if (!field) continue;
        item[field] = [
          "quantity", "width_cm", "height_cm", "area_sqm", "unit_price",
          "line_total", "tax_amount",
        ].includes(field)
          ? numeric(cell.displayValue)
          : cell.displayValue.trim();
        references.push({
          documentId,
          field: `line_items.${items.length}.${field}`,
          sheet: sheet.name,
          row: rowNumber,
          cell: cell.address,
          rawValue: String(cell.rawValue ?? ""),
          displayValue: cell.displayValue,
          formula: cell.formula || undefined,
        });
      }
      const description = String(item.description ?? "").trim();
      if (!description || /^(?:subtotal|total|itbis|impuesto)$/i.test(description))
        continue;
      if (
        numeric(item.line_total) === null &&
        numeric(item.quantity) === null &&
        numeric(item.unit_price) === null
      )
        continue;
      item.line_number = items.length + 1;
      item.source_sheet = sheet.name;
      item.source_row = rowNumber;
      items.push(item);
    }
  }
  for (const page of extraction.pages) {
    for (const line of page.text.split(/\r?\n/)) {
      const match = line
        .trim()
        .match(
          /^(.{3,100}?)\s+(\d+(?:[.,]\d+)?)\s+(?:RD\$?\s*)?([\d,.]+)\s+(?:RD\$?\s*)?([\d,.]+)$/,
        );
      if (!match || /subtotal|total|itbis|impuesto/i.test(match[1])) continue;
      items.push({
        line_number: items.length + 1,
        description: match[1].trim(),
        quantity: numeric(match[2]),
        unit_price: numeric(match[3]),
        line_total: numeric(match[4]),
        source_page: page.pageNumber,
      });
    }
  }
  return items;
}

function lineHeader(value: unknown) {
  const label = normalizeLabel(value);
  if (/descripcion|concepto|detalle|producto|servicio/.test(label))
    return "description";
  if (/codigo|item/.test(label)) return "item_code";
  if (/cantidad|cant/.test(label)) return "quantity";
  if (/ubicacion/.test(label)) return "location";
  if (/ancho/.test(label)) return "width_cm";
  if (/altura/.test(label)) return "height_cm";
  if (/area/.test(label)) return "area_sqm";
  if (/unidad|udm/.test(label)) return "unit_of_measure";
  if (/precio.*unit|valor.*unit/.test(label)) return "unit_price";
  if (/itbis|impuesto/.test(label)) return "tax_amount";
  if (/importe|total.*linea|valor total/.test(label)) return "line_total";
  return "";
}
function resolveHeader(value: unknown) {
  const label = normalizeLabel(value);
  for (const [field, fieldAliases] of Object.entries(aliases)) {
    if (fieldAliases.some((alias) => label === alias || label.includes(alias)))
      return field;
  }
  return "";
}
function normalizeField(field: string, value: unknown) {
  const text = String(value ?? "").trim();
  if (field.endsWith("_amount") || field.endsWith("_snapshot"))
    return numeric(text);
  if (field === "issue_date" || field === "payment_date" || field === "due_date")
    return normalizeDate(text);
  if (field === "invoice_number" || field === "ncf")
    return normalizeIdentifier(text);
  if (field === "status") {
    const normalized = normalizeLabel(text);
    if (["pagado", "pagada", "paid"].includes(normalized)) return "paid";
    if (["parcial", "pago parcial", "partial"].includes(normalized)) return "partial";
    if (["vencido", "vencida", "overdue"].includes(normalized)) return "overdue";
    if (["anulado", "anulada", "cancelled"].includes(normalized)) return "cancelled";
    if (["pendiente", "emitida", "issued"].includes(normalized)) return "issued";
    return "unknown";
  }
  return text;
}
function normalizeDate(value: string) {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return value;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function normalizeDateWithMonth(value: string, monthValue: string) {
  const match = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (!match) return normalizeDate(value);
  const monthNames = [
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
  ];
  const expectedMonth = monthNames.indexOf(normalizeLabel(monthValue)) + 1;
  if (!expectedMonth) return normalizeDate(value);
  const first = Number(match[1]);
  const second = Number(match[2]);
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  if (first === expectedMonth) {
    return `${year}-${String(first).padStart(2, "0")}-${String(second).padStart(2, "0")}`;
  }
  if (second === expectedMonth) {
    return `${year}-${String(second).padStart(2, "0")}-${String(first).padStart(2, "0")}`;
  }
  return normalizeDate(value);
}
function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const candidates = String(value).match(
    /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?/g,
  );
  const parsed = Number(candidates?.at(-1)?.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}
function normalizeIdentifier(value: unknown) {
  return String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function normalizeLabel(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function extractionText(extraction: ImportExtraction) {
  return [
    ...extraction.pages.map((page) => page.text),
    ...extraction.sheets.map((sheet) => sheetText(sheet.cells)),
  ].join("\n");
}
function sheetText(cells: ImportExtraction["sheets"][number]["cells"]) {
  const rows = new Map<number, typeof cells>();
  for (const cell of cells) {
    const row = rows.get(cell.row) ?? [];
    row.push(cell);
    rows.set(cell.row, row);
  }
  return [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, row]) =>
      row
        .sort((left, right) => left.column - right.column)
        .map((cell) => cell.displayValue)
        .join(" "),
    )
    .join("\n");
}
function matchLabelValue(
  field: string,
  text: string,
  fieldAliases: string[],
) {
  if (field === "invoice_number") {
    const invoice = text.match(
      /\bfactura\s*(?:n(?:[oº°.]|umero)?\.?\s*)?[:#-]?\s*(F[-\s]?\d{2,5})\b/i,
    );
    return invoice?.[1] ?? "";
  }
  if (field === "rnc") {
    const rncValues = [...text.matchAll(
      /(?:^|\n)\s*rnc\b\s*[:#-]?\s*([^\n\r]{1,120})/gi,
    )]
      .map((match) => match[1]?.trim())
      .filter((value): value is string => Boolean(value));
    return rncValues
      .at(-1)
      ?.match(/\b\d[\d-]{7,20}\b/)?.[0] ?? "";
  }
  const matches: string[] = [];
  for (const alias of fieldAliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(
      new RegExp(
        `(?:^|\\n)\\s*${escaped}\\b\\s*(?:n[oº°.]*)?\\s*[:#-]?\\s*([^\\n\\r|]{1,120})`,
        "i",
      ),
    );
    if (match?.[1]?.trim()) matches.push(match[1].trim());
  }
  return field === "rnc" ? (matches.at(-1) ?? "") : (matches[0] ?? "");
}
function yearOf(value: unknown) {
  const match = String(value ?? "").match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}
function stableFingerprint(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `inv-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
function sourceLocation(row: InvoiceStagingRow) {
  const reference = row.sourceReferences[0];
  return [reference?.sheet, reference?.page, reference?.row]
    .filter(Boolean)
    .join(":");
}
