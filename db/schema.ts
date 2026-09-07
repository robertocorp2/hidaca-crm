import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const staffUsers = sqliteTable(
  "staff_users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role", { enum: ["admin", "operator", "viewer"] })
      .notNull()
      .default("operator"),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("staff_users_email_unique").on(table.email)],
);

export const businessRecords = sqliteTable("business_records", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull().default("Activo"),
  customerName: text("customer_name").notNull().default(""),
  contact: text("contact").notNull().default(""),
  amount: real("amount").notNull().default(0),
  balance: real("balance").notNull().default(0),
  dueDate: text("due_date"),
  notes: text("notes").notNull().default(""),
  metadata: text("metadata").notNull().default("{}"),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  archivedAt: text("archived_at"),
});

export const documents = sqliteTable(
  "documents",
  {
    id: text("id").primaryKey(),
    recordId: text("record_id"),
    name: text("name").notNull(),
    objectKey: text("object_key").notNull(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    extension: text("extension").notNull().default(""),
    sha256: text("sha256").notNull().default(""),
    sourcePath: text("source_path").notNull().default(""),
    documentRole: text("document_role", {
      enum: [
        "attachment",
        "source",
        "generated",
        "issued_invoice",
        "receipt",
        "payment_evidence",
        "credit_note",
        "invoice_register",
      ],
    })
      .notNull()
      .default("attachment"),
    parserName: text("parser_name").notNull().default(""),
    parsingStatus: text("parsing_status", {
      enum: ["not_requested", "pending", "parsed", "partial", "failed"],
    })
      .notNull()
      .default("not_requested"),
    importedAt: text("imported_at"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("documents_record_idx").on(table.recordId),
    index("documents_hash_idx").on(table.sha256),
    index("documents_imported_idx").on(table.importedAt),
  ],
);

export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorEmail: text("actor_email").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  detail: text("detail").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const businesses = sqliteTable(
  "businesses",
  {
    id: text("id").primaryKey(),
    legacyRecordId: text("legacy_record_id").references(
      () => businessRecords.id,
    ),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    customerType: text("customer_type", {
      enum: ["organization", "individual"],
    })
      .notNull()
      .default("organization"),
    rnc: text("rnc").notNull().default(""),
    normalizedRnc: text("normalized_rnc").notNull().default(""),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    mobilePhone: text("mobile_phone").notNull().default(""),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    ownerEmail: text("owner_email").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("businesses_legacy_record_unique").on(table.legacyRecordId),
    index("businesses_normalized_name_idx").on(table.normalizedName),
    index("businesses_rnc_idx").on(table.normalizedRnc),
    index("businesses_type_idx").on(table.customerType),
    index("businesses_owner_idx").on(table.ownerEmail),
    index("businesses_updated_idx").on(table.updatedAt),
  ],
);

export const contacts = sqliteTable(
  "contacts",
  {
    id: text("id").primaryKey(),
    legacyRecordId: text("legacy_record_id").references(
      () => businessRecords.id,
    ),
    businessId: text("business_id").references(() => businesses.id),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull().default(""),
    email: text("email").notNull().default(""),
    normalizedEmail: text("normalized_email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    normalizedPhone: text("normalized_phone").notNull().default(""),
    mobilePhone: text("mobile_phone").notNull().default(""),
    normalizedMobilePhone: text("normalized_mobile_phone")
      .notNull()
      .default(""),
    title: text("title").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    ownerEmail: text("owner_email").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("contacts_legacy_record_unique").on(table.legacyRecordId),
    index("contacts_business_idx").on(table.businessId),
    index("contacts_normalized_name_idx").on(table.normalizedName),
    index("contacts_email_idx").on(table.normalizedEmail),
    index("contacts_phone_idx").on(table.normalizedPhone),
    index("contacts_mobile_idx").on(table.normalizedMobilePhone),
    index("contacts_owner_idx").on(table.ownerEmail),
    index("contacts_updated_idx").on(table.updatedAt),
  ],
);

export const companySettings = sqliteTable("company_settings", {
  id: text("id").primaryKey(),
  legalName: text("legal_name").notNull(),
  rnc: text("rnc").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  email: text("email").notNull().default(""),
  brandDivision: text("brand_division").notNull().default(""),
  salesRepresentative: text("sales_representative").notNull().default(""),
  department: text("department").notNull().default(""),
  defaultPaymentTerms: text("default_payment_terms").notNull().default(""),
  defaultQuotationValidity: text("default_quotation_validity")
    .notNull()
    .default(""),
  defaultWarranty: text("default_warranty").notNull().default(""),
  defaultObservations: text("default_observations").notNull().default(""),
  defaultPolicies: text("default_policies").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    legacyRecordId: text("legacy_record_id").references(
      () => businessRecords.id,
    ),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    primaryContactId: text("primary_contact_id").references(() => contacts.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    projectType: text("project_type").notNull().default(""),
    serviceCategory: text("service_category").notNull().default(""),
    status: text("status").notNull().default("active"),
    notes: text("notes").notNull().default(""),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    ownerEmail: text("owner_email").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("projects_legacy_record_unique").on(table.legacyRecordId),
    index("projects_business_idx").on(table.businessId),
    index("projects_contact_idx").on(table.primaryContactId),
    index("projects_name_idx").on(table.name),
    index("projects_type_idx").on(table.projectType),
    index("projects_status_idx").on(table.status),
    index("projects_updated_idx").on(table.updatedAt),
  ],
);

export const addresses = sqliteTable(
  "addresses",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id").references(() => businesses.id, {
      onDelete: "cascade",
    }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    type: text("type", {
      enum: ["billing", "project", "mailing", "other"],
    })
      .notNull()
      .default("other"),
    label: text("label").notNull().default(""),
    line1: text("line1").notNull(),
    line2: text("line2").notNull().default(""),
    city: text("city").notNull().default(""),
    province: text("province").notNull().default(""),
    postalCode: text("postal_code").notNull().default(""),
    country: text("country").notNull().default("República Dominicana"),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("addresses_business_idx").on(table.businessId, table.type),
    index("addresses_contact_idx").on(table.contactId),
    index("addresses_project_idx").on(table.projectId),
  ],
);

export const projectContacts = sqliteTable(
  "project_contacts",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: text("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role").notNull().default(""),
    isPrimary: integer("is_primary", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.projectId, table.contactId],
      name: "project_contacts_pk",
    }),
    index("project_contacts_contact_idx").on(table.contactId),
    index("project_contacts_primary_idx").on(table.projectId, table.isPrimary),
  ],
);

export const projectLocations = sqliteTable(
  "project_locations",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    addressId: text("address_id").references(() => addresses.id, {
      onDelete: "set null",
    }),
    label: text("label").notNull().default(""),
    building: text("building").notNull().default(""),
    apartment: text("apartment").notNull().default(""),
    floor: text("floor").notNull().default(""),
    area: text("area").notNull().default(""),
    room: text("room").notNull().default(""),
    balcony: text("balcony").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("project_locations_project_idx").on(table.projectId),
    index("project_locations_address_idx").on(table.addressId),
    index("project_locations_building_idx").on(table.building),
  ],
);

export const leads = sqliteTable(
  "leads",
  {
    id: text("id").primaryKey(),
    businessName: text("business_name").notNull(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull().default(""),
    normalizedEmail: text("normalized_email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    normalizedPhone: text("normalized_phone").notNull().default(""),
    source: text("source").notNull().default(""),
    status: text("status", {
      enum: ["new", "contacted", "working", "unqualified", "converted"],
    })
      .notNull()
      .default("new"),
    ownerEmail: text("owner_email").notNull(),
    notes: text("notes").notNull().default(""),
    convertedBusinessId: text("converted_business_id").references(
      () => businesses.id,
    ),
    convertedContactId: text("converted_contact_id").references(
      () => contacts.id,
    ),
    convertedOpportunityId: text("converted_opportunity_id"),
    convertedAt: text("converted_at"),
    convertedBy: text("converted_by"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("leads_status_idx").on(table.status),
    index("leads_owner_idx").on(table.ownerEmail),
    index("leads_email_idx").on(table.normalizedEmail),
    index("leads_phone_idx").on(table.normalizedPhone),
    index("leads_updated_idx").on(table.updatedAt),
  ],
);

export const leadStatusHistory = sqliteTable(
  "lead_status_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leadId: text("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    fromStatus: text("from_status"),
    toStatus: text("to_status").notNull(),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull(),
    note: text("note").notNull().default(""),
  },
  (table) => [
    index("lead_status_history_lead_idx").on(table.leadId, table.changedAt),
  ],
);

export const opportunities = sqliteTable(
  "opportunities",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    primaryContactId: text("primary_contact_id").references(() => contacts.id),
    projectId: text("project_id").references(() => projects.id),
    relatedLeadId: text("related_lead_id").references(() => leads.id),
    stage: text("stage", {
      enum: ["evaluation", "quote", "negotiation_review", "closed"],
    })
      .notNull()
      .default("evaluation"),
    outcome: text("outcome", { enum: ["won", "lost"] }),
    estimatedValue: real("estimated_value").notNull().default(0),
    expectedCloseDate: text("expected_close_date"),
    lossReason: text("loss_reason").notNull().default(""),
    ownerEmail: text("owner_email").notNull(),
    notes: text("notes").notNull().default(""),
    closedAt: text("closed_at"),
    closedBy: text("closed_by"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("opportunities_related_lead_unique").on(table.relatedLeadId),
    index("opportunities_business_idx").on(table.businessId),
    index("opportunities_contact_idx").on(table.primaryContactId),
    index("opportunities_project_idx").on(table.projectId),
    index("opportunities_stage_idx").on(table.stage),
    index("opportunities_owner_idx").on(table.ownerEmail),
    index("opportunities_close_date_idx").on(table.expectedCloseDate),
    index("opportunities_updated_idx").on(table.updatedAt),
  ],
);

export const opportunityStageHistory = sqliteTable(
  "opportunity_stage_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    outcome: text("outcome"),
    changedBy: text("changed_by").notNull(),
    changedAt: text("changed_at").notNull(),
    note: text("note").notNull().default(""),
  },
  (table) => [
    index("opportunity_stage_history_opportunity_idx").on(
      table.opportunityId,
      table.changedAt,
    ),
  ],
);

export const activities = sqliteTable(
  "activities",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    allDay: integer("all_day", { mode: "boolean" }).notNull().default(false),
    status: text("status", {
      enum: ["planned", "completed", "cancelled"],
    })
      .notNull()
      .default("planned"),
    ownerEmail: text("owner_email").notNull(),
    attendees: text("attendees").notNull().default("[]"),
    location: text("location").notNull().default(""),
    relatedType: text("related_type"),
    relatedId: text("related_id"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("activities_start_idx").on(table.startAt),
    index("activities_owner_idx").on(table.ownerEmail),
    index("activities_status_idx").on(table.status),
    index("activities_related_idx").on(table.relatedType, table.relatedId),
  ],
);

export const opportunityQuotes = sqliteTable(
  "opportunity_quotes",
  {
    opportunityId: text("opportunity_id")
      .notNull()
      .references(() => opportunities.id, { onDelete: "cascade" }),
    quoteRecordId: text("quote_record_id")
      .notNull()
      .references(() => businessRecords.id),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.opportunityId, table.quoteRecordId],
      name: "opportunity_quotes_pk",
    }),
    index("opportunity_quotes_quote_idx").on(table.quoteRecordId),
  ],
);

export const quotations = sqliteTable(
  "quotations",
  {
    id: text("id").primaryKey(),
    legacyRecordId: text("legacy_record_id").references(
      () => businessRecords.id,
    ),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    primaryContactId: text("primary_contact_id").references(() => contacts.id),
    projectId: text("project_id").references(() => projects.id),
    opportunityId: text("opportunity_id").references(() => opportunities.id),
    quotationNumber: text("quotation_number").notNull(),
    normalizedQuotationNumber: text("normalized_quotation_number")
      .notNull()
      .default(""),
    familyKey: text("family_key").notNull().default(""),
    quotationYear: integer("quotation_year"),
    title: text("title").notNull(),
    quotationType: text("quotation_type", {
      enum: ["installation", "repair", "maintenance", "mixed", "other"],
    })
      .notNull()
      .default("other"),
    serviceCategory: text("service_category").notNull().default(""),
    status: text("status", {
      enum: [
        "draft",
        "sent",
        "accepted",
        "rejected",
        "expired",
        "cancelled",
        "unknown",
      ],
    })
      .notNull()
      .default("draft"),
    currency: text("currency").notNull().default("DOP"),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    ownerEmail: text("owner_email").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("quotations_legacy_record_unique").on(table.legacyRecordId),
    index("quotations_number_year_idx").on(
      table.quotationNumber,
      table.quotationYear,
    ),
    index("quotations_family_idx").on(table.familyKey, table.businessId),
    index("quotations_normalized_number_idx").on(
      table.normalizedQuotationNumber,
    ),
    index("quotations_business_idx").on(table.businessId),
    index("quotations_contact_idx").on(table.primaryContactId),
    index("quotations_project_idx").on(table.projectId),
    index("quotations_opportunity_idx").on(table.opportunityId),
    index("quotations_status_idx").on(table.status),
    index("quotations_type_idx").on(table.quotationType),
    index("quotations_updated_idx").on(table.updatedAt),
  ],
);

export const quotationRevisions = sqliteTable(
  "quotation_revisions",
  {
    id: text("id").primaryKey(),
    quotationId: text("quotation_id")
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    parentRevisionId: text("parent_revision_id"),
    identityKey: text("identity_key").notNull(),
    revisionNumber: integer("revision_number").notNull().default(1),
    revisionLabel: text("revision_label").notNull().default(""),
    alternativeLabel: text("alternative_label").notNull().default(""),
    scopeLabel: text("scope_label").notNull().default(""),
    quotationDate: text("quotation_date"),
    quotationMonth: integer("quotation_month"),
    sourceDateRaw: text("source_date_raw").notNull().default(""),
    sourceMonthRaw: text("source_month_raw").notNull().default(""),
    sourceYearRaw: text("source_year_raw").notNull().default(""),
    validityUntil: text("validity_until"),
    isCurrent: integer("is_current", { mode: "boolean" })
      .notNull()
      .default(true),
    customerFacingNotes: text("customer_facing_notes").notNull().default(""),
    internalNotes: text("internal_notes").notNull().default(""),
    sourceMetadata: text("source_metadata").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("quotation_revisions_identity_unique").on(
      table.quotationId,
      table.identityKey,
    ),
    index("quotation_revisions_quote_idx").on(
      table.quotationId,
      table.revisionNumber,
    ),
    index("quotation_revisions_parent_idx").on(table.parentRevisionId),
    index("quotation_revisions_date_idx").on(table.quotationDate),
    index("quotation_revisions_month_idx").on(table.quotationMonth),
    index("quotation_revisions_current_idx").on(
      table.quotationId,
      table.isCurrent,
    ),
  ],
);

export const quotationSections = sqliteTable(
  "quotation_sections",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
  },
  (table) => [
    index("quotation_sections_revision_idx").on(
      table.revisionId,
      table.sortOrder,
    ),
  ],
);

export const quotationLineItems = sqliteTable(
  "quotation_line_items",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    sectionId: text("section_id").references(() => quotationSections.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    itemCode: text("item_code").notNull().default(""),
    description: text("description").notNull(),
    category: text("category").notNull().default(""),
    product: text("product").notNull().default(""),
    service: text("service").notNull().default(""),
    location: text("location").notNull().default(""),
    quantity: real("quantity"),
    unitOfMeasure: text("unit_of_measure").notNull().default(""),
    meters: real("meters"),
    openingWidthCm: real("opening_width_cm"),
    openingHeightCm: real("opening_height_cm"),
    finishedWidthCm: real("finished_width_cm"),
    finishedHeightCm: real("finished_height_cm"),
    areaSqm: real("area_sqm"),
    priceBasis: text("price_basis", {
      enum: ["unit", "square_meter", "flat_fee", "other"],
    }),
    unitPrice: real("unit_price"),
    pricePerSqm: real("price_per_sqm"),
    flatFee: real("flat_fee"),
    discountAmount: real("discount_amount"),
    taxAmount: real("tax_amount"),
    sourceLineTotal: real("source_line_total"),
    calculatedLineTotal: real("calculated_line_total"),
    currency: text("currency").notNull().default("DOP"),
    motorType: text("motor_type").notNull().default(""),
    controlType: text("control_type").notNull().default(""),
    material: text("material").notNull().default(""),
    notes: text("notes").notNull().default(""),
    valueStates: text("value_states").notNull().default("{}"),
    sourceValues: text("source_values").notNull().default("{}"),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("quotation_line_items_revision_idx").on(
      table.revisionId,
      table.sortOrder,
    ),
    index("quotation_line_items_section_idx").on(table.sectionId),
    index("quotation_line_items_code_idx").on(table.itemCode),
    index("quotation_line_items_category_idx").on(table.category),
  ],
);

export const measurements = sqliteTable(
  "measurements",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    lineItemId: text("line_item_id").references(() => quotationLineItems.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id").references(() => projects.id),
    location: text("location").notNull().default(""),
    building: text("building").notNull().default(""),
    apartment: text("apartment").notNull().default(""),
    floor: text("floor").notNull().default(""),
    level: text("level").notNull().default(""),
    room: text("room").notNull().default(""),
    areaLabel: text("area_label").notNull().default(""),
    openingWidthCm: real("opening_width_cm"),
    openingHeightCm: real("opening_height_cm"),
    finishedWidthCm: real("finished_width_cm"),
    finishedHeightCm: real("finished_height_cm"),
    areaSqm: real("area_sqm"),
    quantity: real("quantity"),
    valueStates: text("value_states").notNull().default("{}"),
    sourceValues: text("source_values").notNull().default("{}"),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("measurements_revision_idx").on(table.revisionId),
    index("measurements_line_item_idx").on(table.lineItemId),
    index("measurements_project_idx").on(table.projectId),
    index("measurements_location_idx").on(table.location),
  ],
);

export const quotationFinancials = sqliteTable(
  "quotation_financials",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    currency: text("currency").notNull().default("DOP"),
    sourceSubtotal: real("source_subtotal"),
    calculatedSubtotal: real("calculated_subtotal"),
    discountRate: real("discount_rate"),
    discountAmount: real("discount_amount"),
    discountReason: text("discount_reason").notNull().default(""),
    sourceSubtotalAfterDiscount: real("source_subtotal_after_discount"),
    calculatedSubtotalAfterDiscount: real("calculated_subtotal_after_discount"),
    sourceTaxRate: real("source_tax_rate"),
    sourceTaxAmount: real("source_tax_amount"),
    calculatedTaxAmount: real("calculated_tax_amount"),
    taxName: text("tax_name").notNull().default(""),
    taxExempt: integer("tax_exempt", { mode: "boolean" }),
    sourceTotal: real("source_total"),
    calculatedTotal: real("calculated_total"),
    sourceTotalDop: real("source_total_dop"),
    sourceTotalUsd: real("source_total_usd"),
    exchangeRate: real("exchange_rate"),
    amountPaid: real("amount_paid"),
    remainingBalance: real("remaining_balance"),
    paymentStatus: text("payment_status", {
      enum: ["unpaid", "partial", "paid", "overdue", "unknown"],
    })
      .notNull()
      .default("unknown"),
    discrepancyAmount: real("discrepancy_amount"),
    valueStates: text("value_states").notNull().default("{}"),
    sourceValues: text("source_values").notNull().default("{}"),
    validatedAt: text("validated_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("quotation_financials_revision_unique").on(table.revisionId),
    index("quotation_financials_status_idx").on(table.paymentStatus),
    index("quotation_financials_total_idx").on(
      table.currency,
      table.sourceTotal,
    ),
  ],
);

export const quotationCharges = sqliteTable(
  "quotation_charges",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    type: text("type", {
      enum: [
        "installation",
        "repair",
        "maintenance",
        "transportation",
        "scaffolding",
        "technical_supervision",
        "discount",
        "tax",
        "other",
      ],
    }).notNull(),
    label: text("label").notNull(),
    sourceAmount: real("source_amount"),
    calculatedAmount: real("calculated_amount"),
    rate: real("rate"),
    currency: text("currency").notNull().default("DOP"),
    valueState: text("value_state", {
      enum: [
        "blank",
        "zero",
        "not_applicable",
        "not_calculated",
        "value",
        "invalid",
      ],
    })
      .notNull()
      .default("blank"),
    notes: text("notes").notNull().default(""),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("quotation_charges_revision_idx").on(
      table.revisionId,
      table.sortOrder,
    ),
    index("quotation_charges_type_idx").on(table.type),
  ],
);

export const quotationTerms = sqliteTable(
  "quotation_terms",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    quotationValidity: text("quotation_validity").notNull().default(""),
    paymentConditions: text("payment_conditions").notNull().default(""),
    warranty: text("warranty").notNull().default(""),
    returnPolicy: text("return_policy").notNull().default(""),
    installationObservations: text("installation_observations")
      .notNull()
      .default(""),
    maintenanceDisclaimer: text("maintenance_disclaimer").notNull().default(""),
    unforeseenPartsDisclaimer: text("unforeseen_parts_disclaimer")
      .notNull()
      .default(""),
    additionalCostNotice: text("additional_cost_notice").notNull().default(""),
    originalSpanishText: text("original_spanish_text").notNull().default(""),
    sourceValues: text("source_values").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("quotation_terms_revision_unique").on(table.revisionId),
  ],
);

export const payments = sqliteTable(
  "payments",
  {
    id: text("id").primaryKey(),
    legacyRecordId: text("legacy_record_id").references(
      () => businessRecords.id,
    ),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    projectId: text("project_id").references(() => projects.id),
    revisionId: text("revision_id").references(() => quotationRevisions.id),
    sourceDocumentId: text("source_document_id").references(() => documents.id),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "restrict",
    }),
    type: text("type", {
      enum: ["advance", "partial", "final", "refund", "adjustment"],
    })
      .notNull()
      .default("partial"),
    amount: real("amount"),
    currency: text("currency").notNull().default("DOP"),
    paymentDate: text("payment_date"),
    method: text("method").notNull().default(""),
    status: text("status", {
      enum: ["pending", "received", "cleared", "void", "unknown"],
    })
      .notNull()
      .default("unknown"),
    label: text("label").notNull().default(""),
    installmentNumber: integer("installment_number"),
    installmentReference: text("installment_reference").notNull().default(""),
    transactionReference: text("transaction_reference").notNull().default(""),
    receiptNumber: text("receipt_number").notNull().default(""),
    payerName: text("payer_name").notNull().default(""),
    bankName: text("bank_name").notNull().default(""),
    accountLast4: text("account_last4").notNull().default(""),
    evidenceStatus: text("evidence_status", {
      enum: ["documented", "matrix_only", "manual", "unverified"],
    })
      .notNull()
      .default("unverified"),
    voidedAt: text("voided_at"),
    voidReason: text("void_reason").notNull().default(""),
    notes: text("notes").notNull().default(""),
    valueStates: text("value_states").notNull().default("{}"),
    sourceValues: text("source_values").notNull().default("{}"),
    sourceLocation: text("source_location").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("payments_legacy_record_unique").on(table.legacyRecordId),
    index("payments_business_idx").on(table.businessId, table.paymentDate),
    index("payments_project_idx").on(table.projectId),
    index("payments_revision_idx").on(table.revisionId),
    index("payments_status_idx").on(table.status),
    index("payments_date_idx").on(table.paymentDate),
    index("payments_evidence_status_idx").on(table.evidenceStatus),
    index("payments_import_batch_idx").on(table.importBatchId),
    index("payments_legacy_idx").on(table.legacyRecordId),
    uniqueIndex("payments_transaction_unique")
      .on(
        table.businessId,
        table.transactionReference,
        table.paymentDate,
        table.amount,
      )
      .where(sql`${table.transactionReference} <> ''`),
  ],
);

export const manufacturingWorksheets = sqliteTable(
  "manufacturing_worksheets",
  {
    id: text("id").primaryKey(),
    revisionId: text("revision_id")
      .notNull()
      .references(() => quotationRevisions.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id").references(() => documents.id),
    name: text("name").notNull(),
    worksheetType: text("worksheet_type", {
      enum: ["material_breakdown", "bill_of_materials", "production", "other"],
    })
      .notNull()
      .default("production"),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    calculationStatus: text("calculation_status", {
      enum: ["valid", "warning", "broken", "unsupported", "not_calculated"],
    })
      .notNull()
      .default("not_calculated"),
    sourceFormulaSummary: text("source_formula_summary")
      .notNull()
      .default("{}"),
    notes: text("notes").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("manufacturing_worksheets_revision_idx").on(table.revisionId),
    index("manufacturing_worksheets_document_idx").on(table.sourceDocumentId),
    index("manufacturing_worksheets_status_idx").on(table.calculationStatus),
  ],
);

export const materialComponents = sqliteTable(
  "material_components",
  {
    id: text("id").primaryKey(),
    worksheetId: text("worksheet_id")
      .notNull()
      .references(() => manufacturingWorksheets.id, { onDelete: "cascade" }),
    lineItemId: text("line_item_id").references(() => quotationLineItems.id),
    componentType: text("component_type", {
      enum: [
        "slat",
        "box",
        "tube",
        "motor",
        "side_cap",
        "control",
        "receiver",
        "material",
        "labor",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    quantity: real("quantity"),
    unitOfMeasure: text("unit_of_measure").notNull().default(""),
    widthCm: real("width_cm"),
    heightCm: real("height_cm"),
    unitCost: real("unit_cost"),
    totalCost: real("total_cost"),
    currency: text("currency").notNull().default("DOP"),
    sourceFormula: text("source_formula").notNull().default(""),
    formulaResult: text("formula_result").notNull().default(""),
    formulaStatus: text("formula_status", {
      enum: ["valid", "broken", "unsupported", "not_calculated"],
    })
      .notNull()
      .default("not_calculated"),
    valueStates: text("value_states").notNull().default("{}"),
    sourceValues: text("source_values").notNull().default("{}"),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("material_components_worksheet_idx").on(
      table.worksheetId,
      table.sortOrder,
    ),
    index("material_components_line_idx").on(table.lineItemId),
    index("material_components_type_idx").on(table.componentType),
  ],
);

export const importBatches = sqliteTable(
  "import_batches",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", {
      enum: [
        "pending",
        "processing",
        "review_required",
        "completed",
        "failed",
        "cancelled",
        "reversed",
      ],
    })
      .notNull()
      .default("pending"),
    source: text("source").notNull().default("upload"),
    sourceFilename: text("source_filename").notNull().default(""),
    sourceHash: text("source_hash").notNull().default(""),
    dryRun: integer("dry_run", { mode: "boolean" }).notNull().default(true),
    fileCount: integer("file_count").notNull().default(0),
    totalRows: integer("total_rows").notNull().default(0),
    successfulCount: integer("successful_count").notNull().default(0),
    matchedCount: integer("matched_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    unmappedFieldCount: integer("unmapped_field_count").notNull().default(0),
    summaryJson: text("summary_json").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
  },
  (table) => [
    index("import_batches_status_idx").on(table.status, table.createdAt),
    index("import_batches_hash_idx").on(table.sourceHash),
  ],
);

export const importFiles = sqliteTable(
  "import_files",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id),
    filename: text("filename").notNull(),
    extension: text("extension").notNull(),
    sourcePath: text("source_path").notNull().default(""),
    sha256: text("sha256").notNull(),
    parserName: text("parser_name").notNull().default(""),
    parserVersion: text("parser_version").notNull().default(""),
    documentKind: text("document_kind", {
      enum: [
        "invoice",
        "receipt",
        "payment_evidence",
        "credit_note",
        "invoice_register",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    sourceModifiedAt: text("source_modified_at"),
    downloadStatus: text("download_status", {
      enum: ["downloaded", "inaccessible"],
    })
      .notNull()
      .default("downloaded"),
    deltaStatus: text("delta_status", {
      enum: ["unchanged", "added", "changed", "removed", "inaccessible"],
    })
      .notNull()
      .default("unchanged"),
    templateType: text("template_type", {
      enum: [
        "installation",
        "repair_maintenance",
        "production",
        "register",
        "unknown",
      ],
    })
      .notNull()
      .default("unknown"),
    status: text("status", {
      enum: [
        "pending",
        "parsed",
        "partial",
        "review_required",
        "accepted",
        "failed",
        "duplicate",
      ],
    })
      .notNull()
      .default("pending"),
    rawExtractedData: text("raw_extracted_data").notNull().default("{}"),
    extractedObjectKey: text("extracted_object_key").notNull().default(""),
    extractedSize: integer("extracted_size").notNull().default(0),
    normalizedPreview: text("normalized_preview").notNull().default("{}"),
    canonicalLinks: text("canonical_links").notNull().default("{}"),
    importedBy: text("imported_by").notNull(),
    importedAt: text("imported_at").notNull(),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    acceptedBy: text("accepted_by"),
    acceptedAt: text("accepted_at"),
    errorMessage: text("error_message").notNull().default(""),
  },
  (table) => [
    index("import_files_batch_idx").on(table.batchId, table.status),
    index("import_files_hash_idx").on(table.sha256),
    index("import_files_status_idx").on(table.status, table.importedAt),
    index("import_files_template_idx").on(table.templateType),
    index("import_files_document_kind_idx").on(table.documentKind),
    index("import_files_filename_idx").on(table.filename),
  ],
);

export const importBatchSources = sqliteTable(
  "import_batch_sources",
  {
    id: text("id").primaryKey(),
    batchId: text("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    originLabel: text("origin_label").notNull(),
    sourceWorkbookName: text("source_workbook_name").notNull().default(""),
    expectedRows: integer("expected_rows").notNull().default(0),
    expectedLinks: integer("expected_links").notNull().default(0),
    discoveredRows: integer("discovered_rows").notNull().default(0),
    importedRows: integer("imported_rows").notNull().default(0),
    matchedRows: integer("matched_rows").notNull().default(0),
    duplicateRows: integer("duplicate_rows").notNull().default(0),
    reviewRows: integer("review_rows").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
  },
  (table) => [
    uniqueIndex("import_batch_sources_origin_unique").on(
      table.batchId,
      table.originLabel,
    ),
    index("import_batch_sources_batch_idx").on(table.batchId),
  ],
);

export const importRows = sqliteTable(
  "import_rows",
  {
    id: text("id").primaryKey(),
    importFileId: text("import_file_id")
      .notNull()
      .references(() => importFiles.id, { onDelete: "cascade" }),
    worksheetName: text("worksheet_name").notNull(),
    sourceRowNumber: integer("source_row_number").notNull(),
    rowFingerprint: text("row_fingerprint").notNull(),
    identityFingerprint: text("identity_fingerprint").notNull().default(""),
    documentKind: text("document_kind", {
      enum: [
        "invoice",
        "receipt",
        "payment_evidence",
        "credit_note",
        "invoice_register",
        "other",
      ],
    })
      .notNull()
      .default("other"),
    rawValues: text("raw_values").notNull().default("{}"),
    normalizedValues: text("normalized_values").notNull().default("{}"),
    outcome: text("outcome", {
      enum: [
        "pending",
        "ready",
        "imported",
        "matched",
        "duplicate_candidate",
        "manual_review",
        "failed",
        "skipped",
      ],
    })
      .notNull()
      .default("pending"),
    matchConfidence: text("match_confidence", {
      enum: ["high", "medium", "low", "manual_review"],
    })
      .notNull()
      .default("manual_review"),
    warnings: text("warnings").notNull().default("[]"),
    errors: text("errors").notNull().default("[]"),
    sourceFilename: text("source_filename").notNull().default(""),
    sourceDocumentUri: text("source_document_uri").notNull().default(""),
    sourceOrigin: text("source_origin").notNull().default(""),
    businessId: text("business_id").references(() => businesses.id, {
      onDelete: "set null",
    }),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    quotationId: text("quotation_id").references(() => quotations.id, {
      onDelete: "set null",
    }),
    revisionId: text("revision_id").references(() => quotationRevisions.id, {
      onDelete: "set null",
    }),
    reviewedBy: text("reviewed_by"),
    reviewedAt: text("reviewed_at"),
    acceptedBy: text("accepted_by"),
    acceptedAt: text("accepted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("import_rows_source_unique").on(
      table.importFileId,
      table.worksheetName,
      table.sourceRowNumber,
    ),
    index("import_rows_file_outcome_idx").on(table.importFileId, table.outcome),
    index("import_rows_fingerprint_idx").on(table.rowFingerprint),
    index("import_rows_identity_idx").on(table.identityFingerprint),
    index("import_rows_document_kind_idx").on(table.documentKind),
    index("import_rows_origin_idx").on(table.sourceOrigin),
    index("import_rows_business_idx").on(table.businessId),
    index("import_rows_quotation_idx").on(table.quotationId),
    index("import_rows_revision_idx").on(table.revisionId),
  ],
);

export const sourceFieldValues = sqliteTable(
  "source_field_values",
  {
    id: text("id").primaryKey(),
    importFileId: text("import_file_id")
      .notNull()
      .references(() => importFiles.id, { onDelete: "cascade" }),
    importRowId: text("import_row_id").references(() => importRows.id, {
      onDelete: "cascade",
    }),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourcePage: integer("source_page"),
    sourceRowNumber: integer("source_row_number"),
    sourceCell: text("source_cell").notNull().default(""),
    sourceLabel: text("source_label").notNull().default(""),
    rawValue: text("raw_value").notNull(),
    displayValue: text("display_value").notNull().default(""),
    sourceFormula: text("source_formula").notNull().default(""),
    normalizedValue: text("normalized_value").notNull().default(""),
    canonicalEntity: text("canonical_entity").notNull().default(""),
    canonicalField: text("canonical_field").notNull().default(""),
    transformation: text("transformation").notNull().default(""),
    confidence: text("confidence", {
      enum: ["high", "medium", "low", "manual_review"],
    })
      .notNull()
      .default("manual_review"),
    valueState: text("value_state", {
      enum: [
        "blank",
        "zero",
        "not_applicable",
        "not_calculated",
        "value",
        "invalid",
      ],
    })
      .notNull()
      .default("value"),
    mappingStatus: text("mapping_status", {
      enum: ["mapped", "unmapped", "corrected", "ignored"],
    })
      .notNull()
      .default("unmapped"),
    correctedBy: text("corrected_by"),
    correctedAt: text("corrected_at"),
  },
  (table) => [
    index("source_field_values_file_idx").on(table.importFileId),
    index("source_field_values_row_idx").on(
      table.importRowId,
      table.sourceRowNumber,
    ),
    index("source_field_values_mapping_idx").on(
      table.mappingStatus,
      table.confidence,
    ),
    index("source_field_values_target_idx").on(
      table.canonicalEntity,
      table.canonicalField,
    ),
    index("source_field_values_label_idx").on(table.sourceLabel),
  ],
);

export const importIssues = sqliteTable(
  "import_issues",
  {
    id: text("id").primaryKey(),
    importFileId: text("import_file_id")
      .notNull()
      .references(() => importFiles.id, { onDelete: "cascade" }),
    importRowId: text("import_row_id").references(() => importRows.id, {
      onDelete: "cascade",
    }),
    sourceFieldValueId: text("source_field_value_id").references(
      () => sourceFieldValues.id,
      { onDelete: "set null" },
    ),
    type: text("type", {
      enum: [
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
        "duplicate_row",
        "month_mismatch",
        "source_unavailable",
        "low_confidence_match",
        "ocr_required",
        "invalid_identifier",
        "duplicate_ncf",
        "cancelled_replacement_ambiguity",
        "tax_treatment_unexplained",
        "negative_balance",
        "balance_reconciliation",
        "payment_evidence_missing",
        "orphan_credit_note",
        "provenance_missing",
        "document_matrix_conflict",
        "filename_content_mismatch",
        "document_version_conflict",
      ],
    }).notNull(),
    severity: text("severity", {
      enum: ["info", "warning", "error", "blocking"],
    })
      .notNull()
      .default("warning"),
    status: text("status", {
      enum: ["open", "resolved", "dismissed"],
    })
      .notNull()
      .default("open"),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    sourceLocation: text("source_location").notNull().default(""),
    resolution: text("resolution").notNull().default(""),
    resolvedBy: text("resolved_by"),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("import_issues_file_idx").on(
      table.importFileId,
      table.status,
      table.severity,
    ),
    index("import_issues_row_idx").on(table.importRowId, table.status),
    index("import_issues_type_idx").on(table.type, table.status),
  ],
);

export const importCandidates = sqliteTable(
  "import_candidates",
  {
    id: text("id").primaryKey(),
    importFileId: text("import_file_id")
      .notNull()
      .references(() => importFiles.id, { onDelete: "cascade" }),
    importRowId: text("import_row_id").references(() => importRows.id, {
      onDelete: "cascade",
    }),
    candidateType: text("candidate_type", {
      enum: [
        "business",
        "contact",
        "project",
        "quotation",
        "quotation_revision",
        "source_document",
        "invoice",
        "payment",
        "credit_note",
        "tax_configuration",
      ],
    }).notNull(),
    candidateEntityId: text("candidate_entity_id").notNull(),
    score: real("score").notNull().default(0),
    reasons: text("reasons").notNull().default("[]"),
    status: text("status", {
      enum: ["suggested", "selected", "rejected"],
    })
      .notNull()
      .default("suggested"),
    decidedBy: text("decided_by"),
    decidedAt: text("decided_at"),
  },
  (table) => [
    index("import_candidates_file_idx").on(
      table.importFileId,
      table.candidateType,
      table.score,
    ),
    index("import_candidates_row_idx").on(
      table.importRowId,
      table.candidateType,
      table.score,
    ),
    index("import_candidates_entity_idx").on(
      table.candidateType,
      table.candidateEntityId,
    ),
  ],
);

export const sourceReferences = sqliteTable(
  "source_references",
  {
    id: text("id").primaryKey(),
    importRowId: text("import_row_id").references(() => importRows.id, {
      onDelete: "cascade",
    }),
    revisionId: text("revision_id").references(() => quotationRevisions.id, {
      onDelete: "set null",
    }),
    documentId: text("document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    originalFilename: text("original_filename").notNull().default(""),
    originalUri: text("original_uri").notNull().default(""),
    uriScheme: text("uri_scheme", {
      enum: ["https", "http", "file", "drive", "none", "other"],
    })
      .notNull()
      .default("none"),
    availability: text("availability", {
      enum: ["available", "unresolved", "missing", "invalid"],
    })
      .notNull()
      .default("unresolved"),
    sourceOrigin: text("source_origin").notNull().default(""),
    fileHash: text("file_hash").notNull().default(""),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("source_references_row_idx").on(table.importRowId),
    index("source_references_revision_idx").on(table.revisionId),
    index("source_references_document_idx").on(table.documentId),
    index("source_references_filename_idx").on(table.originalFilename),
    index("source_references_origin_idx").on(table.sourceOrigin),
  ],
);

export const documentLinks = sqliteTable(
  "document_links",
  {
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    purpose: text("purpose", {
      enum: [
        "source",
        "attachment",
        "supporting",
        "generated",
        "issued_document",
        "payment_evidence",
        "credit_note",
        "paired_representation",
      ],
    })
      .notNull()
      .default("attachment"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.documentId, table.entityType, table.entityId],
      name: "document_links_pk",
    }),
    index("document_links_entity_idx").on(table.entityType, table.entityId),
  ],
);

export const entityHistory = sqliteTable(
  "entity_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    fieldName: text("field_name").notNull().default(""),
    previousValue: text("previous_value").notNull().default(""),
    newValue: text("new_value").notNull().default(""),
    sourceDocumentId: text("source_document_id").references(() => documents.id),
    actorEmail: text("actor_email").notNull(),
    reason: text("reason").notNull().default(""),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("entity_history_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    index("entity_history_source_idx").on(table.sourceDocumentId),
  ],
);

export const searchDocuments = sqliteTable(
  "search_documents",
  {
    rowId: integer("row_id").primaryKey({ autoIncrement: true }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    searchText: text("search_text").notNull().default(""),
    ownerEmail: text("owner_email").notNull().default(""),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("search_documents_entity_unique").on(
      table.entityType,
      table.entityId,
    ),
    index("search_documents_type_idx").on(table.entityType),
    index("search_documents_owner_idx").on(table.ownerEmail),
  ],
);

export const taxConfigurations = sqliteTable(
  "tax_configurations",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    label: text("label").notNull(),
    taxKind: text("tax_kind").notNull(),
    rate: real("rate").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    effectiveTo: text("effective_to"),
    appliesTo: text("applies_to", {
      enum: ["line", "invoice", "fee"],
    }).notNull(),
    calculationBasis: text("calculation_basis").notNull().default(""),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    source: text("source").notNull().default(""),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("tax_configurations_code_effective_unique").on(
      table.code,
      table.effectiveFrom,
    ),
    index("tax_configurations_kind_idx").on(table.taxKind),
    index("tax_configurations_effective_idx").on(
      table.effectiveFrom,
      table.effectiveTo,
    ),
    index("tax_configurations_active_idx").on(table.active),
    check("tax_configurations_rate_check", sql`${table.rate} >= 0`),
    check(
      "tax_configurations_applies_to_check",
      sql`${table.appliesTo} in ('line', 'invoice', 'fee')`,
    ),
  ],
);

export const productsServices = sqliteTable(
  "products_services",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull().default(""),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    kind: text("kind", {
      enum: ["product", "service", "labor", "fee", "other"],
    })
      .notNull()
      .default("other"),
    defaultUnit: text("default_unit").notNull().default(""),
    defaultTaxConfigurationId: text("default_tax_configuration_id").references(
      () => taxConfigurations.id,
      { onDelete: "set null" },
    ),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("products_services_code_unique")
      .on(table.code)
      .where(sql`${table.code} <> ''`),
    index("products_services_name_idx").on(table.normalizedName),
    index("products_services_kind_idx").on(table.kind),
    index("products_services_tax_idx").on(table.defaultTaxConfigurationId),
    index("products_services_active_idx").on(table.active),
    check(
      "products_services_kind_check",
      sql`${table.kind} in ('product', 'service', 'labor', 'fee', 'other')`,
    ),
  ],
);

export const invoices = sqliteTable(
  "invoices",
  {
    id: text("id").primaryKey(),
    legacyRecordId: text("legacy_record_id").references(
      () => businessRecords.id,
    ),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    quotationId: text("quotation_id").references(() => quotations.id, {
      onDelete: "set null",
    }),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "restrict",
    }),
    invoiceNumberRaw: text("invoice_number_raw").notNull(),
    invoiceNumberNormalized: text("invoice_number_normalized").notNull(),
    issueDate: text("issue_date"),
    issueDateRaw: text("issue_date_raw").notNull().default(""),
    issueYear: integer("issue_year"),
    dueDate: text("due_date"),
    dueDateRaw: text("due_date_raw").notNull().default(""),
    ncfRaw: text("ncf_raw").notNull().default(""),
    ncfNormalized: text("ncf_normalized").notNull().default(""),
    ncfType: text("ncf_type").notNull().default(""),
    documentVersion: integer("document_version").notNull().default(1),
    status: text("status", {
      enum: [
        "draft",
        "issued",
        "partial",
        "paid",
        "overdue",
        "cancelled",
        "replaced",
        "credited",
        "unknown",
      ],
    })
      .notNull()
      .default("unknown"),
    replacedInvoiceId: text("replaced_invoice_id").references(
      (): AnySQLiteColumn => invoices.id,
      { onDelete: "set null" },
    ),
    cancellationReason: text("cancellation_reason").notNull().default(""),
    currency: text("currency").notNull().default("DOP"),
    paymentTermsRaw: text("payment_terms_raw").notNull().default(""),
    purchaseOrderNumber: text("purchase_order_number").notNull().default(""),
    salesRepresentative: text("sales_representative").notNull().default(""),
    subtotalAmount: real("subtotal_amount"),
    discountAmount: real("discount_amount"),
    taxableAmount: real("taxable_amount"),
    exemptAmount: real("exempt_amount"),
    taxAmount: real("tax_amount"),
    totalAmount: real("total_amount"),
    paidAmountSnapshot: real("paid_amount_snapshot"),
    balanceAmountSnapshot: real("balance_amount_snapshot"),
    snapshotAsOf: text("snapshot_as_of"),
    sourceAuthority: text("source_authority", {
      enum: ["issued_document", "matrix", "manual_resolution"],
    })
      .notNull()
      .default("issued_document"),
    sourceValues: text("source_values").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("invoices_legacy_record_unique").on(table.legacyRecordId),
    uniqueIndex("invoices_ncf_unique")
      .on(table.ncfNormalized)
      .where(sql`${table.ncfNormalized} <> ''`),
    uniqueIndex("invoices_identity_unique").on(
      table.businessId,
      table.issueYear,
      table.invoiceNumberNormalized,
      table.ncfNormalized,
      table.documentVersion,
    ),
    index("invoices_business_date_idx").on(table.businessId, table.issueDate),
    index("invoices_status_idx").on(table.status),
    index("invoices_due_date_idx").on(table.dueDate),
    index("invoices_project_idx").on(table.projectId),
    index("invoices_quotation_idx").on(table.quotationId),
    index("invoices_document_idx").on(table.sourceDocumentId),
    index("invoices_import_batch_idx").on(table.importBatchId),
    index("invoices_replaced_idx").on(table.replacedInvoiceId),
    index("invoices_legacy_idx").on(table.legacyRecordId),
    check(
      "invoices_document_version_check",
      sql`${table.documentVersion} >= 1`,
    ),
    check(
      "invoices_status_check",
      sql`${table.status} in ('draft', 'issued', 'partial', 'paid', 'overdue', 'cancelled', 'replaced', 'credited', 'unknown')`,
    ),
    check(
      "invoices_source_authority_check",
      sql`${table.sourceAuthority} in ('issued_document', 'matrix', 'manual_resolution')`,
    ),
  ],
);

export const invoiceLines = sqliteTable(
  "invoice_lines",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    productServiceId: text("product_service_id").references(
      () => productsServices.id,
      { onDelete: "set null" },
    ),
    itemCode: text("item_code").notNull().default(""),
    description: text("description").notNull().default(""),
    location: text("location").notNull().default(""),
    quantity: real("quantity"),
    widthCm: real("width_cm"),
    heightCm: real("height_cm"),
    areaSqm: real("area_sqm"),
    unitOfMeasure: text("unit_of_measure").notNull().default(""),
    unitPrice: real("unit_price"),
    lineSubtotal: real("line_subtotal"),
    discountAmount: real("discount_amount"),
    taxAmount: real("tax_amount"),
    lineTotal: real("line_total"),
    taxConfigurationId: text("tax_configuration_id").references(
      () => taxConfigurations.id,
      { onDelete: "set null" },
    ),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    sourceFormula: text("source_formula").notNull().default(""),
    sourceValues: text("source_values").notNull().default("{}"),
    valueStates: text("value_states").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("invoice_lines_invoice_number_unique").on(
      table.invoiceId,
      table.lineNumber,
    ),
    index("invoice_lines_invoice_idx").on(table.invoiceId),
    index("invoice_lines_product_idx").on(table.productServiceId),
    index("invoice_lines_tax_idx").on(table.taxConfigurationId),
    check("invoice_lines_line_number_check", sql`${table.lineNumber} >= 1`),
  ],
);

export const paymentAllocations = sqliteTable(
  "payment_allocations",
  {
    id: text("id").primaryKey(),
    paymentId: text("payment_id")
      .notNull()
      .references(() => payments.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: real("amount").notNull(),
    currency: text("currency").notNull().default("DOP"),
    allocationDate: text("allocation_date"),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "restrict",
    }),
    status: text("status", {
      enum: ["draft", "applied", "reversed"],
    })
      .notNull()
      .default("draft"),
    reversalOfId: text("reversal_of_id").references(
      (): AnySQLiteColumn => paymentAllocations.id,
      { onDelete: "restrict" },
    ),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("payment_allocations_identity_unique").on(
      table.paymentId,
      table.invoiceId,
      table.amount,
      table.allocationDate,
      table.importBatchId,
    ),
    index("payment_allocations_payment_idx").on(table.paymentId, table.status),
    index("payment_allocations_invoice_idx").on(table.invoiceId, table.status),
    index("payment_allocations_batch_idx").on(table.importBatchId),
    index("payment_allocations_reversal_idx").on(table.reversalOfId),
    check("payment_allocations_amount_check", sql`${table.amount} > 0`),
    check(
      "payment_allocations_status_check",
      sql`${table.status} in ('draft', 'applied', 'reversed')`,
    ),
  ],
);

export const creditNotes = sqliteTable(
  "credit_notes",
  {
    id: text("id").primaryKey(),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "restrict",
    }),
    creditNoteNumberRaw: text("credit_note_number_raw").notNull(),
    creditNoteNumberNormalized: text(
      "credit_note_number_normalized",
    ).notNull(),
    ncfRaw: text("ncf_raw").notNull().default(""),
    ncfNormalized: text("ncf_normalized").notNull().default(""),
    issueDate: text("issue_date"),
    issueDateRaw: text("issue_date_raw").notNull().default(""),
    issueYear: integer("issue_year"),
    currency: text("currency").notNull().default("DOP"),
    reason: text("reason").notNull().default(""),
    subtotalAmount: real("subtotal_amount"),
    taxAmount: real("tax_amount"),
    totalAmount: real("total_amount"),
    status: text("status", {
      enum: ["issued", "applied", "void", "unknown"],
    })
      .notNull()
      .default("unknown"),
    sourceAuthority: text("source_authority", {
      enum: ["issued_document", "matrix", "manual_resolution"],
    })
      .notNull()
      .default("issued_document"),
    sourceValues: text("source_values").notNull().default("{}"),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    uniqueIndex("credit_notes_ncf_unique")
      .on(table.ncfNormalized)
      .where(sql`${table.ncfNormalized} <> ''`),
    uniqueIndex("credit_notes_identity_unique").on(
      table.businessId,
      table.issueYear,
      table.creditNoteNumberNormalized,
      table.ncfNormalized,
    ),
    index("credit_notes_business_date_idx").on(
      table.businessId,
      table.issueDate,
    ),
    index("credit_notes_status_idx").on(table.status),
    index("credit_notes_document_idx").on(table.sourceDocumentId),
    index("credit_notes_import_batch_idx").on(table.importBatchId),
    check(
      "credit_notes_status_check",
      sql`${table.status} in ('issued', 'applied', 'void', 'unknown')`,
    ),
    check(
      "credit_notes_source_authority_check",
      sql`${table.sourceAuthority} in ('issued_document', 'matrix', 'manual_resolution')`,
    ),
  ],
);

export const creditNoteLines = sqliteTable(
  "credit_note_lines",
  {
    id: text("id").primaryKey(),
    creditNoteId: text("credit_note_id")
      .notNull()
      .references(() => creditNotes.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    productServiceId: text("product_service_id").references(
      () => productsServices.id,
      { onDelete: "set null" },
    ),
    itemCode: text("item_code").notNull().default(""),
    description: text("description").notNull().default(""),
    location: text("location").notNull().default(""),
    quantity: real("quantity"),
    widthCm: real("width_cm"),
    heightCm: real("height_cm"),
    areaSqm: real("area_sqm"),
    unitOfMeasure: text("unit_of_measure").notNull().default(""),
    unitPrice: real("unit_price"),
    lineSubtotal: real("line_subtotal"),
    discountAmount: real("discount_amount"),
    taxAmount: real("tax_amount"),
    lineTotal: real("line_total"),
    taxConfigurationId: text("tax_configuration_id").references(
      () => taxConfigurations.id,
      { onDelete: "set null" },
    ),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRange: text("source_range").notNull().default(""),
    sourceFormula: text("source_formula").notNull().default(""),
    sourceValues: text("source_values").notNull().default("{}"),
    valueStates: text("value_states").notNull().default("{}"),
  },
  (table) => [
    uniqueIndex("credit_note_lines_note_number_unique").on(
      table.creditNoteId,
      table.lineNumber,
    ),
    index("credit_note_lines_note_idx").on(table.creditNoteId),
    index("credit_note_lines_product_idx").on(table.productServiceId),
    index("credit_note_lines_tax_idx").on(table.taxConfigurationId),
    check("credit_note_lines_line_number_check", sql`${table.lineNumber} >= 1`),
  ],
);

export const creditNoteApplications = sqliteTable(
  "credit_note_applications",
  {
    id: text("id").primaryKey(),
    creditNoteId: text("credit_note_id")
      .notNull()
      .references(() => creditNotes.id),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    amount: real("amount").notNull(),
    applicationDate: text("application_date"),
    status: text("status", {
      enum: ["draft", "applied", "reversed"],
    })
      .notNull()
      .default("draft"),
    reversalOfId: text("reversal_of_id").references(
      (): AnySQLiteColumn => creditNoteApplications.id,
      { onDelete: "restrict" },
    ),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "restrict",
    }),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("credit_note_applications_identity_unique").on(
      table.creditNoteId,
      table.invoiceId,
      table.amount,
      table.applicationDate,
      table.importBatchId,
    ),
    index("credit_note_applications_note_idx").on(
      table.creditNoteId,
      table.status,
    ),
    index("credit_note_applications_invoice_idx").on(
      table.invoiceId,
      table.status,
    ),
    index("credit_note_applications_batch_idx").on(table.importBatchId),
    index("credit_note_applications_reversal_idx").on(table.reversalOfId),
    check("credit_note_applications_amount_check", sql`${table.amount} > 0`),
    check(
      "credit_note_applications_status_check",
      sql`${table.status} in ('draft', 'applied', 'reversed')`,
    ),
  ],
);

export const receivableSnapshots = sqliteTable(
  "receivable_snapshots",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    asOf: text("as_of").notNull(),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    importBatchId: text("import_batch_id").references(() => importBatches.id, {
      onDelete: "restrict",
    }),
    invoiceTotal: real("invoice_total"),
    paidAmount: real("paid_amount"),
    balanceAmount: real("balance_amount"),
    statusRaw: text("status_raw").notNull().default(""),
    statusNormalized: text("status_normalized", {
      enum: ["unpaid", "partial", "paid", "overdue", "cancelled", "unknown"],
    })
      .notNull()
      .default("unknown"),
    sourceSheet: text("source_sheet").notNull().default(""),
    sourceRowNumber: integer("source_row_number"),
    rawValues: text("raw_values").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    reversedAt: text("reversed_at"),
    reversalReason: text("reversal_reason").notNull().default(""),
  },
  (table) => [
    uniqueIndex("receivable_snapshots_source_unique").on(
      table.invoiceId,
      table.asOf,
      table.sourceDocumentId,
      table.sourceRowNumber,
    ),
    index("receivable_snapshots_invoice_idx").on(table.invoiceId, table.asOf),
    index("receivable_snapshots_batch_idx").on(table.importBatchId),
    index("receivable_snapshots_status_idx").on(table.statusNormalized),
    index("receivable_snapshots_reversed_idx").on(table.reversedAt),
    check(
      "receivable_snapshots_status_check",
      sql`${table.statusNormalized} in ('unpaid', 'partial', 'paid', 'overdue', 'cancelled', 'unknown')`,
    ),
  ],
);

export const collectionActivities = sqliteTable(
  "collection_activities",
  {
    id: text("id").primaryKey(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id),
    businessId: text("business_id")
      .notNull()
      .references(() => businesses.id),
    contactId: text("contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    activityType: text("activity_type", {
      enum: [
        "call",
        "email",
        "visit",
        "promise_to_pay",
        "dispute",
        "note",
        "other",
      ],
    })
      .notNull()
      .default("note"),
    occurredAt: text("occurred_at").notNull(),
    nextActionAt: text("next_action_at"),
    ownerEmail: text("owner_email").notNull(),
    outcome: text("outcome").notNull().default(""),
    promisedAmount: real("promised_amount"),
    promisedDate: text("promised_date"),
    notes: text("notes").notNull().default(""),
    sourceDocumentId: text("source_document_id").references(
      () => documents.id,
      { onDelete: "set null" },
    ),
    createdBy: text("created_by").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (table) => [
    index("collection_activities_invoice_idx").on(
      table.invoiceId,
      table.occurredAt,
    ),
    index("collection_activities_owner_next_idx").on(
      table.ownerEmail,
      table.nextActionAt,
    ),
    index("collection_activities_type_idx").on(table.activityType),
    index("collection_activities_business_idx").on(table.businessId),
    check(
      "collection_activities_type_check",
      sql`${table.activityType} in ('call', 'email', 'visit', 'promise_to_pay', 'dispute', 'note', 'other')`,
    ),
  ],
);
