import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  businesses,
  contacts,
  importCandidates,
  importFiles,
  importIssues,
  projects,
  quotationRevisions,
  quotations,
  sourceFieldValues,
} from "../../../../../db/schema";
import { authorizeApi } from "../../../../lib/authorization";
import { parseJson, safeImportSummary } from "../../../../lib/import-service";
import type { NormalizedImportPreview } from "../../../../lib/importers";
import {
  normalizeEmail,
  normalizePhone,
  normalizeText,
} from "../../../../lib/crm";
import {
  normalizeRnc,
  validateCustomerIdentity,
} from "../../../../lib/source-domain";

type RouteContext = { params: Promise<{ id: string }> };
type StoredPreview = Omit<NormalizedImportPreview, "sourceValues">;

const MAX_ATOMIC_STATEMENTS = 750;

function clean(value: unknown, max = 4_000) {
  return String(value ?? "")
    .trim()
    .slice(0, max);
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function applyTopLevelCorrections(
  preview: StoredPreview,
  values: Array<typeof sourceFieldValues.$inferSelect>,
) {
  for (const value of values) {
    const normalized = value.normalizedValue;
    const key = `${value.canonicalEntity}.${value.canonicalField}`;
    switch (key) {
      case "business.name":
        preview.business.name = normalized;
        break;
      case "business.rnc":
        preview.business.rnc = normalized;
        break;
      case "business.email":
        preview.business.email = normalized;
        break;
      case "business.phone":
        preview.business.phone = normalized;
        break;
      case "business.mobile_phone":
        preview.business.mobilePhone = normalized;
        break;
      case "contact.name":
        preview.contact.name = normalized;
        break;
      case "contact.email":
        preview.contact.email = normalized;
        break;
      case "contact.phone":
        preview.contact.phone = normalized;
        break;
      case "contact.mobile_phone":
        preview.contact.mobilePhone = normalized;
        break;
      case "project.name":
        preview.project.name = normalized;
        break;
      case "project.address":
      case "address.line1":
        preview.project.address ||= normalized;
        break;
      case "quotation.quotation_number":
        preview.quotation.quotationNumber = normalized;
        break;
      case "quotation_revision.quotation_date":
        preview.revision.quotationDate = normalized || null;
        break;
    }
  }
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "importaciones", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  const db = getDb();
  const [file] = await db
    .select()
    .from(importFiles)
    .where(eq(importFiles.id, id))
    .limit(1);
  if (!file) {
    return Response.json(
      { error: "Importación no encontrada." },
      { status: 404 },
    );
  }
  if (file.status === "accepted") {
    return Response.json({
      import: safeImportSummary(file),
      links: parseJson(file.canonicalLinks, {}),
      idempotent: true,
    });
  }
  if (!file.normalizedPreview || file.status === "failed") {
    return Response.json(
      { error: "Corrige o reintenta el análisis antes de aceptar." },
      { status: 409 },
    );
  }
  const openBlocking = await db
    .select({ id: importIssues.id, title: importIssues.title })
    .from(importIssues)
    .where(
      and(
        eq(importIssues.importFileId, id),
        eq(importIssues.status, "open"),
        eq(importIssues.severity, "blocking"),
      ),
    )
    .limit(20);
  if (openBlocking.length > 0) {
    return Response.json(
      {
        error: "Resuelve las advertencias bloqueantes antes de aceptar.",
        issues: openBlocking,
      },
      { status: 409 },
    );
  }

  const preview = parseJson<StoredPreview | null>(file.normalizedPreview, null);
  if (!preview) {
    return Response.json(
      { error: "La vista normalizada no es válida." },
      { status: 422 },
    );
  }
  const corrections = await db
    .select()
    .from(sourceFieldValues)
    .where(
      and(
        eq(sourceFieldValues.importFileId, id),
        eq(sourceFieldValues.mappingStatus, "corrected"),
      ),
    )
    .limit(5_000);
  applyTopLevelCorrections(preview, corrections);

  const businessValidation = validateCustomerIdentity({
    name: preview.business.name,
    type: preview.business.customerType,
    rnc: preview.business.rnc,
  });
  if (businessValidation.errors.length > 0) {
    return Response.json(
      { error: businessValidation.errors.join(" ") },
      { status: 422 },
    );
  }
  if (!clean(preview.quotation.quotationNumber, 100)) {
    return Response.json(
      { error: "El número de cotización es obligatorio." },
      { status: 422 },
    );
  }

  const selectedCandidates = await db
    .select()
    .from(importCandidates)
    .where(
      and(
        eq(importCandidates.importFileId, id),
        eq(importCandidates.status, "selected"),
      ),
    );
  const selected = new Map(
    selectedCandidates.map((candidate) => [
      candidate.candidateType,
      candidate.candidateEntityId,
    ]),
  );
  let businessId =
    clean(payload.businessId, 80) || selected.get("business") || "";
  let contactId = clean(payload.contactId, 80) || selected.get("contact") || "";
  let projectId = clean(payload.projectId, 80);
  let quotationId =
    clean(payload.quotationId, 80) || selected.get("quotation_revision") || "";
  const useExistingRevisionId = clean(payload.revisionId, 80);
  const now = new Date().toISOString();
  const actor = auth.user.email;
  const statements: D1PreparedStatement[] = [];
  const d1 = getD1();
  const prepare = (sql: string, ...bindings: unknown[]) =>
    d1.prepare(sql).bind(...bindings);

  if (businessId) {
    const [business] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
      .limit(1);
    if (!business) {
      return Response.json(
        { error: "El Business seleccionado no existe." },
        { status: 422 },
      );
    }
  } else {
    businessId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO businesses (
          id, name, normalized_name, customer_type, rnc, normalized_rnc,
          email, phone, mobile_phone, address, notes, source_metadata,
          owner_email, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
        businessId,
        clean(preview.business.name, 180),
        normalizeText(preview.business.name),
        preview.business.customerType,
        clean(preview.business.rnc, 30),
        normalizeRnc(preview.business.rnc),
        clean(preview.business.email, 180),
        clean(preview.business.phone, 60),
        clean(preview.business.mobilePhone, 60),
        clean(preview.business.address, 500),
        JSON.stringify({ importFileId: id }),
        actor,
        actor,
        now,
        now,
      ),
    );
  }

  const hasContact = Boolean(
    preview.contact.name ||
    preview.contact.email ||
    preview.contact.phone ||
    preview.contact.mobilePhone,
  );
  if (contactId) {
    const [contact] = await db
      .select({ id: contacts.id, businessId: contacts.businessId })
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);
    if (!contact || (contact.businessId && contact.businessId !== businessId)) {
      return Response.json(
        { error: "El Contact seleccionado no pertenece al Business." },
        { status: 422 },
      );
    }
    if (!contact.businessId) {
      statements.push(
        prepare(
          "UPDATE contacts SET business_id = ?, updated_at = ? WHERE id = ? AND business_id IS NULL",
          businessId,
          now,
          contactId,
        ),
      );
    }
  } else if (hasContact) {
    contactId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO contacts (
          id, business_id, name, email, normalized_email, phone,
          normalized_phone, mobile_phone, normalized_mobile_phone, title,
          notes, source_metadata, owner_email, created_by, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)`,
        contactId,
        businessId,
        clean(preview.contact.name || preview.business.name, 180),
        clean(preview.contact.email, 180),
        normalizeEmail(preview.contact.email),
        clean(preview.contact.phone, 60),
        normalizePhone(preview.contact.phone),
        clean(preview.contact.mobilePhone, 60),
        normalizePhone(preview.contact.mobilePhone),
        JSON.stringify({ importFileId: id }),
        actor,
        actor,
        now,
        now,
      ),
    );
  }

  if (projectId) {
    const [project] = await db
      .select({ id: projects.id, businessId: projects.businessId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!project || project.businessId !== businessId) {
      return Response.json(
        { error: "El proyecto seleccionado no pertenece al Business." },
        { status: 422 },
      );
    }
  } else if (preview.project.name || preview.project.address) {
    projectId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO projects (
          id, business_id, primary_contact_id, name, description,
          service_category, status, owner_email, created_by, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
        projectId,
        businessId,
        contactId || null,
        clean(preview.project.name || preview.quotation.title, 180),
        clean(preview.project.description, 4_000),
        clean(preview.project.serviceCategory, 120),
        actor,
        actor,
        now,
        now,
      ),
    );
  }

  if (quotationId) {
    const [quotation] = await db
      .select({ id: quotations.id, businessId: quotations.businessId })
      .from(quotations)
      .where(eq(quotations.id, quotationId))
      .limit(1);
    if (!quotation || quotation.businessId !== businessId) {
      return Response.json(
        { error: "La cotización seleccionada no pertenece al Business." },
        { status: 422 },
      );
    }
  } else {
    quotationId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO quotations (
          id, business_id, primary_contact_id, project_id, quotation_number,
          quotation_year, title, quotation_type, service_category, status,
          currency, owner_email, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
        quotationId,
        businessId,
        contactId || null,
        projectId || null,
        clean(
          preview.quotation.baseNumber || preview.quotation.quotationNumber,
          100,
        ),
        preview.quotation.quotationYear,
        clean(preview.quotation.title, 240),
        preview.quotation.quotationType,
        clean(preview.quotation.serviceCategory, 120),
        clean(preview.quotation.currency, 3) || "DOP",
        actor,
        actor,
        now,
        now,
      ),
    );
  }

  let revisionId = useExistingRevisionId;
  if (revisionId) {
    const [revision] = await db
      .select({
        id: quotationRevisions.id,
        quotationId: quotationRevisions.quotationId,
      })
      .from(quotationRevisions)
      .where(eq(quotationRevisions.id, revisionId))
      .limit(1);
    if (!revision || revision.quotationId !== quotationId) {
      return Response.json(
        { error: "La revisión seleccionada no pertenece a la cotización." },
        { status: 422 },
      );
    }
  } else {
    const [existingRevision] = await db
      .select({ id: quotationRevisions.id })
      .from(quotationRevisions)
      .where(
        and(
          eq(quotationRevisions.quotationId, quotationId),
          eq(quotationRevisions.identityKey, preview.revision.identityKey),
        ),
      )
      .limit(1);
    if (existingRevision) {
      return Response.json(
        {
          error:
            "Ya existe esta revisión. Selecciónala explícitamente para vincular el documento.",
          revisionId: existingRevision.id,
        },
        { status: 409 },
      );
    }
    revisionId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO quotation_revisions (
          id, quotation_id, identity_key, revision_number, revision_label,
          alternative_label, scope_label, quotation_date, source_date_raw,
          is_current, customer_facing_notes, internal_notes, source_metadata,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '', '', ?, ?, ?, ?)`,
        revisionId,
        quotationId,
        clean(preview.revision.identityKey, 300),
        preview.revision.revisionNumber,
        clean(preview.revision.revisionLabel, 120),
        clean(preview.revision.alternativeLabel, 120),
        clean(preview.revision.scopeLabel, 240),
        preview.revision.quotationDate,
        clean(preview.revision.sourceDateRaw, 120),
        JSON.stringify({ importFileId: id, filename: file.filename }),
        actor,
        now,
        now,
      ),
    );
  }

  if (preview.business.address) {
    statements.push(
      prepare(
        `INSERT INTO addresses (
          id, business_id, type, label, line1, is_primary, source_metadata,
          created_by, created_at, updated_at
        ) VALUES (?, ?, 'billing', 'Dirección principal', ?, 1, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        businessId,
        clean(preview.business.address, 500),
        JSON.stringify({ importFileId: id }),
        actor,
        now,
        now,
      ),
    );
  }
  if (projectId && preview.project.address) {
    statements.push(
      prepare(
        `INSERT INTO addresses (
          id, project_id, type, label, line1, is_primary, source_metadata,
          created_by, created_at, updated_at
        ) VALUES (?, ?, 'project', 'Dirección del proyecto', ?, 1, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        projectId,
        clean(preview.project.address, 500),
        JSON.stringify({ importFileId: id }),
        actor,
        now,
        now,
      ),
    );
  }

  const sectionId = crypto.randomUUID();
  if (preview.lineItems.length > 0) {
    statements.push(
      prepare(
        `INSERT INTO quotation_sections (
          id, revision_id, name, description, sort_order
        ) VALUES (?, ?, 'Partidas', '', 0)`,
        sectionId,
        revisionId,
      ),
    );
  }
  for (const [index, item] of preview.lineItems.entries()) {
    const lineItemId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO quotation_line_items (
          id, revision_id, section_id, sort_order, item_code, description,
          category, product, service, location, quantity, unit_of_measure,
          meters, opening_width_cm, opening_height_cm, finished_width_cm,
          finished_height_cm, area_sqm, price_basis, unit_price,
          price_per_sqm, flat_fee, discount_amount, tax_amount,
          source_line_total, calculated_line_total, currency, motor_type,
          control_type, material, notes, value_states, source_values,
          source_sheet, source_range, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                  ?, ?, ?, NULL, NULL, ?, ?, ?, '', '', '', ?, ?, ?, ?, ?, ?,
                  ?)`,
        lineItemId,
        revisionId,
        sectionId,
        index,
        clean(item.itemCode, 100),
        clean(item.description, 1_000),
        clean(item.category, 120),
        clean(item.location, 240),
        asNumber(item.quantity),
        clean(item.unitOfMeasure, 40),
        asNumber(item.meters),
        asNumber(item.openingWidthCm),
        asNumber(item.openingHeightCm),
        asNumber(item.finishedWidthCm),
        asNumber(item.finishedHeightCm),
        asNumber(item.areaSqm),
        item.priceBasis,
        asNumber(item.unitPrice),
        asNumber(item.pricePerSqm),
        asNumber(item.flatFee),
        asNumber(item.sourceLineTotal),
        asNumber(item.calculatedLineTotal),
        clean(item.currency, 3) || preview.financials.currency,
        clean(item.notes, 2_000),
        JSON.stringify(item.valueStates),
        JSON.stringify(item.sourceValues),
        clean(item.sourceSheet, 120),
        clean(item.sourceRange, 240),
        now,
        now,
      ),
    );
    if (
      item.openingWidthCm !== null ||
      item.openingHeightCm !== null ||
      item.finishedWidthCm !== null ||
      item.finishedHeightCm !== null ||
      item.areaSqm !== null
    ) {
      statements.push(
        prepare(
          `INSERT INTO measurements (
            id, revision_id, line_item_id, project_id, location,
            opening_width_cm, opening_height_cm, finished_width_cm,
            finished_height_cm, area_sqm, quantity, value_states,
            source_values, source_sheet, source_range, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          revisionId,
          lineItemId,
          projectId || null,
          clean(item.location, 240),
          asNumber(item.openingWidthCm),
          asNumber(item.openingHeightCm),
          asNumber(item.finishedWidthCm),
          asNumber(item.finishedHeightCm),
          asNumber(item.areaSqm),
          asNumber(item.quantity),
          JSON.stringify(item.valueStates),
          JSON.stringify(item.sourceValues),
          clean(item.sourceSheet, 120),
          clean(item.sourceRange, 240),
          now,
          now,
        ),
      );
    }
  }

  statements.push(
    prepare(
      `INSERT INTO quotation_financials (
        id, revision_id, currency, source_subtotal, calculated_subtotal,
        discount_rate, discount_amount, source_tax_rate, source_tax_amount,
        calculated_tax_amount, source_total, calculated_total,
        discrepancy_amount, payment_status, value_states, source_values,
        validated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      crypto.randomUUID(),
      revisionId,
      clean(preview.financials.currency, 3) || "DOP",
      asNumber(preview.financials.sourceSubtotal),
      asNumber(preview.financials.calculatedSubtotal),
      asNumber(preview.financials.discountRate),
      asNumber(preview.financials.discountAmount),
      asNumber(preview.financials.sourceTaxRate),
      asNumber(preview.financials.sourceTaxAmount),
      asNumber(preview.financials.calculatedTaxAmount),
      asNumber(preview.financials.sourceTotal),
      asNumber(preview.financials.calculatedTotal),
      asNumber(preview.financials.discrepancyAmount),
      preview.financials.paymentStatus,
      JSON.stringify(preview.financials.valueStates),
      JSON.stringify(preview.financials.sourceValues),
      now,
      now,
      now,
    ),
  );
  for (const [index, charge] of preview.charges.entries()) {
    statements.push(
      prepare(
        `INSERT INTO quotation_charges (
          id, revision_id, type, label, source_amount, calculated_amount,
          rate, currency, value_state, source_range, sort_order
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        revisionId,
        charge.type,
        clean(charge.label, 500),
        asNumber(charge.sourceAmount),
        asNumber(charge.calculatedAmount),
        asNumber(charge.rate),
        clean(charge.currency, 3) || "DOP",
        charge.valueState,
        clean(charge.sourceLocation, 240),
        index,
      ),
    );
  }
  statements.push(
    prepare(
      `INSERT INTO quotation_terms (
        id, revision_id, quotation_validity, payment_conditions, warranty,
        return_policy, installation_observations, maintenance_disclaimer,
        unforeseen_parts_disclaimer, additional_cost_notice,
        original_spanish_text, source_values, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)`,
      crypto.randomUUID(),
      revisionId,
      clean(preview.terms.quotationValidity, 4_000),
      clean(preview.terms.paymentConditions, 4_000),
      clean(preview.terms.warranty, 4_000),
      clean(preview.terms.returnPolicy, 4_000),
      clean(preview.terms.installationObservations, 4_000),
      clean(preview.terms.maintenanceDisclaimer, 4_000),
      clean(preview.terms.unforeseenPartsDisclaimer, 4_000),
      clean(preview.terms.additionalCostNotice, 4_000),
      clean(preview.terms.originalSpanishText, 20_000),
      now,
      now,
    ),
  );
  for (const payment of preview.payments) {
    statements.push(
      prepare(
        `INSERT INTO payments (
          id, business_id, project_id, revision_id, source_document_id, type,
          amount, currency, payment_date, method, status, label,
          installment_reference, notes, source_values, source_location,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(),
        businessId,
        projectId || null,
        revisionId,
        file.documentId,
        payment.type,
        asNumber(payment.amount),
        clean(payment.currency, 3) || "DOP",
        payment.paymentDate,
        clean(payment.method, 120),
        payment.status,
        clean(payment.label, 240),
        clean(payment.installmentReference, 120),
        clean(payment.notes, 4_000),
        JSON.stringify(payment.sourceValues),
        clean(payment.sourceLocation, 240),
        actor,
        now,
        now,
      ),
    );
  }
  for (const worksheet of preview.manufacturing) {
    const worksheetId = crypto.randomUUID();
    statements.push(
      prepare(
        `INSERT INTO manufacturing_worksheets (
          id, revision_id, source_document_id, name, worksheet_type,
          source_sheet, source_range, calculation_status,
          source_formula_summary, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`,
        worksheetId,
        revisionId,
        file.documentId,
        clean(worksheet.name, 240),
        worksheet.worksheetType,
        clean(worksheet.sourceSheet, 120),
        clean(worksheet.sourceRange, 240),
        worksheet.calculationStatus,
        JSON.stringify(worksheet.formulaSummary),
        actor,
        now,
        now,
      ),
    );
    for (const [index, component] of worksheet.components.entries()) {
      statements.push(
        prepare(
          `INSERT INTO material_components (
            id, worksheet_id, component_type, name, quantity, unit_cost,
            total_cost, currency, source_formula, formula_result,
            formula_status, source_values, source_sheet, source_range,
            sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          crypto.randomUUID(),
          worksheetId,
          component.componentType,
          clean(component.name, 240),
          asNumber(component.quantity),
          asNumber(component.unitCost),
          asNumber(component.totalCost),
          preview.financials.currency,
          clean(component.sourceFormula, 10_000),
          clean(component.formulaResult, 2_000),
          component.formulaStatus,
          JSON.stringify(component.sourceValues),
          clean(component.sourceSheet, 120),
          clean(component.sourceRange, 240),
          index,
        ),
      );
    }
  }

  const links = {
    businessId,
    contactId: contactId || null,
    projectId: projectId || null,
    quotationId,
    revisionId,
    documentId: file.documentId,
  };
  statements.push(
    prepare(
      `INSERT INTO document_links (
        document_id, entity_type, entity_id, purpose, created_by, created_at
      ) VALUES (?, 'quotation_revision', ?, 'source', ?, ?)`,
      file.documentId,
      revisionId,
      actor,
      now,
    ),
    prepare(
      `INSERT INTO entity_history (
        entity_type, entity_id, action, source_document_id, actor_email,
        reason, created_at
      ) VALUES ('quotation_revision', ?, 'import_accept', ?, ?, ?, ?)`,
      revisionId,
      file.documentId,
      actor,
      `Importación ${id}`,
      now,
    ),
    prepare(
      `UPDATE import_files
       SET status = 'accepted', canonical_links = ?, accepted_by = ?,
           accepted_at = ?, reviewed_by = COALESCE(reviewed_by, ?),
           reviewed_at = COALESCE(reviewed_at, ?)
       WHERE id = ? AND status <> 'accepted'`,
      JSON.stringify(links),
      actor,
      now,
      actor,
      now,
      id,
    ),
    prepare(
      `UPDATE import_batches
       SET status = 'completed', successful_count = successful_count + 1,
           review_count = CASE WHEN review_count > 0 THEN review_count - 1 ELSE 0 END,
           completed_at = ?
       WHERE id = ?`,
      now,
      file.batchId,
    ),
    prepare(
      `INSERT INTO audit_log (
        actor_email, action, entity_type, entity_id, detail, created_at
      ) VALUES (?, 'accept_import', 'import_file', ?, ?, ?)`,
      actor,
      id,
      JSON.stringify(links),
      now,
    ),
    prepare(
      `INSERT INTO search_documents (
        entity_type, entity_id, title, subtitle, search_text, owner_email,
        updated_at
      ) VALUES ('quotation', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        title = excluded.title, subtitle = excluded.subtitle,
        search_text = excluded.search_text, owner_email = excluded.owner_email,
        updated_at = excluded.updated_at`,
      quotationId,
      clean(preview.quotation.title, 240),
      clean(preview.quotation.quotationNumber, 100),
      [
        preview.quotation.quotationNumber,
        preview.business.name,
        preview.contact.name,
        preview.project.name,
        preview.quotation.serviceCategory,
        file.filename,
      ].join(" "),
      actor,
      now,
    ),
  );
  statements.push(
    prepare(
      `INSERT INTO search_documents (
        entity_type, entity_id, title, subtitle, search_text, owner_email,
        updated_at
      ) VALUES ('business', ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity_type, entity_id) DO UPDATE SET
        title = excluded.title, subtitle = excluded.subtitle,
        search_text = excluded.search_text, owner_email = excluded.owner_email,
        updated_at = excluded.updated_at`,
      businessId,
      clean(preview.business.name, 180),
      clean(preview.business.rnc || preview.business.email, 180),
      [
        preview.business.name,
        preview.business.rnc,
        preview.business.email,
        preview.business.phone,
        preview.business.mobilePhone,
        preview.business.address,
      ].join(" "),
      actor,
      now,
    ),
  );
  if (contactId) {
    statements.push(
      prepare(
        `INSERT INTO search_documents (
          entity_type, entity_id, title, subtitle, search_text, owner_email,
          updated_at
        ) VALUES ('contact', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          title = excluded.title, subtitle = excluded.subtitle,
          search_text = excluded.search_text, owner_email = excluded.owner_email,
          updated_at = excluded.updated_at`,
        contactId,
        clean(preview.contact.name || preview.business.name, 180),
        clean(preview.contact.email || preview.contact.mobilePhone, 180),
        [
          preview.contact.name,
          preview.contact.email,
          preview.contact.phone,
          preview.contact.mobilePhone,
          preview.business.name,
        ].join(" "),
        actor,
        now,
      ),
    );
  }
  if (projectId) {
    statements.push(
      prepare(
        `INSERT INTO search_documents (
          entity_type, entity_id, title, subtitle, search_text, owner_email,
          updated_at
        ) VALUES ('project', ?, ?, ?, ?, ?, ?)
        ON CONFLICT(entity_type, entity_id) DO UPDATE SET
          title = excluded.title, subtitle = excluded.subtitle,
          search_text = excluded.search_text, owner_email = excluded.owner_email,
          updated_at = excluded.updated_at`,
        projectId,
        clean(preview.project.name || preview.quotation.title, 180),
        clean(preview.project.serviceCategory, 120),
        [
          preview.project.name,
          preview.project.description,
          preview.project.serviceCategory,
          preview.project.address,
          preview.business.name,
        ].join(" "),
        actor,
        now,
      ),
    );
  }

  if (statements.length > MAX_ATOMIC_STATEMENTS) {
    await db.insert(importIssues).values({
      id: crypto.randomUUID(),
      importFileId: id,
      type: "security_limit",
      severity: "blocking",
      status: "open",
      title: "La importación excede el límite de aceptación atómica.",
      detail: `${statements.length} operaciones; máximo ${MAX_ATOMIC_STATEMENTS}. Divide el documento o revisa el mapeo.`,
      createdAt: now,
    });
    return Response.json(
      {
        error:
          "La importación es demasiado grande para aceptarla de forma atómica.",
      },
      { status: 413 },
    );
  }

  try {
    await d1.batch(statements);
  } catch (error) {
    return Response.json(
      {
        error: `No se aceptó ninguna parte de la importación: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 409 },
    );
  }
  const [accepted] = await db
    .select()
    .from(importFiles)
    .where(eq(importFiles.id, id))
    .limit(1);
  return Response.json({
    import: safeImportSummary(accepted),
    links,
    idempotent: false,
  });
}
