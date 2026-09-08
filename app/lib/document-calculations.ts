export type DocumentLineInput = {
  id?: string;
  description?: unknown;
  quantity?: unknown;
  widthCm?: unknown;
  heightCm?: unknown;
  unitPrice?: unknown;
};

export type CalculatedDocumentLine = {
  id?: string;
  description: string;
  quantity: number;
  widthCm: number | null;
  heightCm: number | null;
  areaPerUnit: number | null;
  areaTotal: number | null;
  unitPrice: number;
  lineTotal: number;
  errors: string[];
};

export type DocumentCalculationInput = {
  lines?: DocumentLineInput[];
  discount?: unknown;
  additionalCharge?: unknown;
  taxRate?: unknown;
  advance?: unknown;
};

export type DocumentCalculation = {
  lines: CalculatedDocumentLine[];
  subtotal: number;
  discount: number;
  subtotalAfterDiscount: number;
  additionalCharge: number;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  advance: number;
  balance: number;
  errors: string[];
};

export function parseDocumentNumber(value: unknown, fallback = 0) {
  if (value === "" || value === null || value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nullableDocumentNumber(value: unknown) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundDocumentMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function roundDocumentMeasure(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function calculateDocumentLine(
  input: DocumentLineInput,
): CalculatedDocumentLine {
  const quantity = parseDocumentNumber(input.quantity, 1);
  const widthCm = nullableDocumentNumber(input.widthCm);
  const heightCm = nullableDocumentNumber(input.heightCm);
  const unitPrice = Math.max(0, parseDocumentNumber(input.unitPrice));
  const errors: string[] = [];

  if (!Number.isFinite(quantity) || quantity <= 0) {
    errors.push("La cantidad debe ser mayor que cero.");
  } else if (!Number.isInteger(quantity)) {
    errors.push("La cantidad debe ser un número entero mayor que cero.");
  }
  if (widthCm !== null && !Number.isFinite(widthCm)) {
    errors.push("El ancho no es válido.");
  }
  if (heightCm !== null && !Number.isFinite(heightCm)) {
    errors.push("La altura no es válida.");
  }
  if ((widthCm === null) !== (heightCm === null)) {
    errors.push("Ingresa ancho y altura, o deja ambas dimensiones en blanco.");
  }
  if (widthCm !== null && widthCm <= 0) {
    errors.push("El ancho debe ser mayor que cero.");
  }
  if (heightCm !== null && heightCm <= 0) {
    errors.push("La altura debe ser mayor que cero.");
  }

  const hasDimensions = widthCm !== null && heightCm !== null;
  const areaPerUnit = hasDimensions
    ? roundDocumentMeasure((widthCm * heightCm) / 10_000)
    : null;
  const areaTotal = areaPerUnit === null
    ? null
    : roundDocumentMeasure(areaPerUnit * Math.max(0, quantity));
  const lineTotal = roundDocumentMoney(
    (areaTotal ?? Math.max(0, quantity)) * unitPrice,
  );

  return {
    id: input.id,
    description: String(input.description ?? ""),
    quantity: Math.max(0, quantity),
    widthCm,
    heightCm,
    areaPerUnit,
    areaTotal,
    unitPrice,
    lineTotal,
    errors,
  };
}

export function calculateDocument(
  input: DocumentCalculationInput,
): DocumentCalculation {
  const lines = (input.lines ?? []).map(calculateDocumentLine);
  const subtotal = roundDocumentMoney(
    lines.reduce((sum, line) => sum + line.lineTotal, 0),
  );
  const discount = roundDocumentMoney(
    Math.min(subtotal, Math.max(0, parseDocumentNumber(input.discount))),
  );
  const subtotalAfterDiscount = roundDocumentMoney(subtotal - discount);
  const additionalCharge = roundDocumentMoney(
    Math.max(0, parseDocumentNumber(input.additionalCharge)),
  );
  const taxableAmount = roundDocumentMoney(
    subtotalAfterDiscount + additionalCharge,
  );
  const taxRate = Math.max(0, parseDocumentNumber(input.taxRate, 18));
  const taxAmount = roundDocumentMoney(taxableAmount * (taxRate / 100));
  const total = roundDocumentMoney(taxableAmount + taxAmount);
  const advance = roundDocumentMoney(
    Math.max(0, parseDocumentNumber(input.advance)),
  );

  return {
    lines,
    subtotal,
    discount,
    subtotalAfterDiscount,
    additionalCharge,
    taxableAmount,
    taxRate,
    taxAmount,
    total,
    advance,
    balance: roundDocumentMoney(Math.max(0, total - advance)),
    errors: lines.flatMap((line) => line.errors),
  };
}
