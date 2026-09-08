export const ecfTypes = ["31", "32", "33", "34"] as const;
export type EcfType = (typeof ecfTypes)[number];
export type EcfEnvironment = "test" | "certification" | "production";

export type EcfValidationIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  path: string;
  message: string;
};

export type EcfLineSnapshot = {
  lineNumber: number;
  itemCode: string;
  description: string;
  quantity: number | null;
  unitOfMeasure: string;
  unitPrice: number | null;
  lineSubtotal: number | null;
  discountAmount: number | null;
  taxAmount: number | null;
  lineTotal: number | null;
  taxCode: string;
  taxRate: number | null;
};

export type EcfFiscalSnapshot = {
  schemaVersion: "1.0";
  ecfType: EcfType;
  environment: EcfEnvironment;
  sourceInvoiceId: string;
  sourceInvoiceNumber: string;
  issuer: {
    legalName: string;
    rnc: string;
    address: string;
    provinceCode: string;
    municipalityCode: string;
    phone: string;
    email: string;
  };
  receiver: {
    name: string;
    identityType: string;
    identityValue: string;
    address: string;
    provinceCode: string;
    municipalityCode: string;
    email: string;
    phone: string;
  };
  issueDate: string;
  dueDate: string;
  currency: string;
  exchangeRate: number | null;
  paymentTerms: string;
  subtotal: number | null;
  discount: number | null;
  taxableAmount: number | null;
  exemptAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  lines: EcfLineSnapshot[];
  supplements: Record<string, string | number | boolean>;
};

export function buildFiscalSnapshot(input: {
  ecfType: EcfType;
  environment: EcfEnvironment;
  invoice: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  issuer: Record<string, unknown>;
  receiver: Record<string, unknown>;
  supplements?: Record<string, string | number | boolean>;
}): EcfFiscalSnapshot {
  const invoice = input.invoice;
  return {
    schemaVersion: "1.0",
    ecfType: input.ecfType,
    environment: input.environment,
    sourceInvoiceId: stringValue(invoice.id),
    sourceInvoiceNumber: stringValue(invoice.invoice_number_raw),
    issuer: {
      legalName: stringValue(input.issuer.legalName ?? input.issuer.legal_name),
      rnc: stringValue(input.issuer.rnc),
      address: stringValue(input.issuer.fiscalAddress ?? input.issuer.fiscal_address ?? input.issuer.address),
      provinceCode: stringValue(input.issuer.provinceCode ?? input.issuer.province_code),
      municipalityCode: stringValue(input.issuer.municipalityCode ?? input.issuer.municipality_code),
      phone: stringValue(input.issuer.phone),
      email: stringValue(input.issuer.email),
    },
    receiver: {
      name: stringValue(input.receiver.name ?? input.receiver.business_name),
      identityType: stringValue(input.receiver.identityType ?? input.receiver.identity_type) || "RNC",
      identityValue: stringValue(input.receiver.identityValue ?? input.receiver.identity_value ?? input.receiver.business_rnc),
      address: stringValue(input.receiver.address ?? input.receiver.business_address),
      provinceCode: stringValue(input.receiver.provinceCode ?? input.receiver.province_code),
      municipalityCode: stringValue(input.receiver.municipalityCode ?? input.receiver.municipality_code),
      email: stringValue(input.receiver.email ?? input.receiver.business_email),
      phone: stringValue(input.receiver.phone ?? input.receiver.business_phone),
    },
    issueDate: stringValue(invoice.issue_date),
    dueDate: stringValue(invoice.due_date),
    currency: stringValue(invoice.currency) || "DOP",
    exchangeRate: numberValue(invoice.exchange_rate ?? invoice.exchangeRate),
    paymentTerms: stringValue(invoice.payment_terms_raw),
    subtotal: numberValue(invoice.subtotal_amount),
    discount: numberValue(invoice.discount_amount),
    taxableAmount: numberValue(invoice.taxable_amount),
    exemptAmount: numberValue(invoice.exempt_amount),
    taxAmount: numberValue(invoice.tax_amount),
    totalAmount: numberValue(invoice.total_amount),
    lines: input.lines.map((line, index) => ({
      lineNumber: Number(line.line_number ?? index + 1),
      itemCode: stringValue(line.item_code),
      description: stringValue(line.description),
      quantity: numberValue(line.quantity),
      unitOfMeasure: stringValue(line.unit_of_measure),
      unitPrice: numberValue(line.unit_price),
      lineSubtotal: numberValue(line.line_subtotal),
      discountAmount: numberValue(line.discount_amount),
      taxAmount: numberValue(line.tax_amount),
      lineTotal: numberValue(line.line_total),
      taxCode: stringValue(line.tax_configuration_code ?? line.tax_configuration_label),
      taxRate: numberValue(line.tax_rate),
    })),
    supplements: input.supplements ?? {},
  };
}

export function validateFiscalSnapshot(snapshot: EcfFiscalSnapshot): EcfValidationIssue[] {
  const issues: EcfValidationIssue[] = [];
  required(issues, snapshot.issuer.legalName, "issuer.legalName", "MISSING_ISSUER_NAME", "Configura la razón social del emisor.");
  required(issues, snapshot.issuer.rnc, "issuer.rnc", "MISSING_ISSUER_RNC", "Configura el RNC del emisor.");
  required(issues, snapshot.receiver.name, "receiver.name", "MISSING_RECEIVER_NAME", "La empresa receptora es obligatoria.");
  required(issues, snapshot.receiver.identityValue, "receiver.identityValue", "MISSING_RECEIVER_ID", "El RNC o documento del receptor es obligatorio para este e-CF.");
  required(issues, snapshot.issueDate, "issueDate", "MISSING_ISSUE_DATE", "La fecha de emisión es obligatoria.");
  required(issues, snapshot.currency, "currency", "MISSING_CURRENCY", "La moneda es obligatoria.");
  required(issues, snapshot.totalAmount, "totalAmount", "MISSING_TOTAL", "El total de la factura es obligatorio.");
  if (!snapshot.lines.length) issues.push({ severity: "error", code: "MISSING_LINES", path: "lines", message: "La factura debe tener al menos una partida." });
  for (const line of snapshot.lines) {
    required(issues, line.description, `lines[${line.lineNumber}].description`, "MISSING_LINE_DESCRIPTION", "Cada partida debe tener una descripción.");
    required(issues, line.quantity, `lines[${line.lineNumber}].quantity`, "MISSING_LINE_QUANTITY", "Cada partida debe tener una cantidad.");
    required(issues, line.unitPrice, `lines[${line.lineNumber}].unitPrice`, "MISSING_LINE_PRICE", "Cada partida debe tener un precio unitario.");
    if (!line.unitOfMeasure) issues.push({ severity: "warning", code: "MISSING_UNIT", path: `lines[${line.lineNumber}].unitOfMeasure`, message: "La unidad de medida deberá completarse según el catálogo DGII." });
    if (!line.taxCode) issues.push({ severity: "warning", code: "MISSING_TAX_CODE", path: `lines[${line.lineNumber}].taxCode`, message: "La clasificación de impuesto de la partida deberá confirmarse." });
  }
  if (snapshot.ecfType === "32" && snapshot.receiver.identityValue) {
    issues.push({ severity: "info", code: "CONSUMER_TYPE_REVIEW", path: "ecfType", message: "Confirma que el receptor corresponde a una factura de consumo." });
  }
  if (snapshot.ecfType === "33" || snapshot.ecfType === "34") {
    required(issues, snapshot.supplements.referenceEcf, "supplements.referenceEcf", "MISSING_REFERENCE_ECF", "Las notas de débito/crédito requieren el e-CF de referencia.");
    required(issues, snapshot.supplements.adjustmentReason, "supplements.adjustmentReason", "MISSING_ADJUSTMENT_REASON", "Indica el motivo de la nota.");
  }
  return issues;
}

export function canonicalSnapshotJson(snapshot: EcfFiscalSnapshot) {
  return JSON.stringify(sortJson(snapshot));
}

export async function snapshotHash(snapshot: EcfFiscalSnapshot) {
  const bytes = new TextEncoder().encode(canonicalSnapshotJson(snapshot));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

/** Structural XML generation. XSD validation is a separate mandatory gate. */
export function generateEcfXml(snapshot: EcfFiscalSnapshot, encf: string) {
  const lines = snapshot.lines.map((line) => `<DetalleItem><NumeroLinea>${line.lineNumber}</NumeroLinea><Descripcion>${xmlEscape(line.description)}</Descripcion><CantidadItem>${xmlNumber(line.quantity)}</CantidadItem><PrecioUnitarioItem>${xmlNumber(line.unitPrice)}</PrecioUnitarioItem><MontoItem>${xmlNumber(line.lineTotal)}</MontoItem></DetalleItem>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><ECF><Encabezado><Version>1.0</Version><IdDoc><TipoeCF>${snapshot.ecfType}</TipoeCF><eNCF>${xmlEscape(encf)}</eNCF><FechaVencimientoSecuencia>${xmlEscape(snapshot.dueDate)}</FechaVencimientoSecuencia><IndicadorMontoGravado>${snapshot.taxableAmount !== null ? "1" : "0"}</IndicadorMontoGravado><TipoIngresos>01</TipoIngresos><TipoPago>1</TipoPago></IdDoc><Emisor><RNCEmisor>${xmlEscape(snapshot.issuer.rnc)}</RNCEmisor><RazonSocialEmisor>${xmlEscape(snapshot.issuer.legalName)}</RazonSocialEmisor><DireccionEmisor>${xmlEscape(snapshot.issuer.address)}</DireccionEmisor><Municipio>${xmlEscape(snapshot.issuer.municipalityCode)}</Municipio><Provincia>${xmlEscape(snapshot.issuer.provinceCode)}</Provincia></Emisor><Comprador><RNCComprador>${xmlEscape(snapshot.receiver.identityValue)}</RNCComprador><RazonSocialComprador>${xmlEscape(snapshot.receiver.name)}</RazonSocialComprador><DireccionComprador>${xmlEscape(snapshot.receiver.address)}</DireccionComprador></Comprador><FechaEmision>${xmlEscape(snapshot.issueDate)}</FechaEmision></Encabezado><DetallesItems>${lines}</DetallesItems><Totales><MontoGravado>${xmlNumber(snapshot.taxableAmount)}</MontoGravado><MontoExento>${xmlNumber(snapshot.exemptAmount)}</MontoExento><ITBIS>${xmlNumber(snapshot.taxAmount)}</ITBIS><MontoTotal>${xmlNumber(snapshot.totalAmount)}</MontoTotal></Totales></ECF>`;
}

export function xmlEscape(value: unknown) {
  return stringValue(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function xmlNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(2) : "0.00";
}

function required(issues: EcfValidationIssue[], value: unknown, path: string, code: string, message: string) {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) issues.push({ severity: "error", code, path, message });
}

function stringValue(value: unknown) { return value === null || value === undefined ? "" : String(value).trim(); }
function numberValue(value: unknown): number | null { const number = Number(value); return Number.isFinite(number) ? number : null; }

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortJson(entry)]));
  }
  return value;
}
