import { and, asc, desc, eq, gt, isNull, lt, lte, or } from "drizzle-orm";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { getDb } from "../../db";
import { activities, businesses, contacts, invoices, opportunities, projects, quotations } from "../../db/schema";
import { can, type AuthorizedUser } from "./authorization";
import { permissionModules } from "./modules";
import { searchBusinessData } from "./search";
import type { NormalizedTool } from "./ai";

export const readOnlyAiTools: NormalizedTool[] = [
  { name: "search_records", description: "Busca registros operativos autorizados por texto.", inputSchema: { type: "object", properties: { term: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } }, required: ["term"] } },
  { name: "get_record_context", description: "Recupera coincidencias de un cliente, contacto, oportunidad, cotización, factura o proyecto.", inputSchema: { type: "object", properties: { term: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, required: ["term"] } },
  { name: "list_agenda_items", description: "Lista actividades futuras autorizadas de la agenda.", inputSchema: { type: "object", properties: { from: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "list_opportunities", description: "Lista oportunidades abiertas y su próxima prioridad comercial.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "list_quotations", description: "Lista cotizaciones recientes y su estado para preparar seguimiento.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "list_overdue_invoices", description: "Lista facturas vencidas o con saldo pendiente; solo lectura.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "list_projects", description: "Lista proyectos activos con cliente, estado y última actualización.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "list_recent_contacts", description: "Lista contactos actualizados recientemente para preparar una conversación.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } } },
  { name: "list_priorities", description: "Resume actividades próximas y oportunidades abiertas que requieren atención.", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 20 } } } },
];

function limitValue(value: unknown, fallback = 12) {
  return Math.min(Math.max(Number(value) || fallback, 1), 20);
}

function canSeeAll(user: AuthorizedUser) {
  return user.role === "admin";
}

function ownerScope(column: AnySQLiteColumn, user: AuthorizedUser) {
  return canSeeAll(user) ? undefined : eq(column, user.email);
}

export async function executeReadOnlyTool(user: AuthorizedUser, name: string, args: Record<string, unknown>) {
  if (name === "search_records") {
    const term = String(args.term ?? "").trim().slice(0, 120);
    if (term.length < 2) return { results: [], note: "El término debe tener al menos dos caracteres." };
    const allowedEntityTypes = permissionModules.filter((module) => can(user, module.key, "view")).flatMap((module) => [...module.entities]);
    return { results: await searchBusinessData(term, Math.min(Number(args.limit) || 12, 20), allowedEntityTypes) };
  }
  if (name === "get_record_context") {
    const term = String(args.term ?? "").trim().slice(0, 120);
    if (term.length < 2) return { results: [], note: "El término debe tener al menos dos caracteres." };
    const allowedEntityTypes = permissionModules.filter((module) => can(user, module.key, "view")).flatMap((module) => [...module.entities]);
    return { results: await searchBusinessData(term, limitValue(args.limit, 8), allowedEntityTypes), note: "Usa estos registros como contexto; no completes campos que no estén presentes." };
  }
  if (name === "list_agenda_items") {
    const from = typeof args.from === "string" && !Number.isNaN(Date.parse(args.from)) ? args.from : new Date().toISOString();
    const rows = await getDb().select({ id: activities.id, title: activities.title, description: activities.description, startAt: activities.startAt, endAt: activities.endAt, status: activities.status, location: activities.location, relatedType: activities.relatedType, relatedId: activities.relatedId, ownerEmail: activities.ownerEmail }).from(activities).where(and(isNull(activities.archivedAt), lte(activities.startAt, new Date(Date.parse(from) + 31 * 24 * 60 * 60 * 1000).toISOString()), ownerScope(activities.ownerEmail, user))).orderBy(asc(activities.startAt)).limit(limitValue(args.limit, 20));
    return { activities: rows };
  }
  if (name === "list_opportunities") {
    const rows = await getDb().select({ id: opportunities.id, title: opportunities.title, stage: opportunities.stage, estimatedValue: opportunities.estimatedValue, expectedCloseDate: opportunities.expectedCloseDate, businessId: opportunities.businessId, projectId: opportunities.projectId, ownerEmail: opportunities.ownerEmail, updatedAt: opportunities.updatedAt }).from(opportunities).where(and(isNull(opportunities.archivedAt), or(eq(opportunities.stage, "evaluation"), eq(opportunities.stage, "quote"), eq(opportunities.stage, "negotiation_review")), ownerScope(opportunities.ownerEmail, user))).orderBy(desc(opportunities.updatedAt)).limit(limitValue(args.limit));
    return { opportunities: rows };
  }
  if (name === "list_quotations") {
    const rows = await getDb().select({ id: quotations.id, quotationNumber: quotations.quotationNumber, title: quotations.title, status: quotations.status, businessId: quotations.businessId, opportunityId: quotations.opportunityId, projectId: quotations.projectId, ownerEmail: quotations.ownerEmail, updatedAt: quotations.updatedAt }).from(quotations).where(and(isNull(quotations.archivedAt), ownerScope(quotations.ownerEmail, user))).orderBy(desc(quotations.updatedAt)).limit(limitValue(args.limit));
    return { quotations: rows };
  }
  if (name === "list_overdue_invoices") {
    const today = new Date().toISOString().slice(0, 10);
    const scope = canSeeAll(user) ? undefined : eq(businesses.ownerEmail, user.email);
    const rows = await getDb().select({ id: invoices.id, invoiceNumber: invoices.invoiceNumberRaw, status: invoices.status, dueDate: invoices.dueDate, totalAmount: invoices.totalAmount, balanceAmount: invoices.balanceAmountSnapshot, businessId: invoices.businessId, projectId: invoices.projectId, updatedAt: invoices.updatedAt }).from(invoices).innerJoin(businesses, eq(invoices.businessId, businesses.id)).where(and(isNull(invoices.archivedAt), lt(invoices.dueDate, today), or(eq(invoices.status, "issued"), eq(invoices.status, "partial"), eq(invoices.status, "overdue")), scope)).orderBy(asc(invoices.dueDate)).limit(limitValue(args.limit));
    return { overdueInvoices: rows };
  }
  if (name === "list_projects") {
    const rows = await getDb().select({ id: projects.id, name: projects.name, status: projects.status, businessId: projects.businessId, projectType: projects.projectType, ownerEmail: projects.ownerEmail, updatedAt: projects.updatedAt }).from(projects).where(and(isNull(projects.archivedAt), ownerScope(projects.ownerEmail, user))).orderBy(desc(projects.updatedAt)).limit(limitValue(args.limit));
    return { projects: rows };
  }
  if (name === "list_recent_contacts") {
    const rows = await getDb().select({ id: contacts.id, name: contacts.name, title: contacts.title, email: contacts.email, phone: contacts.phone, mobilePhone: contacts.mobilePhone, businessId: contacts.businessId, ownerEmail: contacts.ownerEmail, updatedAt: contacts.updatedAt }).from(contacts).where(and(isNull(contacts.archivedAt), ownerScope(contacts.ownerEmail, user))).orderBy(desc(contacts.updatedAt)).limit(limitValue(args.limit));
    return { contacts: rows };
  }
  if (name === "list_priorities") {
    const now = new Date();
    const horizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const activityRows = await getDb().select({ id: activities.id, title: activities.title, startAt: activities.startAt, relatedType: activities.relatedType, relatedId: activities.relatedId, status: activities.status }).from(activities).where(and(isNull(activities.archivedAt), gt(activities.startAt, now.toISOString()), lte(activities.startAt, horizon), ownerScope(activities.ownerEmail, user))).orderBy(asc(activities.startAt)).limit(limitValue(args, 10));
    const opportunityRows = await getDb().select({ id: opportunities.id, title: opportunities.title, stage: opportunities.stage, expectedCloseDate: opportunities.expectedCloseDate, estimatedValue: opportunities.estimatedValue }).from(opportunities).where(and(isNull(opportunities.archivedAt), or(eq(opportunities.stage, "quote"), eq(opportunities.stage, "negotiation_review")), ownerScope(opportunities.ownerEmail, user))).orderBy(asc(opportunities.expectedCloseDate)).limit(limitValue(args, 10));
    return { activities: activityRows, opportunities: opportunityRows };
  }
  return { error: "Herramienta no disponible." };
}
