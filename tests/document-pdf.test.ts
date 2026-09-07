import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { calculateDocument } from "../app/lib/document-calculations";
import { createDocumentPdf } from "../app/lib/document-pdf";

test("PDF generation accepts the shared calculated values for standard and area lines", async () => {
  const calculation = calculateDocument({
    lines: [
      { id: "standard", description: "Servicio", quantity: 4, unitPrice: 500 },
      { id: "area", description: "Ventana", quantity: 3, widthCm: 100, heightCm: 200, unitPrice: 1000 },
    ],
    discount: 100,
    additionalCharge: 200,
    taxRate: 18,
    advance: 500,
  });
  const bytes = await createDocumentPdf({
    kind: "quotation",
    number: "COT-001",
    date: "2026-08-14",
    dueDate: "2026-08-30",
    businessName: "Cliente de prueba",
    lines: [
      { id: "standard", description: "Servicio", quantity: 4, unitPrice: 500 },
      { id: "area", description: "Ventana", quantity: 3, widthCm: 100, heightCm: 200, unitPrice: 1000 },
    ],
    calculation,
  });
  assert.equal(String.fromCharCode(...bytes.slice(0, 5)), "%PDF-");
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 1);
  assert.equal(calculation.lines[0]?.lineTotal, 2000);
  assert.equal(calculation.lines[1]?.areaTotal, 6);
  assert.equal(calculation.lines[1]?.lineTotal, 6000);
});
