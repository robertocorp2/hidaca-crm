export const leadStatuses = [
  "new",
  "contacted",
  "working",
  "unqualified",
  "converted",
] as const;

export type LeadStatus = (typeof leadStatuses)[number];

export const leadStatusLabels: Record<LeadStatus, string> = {
  new: "Nuevo",
  contacted: "Contactado",
  working: "En seguimiento",
  unqualified: "No calificado",
  converted: "Convertido",
};

export const opportunityStages = [
  "evaluation",
  "quote",
  "negotiation_review",
  "closed",
] as const;

export type OpportunityStage = (typeof opportunityStages)[number];

export const opportunityStageLabels: Record<OpportunityStage, string> = {
  evaluation: "Evaluación",
  quote: "Cotización",
  negotiation_review: "Negociación / revisión",
  closed: "Cerrada",
};

export const opportunityOutcomes = ["won", "lost"] as const;
export type OpportunityOutcome = (typeof opportunityOutcomes)[number];

export const opportunityOutcomeLabels: Record<OpportunityOutcome, string> = {
  won: "Ganada",
  lost: "Perdida",
};

export const activityStatuses = ["planned", "completed", "cancelled"] as const;
export type ActivityStatus = (typeof activityStatuses)[number];

export const activityStatusLabels: Record<ActivityStatus, string> = {
  planned: "Programada",
  completed: "Completada",
  cancelled: "Cancelada",
};

export const relatedRecordTypes = [
  "business",
  "contact",
  "lead",
  "opportunity",
  "case",
  "project",
] as const;

export type RelatedRecordType = (typeof relatedRecordTypes)[number];

export const searchEntityLabels: Record<string, string> = {
  business: "Empresas",
  contact: "Contactos",
  lead: "Prospectos",
  opportunity: "Oportunidades",
  case: "Casos",
  project: "Proyectos",
  quote: "Cotizaciones",
  quotation: "Cotizaciones",
  invoice: "Facturas",
  document: "Documentos",
  activity: "Actividades",
  payment: "Pagos",
  task: "Tareas",
  milestone: "Hitos",
  daily_report: "Reportes diarios",
  equipment: "Equipos",
  staff: "Personal",
  supplier: "Suplidores",
  record: "Registros",
};

export function isLeadStatus(value: unknown): value is LeadStatus {
  return (
    typeof value === "string" && leadStatuses.includes(value as LeadStatus)
  );
}

export function isOpportunityStage(value: unknown): value is OpportunityStage {
  return (
    typeof value === "string" &&
    opportunityStages.includes(value as OpportunityStage)
  );
}

export function isOpportunityOutcome(
  value: unknown,
): value is OpportunityOutcome {
  return (
    typeof value === "string" &&
    opportunityOutcomes.includes(value as OpportunityOutcome)
  );
}

export function isActivityStatus(value: unknown): value is ActivityStatus {
  return (
    typeof value === "string" &&
    activityStatuses.includes(value as ActivityStatus)
  );
}

export function isRelatedRecordType(
  value: unknown,
): value is RelatedRecordType {
  return (
    typeof value === "string" &&
    relatedRecordTypes.includes(value as RelatedRecordType)
  );
}

export function nextLeadStatus(status: LeadStatus): LeadStatus | null {
  if (status === "new") return "contacted";
  if (status === "contacted") return "working";
  if (status === "working") return "unqualified";
  return null;
}

export function isValidLeadTransition(
  current: LeadStatus,
  next: LeadStatus,
): boolean {
  return nextLeadStatus(current) === next;
}

export function nextOpportunityStage(
  stage: OpportunityStage,
): OpportunityStage | null {
  if (stage === "evaluation") return "quote";
  if (stage === "quote") return "negotiation_review";
  if (stage === "negotiation_review") return "closed";
  return null;
}

export function isValidOpportunityTransition(
  current: OpportunityStage,
  next: OpportunityStage,
): boolean {
  return nextOpportunityStage(current) === next;
}

export function normalizeText(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en-US")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeEmail(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

export function normalizePhone(value: string): string {
  return value.replace(/\D+/g, "");
}

export function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .trim()
    .slice(0, maxLength);
}

export function optionalIsoDate(value: unknown): string | null {
  const input = cleanText(value, 40);
  if (!input) return null;
  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function nonNegativeNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function toFtsQuery(value: string): string {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0)
    .slice(0, 8)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" AND ");
}

export function moduleSearchEntityType(moduleKey: string): string {
  const mapping: Record<string, string> = {
    clientes: "business",
    contactos: "contact",
    proyectos: "project",
    cotizaciones: "quote",
    facturas: "invoice",
    pagos: "payment",
    "ordenes-cambio": "case",
    tareas: "task",
    hitos: "milestone",
    "reportes-diarios": "daily_report",
    equipos: "equipment",
    personal: "staff",
    suplidores: "supplier",
  };
  return mapping[moduleKey] ?? "record";
}

export function requiredLeadConversionFields(lead: {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
}): string[] {
  const missing: string[] = [];
  if (!lead.businessName.trim()) missing.push("Business Name");
  if (!lead.contactName.trim()) missing.push("Contact Name");
  if (!lead.email.trim() && !normalizePhone(lead.phone)) {
    missing.push("Email or Phone");
  }
  return missing;
}
