import assert from "node:assert/strict";
import test from "node:test";
import { utils, write } from "@e965/xlsx";
import {
  invoiceReplacementHeaders,
  invoiceReplacementCommitDecision,
  parseInvoiceReplacementWorkbook,
  roundMoney,
  sourceCompanyKey,
} from "../app/lib/invoice-replacement";

function workbookBytes(options?: {
  duplicateNcf?: boolean;
  extraReserved?: boolean;
  arithmeticMismatch?: boolean;
  documentedArithmeticConflict?: boolean;
}) {
  const workbook = utils.book_new();
  const rows: unknown[][] = [Array.from(invoiceReplacementHeaders)];
  for (let number = 1; number <= 92; number += 1) {
    const formatted = String(number).padStart(4, "0");
    const subtotal = 100;
    const tax = 18;
    const total = number === 27 && options?.arithmeticMismatch ? 119 : 118;
    rows.push([
      `F-${formatted}`,
      new Date(Date.UTC(2021, number <= 72 ? 0 : 10, Math.min(number, 28), 12)),
      number === 5 ? "Compañía Ágil, SRL" : `Empresa ${formatted}`,
      number <= 20 ? "" : `1-01-${String(number).padStart(5, "0")}-1`,
      options?.duplicateNcf && number === 92
        ? "B0100000001"
        : `B01${String(number).padStart(8, "0")}`,
      subtotal,
      tax,
      total,
      total,
      0,
      "PAGADO",
      "DOP",
      number <= 20 ? "registro_2021" : "documento_emitido",
      String(number).padStart(64, "a").slice(-64),
    ]);
  }
  if (options?.extraReserved) {
    rows.push([
      "F-0093", new Date(Date.UTC(2021, 11, 30, 12)), "Reservada", "", "B0100000093",
      100, 18, 118, 118, 0, "PAGADO", "DOP", "documento_emitido", "b".repeat(64),
    ]);
  }
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(rows, { cellDates: true }), "Facturas");
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([["Ruta", "Hash SHA-256", "Función", "Representación"], ["registro.xlsx", "a".repeat(64), "Autoridad", "—"]]),
    "Fuentes",
  );
  const conflictRows: unknown[][] = [["Factura", "Campo", "Resolución"]];
  if (options?.documentedArithmeticConflict) {
    conflictRows.push(["F-0027", "cuadre subtotal+ITBIS", "Se conserva el TOTAL impreso."]);
  }
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(conflictRows), "Conflictos");
  utils.book_append_sheet(workbook, utils.aoa_to_sheet([["Control", "Resultado"], ["Conteo", 92]]), "Reconciliacion");
  const output = write(workbook, { type: "array", bookType: "xlsx", cellDates: true });
  return output instanceof ArrayBuffer
    ? output
    : output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength);
}

test("the replacement workbook enforces the exact 2021 invoice set and fiscal identities", async () => {
  const parsed = await parseInvoiceReplacementWorkbook(
    "HIDACA_Facturas_2021_Importacion.xlsx",
    workbookBytes(),
  );
  assert.equal(parsed.rows.length, 92);
  assert.equal(parsed.rows[0].invoiceNumber, "F-0001");
  assert.equal(parsed.rows.at(-1)?.invoiceNumber, "F-0092");
  assert.equal(parsed.rows.filter((row) => row.invoiceNumber === "F-0090").length, 1);
  assert.equal(new Set(parsed.rows.map((row) => row.normalizedNcf)).size, 92);
  assert.ok(parsed.rows.slice(72).every((row) => row.issueDate.startsWith("2021-")));
  assert.equal(parsed.rows[4].normalizedBusinessName, "compania agil srl");
  assert.equal(parsed.rows[20].normalizedRnc, "101000211");
  assert.equal(parsed.rows[19].authority, "registro_2021");
  assert.equal(parsed.rows[20].authority, "documento_emitido");
});

test("reserved rows, duplicate NCFs, and undocumented arithmetic differences are rejected", async () => {
  await assert.rejects(
    parseInvoiceReplacementWorkbook("facturas.xlsx", workbookBytes({ extraReserved: true })),
    /exactamente 92 filas/,
  );
  await assert.rejects(
    parseInvoiceReplacementWorkbook("facturas.xlsx", workbookBytes({ duplicateNcf: true })),
    /números y NCF únicos/,
  );
  await assert.rejects(
    parseInvoiceReplacementWorkbook(
      "facturas.xlsx",
      workbookBytes({ arithmeticMismatch: true }),
    ),
    /Subtotal \+ ITBIS no cuadra/,
  );
  const documented = await parseInvoiceReplacementWorkbook(
    "facturas.xlsx",
    workbookBytes({ arithmeticMismatch: true, documentedArithmeticConflict: true }),
  );
  assert.equal(documented.rows[26].total, 119);
});

test("hashes change with altered files and company keys obey exact RNC/name rules", async () => {
  const first = await parseInvoiceReplacementWorkbook("facturas.xlsx", workbookBytes());
  const second = await parseInvoiceReplacementWorkbook(
    "facturas.xlsx",
    workbookBytes({ arithmeticMismatch: true, documentedArithmeticConflict: true }),
  );
  assert.notEqual(first.workbookHash, second.workbookHash);
  assert.equal(sourceCompanyKey("Compañía Ágil, SRL", ""), "name:compania agil srl");
  assert.equal(sourceCompanyKey("Nombre ignorado", "1-01-00021-0"), "rnc:101000210");
  assert.equal(roundMoney(10.005), 10.01);
});

test("commit tokens reject altered files and stale state while a second commit is idempotent", () => {
  const base = {
    actualWorkbookHash: "a".repeat(64),
    expectedWorkbookHash: "a".repeat(64),
    actualStateFingerprint: "b".repeat(64),
    expectedStateFingerprint: "b".repeat(64),
    alreadyCommittedInvoiceCount: 0,
  };
  assert.equal(invoiceReplacementCommitDecision(base), "commit");
  assert.equal(
    invoiceReplacementCommitDecision({ ...base, actualWorkbookHash: "c".repeat(64) }),
    "file_changed",
  );
  assert.equal(
    invoiceReplacementCommitDecision({ ...base, actualStateFingerprint: "d".repeat(64) }),
    "state_changed",
  );
  assert.equal(
    invoiceReplacementCommitDecision({ ...base, alreadyCommittedInvoiceCount: 92 }),
    "idempotent",
  );
});
