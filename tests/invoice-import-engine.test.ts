import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationDraftFromEvidence,
  analyzeInvoiceExtraction,
  classifyInvoiceDocument,
  decideInvoiceMatch,
  type ImportExtraction,
} from "../app/lib/importers";

function registerExtraction(): ImportExtraction {
  const values = [
    ["A1", 1, "No Factura"],
    ["B1", 2, "Cliente"],
    ["C1", 3, "Fecha"],
    ["D1", 4, "NCF"],
    ["E1", 5, "Total"],
    ["F1", 6, "Avance"],
    ["G1", 7, "Pendiente"],
    ["A2", 1, "F-001"],
    ["B2", 2, "ACME"],
    ["C2", 3, "08/01/2021"],
    ["D2", 4, "B0100000001"],
    ["E2", 5, "1180"],
    ["F2", 6, "500"],
    ["G2", 7, "680"],
  ] as const;
  return {
    format: "xlsx",
    parserName: "test",
    parserVersion: "1",
    hasMacros: false,
    partial: false,
    warnings: [],
    pages: [],
    sheets: [
      {
        name: "Matriz",
        range: "A1:G2",
        merges: [],
        cells: values.map(([address, column, displayValue]) => ({
          sheet: "Matriz",
          address,
          row: address.endsWith("1") ? 1 : 2,
          column,
          rawValue: displayValue,
          displayValue,
          formula: "",
          cellType: "s",
        })),
      },
    ],
  };
}

test("register snapshots never manufacture payment transactions", () => {
  const extraction = registerExtraction();
  assert.equal(
    classifyInvoiceDocument("anything.xlsx", extraction),
    "invoice_register",
  );
  const result = analyzeInvoiceExtraction(
    "registro de facturas.xlsx",
    "document-1",
    extraction,
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].normalizedValues.invoice_number, "F001");
  assert.equal(result.rows[0].normalizedValues.issue_date, "2021-01-08");
  assert.equal(result.rows[0].normalizedValues.paid_amount_snapshot, 500);
  assert.equal(result.allocations.length, 0);
  assert.equal(result.decisions[0].decision, "manual_review");
  assert.ok(
    result.issues.some((issue) => issue.type === "payment_evidence_missing"),
  );
});

test("document content outranks a misleading invoice filename", () => {
  const extraction: ImportExtraction = {
    ...registerExtraction(),
    format: "pdf",
    sheets: [],
    pages: [
      {
        pageNumber: 1,
        text: "NOTA DE CRÉDITO\nNCF: B040000001\nTotal: RD$ 100",
      },
    ],
  };
  assert.equal(classifyInvoiceDocument("FACTURA-99.pdf", extraction), "credit_note");
});

test("an invoice workbook is not mistaken for a register and keeps customer identifiers", () => {
  const extraction: ImportExtraction = {
    format: "xlsx",
    parserName: "test",
    parserVersion: "1",
    hasMacros: false,
    partial: false,
    warnings: [],
    pages: [],
    sheets: [
      {
        name: "FACTURA",
        range: "A1:G8",
        merges: [],
        cells: [
          ["A1", 1, 1, "FACTURA VALIDO PARA CREDITO FISCAL"],
          ["F2", 2, 6, "NCF:"],
          ["G2", 2, 7, "B0100000257"],
          ["A3", 3, 1, "Fecha: 29/06/2021"],
          ["A4", 4, 1, "Cliente: DIVALDI VILLAGE LTD"],
          ["A5", 5, 1, "RNC: 130-73431-3"],
          ["F5", 5, 6, "Factura No.: F0038"],
          ["A6", 6, 1, "ITBIS: 18% al 10% 9,707.09"],
          ["A7", 7, 1, "Total: RD$ 548,989.59"],
        ].map(([address, row, column, displayValue]) => ({
          sheet: "FACTURA",
          address: String(address),
          row: Number(row),
          column: Number(column),
          rawValue: displayValue,
          displayValue: String(displayValue),
          formula: "",
          cellType: "s",
        })),
      },
    ],
  };

  const result = analyzeInvoiceExtraction("DIVALDI F0038.xlsx", "document-2", extraction);
  assert.equal(result.documentKind, "invoice");
  assert.equal(result.rows[0].normalizedValues.invoice_number, "F0038");
  assert.equal(result.rows[0].normalizedValues.rnc, "130-73431-3");
  assert.equal(result.rows[0].normalizedValues.ncf, "B0100000257");
  assert.equal(result.rows[0].normalizedValues.tax_amount, 9707.09);
  assert.equal(result.rows[0].normalizedValues.total_amount, 548989.59);
});

test("only a unique exact invoice identity auto-links", () => {
  const result = analyzeInvoiceExtraction(
    "registro.xlsx",
    "document-1",
    registerExtraction(),
  );
  const row = result.rows[0];
  row.normalizedValues.business_id = "business-1";
  const candidate = {
    id: "invoice-1",
    businessId: "business-1",
    invoiceNumberNormalized: "F001",
    issueYear: 2021,
    ncfNormalized: "B0100000001",
    versionNumber: 1,
    status: "issued",
  };
  assert.equal(decideInvoiceMatch(row, [candidate]).decision, "link");
  assert.equal(
    decideInvoiceMatch(row, [candidate, { ...candidate, id: "invoice-2" }])
      .decision,
    "manual_review",
  );
});

test("payment allocation drafts require identified evidence and a positive amount", () => {
  assert.equal(
    allocationDraftFromEvidence({
      paymentStagingId: "payment-1",
      invoiceStagingId: "invoice-1",
      amount: 100,
      currency: "DOP",
      allocationDate: "2026-01-01",
      evidenceDocumentId: "document-1",
    }).decision,
    "ready",
  );
  assert.equal(
    allocationDraftFromEvidence({
      paymentStagingId: "payment-2",
      invoiceStagingId: "invoice-1",
      amount: null,
      currency: "DOP",
      allocationDate: null,
      evidenceDocumentId: "",
    }).decision,
    "blocked",
  );
});

test("non-18 percent source tax is preserved when source totals reconcile", () => {
  const extraction: ImportExtraction = {
    format: "pdf",
    parserName: "test",
    parserVersion: "1",
    sheets: [],
    pages: [
      {
        pageNumber: 1,
        text: [
          "FACTURA: F-008",
          "RNC: 101010101",
          "NCF: B0100000008",
          "Subtotal: 1000",
          "ITBIS: 80",
          "Total: 1080",
        ].join("\n"),
      },
    ],
    hasMacros: false,
    partial: false,
    warnings: [],
  };
  const result = analyzeInvoiceExtraction(
    "factura-f008.pdf",
    "document-tax",
    extraction,
  );
  assert.equal(result.rows[0].normalizedValues.tax_amount, 80);
  assert.equal(result.rows[0].normalizedValues.total_amount, 1080);
  assert.ok(
    !result.issues.some((issue) => issue.type === "balance_reconciliation"),
  );
});

test("blank PDF pages and spreadsheet formula errors remain blocking", () => {
  const blankPdf: ImportExtraction = {
    format: "pdf",
    parserName: "test",
    parserVersion: "1",
    sheets: [],
    pages: [{ pageNumber: 1, text: "" }],
    hasMacros: false,
    partial: false,
    warnings: [],
  };
  assert.ok(
    analyzeInvoiceExtraction("scan.pdf", "scan-1", blankPdf).issues.some(
      (issue) =>
        issue.type === "ocr_required" && issue.severity === "blocking",
    ),
  );
  const formula = registerExtraction();
  formula.sheets[0].cells.push({
    sheet: "Matriz",
    address: "H2",
    row: 2,
    column: 8,
    rawValue: "#REF!",
    displayValue: "#REF!",
    formula: "=A999",
    cellType: "e",
  });
  assert.ok(
    analyzeInvoiceExtraction("registro.xlsx", "sheet-1", formula).issues.some(
      (issue) => issue.type === "formula_error",
    ),
  );
});

test("invoice line tables preserve source rows and displayed values", () => {
  const extraction = registerExtraction();
  extraction.sheets[0] = {
    name: "Factura",
    range: "A1:D3",
    merges: [],
    cells: [
      {
        sheet: "Factura",
        address: "A1",
        row: 1,
        column: 1,
        rawValue: "Descripción",
        displayValue: "Descripción",
        formula: "",
        cellType: "s",
      },
      {
        sheet: "Factura",
        address: "B1",
        row: 1,
        column: 2,
        rawValue: "Cantidad",
        displayValue: "Cantidad",
        formula: "",
        cellType: "s",
      },
      {
        sheet: "Factura",
        address: "C1",
        row: 1,
        column: 3,
        rawValue: "Precio unitario",
        displayValue: "Precio unitario",
        formula: "",
        cellType: "s",
      },
      {
        sheet: "Factura",
        address: "D1",
        row: 1,
        column: 4,
        rawValue: "Importe",
        displayValue: "Importe",
        formula: "",
        cellType: "s",
      },
      {
        sheet: "Factura",
        address: "A2",
        row: 2,
        column: 1,
        rawValue: "Puerta enrollable",
        displayValue: "Puerta enrollable",
        formula: "",
        cellType: "s",
      },
      {
        sheet: "Factura",
        address: "B2",
        row: 2,
        column: 2,
        rawValue: 2,
        displayValue: "2",
        formula: "",
        cellType: "n",
      },
      {
        sheet: "Factura",
        address: "C2",
        row: 2,
        column: 3,
        rawValue: 500,
        displayValue: "500",
        formula: "",
        cellType: "n",
      },
      {
        sheet: "Factura",
        address: "D2",
        row: 2,
        column: 4,
        rawValue: 1000,
        displayValue: "1000",
        formula: "=B2*C2",
        cellType: "n",
      },
    ],
  };
  const result = analyzeInvoiceExtraction(
    "factura.xlsx",
    "line-document",
    extraction,
  );
  const lines = result.rows[0].normalizedValues.line_items as Array<
    Record<string, unknown>
  >;
  assert.equal(lines[0].description, "Puerta enrollable");
  assert.equal(lines[0].line_total, 1000);
  assert.ok(
    result.rows[0].sourceReferences.some(
      (reference) => reference.field === "line_items.0.line_total",
    ),
  );
});
