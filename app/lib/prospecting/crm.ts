import { ProspectingError, type Context, type ConversionMapping, type ConversionPreview, type CrmMatch, type CrmPort, type Prospect } from "./contracts";
import { hash, normalize, normalizePhone } from "./domain";
import { Repository } from "./repository";

/** Existing HIDACA tables represent one organization. Never expose them to a
 * second tenant until the core CRM itself has a tenant migration. */
export const HIDACA_TENANT = "hidaca";
type Company = { id: string; name: string; phone: string; address: string; source_metadata: string };
type Contact = { id: string; name: string; business_id: string | null; normalized_phone: string };
export class HidacaCrm implements CrmPort {
  constructor(private repo: Repository) {}
  private scope(context: Context) { if (context.tenantId !== HIDACA_TENANT) throw new ProspectingError("unsupported", "El CRM local solo admite la organización HIDACA."); }
  async findCompany(context: Context, prospect: Prospect): Promise<CrmMatch[]> {
    this.scope(context);
    const linked = await this.repo.one<{ remote_id: string }>("SELECT remote_id FROM pi_crm_links WHERE tenant_id=? AND entity_type='company' AND identity_key=?", context.tenantId, prospect.identityKey);
    if (linked) {
      const active = await this.repo.one<Company>("SELECT * FROM businesses WHERE id=? AND archived_at IS NULL", linked.remote_id);
      if (!active) throw new ProspectingError("conflict", "La empresa vinculada está archivada o no existe.");
      return [{ id: active.id, name: active.name, signals: ["external_id"], confidence: "exact" }];
    }
    // Legacy CRM stores phone/address as display text. Filtering those fields
    // with raw equality would omit equivalent formatting before normalization.
    // Keyset pages bound each D1 response; every active record is considered.
    const matches: CrmMatch[] = []; let cursor = "";
    while (true) {
      const rows = await this.repo.all<Company>("SELECT id,name,phone,address,source_metadata FROM businesses WHERE archived_at IS NULL AND id>? ORDER BY id LIMIT 250", cursor);
      for (const row of rows) {
      const signals: string[] = [];
      if (normalize(row.name) === normalize(prospect.name)) signals.push("name");
      if (prospect.phone && normalizePhone(row.phone) === normalizePhone(prospect.phone)) signals.push("phone");
      if (prospect.address && normalize(row.address) === normalize(prospect.address)) signals.push("address");
      try { if (prospect.domain && JSON.parse(row.source_metadata).domain === prospect.domain) signals.push("domain"); } catch { /* Legacy unstructured metadata is not identity evidence. */ }
        if (signals.length) matches.push({ id: row.id, name: row.name, signals, confidence: signals.filter(s => s !== "name").length >= 2 ? "exact" : "review" });
        if (matches.length > 20) throw new ProspectingError("conflict", "Demasiados candidatos; revisar en Empresas.");
      }
      if (rows.length < 250) break;
      cursor = rows[rows.length - 1].id;
    }
    return matches;
  }
  async findContact(context: Context, prospect: Prospect, companyId: string | null): Promise<CrmMatch[]> {
    this.scope(context);
    const key = `${prospect.identityKey}:general`, linked = await this.repo.one<{ remote_id: string }>("SELECT remote_id FROM pi_crm_links WHERE tenant_id=? AND entity_type='contact' AND identity_key=?", context.tenantId, key);
    if (linked) {
      const contact = await this.repo.one<Contact>("SELECT * FROM contacts WHERE id=? AND archived_at IS NULL", linked.remote_id);
      if (!contact || (companyId && contact.business_id !== companyId)) throw new ProspectingError("conflict");
      return [{ id: contact.id, name: contact.name, signals: ["external_id"], confidence: "exact" }];
    }
    if (!prospect.phone) return [];
    const rows = await this.repo.all<Contact>("SELECT id,name,business_id,normalized_phone FROM contacts WHERE archived_at IS NULL AND normalized_phone=? LIMIT 21", normalizePhone(prospect.phone));
    if (rows.length > 20) throw new ProspectingError("conflict");
    return rows.map(c => ({ id: c.id, name: c.name, signals: ["phone", ...(c.business_id === companyId && companyId ? ["company"] : ["different_company"])], confidence: c.business_id === companyId && companyId ? "exact" : "review" }));
  }
  async findOpportunity(context: Context, prospect: Prospect): Promise<string | null> {
    this.scope(context);
    return (await this.repo.one<{ remote_id: string }>("SELECT remote_id FROM pi_crm_links WHERE tenant_id=? AND entity_type='opportunity' AND identity_key=?", context.tenantId, prospect.identityKey))?.remote_id ?? null;
  }
  async ensurePipeline(context: Context) { this.scope(context); return { id: "hidaca-sales", stage: "evaluation" }; }
  async preview(context: Context, prospect: Prospect, input: ConversionMapping): Promise<ConversionPreview> {
    this.scope(context);
    const companies = await this.findCompany(context, prospect);
    const exactCompany = companies.length === 1 && companies[0].confidence === "exact" ? companies[0].id : null;
    const companyId = input.companyId || exactCompany;
    const contactMatches = await this.findContact(context, prospect, companyId);
    const exactContact = contactMatches.length === 1 && contactMatches[0].confidence === "exact" ? contactMatches[0].id : null;
    const mapping = { ...input, companyId, contactId: input.contactId || exactContact };
    const conflicts: string[] = [], missing: string[] = [];
    if (companies.length && !companyId) conflicts.push("Selecciona y revisa la empresa existente.");
    if (companyId && !companies.some(c => c.id === companyId)) conflicts.push("La empresa seleccionada no coincide con las señales del prospecto.");
    if (contactMatches.length && !mapping.contactId) conflicts.push("Selecciona y revisa el contacto existente.");
    const selectedContact = contactMatches.find(c => c.id === mapping.contactId);
    if (mapping.contactId && (!selectedContact || selectedContact.signals.includes("different_company"))) conflicts.push("El contacto debe pertenecer a la empresa seleccionada.");
    if ([...companies.filter(c => c.id === companyId), ...contactMatches.filter(c => c.id === mapping.contactId)].some(c => c.confidence === "review") && !mapping.reviewed) conflicts.push("Confirma la revisión de coincidencias ambiguas.");
    if (!prospect.name) missing.push("Nombre de empresa");
    if (!mapping.contactName && !mapping.contactId) missing.push("Nombre del contacto general");
    if (!prospect.phone && !mapping.contactId) missing.push("Teléfono del negocio para el contacto general");
    if (!mapping.opportunityTitle) missing.push("Título de oportunidad");
    const existingOpportunity = await this.findOpportunity(context, prospect);
    const result = { prospectId: prospect.id, company: { name: prospect.name, matches: companies, action: companies.length && !companyId ? "review" as const : companyId ? "reuse" as const : "create" as const },
      contact: { name: mapping.contactName, matches: contactMatches, action: contactMatches.length && !mapping.contactId ? "review" as const : mapping.contactId ? "reuse" as const : "create" as const },
      opportunity: { title: mapping.opportunityTitle, action: existingOpportunity ? "reuse" as const : "create" as const }, pipeline: await this.ensurePipeline(context), missing, conflicts, mapping };
    return { ...result, fingerprint: await hash([prospect.id, prospect.lastSeen, result]) };
  }
  private async perform(context: Context, exportId: string, operation: string, ordinal: number, remoteId: string, statements: D1PreparedStatement[]) {
    const existing = await this.repo.one<{ remote_id: string; status: string }>("SELECT * FROM pi_export_operations WHERE tenant_id=? AND export_id=? AND operation=?", context.tenantId, exportId, operation);
    if (existing?.status === "completed") return existing.remote_id;
    const now = new Date().toISOString();
    await this.repo.db.batch([...statements, this.repo.statement(`INSERT INTO pi_export_operations(tenant_id,export_id,operation,ordinal,status,remote_id,attempts,updated_at)
      VALUES (?,?,?,?,'completed',?,1,?) ON CONFLICT(tenant_id,export_id,operation) DO UPDATE SET status='completed',remote_id=excluded.remote_id,attempts=attempts+1,updated_at=excluded.updated_at`, context.tenantId, exportId, operation, ordinal, remoteId, now)]);
    return remoteId;
  }
  private link(context: Context, entity: string, key: string, id: string) {
    return this.repo.statement("INSERT INTO pi_crm_links(tenant_id,entity_type,identity_key,remote_id,created_at) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING", context.tenantId, entity, key, id, new Date().toISOString());
  }
  private index(context: Context, entity: string, id: string, title: string, subtitle: string) {
    return this.repo.statement(`INSERT INTO search_documents(entity_type,entity_id,title,subtitle,search_text,owner_email,updated_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(entity_type,entity_id) DO UPDATE SET title=excluded.title,subtitle=excluded.subtitle,search_text=excluded.search_text,updated_at=excluded.updated_at`, entity, id, title, subtitle, `${title} ${subtitle}`, context.actor, new Date().toISOString());
  }
  async createCompany(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string): Promise<string> {
    this.scope(context);
    const id = mapping.companyId ?? `pi_b_${await hash([context.tenantId, prospect.identityKey])}`, now = new Date().toISOString();
    return this.perform(context, exportId, "company", 1, id, [
      ...(!mapping.companyId ? [this.repo.statement(`INSERT INTO businesses(id,name,normalized_name,phone,address,source_metadata,owner_email,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, prospect.name, normalize(prospect.name), prospect.phone, prospect.address, JSON.stringify({ prospectId: prospect.id, domain: prospect.domain, source: "prospecting" }), context.actor, context.actor, now, now), this.index(context, "business", id, prospect.name, prospect.phone)] : []),
      this.link(context, "company", prospect.identityKey, id),
    ]);
  }
  async createContact(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string, companyId: string): Promise<string> {
    this.scope(context);
    const id = mapping.contactId ?? `pi_c_${await hash([context.tenantId, prospect.identityKey])}`, now = new Date().toISOString();
    return this.perform(context, exportId, "contact", 2, id, [
      ...(!mapping.contactId ? [this.repo.statement(`INSERT INTO contacts(id,business_id,name,normalized_name,phone,normalized_phone,title,source_metadata,owner_email,created_by,created_at,updated_at)
        VALUES(?,?,?,?,?,?,'Contacto general',?,?,?,?,?) ON CONFLICT(id) DO NOTHING`, id, companyId, mapping.contactName, normalize(mapping.contactName), prospect.phone, normalizePhone(prospect.phone), JSON.stringify({ prospectId: prospect.id, source: "prospecting", contactType: "general_business" }), context.actor, context.actor, now, now), this.index(context, "contact", id, mapping.contactName, prospect.phone)] : []),
      this.link(context, "contact", `${prospect.identityKey}:general`, id),
    ]);
  }
  async createOpportunity(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string, companyId: string, contactId: string): Promise<string> {
    this.scope(context);
    const id = `pi_o_${await hash([context.tenantId, prospect.identityKey])}`, now = new Date().toISOString();
    return this.perform(context, exportId, "opportunity", 3, id, [
      this.repo.statement(`INSERT INTO opportunities(id,title,business_id,primary_contact_id,stage,owner_email,notes,created_by,created_at,updated_at)
        VALUES(?,?,?,?,'evaluation',?,'Prospecting: oportunidad estimada; sin inferencia de intención de compra.',?,?,?) ON CONFLICT(id) DO NOTHING`, id, mapping.opportunityTitle, companyId, contactId, context.actor, context.actor, now, now),
      this.repo.statement(`INSERT INTO opportunity_stage_history(opportunity_id,to_stage,changed_by,changed_at,note)
        SELECT ?,'evaluation',?,?,'Prospecting: conversión confirmada' WHERE NOT EXISTS(SELECT 1 FROM opportunity_stage_history WHERE opportunity_id=?)`, id, context.actor, now, id),
      this.link(context, "opportunity", prospect.identityKey, id), this.index(context, "opportunity", id, mapping.opportunityTitle, prospect.name),
    ]);
  }
  async convert(context: Context, prospect: Prospect, mapping: ConversionMapping, exportId: string) {
    this.scope(context);
    const companyId = await this.createCompany(context, prospect, mapping, exportId);
    const contactId = await this.createContact(context, prospect, mapping, exportId, companyId);
    const opportunityId = await this.createOpportunity(context, prospect, mapping, exportId, companyId, contactId);
    const pipeline = await this.ensurePipeline(context);
    await this.perform(context, exportId, "pipeline", 4, pipeline.id, []);
    return { companyId, contactId, opportunityId, pipelineId: pipeline.id };
  }
}
