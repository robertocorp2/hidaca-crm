import {
  calculateDocument,
  calculateDocumentLine,
  parseDocumentNumber,
  roundDocumentMoney,
  type DocumentLineInput,
} from "./document-calculations";

export type InvoiceLineCalculationInput = DocumentLineInput & {
  quantity?: unknown;
  unitPrice?: unknown;
  lineTotal?: unknown;
};

export type InvoiceCalculationInput = {
  lines?: InvoiceLineCalculationInput[];
  subtotal?: unknown;
  discount?: unknown;
  additionalCharge?: unknown;
  taxRate?: unknown;
  taxAmount?: unknown;
  advance?: unknown;
};

const cents = roundDocumentMoney;

export function finiteAmount(value: unknown, fallback = 0) {
  return parseDocumentNumber(value, fallback);
}

export function calculateLineTotal(line: InvoiceLineCalculationInput) {
  if (
    line.lineTotal !== "" &&
    line.lineTotal !== null &&
    line.lineTotal !== undefined &&
    line.widthCm === undefined &&
    line.heightCm === undefined
  ) {
    return cents(Math.max(0, finiteAmount(line.lineTotal)));
  }
  return calculateDocumentLine(line).lineTotal;
}

export function calculateInvoice(input: InvoiceCalculationInput) {
  const calculated = calculateDocument({
    lines: input.lines,
    discount: input.discount,
    additionalCharge: input.additionalCharge,
    taxRate: input.taxRate,
    advance: input.advance,
  });
  const hasLines = Boolean(input.lines?.length);
  const subtotal = hasLines
    ? calculated.subtotal
    : cents(Math.max(0, finiteAmount(input.subtotal)));
  const discount = cents(Math.min(subtotal, Math.max(0, finiteAmount(input.discount))));
  const subtotalAfterDiscount = cents(subtotal - discount);
  const additionalCharge = calculated.additionalCharge;
  const taxableAmount = cents(subtotalAfterDiscount + additionalCharge);
  const taxRate = calculated.taxRate;
  const taxAmount =
    input.taxAmount === "" || input.taxAmount === null || input.taxAmount === undefined
      ? cents(taxableAmount * (taxRate / 100))
      : Math.max(0, finiteAmount(input.taxAmount));
  const total = cents(taxableAmount + taxAmount);
  const advance = calculated.advance;
  const balance = cents(Math.max(0, total - advance));

  return {
    subtotal,
    discount,
    subtotalAfterDiscount,
    additionalCharge,
    taxableAmount,
    taxRate,
    taxAmount,
    total,
    advance,
    balance,
  };
}
