import { normalizeEmail, normalizePhone, normalizeText } from "./crm";

export const valueStates = [
  "blank",
  "zero",
  "not_applicable",
  "not_calculated",
  "value",
  "invalid",
] as const;
export type ValueState = (typeof valueStates)[number];

export const mappingConfidences = [
  "high",
  "medium",
  "low",
  "manual_review",
] as const;
export type MappingConfidence = (typeof mappingConfidences)[number];

export const customerTypes = ["organization", "individual"] as const;
export type CustomerType = (typeof customerTypes)[number];

export const quotationTypes = [
  "installation",
  "repair",
  "maintenance",
  "mixed",
  "other",
] as const;
export type QuotationType = (typeof quotationTypes)[number];

export const importStatuses = [
  "pending",
  "parsed",
  "partial",
  "review_required",
  "accepted",
  "failed",
  "duplicate",
] as const;
export type ImportStatus = (typeof importStatuses)[number];

export const importIssueTypes = [
  "duplicate_file",
  "duplicate_customer",
  "revision_candidate",
  "conflicting_value",
  "missing_required",
  "suspicious_date",
  "total_discrepancy",
  "parser_error",
  "formula_error",
  "unsupported_calculation",
  "unmapped_field",
  "incomplete_record",
  "security_limit",
] as const;
export type ImportIssueType = (typeof importIssueTypes)[number];

export type CanonicalSourceValue = {
  sourceSheet?: string;
  sourcePage?: number;
  sourceCell?: string;
  sourceLabel?: string;
  rawValue: string;
  displayValue?: string;
  sourceFormula?: string;
  normalizedValue?: string;
  canonicalEntity?: string;
  canonicalField?: string;
  transformation?: string;
  confidence: MappingConfidence;
  valueState: ValueState;
  mappingStatus: "mapped" | "unmapped";
};

export type ImportIssueDraft = {
  type: ImportIssueType;
  severity: "info" | "warning" | "error" | "blocking";
  title: string;
  detail?: string;
  sourceLocation?: string;
};

export type QuotationIdentity = {
  raw: string;
  baseNumber: string;
  year: number | null;
  revisionHint: number | null;
  familyKey: string;
};

const NA_VALUES = new Set([
  "n/a",
  "n a",
  "na",
  "no aplica",
  "no aplicable",
  "not applicable",
  "-",
]);
const NOT_CALCULATED_VALUES = new Set([
  "no calculado",
  "not calculated",
  "pendiente",
]);

export function valueStateOf(value: unknown): ValueState {
  if (value === null || value === undefined) return "blank";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "invalid";
    return value === 0 ? "zero" : "value";
  }
  const text = String(value).trim();
  if (!text) return "blank";
  const normalized = normalizeText(text);
  if (NA_VALUES.has(normalized)) return "not_applicable";
  if (NOT_CALCULATED_VALUES.has(normalized)) return "not_calculated";
  if (
    /^#(?:ref!|value!|div\/0!|name\?|num!|null!|spill!|calc!|n\/a)$/i.test(text)
  ) {
    return "invalid";
  }
  const number = parseLocaleNumber(text);
  return number === 0 && /0/.test(text) ? "zero" : "value";
}

export function parseLocaleNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined) return null;
  let text = String(value).trim();
  if (!text || NA_VALUES.has(normalizeText(text))) return null;
  const negative = /^\(.*\)$/.test(text);
  text = text
    .replace(/[()]/g, "")
    .replace(/(?:RD|US)?\$/gi, "")
    .replace(/\s+/g, "")
    .replace(/[^\d,.-]/g, "");
  if (!text) return null;

  const comma = text.lastIndexOf(",");
  const dot = text.lastIndexOf(".");
  if (comma > dot) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else {
    text = text.replace(/,/g, "");
  }
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -Math.abs(parsed) : parsed;
}

export function normalizeRnc(value: unknown) {
  return String(value ?? "")
    .replace(/\D/g, "")
    .slice(0, 11);
}

export function normalizeCurrency(value: unknown) {
  const raw = String(value ?? "").trim();
  const text = normalizeText(String(value ?? ""));
  if (/US\$|USD/i.test(raw) || /\b(?:usd|dolar|dollar)\b/.test(text)) {
    return "USD";
  }
  if (/RD\$|DOP/i.test(raw) || /\b(?:dop|peso|pesos)\b/.test(text)) {
    return "DOP";
  }
  const code = raw.toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "DOP";
}

export function inferCustomerType(name: unknown, rnc: unknown): CustomerType {
  const normalizedName = normalizeText(String(name ?? ""));
  const hasCompanySuffix =
    /\b(?:srl|s r l|sa|s a|sas|corp|corporacion|grupo|constructora|ingenieria|asociados)\b/.test(
      normalizedName,
    );
  return normalizeRnc(rnc) || hasCompanySuffix ? "organization" : "individual";
}

export function validateCustomerIdentity(input: {
  name: unknown;
  type: unknown;
  rnc?: unknown;
}) {
  const errors: string[] = [];
  const name = String(input.name ?? "").trim();
  const type = customerTypes.includes(input.type as CustomerType)
    ? (input.type as CustomerType)
    : null;
  const rnc = normalizeRnc(input.rnc);
  if (!name) errors.push("Business Name es obligatorio.");
  if (!type) errors.push("Selecciona el tipo de cliente.");
  if (rnc && ![9, 11].includes(rnc.length)) {
    errors.push("El RNC o cédula debe contener 9 u 11 dígitos.");
  }
  return { errors, name, type, rnc };
}

export function quotationIdentity(value: unknown): QuotationIdentity {
  const raw = String(value ?? "").trim();
  const compact = raw.toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/\b([A-Z]{0,3}\d+)-(\d{4})(?:-(\d+))?\b/);
  if (!match) {
    const fallback = normalizeText(raw).replace(/\s+/g, "-");
    return {
      raw,
      baseNumber: raw,
      year: null,
      revisionHint: null,
      familyKey: fallback,
    };
  }
  const baseNumber = `${match[1]}-${match[2]}`;
  return {
    raw,
    baseNumber,
    year: Number(match[2]),
    revisionHint: match[3] ? Number(match[3]) : null,
    familyKey: normalizeText(baseNumber).replace(/\s+/g, "-"),
  };
}

export function parseSourceDate(value: unknown): {
  iso: string | null;
  suspicious: boolean;
} {
  const raw = String(value ?? "").trim();
  if (!raw) return { iso: null, suspicious: false };
  let date: Date | null = null;
  const local = raw.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (local) {
    const year = Number(local[3].length === 2 ? `20${local[3]}` : local[3]);
    date = new Date(Date.UTC(year, Number(local[2]) - 1, Number(local[1])));
    if (
      date.getUTCFullYear() !== year ||
      date.getUTCMonth() !== Number(local[2]) - 1 ||
      date.getUTCDate() !== Number(local[1])
    ) {
      date = null;
    }
  } else {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date) return { iso: null, suspicious: true };
  const year = date.getUTCFullYear();
  const maxYear = new Date().getUTCFullYear() + 1;
  return {
    iso: date.toISOString().slice(0, 10),
    suspicious: year < 1990 || year > maxYear,
  };
}

export function normalizeSourceValue(
  rawValue: unknown,
  target: {
    entity?: string;
    field?: string;
    confidence?: MappingConfidence;
    sourceLabel?: string;
    sourceSheet?: string;
    sourcePage?: number;
    sourceCell?: string;
    sourceFormula?: string;
    transformation?: string;
  } = {},
): CanonicalSourceValue {
  const raw =
    rawValue instanceof Date
      ? rawValue.toISOString()
      : rawValue === null || rawValue === undefined
        ? ""
        : String(rawValue);
  let normalizedValue = raw.trim();
  if (target.field?.toLowerCase().includes("email")) {
    normalizedValue = normalizeEmail(raw);
  } else if (
    target.field?.toLowerCase().includes("phone") ||
    target.field?.toLowerCase().includes("telefono")
  ) {
    normalizedValue = normalizePhone(raw);
  } else if (target.field?.toLowerCase().includes("rnc")) {
    normalizedValue = normalizeRnc(raw);
  }
  return {
    sourceSheet: target.sourceSheet,
    sourcePage: target.sourcePage,
    sourceCell: target.sourceCell,
    sourceLabel: target.sourceLabel,
    rawValue: raw,
    displayValue: raw,
    sourceFormula: target.sourceFormula,
    normalizedValue,
    canonicalEntity: target.entity,
    canonicalField: target.field,
    transformation: target.transformation,
    confidence: target.confidence ?? "manual_review",
    valueState: valueStateOf(rawValue),
    mappingStatus: target.entity && target.field ? "mapped" : "unmapped",
  };
}

export function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
