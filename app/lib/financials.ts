import {
  parseLocaleNumber,
  type ImportIssueDraft,
  type ValueState,
  valueStateOf,
} from "./source-domain";

export type PriceBasis = "unit" | "square_meter" | "flat_fee" | "other";

export type FinancialLineInput = {
  quantity?: unknown;
  areaSqm?: unknown;
  priceBasis?: PriceBasis | null;
  unitPrice?: unknown;
  pricePerSqm?: unknown;
  flatFee?: unknown;
  discountAmount?: unknown;
  taxAmount?: unknown;
  sourceLineTotal?: unknown;
};

export type ChargeInput = {
  type: string;
  sourceAmount?: unknown;
  calculatedAmount?: unknown;
};

export type FinancialSummaryInput = {
  lines: FinancialLineInput[];
  charges?: ChargeInput[];
  discountRate?: unknown;
  discountAmount?: unknown;
  taxRate?: unknown;
  sourceSubtotal?: unknown;
  sourceTaxAmount?: unknown;
  sourceTotal?: unknown;
  currency?: string;
};

const roundMoney = (value: number) =>
  Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateLineTotal(input: FinancialLineInput): {
  total: number | null;
  basis: PriceBasis | null;
  valueStates: Record<string, ValueState>;
} {
  const quantity = parseLocaleNumber(input.quantity);
  const area = parseLocaleNumber(input.areaSqm);
  const unitPrice = parseLocaleNumber(input.unitPrice);
  const pricePerSqm = parseLocaleNumber(input.pricePerSqm);
  const flatFee = parseLocaleNumber(input.flatFee);
  const discount = parseLocaleNumber(input.discountAmount) ?? 0;
  const tax = parseLocaleNumber(input.taxAmount) ?? 0;
  const states = {
    quantity: valueStateOf(input.quantity),
    areaSqm: valueStateOf(input.areaSqm),
    unitPrice: valueStateOf(input.unitPrice),
    pricePerSqm: valueStateOf(input.pricePerSqm),
    flatFee: valueStateOf(input.flatFee),
    discountAmount: valueStateOf(input.discountAmount),
    taxAmount: valueStateOf(input.taxAmount),
  };

  let subtotal: number | null = null;
  if (input.priceBasis === "square_meter") {
    if (area !== null && pricePerSqm !== null) {
      subtotal = area * pricePerSqm * (quantity ?? 1);
    }
  } else if (input.priceBasis === "flat_fee") {
    subtotal = flatFee;
  } else if (input.priceBasis === "unit") {
    if (quantity !== null && unitPrice !== null)
      subtotal = quantity * unitPrice;
  } else if (flatFee !== null) {
    subtotal = flatFee;
  } else if (quantity !== null && unitPrice !== null) {
    subtotal = quantity * unitPrice;
  } else if (area !== null && pricePerSqm !== null) {
    subtotal = area * pricePerSqm * (quantity ?? 1);
  }

  return {
    total: subtotal === null ? null : roundMoney(subtotal - discount + tax),
    basis: input.priceBasis ?? null,
    valueStates: states,
  };
}

export function calculateFinancialSummary(input: FinancialSummaryInput) {
  const calculatedLines = input.lines.map(calculateLineTotal);
  const knownLineTotals = calculatedLines
    .map((line) => line.total)
    .filter((value): value is number => value !== null);
  const calculatedSubtotal =
    knownLineTotals.length === input.lines.length
      ? roundMoney(knownLineTotals.reduce((sum, value) => sum + value, 0))
      : null;
  const chargeTotal = (input.charges ?? []).reduce((sum, charge) => {
    const value =
      parseLocaleNumber(charge.calculatedAmount) ??
      parseLocaleNumber(charge.sourceAmount);
    return sum + (value ?? 0);
  }, 0);
  const discountRate = parseLocaleNumber(input.discountRate);
  const explicitDiscount = parseLocaleNumber(input.discountAmount);
  const calculatedDiscount =
    explicitDiscount ??
    (calculatedSubtotal !== null && discountRate !== null
      ? calculatedSubtotal * discountRate
      : 0);
  const afterDiscount =
    calculatedSubtotal === null
      ? null
      : roundMoney(calculatedSubtotal - calculatedDiscount + chargeTotal);
  const taxRate = parseLocaleNumber(input.taxRate);
  const sourceTax = parseLocaleNumber(input.sourceTaxAmount);
  const calculatedTax =
    afterDiscount !== null && taxRate !== null
      ? roundMoney(afterDiscount * taxRate)
      : null;
  const calculatedTotal =
    afterDiscount === null
      ? null
      : roundMoney(afterDiscount + (calculatedTax ?? sourceTax ?? 0));
  const sourceSubtotal = parseLocaleNumber(input.sourceSubtotal);
  const sourceTotal = parseLocaleNumber(input.sourceTotal);
  const discrepancy =
    calculatedTotal !== null && sourceTotal !== null
      ? roundMoney(sourceTotal - calculatedTotal)
      : null;
  const issues: ImportIssueDraft[] = [];
  if (
    discrepancy !== null &&
    Math.abs(discrepancy) > Math.max(0.05, Math.abs(sourceTotal ?? 0) * 0.001)
  ) {
    issues.push({
      type: "total_discrepancy",
      severity: "warning",
      title: "El total calculado no coincide con el documento.",
      detail: `Diferencia ${discrepancy.toFixed(2)} ${input.currency ?? "DOP"}.`,
    });
  }

  return {
    currency: input.currency ?? "DOP",
    calculatedLines,
    sourceSubtotal,
    calculatedSubtotal,
    calculatedDiscount: roundMoney(calculatedDiscount),
    calculatedSubtotalAfterDiscount: afterDiscount,
    sourceTaxAmount: sourceTax,
    calculatedTaxAmount: calculatedTax,
    sourceTotal,
    calculatedTotal,
    discrepancyAmount: discrepancy,
    issues,
  };
}
