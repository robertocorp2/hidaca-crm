import assert from "node:assert/strict";
import test from "node:test";
import { duplicateDocumentLine, emptyDocumentState, removeDocumentLine, todayInputValue } from "../app/app/document-editor";
import { calculateDocument, calculateDocumentLine } from "../app/lib/document-calculations";

test("standard documents calculate quantity times price", () => {
  const result = calculateDocument({ lines: [{ description: "Servicio", quantity: 4, unitPrice: 500 }] });
  assert.equal(result.lines[0]?.areaTotal, null);
  assert.equal(result.subtotal, 2000);
  assert.equal(result.total, 2360);
});

test("quantities default to one and require positive whole numbers", () => {
  assert.equal(calculateDocumentLine({ description: "Servicio", unitPrice: 500 }).quantity, 1);
  assert.deepEqual(calculateDocumentLine({ description: "Servicio", quantity: 4, unitPrice: 500 }).errors, []);
  assert.match(calculateDocumentLine({ description: "Servicio", quantity: 1.5, unitPrice: 500 }).errors[0] ?? "", /entero/i);
  assert.match(calculateDocumentLine({ description: "Servicio", quantity: 0, unitPrice: 500 }).errors[0] ?? "", /mayor que cero/i);
  assert.match(calculateDocumentLine({ description: "Servicio", quantity: -2, unitPrice: 500 }).errors[0] ?? "", /mayor que cero/i);
});

test("new document states use the local current date", () => {
  const expected = todayInputValue(new Date());
  assert.equal(emptyDocumentState("invoice").fields.issueDate, expected);
  assert.equal(emptyDocumentState("quotation").fields.quotationDate, expected);
});

test("area documents calculate total square meters times price", () => {
  const line = calculateDocumentLine({ description: "Shutter", quantity: 3, widthCm: 100, heightCm: 200, unitPrice: 1000 });
  assert.equal(line.areaPerUnit, 2);
  assert.equal(line.areaTotal, 6);
  assert.equal(line.lineTotal, 6000);
});

test("partial dimensions are invalid and never produce a misleading area", () => {
  const line = calculateDocumentLine({ description: "Shutter", quantity: 1, widthCm: 100, heightCm: "", unitPrice: 1000 });
  assert.equal(line.areaTotal, null);
  assert.equal(line.lineTotal, 1000);
  assert.match(line.errors[0] ?? "", /ancho y altura/i);
});

test("financial summary updates discount, charges, ITBIS, advance and balance", () => {
  const result = calculateDocument({
    lines: [{ description: "Servicio", quantity: 4, unitPrice: 500 }],
    discount: 100,
    additionalCharge: 200,
    taxRate: 18,
    advance: 500,
  });
  assert.equal(result.subtotal, 2000);
  assert.equal(result.discount, 100);
  assert.equal(result.additionalCharge, 200);
  assert.equal(result.taxAmount, 378);
  assert.equal(result.total, 2478);
  assert.equal(result.balance, 1978);
});

test("duplicate inserts an independent line and removal updates the collection", () => {
  const original = { id: "one", description: "Puerta", quantity: "2", widthCm: "100", heightCm: "200", unitPrice: "1000" };
  const duplicated = duplicateDocumentLine([original], 0);
  assert.equal(duplicated.length, 2);
  assert.notEqual(duplicated[0]?.id, duplicated[1]?.id);
  assert.equal(duplicated[1]?.description, original.description);
  const edited = { ...duplicated[1], description: "Ventana" };
  assert.equal(duplicated[0]?.description, original.description);
  assert.equal(edited.description, "Ventana");
  assert.equal(removeDocumentLine(duplicated, 0).length, 1);
});
