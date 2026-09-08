import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateFinancialSummary,
  calculateLineTotal,
} from "../app/lib/financials";

test("calculates quantity by unit price", () => {
  assert.equal(
    calculateLineTotal({
      quantity: 5,
      unitPrice: 690,
      priceBasis: "unit",
    }).total,
    3450,
  );
});

test("calculates area by square-meter price and quantity", () => {
  assert.equal(
    calculateLineTotal({
      quantity: 2,
      areaSqm: 4.83,
      pricePerSqm: 3950,
      priceBasis: "square_meter",
    }).total,
    38157,
  );
});

test("calculates flat fees, discounts, and per-line tax", () => {
  assert.equal(
    calculateLineTotal({
      flatFee: 10000,
      priceBasis: "flat_fee",
      discountAmount: 1000,
      taxAmount: 1620,
    }).total,
    10620,
  );
});

test("does not convert blank values into zero", () => {
  const result = calculateLineTotal({
    quantity: "",
    unitPrice: "",
    priceBasis: "unit",
  });
  assert.equal(result.total, null);
  assert.equal(result.valueStates.quantity, "blank");
  assert.equal(result.valueStates.unitPrice, "blank");
});

test("calculates charges, discounts, ITBIS, and totals", () => {
  const result = calculateFinancialSummary({
    currency: "DOP",
    lines: [
      { quantity: 5, unitPrice: 690, priceBasis: "unit" },
      { quantity: 1, unitPrice: 690, priceBasis: "unit" },
      { quantity: 1, unitPrice: 715, priceBasis: "unit" },
    ],
    charges: [{ type: "installation", sourceAmount: 10500 }],
    taxRate: 0.18,
    sourceSubtotal: 4855,
    sourceTaxAmount: 2763.9,
    sourceTotal: 18118.9,
  });
  assert.equal(result.calculatedSubtotal, 4855);
  assert.equal(result.calculatedSubtotalAfterDiscount, 15355);
  assert.equal(result.calculatedTaxAmount, 2763.9);
  assert.equal(result.calculatedTotal, 18118.9);
  assert.equal(result.discrepancyAmount, 0);
  assert.deepEqual(result.issues, []);
});

test("flags source-total discrepancies without replacing source values", () => {
  const result = calculateFinancialSummary({
    currency: "USD",
    lines: [{ quantity: 2, unitPrice: 100, priceBasis: "unit" }],
    taxRate: 0,
    sourceTotal: 250,
  });
  assert.equal(result.sourceTotal, 250);
  assert.equal(result.calculatedTotal, 200);
  assert.equal(result.discrepancyAmount, 50);
  assert.equal(result.issues[0]?.type, "total_discrepancy");
});

test("blank and zero tax values remain distinguishable", () => {
  const blank = calculateFinancialSummary({
    lines: [{ quantity: 1, unitPrice: 100, priceBasis: "unit" }],
    taxRate: "",
    sourceTaxAmount: "",
    sourceTotal: 100,
  });
  const zero = calculateFinancialSummary({
    lines: [{ quantity: 1, unitPrice: 100, priceBasis: "unit" }],
    taxRate: 0,
    sourceTaxAmount: 0,
    sourceTotal: 100,
  });
  assert.equal(blank.calculatedTaxAmount, null);
  assert.equal(blank.sourceTaxAmount, null);
  assert.equal(zero.calculatedTaxAmount, 0);
  assert.equal(zero.sourceTaxAmount, 0);
});
