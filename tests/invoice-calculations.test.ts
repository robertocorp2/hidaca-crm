import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateInvoice,
  calculateLineTotal,
} from "../app/lib/invoice-calculations";

test("invoice line totals are deterministic", () => {
  assert.equal(calculateLineTotal({ quantity: 4, unitPrice: 5900 }), 23600);
  assert.equal(calculateLineTotal({ quantity: 3, unitPrice: 515 }), 1545);
  assert.equal(
    calculateLineTotal({ quantity: 4, unitPrice: 5900, lineTotal: 20000 }),
    20000,
  );
});

test("invoice summary follows subtotal, discount, charges, ITBIS, advance and balance", () => {
  assert.deepEqual(
    calculateInvoice({
      lines: [
        { quantity: 4, unitPrice: 5900 },
        { quantity: 1, unitPrice: 11380 },
        { quantity: 3, unitPrice: 515 },
      ],
      discount: 1000,
      additionalCharge: 22000,
      taxRate: 18,
      advance: 10000,
    }),
    {
      subtotal: 36525,
      discount: 1000,
      subtotalAfterDiscount: 35525,
      additionalCharge: 22000,
      taxableAmount: 57525,
      taxRate: 18,
      taxAmount: 10354.5,
      total: 67879.5,
      advance: 10000,
      balance: 57879.5,
    },
  );
});

test("paid historical invoices do not require a fabricated payment amount", () => {
  const summary = calculateInvoice({ subtotal: 1000, taxAmount: 180 });
  assert.equal(summary.total, 1180);
  assert.equal(summary.balance, 1180);
});
