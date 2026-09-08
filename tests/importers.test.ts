import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { utils, write, type BookType, type WorkBook } from "@e965/xlsx";
import {
  parseCombinedRegister,
  parseSourceFile,
  registerHeaders,
  supportedImportExtensions,
} from "../app/lib/importers";
import { mapHidacaExtraction } from "../app/lib/importers/hidaca-mapper";
import { analyzeRegisterImport } from "../app/lib/register-import";

function workbookBytes(
  sheets: Array<{ name: string; rows: unknown[][] }>,
  bookType: BookType = "xlsx",
) {
  const workbook: WorkBook = utils.book_new();
  for (const sheet of sheets) {
    utils.book_append_sheet(
      workbook,
      utils.aoa_to_sheet(sheet.rows),
      sheet.name,
    );
  }
  const bytes = write(workbook, { bookType, type: "array", cellDates: true });
  return bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function maintenanceWorkbook() {
  return workbookBytes([
    {
      name: "Reparación",
      rows: [
        ["Cliente: QUIMOCARIBE SAS", null, null, "Fecha: 24/02/2025"],
        ["RNC: 101-06921-1", null, null, "Cotización: M028-2025"],
        [
          "Dirección: Calle Central No. 10",
          null,
          null,
          "Contacto: Cinthia Baez",
        ],
        ["Teléfonos:", null, null, "Proyecto: Mantenimiento 12 Shutters"],
        ["Celular: 809-669-1102"],
        ["Correo: cinthia.baez@quimocaribe.com"],
        ["Codigo", "Descripción", "Cantidad", "Mts", "Precio", "Total"],
        ["", "Silicon Uretanado", 5, null, 690, 3450],
        ["", "Limpiador de Lamina", 1, null, 690, 690],
        ["", "Penetrante", 1, null, 715, 715],
        [],
        [null, "No incluye piezas / cliente debe autorizar el cambio"],
        [null, null, null, null, "Sub- Total", 4855],
        [null, null, null, null, "Instalacion", 10500],
        [null, null, null, null, "Sub- Total", 15355],
        [null, null, null, null, "ITBIS 18%", 2763.9],
        [null, null, null, null, "TOTAL (RD$)", 18118.9],
        ["Abono recibido", 5000, "24/02/2025", "Transferencia"],
        [],
        ["COTIZACIÓN VALIDA POR 15 DIAS LABORABLES."],
        [
          "Esta cotizacion NO contempla las piezas dañadas que podamos encontrar durante el mantenimiento.",
        ],
        ["Las piezas adicionales estaran reflejadas en su factura final."],
        [
          "No aceptamos devoluciones despues de colocada la orden y haber recibido la mercancía.",
        ],
      ],
    },
  ]);
}

function installationWorkbook() {
  return workbookBytes([
    {
      name: "Instalación",
      rows: [
        ["Cliente: Solgela Castillo", null, null, "Fecha: 02/09/2025"],
        ["RNC:", null, null, "Cotización: C176-2025-1"],
        ["Dirección: Santo Domingo", null, null, "Contacto:"],
        [
          "Celular: +1 (829) 591-0701",
          null,
          null,
          "Proyecto: Instalacion Screen",
        ],
        [],
        [
          "Descripción",
          null,
          "Cant.",
          "Ubicación",
          "Ancho",
          "Altura",
          "Ancho",
          "Altura",
          "Área",
          "PU/m2",
          "Total",
        ],
        [
          "Enrollable Screen 1%",
          null,
          2,
          "Sala",
          null,
          null,
          230,
          210,
          4.83,
          3950,
          38157,
        ],
        [
          "Enrollable Screen 1%",
          null,
          1,
          "Habitación",
          null,
          null,
          117,
          240,
          2.808,
          3950,
          11091.6,
        ],
        [],
        [null, null, null, null, null, null, null, null, "Sub- Total", 49248.6],
        [null, null, null, null, null, null, null, null, "Instalación", 4500],
        [null, null, null, null, null, null, null, null, "ITBIS 18%", 9674.748],
        [
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          "TOTAL (RD$)",
          63423.348,
        ],
        [],
        ["CONDICIONES DE PAGO: 70% CON LA ORDEN / 30% RECIBIDA CONFORME."],
        ["*** DOS (2) AÑOS DE GARANTIA EN PIEZAS Y SERVICIOS***"],
      ],
    },
    {
      name: "despiece",
      rows: [
        ["Componente", "Cantidad", "Costo", "Total"],
        ["Laminas", 10, 500, 5000],
        ["Motores", 2, 2400, 4800],
        ["Controles", 2, 800, 1600],
      ],
    },
  ]);
}

function combinedRegisterWorkbook(rowCount = 4_505) {
  const rows: unknown[][] = [
    ["REGISTRO COMBINADO DE COTIZACIONES HIDACA"],
    [...registerHeaders],
  ];
  for (let index = 0; index < rowCount; index += 1) {
    rows.push([
      index === 1 ? "" : index === 10 ? "02/01/2002" : "02/01/2018",
      index === 2 ? "Febrero" : "Enero",
      index === 10 ? "" : 2018,
      index === 3 ? "" : `C${String(index + 1).padStart(4, "0")}-2018`,
      index === 4 ? "" : `Cliente ${index + 1}`,
      index === 5 ? "" : "131230628",
      index === 6 ? "Ana / Juan" : "Ana",
      index === 7 ? 0 : "809-555-0101",
      "829-555-0101",
      index === 8 ? "ana@example.com; juan@example.com" : "ana@example.com",
      "Santo Domingo",
      index === 9 ? "Torre Uno, Apto. 2" : "",
      `COTIZACIONES 2018\\C${index + 1}.xlsx`,
      `Abrir ${index + 1}`,
      "consolidado local",
    ]);
  }
  const workbook: WorkBook = utils.book_new();
  const register = utils.aoa_to_sheet(rows);
  for (let row = 3; row <= rowCount + 2; row += 1) {
    register[`N${row}`] = {
      t: "s",
      v: `Abrir ${row - 2}`,
      f: `HYPERLINK("file:///C:/quotes/C${row - 2}.xlsx","Abrir")`,
    };
  }
  utils.book_append_sheet(workbook, register, "Registro combinado");
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet([
      ["RESUMEN DE LA COMBINACIÓN"],
      [],
      [
        "Registro de origen",
        "Archivo",
        "Filas incluidas",
        "Enlaces preservados",
      ],
      ["2021 y otras", "registro 2021.xlsx", 133, 133],
      ["2022", "registro 2022.xlsx", 277, 277],
      ["2023", "registro 2023.xlsx", 196, 196],
      ["2024", "registro 2024.xlsx", 0, 0],
      [
        "consolidado local",
        "registro local.xlsx",
        rowCount - 642,
        rowCount - 642,
      ],
      ["registro de cotizacion Hidaca (Drive)", "registro drive.xlsx", 36, 36],
      [],
      [],
      ["Métrica", "Resultado"],
      ["Total de filas combinadas", rowCount],
      ["Total de enlaces preservados", rowCount],
      ["Filas sin fecha", 1],
      ["Filas sin número de cotización", 1],
      ["Filas sin cliente", 1],
      ["Grupos repetidos por fecha, cotización y cliente", 0],
      ["Filas adicionales dentro de esos grupos", 0],
    ]),
    "Resumen",
  );
  const bytes = write(workbook, {
    bookType: "xlsx",
    type: "array",
    cellDates: true,
  });
  return bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

test("declares every required import extension", () => {
  assert.deepEqual(supportedImportExtensions, [
    ".pdf",
    ".xlsx",
    ".xlsm",
    ".xlsb",
  ]);
});

test("parses XLSX, XLSM, and XLSB rather than skipping binary workbooks", async () => {
  for (const extension of ["xlsx", "xlsm", "xlsb"] as const) {
    const extraction = await parseSourceFile(
      `representative.${extension}`,
      workbookBytes(
        [{ name: "Reparación", rows: [["Cliente: Ejemplo"], ["Total", 1]] }],
        extension,
      ),
    );
    assert.equal(extraction.format, extension);
    assert.equal(extraction.sheets[0]?.name, "Reparación");
    assert.ok(extraction.sheets[0]?.cells.length);
  }
});

test("parses every row and worksheet in a consolidated register above the old cell limit", async () => {
  const extraction = await parseSourceFile(
    "registro combinado de cotizaciones HIDACA.xlsx",
    combinedRegisterWorkbook(),
  );
  const register = parseCombinedRegister(extraction);
  assert.deepEqual(register.worksheets, ["Registro combinado", "Resumen"]);
  assert.equal(extraction.partial, false);
  assert.equal(register.rows.length, 4_505);
  assert.equal(register.rows[0]?.sourceRowNumber, 3);
  assert.equal(register.rows.at(-1)?.sourceRowNumber, 4_507);
  assert.equal(register.rows[0]?.normalizedValues.date, "2018-01-02");
  assert.equal(register.rows[1]?.rawValues.Fecha.state, "blank");
  assert.equal(register.rows[7]?.rawValues.Telefono.state, "zero");
  assert.ok(register.rows[2]?.warnings.includes("month_mismatch"));
  assert.ok(register.rows[10]?.warnings.includes("suspicious_date"));
  assert.ok(register.rows[10]?.warnings.includes("year_mismatch"));
  assert.ok(register.rows[3]?.errors.includes("missing_quotation_number"));
  assert.ok(register.rows[4]?.errors.includes("missing_customer"));
  assert.ok(register.rows[0]?.warnings.includes("source_unavailable"));
  assert.equal(
    register.rows[0]?.normalizedValues.sourceDocumentUri,
    "file:///C:/quotes/C1.xlsx",
  );
  assert.equal(register.formulas, 4_505);
  assert.equal(register.formulaErrors, 0);
  assert.equal(register.sources.length, 6);
  assert.equal(register.metrics.length, 7);
  assert.deepEqual(register.unmappedHeaders, []);
  const analyzed = await analyzeRegisterImport(register);
  assert.equal(analyzed.summary.sourceRowsDiscovered, 4_505);
  assert.equal(analyzed.summary.missingDates, 1);
  assert.equal(analyzed.summary.missingQuotationNumbers, 1);
  assert.equal(analyzed.summary.missingCustomers, 1);
  assert.equal(analyzed.summary.monthMismatches, 1);
  assert.equal(analyzed.summary.suspiciousDates, 1);
  assert.equal(analyzed.summary.unmappedFields, 0);
});

test("detects repeated register rows conservatively, including missing dates or customers", async () => {
  const extraction = await parseSourceFile(
    "registro combinado de cotizaciones HIDACA.xlsx",
    combinedRegisterWorkbook(12),
  );
  const register = parseCombinedRegister(extraction);
  const first = register.rows[0]!;
  register.rows[1]!.normalizedValues = { ...first.normalizedValues };
  register.rows[1]!.errors = [];
  register.rows[1]!.outcome = "ready";
  register.rows[2]!.normalizedValues = {
    ...first.normalizedValues,
    date: null,
    customerName: "",
    normalizedCustomerName: "",
    quotationNumber: "C-BLANK-2018",
    normalizedQuotationNumber: "C-BLANK-2018",
    quotationFamilyKey: "C-BLANK-2018",
  };
  register.rows[2]!.errors = ["missing_customer"];
  register.rows[3]!.normalizedValues = {
    ...register.rows[2]!.normalizedValues,
  };
  register.rows[3]!.errors = ["missing_customer"];
  const analyzed = await analyzeRegisterImport(register);
  assert.equal(analyzed.summary.duplicateCandidates, 2);
  assert.equal(
    analyzed.rows.filter((row) => row.duplicateOfRowNumber !== null).length,
    2,
  );
  assert.ok(
    analyzed.rows
      .filter((row) => row.duplicateOfRowNumber !== null)
      .every((row) => row.outcome === "manual_review"),
  );
});

test("maps a maintenance quotation, source totals, terms, and blank values", async () => {
  const extraction = await parseSourceFile(
    "Cinthia Baez M028-2025 Mantenimiento Shutters.xlsx",
    maintenanceWorkbook(),
  );
  const preview = mapHidacaExtraction(
    "Cinthia Baez M028-2025 Mantenimiento Shutters.xlsx",
    extraction,
  );
  assert.equal(preview.templateType, "repair_maintenance");
  assert.equal(preview.business.name, "QUIMOCARIBE SAS");
  assert.equal(preview.business.rnc, "101069211");
  assert.equal(preview.contact.name, "Cinthia Baez");
  assert.equal(preview.quotation.baseNumber, "M028-2025");
  assert.equal(preview.lineItems.length, 3);
  assert.equal(preview.lineItems[0]?.sourceLineTotal, 3450);
  assert.equal(preview.financials.sourceSubtotal, 4855);
  assert.equal(preview.financials.sourceTaxAmount, 2763.9);
  assert.equal(preview.financials.sourceTotal, 18118.9);
  assert.equal(preview.financials.calculatedTotal, 18118.9);
  assert.equal(preview.financials.paymentStatus, "partial");
  assert.equal(preview.payments.length, 1);
  assert.equal(preview.payments[0]?.amount, 5000);
  assert.equal(preview.payments[0]?.paymentDate, "2025-02-24");
  assert.match(preview.payments[0]?.method ?? "", /transferencia/i);
  assert.match(preview.terms.quotationValidity, /15 DIAS/i);
  assert.match(preview.terms.returnPolicy, /devoluciones/i);
  assert.ok(
    preview.sourceValues.some(
      (value) => value.canonicalField === "rnc" && value.valueState === "value",
    ),
  );
});

test("maps installation dimensions, revision hints, alternatives, and internal materials", async () => {
  const extraction = await parseSourceFile(
    "Solgela Castillo C176-2025-1 Manuales.xlsx",
    installationWorkbook(),
  );
  const preview = mapHidacaExtraction(
    "Solgela Castillo C176-2025-1 Manuales.xlsx",
    extraction,
  );
  assert.equal(preview.templateType, "installation");
  assert.equal(preview.business.customerType, "individual");
  assert.equal(preview.business.rnc, "");
  assert.equal(preview.revision.revisionNumber, 1);
  assert.equal(preview.revision.alternativeLabel, "Manual");
  assert.equal(preview.lineItems[0]?.finishedWidthCm, 230);
  assert.equal(preview.lineItems[0]?.finishedHeightCm, 210);
  assert.equal(preview.lineItems[0]?.areaSqm, 4.83);
  assert.equal(preview.lineItems[0]?.pricePerSqm, 3950);
  assert.equal(preview.manufacturing[0]?.sourceSheet, "despiece");
  assert.ok(preview.manufacturing[0]?.components.length);
});

test("preserves and flags broken production formulas", async () => {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([
    ["Cliente: Taller de Prueba", null, "Cotización: C001-2026"],
    ["Componente", "Cantidad", "Total"],
    ["Motores", 2, 0],
  ]);
  sheet.C3 = { t: "e", v: 23, f: "Instalación!#REF!-A1" };
  utils.book_append_sheet(workbook, sheet, "despiece");
  const bytes = write(workbook, { bookType: "xlsx", type: "array" });
  const extraction = await parseSourceFile("hoja de produccion.xlsx", bytes);
  const preview = mapHidacaExtraction("hoja de produccion.xlsx", extraction);
  assert.equal(preview.manufacturing[0]?.calculationStatus, "broken");
  assert.ok(
    preview.manufacturing[0]?.components.some(
      (component) => component.formulaStatus === "broken",
    ),
  );
  assert.ok(preview.issues.some((issue) => issue.type === "formula_error"));
});

test("extracts representative PDF text and table rows", async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  page.drawText(
    [
      "Cliente: PDF CUSTOMER Fecha: 24/02/2025",
      "RNC: Cotizacion: M028-2025",
      "Contacto: Ana Proyecto: Mantenimiento Shutters",
      "Silicon Uretanado 5 690.00RD$ 3,450.00RD$",
      "Sub- Total 3,450.00RD$",
      "ITBIS 18% 621.00RD$",
      "TOTAL (RD$) 4,071.00RD$",
      "COTIZACION VALIDA POR 15 DIAS LABORABLES.",
    ].join("\n"),
    { x: 40, y: 730, size: 10, font, lineHeight: 16 },
  );
  const bytes = await pdf.save();
  const extraction = await parseSourceFile(
    "maintenance.pdf",
    Uint8Array.from(bytes).buffer,
  );
  const preview = mapHidacaExtraction("maintenance.pdf", extraction);
  assert.equal(extraction.pages.length, 1);
  assert.equal(preview.business.name, "PDF CUSTOMER");
  assert.equal(preview.lineItems.length, 1);
  assert.equal(preview.financials.sourceTotal, 4071);
});

test("corrupt files fail explicitly and retain a useful parser message", async () => {
  await assert.rejects(
    parseSourceFile(
      "_$temporary.xlsx",
      new TextEncoder().encode("not a zip file").buffer,
    ),
    /No se pudo leer el libro XLSX/i,
  );
});

test("unknown formats are rejected before parsing", async () => {
  await assert.rejects(
    parseSourceFile("source.csv", new ArrayBuffer(8)),
    /Formato no permitido/i,
  );
});
