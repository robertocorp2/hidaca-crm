import { cleanText } from "./crm";

export const invoiceStatuses = [
  "draft",
  "issued",
  "partial",
  "paid",
  "overdue",
  "cancelled",
  "replaced",
  "credited",
  "unknown",
] as const;

export const creditNoteStatuses = [
  "issued",
  "applied",
  "void",
  "unknown",
] as const;

export const collectionActivityTypes = [
  "call",
  "email",
  "visit",
  "promise_to_pay",
  "dispute",
  "note",
  "other",
] as const;

export const invoiceStatusLabels: Record<(typeof invoiceStatuses)[number], string> =
  {
    draft: "Borrador",
    issued: "Emitida",
    partial: "Pago parcial",
    paid: "Pagada",
    overdue: "Vencida",
    cancelled: "Anulada",
    replaced: "Sustituida",
    credited: "Acreditada",
    unknown: "Por revisar",
  };

export function normalizeInvoiceIdentifier(value: unknown) {
  return cleanText(value, 120)
    .toUpperCase()
    .replaceAll(/[^A-Z0-9]/g, "");
}

export function optionalAmount(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isoDate(value: unknown) {
  const raw = cleanText(value, 40);
  if (!raw) return null;
  const date = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function issueYear(date: string | null) {
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : null;
}

export function enumValue<T extends readonly string[]>(
  value: unknown,
  allowed: T,
  fallback: T[number],
) {
  const candidate = String(value ?? "");
  return allowed.includes(candidate) ? (candidate as T[number]) : fallback;
}
