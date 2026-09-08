import { getD1 } from "../../../../db";
import { authorizeApi } from "../../../lib/authorization";
import { cleanText } from "../../../lib/crm";
import { calculateDocument } from "../../../lib/document-calculations";
import { quotationIdentity } from "../../../lib/source-domain";

type RouteContext = { params: Promise<{ id: string }> };

async function all<T extends Record<string, unknown>>(
  sql: string,
  ...bindings: unknown[]
) {
  const result = await getD1()
    .prepare(sql)
    .bind(...bindings)
    .all<T>();
  return result.results ?? [];
}

async function optionalAll<T extends Record<string, unknown>>(
  sql: string,
  ...bindings: unknown[]
) {
  try {
    return await all<T>(sql, ...bindings);
  } catch (error) {
    if (/FROM addresses/i.test(sql) && /no such table/i.test(String(error))) {
      return [] as T[];
    }
    throw error;
  }
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "cotizaciones", action: "view" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const requestedRevisionId = cleanText(
    new URL(request.url).searchParams.get("revisionId"),
    80,
  );
  const quotation = await getD1()
    .prepare(
      `SELECT q.id,
        CASE WHEN ir.id IS NOT NULL THEN coalesce(json_extract(ir.raw_values, '$.sourceQuotationNumber'), '') ELSE q.quotation_number END AS quotationNumber,
        CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceYear') ELSE q.quotation_year END AS quotationYear,
        CASE WHEN ir.id IS NOT NULL THEN coalesce(json_extract(ir.raw_values, '$.sourceCustomerName'), '') ELSE q.title END AS title,
        q.quotation_type AS quotationType,
        q.service_category AS serviceCategory, q.status, q.currency,
        q.business_id AS businessId,
        CASE WHEN ir.id IS NOT NULL THEN coalesce(json_extract(ir.raw_values, '$.sourceCustomerName'), '') ELSE b.name END AS businessName,
        CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceRnc') ELSE b.rnc END AS rnc,
        q.primary_contact_id AS primaryContactId,
        CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceContact') ELSE c.name END AS contactName,
        CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceEmail') ELSE c.email END AS contactEmail,
        CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourcePhone') ELSE c.phone END AS contactPhone,
        CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceMobilePhone') ELSE c.mobile_phone END AS contactMobilePhone,
        q.project_id AS projectId, p.name AS projectName,
        q.opportunity_id AS opportunityId, q.owner_email AS ownerEmail,
        q.created_at AS createdAt, q.updated_at AS updatedAt
       FROM quotations q
       JOIN businesses b ON b.id = q.business_id
       LEFT JOIN contacts c ON c.id = q.primary_contact_id
       LEFT JOIN projects p ON p.id = q.project_id
       LEFT JOIN import_rows ir ON ir.revision_id = (
         SELECT current.id FROM quotation_revisions current
         WHERE current.quotation_id = q.id
         ORDER BY current.is_current DESC, current.revision_number DESC,
                  current.updated_at DESC LIMIT 1
       ) AND ir.source_origin = 'cotizaciones_replacement'
       WHERE q.id = ? AND q.archived_at IS NULL`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!quotation) {
    return Response.json(
      { error: "Cotización no encontrada." },
      { status: 404 },
    );
  }

  const sourceRecord = await getD1()
    .prepare(
      `SELECT source_row_number AS sourceRowNumber,
        json_extract(raw_values, '$.sourceDate') AS sourceDate,
        json_extract(raw_values, '$.sourceMonth') AS sourceMonth,
        json_extract(raw_values, '$.sourceYear') AS sourceYear,
        json_extract(raw_values, '$.sourceQuotationNumber') AS sourceQuotationNumber,
        json_extract(raw_values, '$.sourceCustomerName') AS sourceCustomerName,
        json_extract(raw_values, '$.sourceRnc') AS sourceRnc,
        json_extract(raw_values, '$.sourceContact') AS sourceContact,
        json_extract(raw_values, '$.sourcePhone') AS sourcePhone,
        json_extract(raw_values, '$.sourceMobilePhone') AS sourceMobilePhone,
        json_extract(raw_values, '$.sourceEmail') AS sourceEmail,
        json_extract(raw_values, '$.sourceAddress') AS sourceAddress,
        json_extract(raw_values, '$.sourceProjectAddress') AS sourceProjectAddress,
        ir.source_filename AS sourceFilename, ir.source_document_uri AS sourceDocumentUri,
        f.filename AS sourceWorkbook, f.sha256 AS sourceSha256
       FROM import_rows ir JOIN import_files f ON f.id = ir.import_file_id
       WHERE ir.quotation_id = ? AND ir.source_origin = 'cotizaciones_replacement' LIMIT 1`,
    )
    .bind(id)
    .first<Record<string, unknown>>();

  const revisions = await all<Record<string, unknown>>(
    `SELECT id, parent_revision_id AS parentRevisionId,
      identity_key AS identityKey, revision_number AS revisionNumber,
      revision_label AS revisionLabel, alternative_label AS alternativeLabel,
      scope_label AS scopeLabel, quotation_date AS quotationDate,
      quotation_month AS quotationMonth, source_date_raw AS sourceDateRaw,
      source_month_raw AS sourceMonthRaw, source_year_raw AS sourceYearRaw,
      validity_until AS validityUntil,
      is_current AS isCurrent, customer_facing_notes AS customerFacingNotes,
      internal_notes AS internalNotes, source_metadata AS sourceMetadata,
      created_by AS createdBy, created_at AS createdAt, updated_at AS updatedAt
     FROM quotation_revisions WHERE quotation_id = ?
     ORDER BY revision_number DESC, updated_at DESC LIMIT 100`,
    id,
  );
  const revision =
    revisions.find((item) => item.id === requestedRevisionId) ??
    revisions.find((item) => Boolean(item.isCurrent)) ??
    revisions[0] ??
    null;
  if (!revision) {
    return Response.json({ quotation, revisions, revision: null });
  }
  const revisionId = String(revision.id);
  const [
    sections,
    lineItems,
    measurements,
    financials,
    charges,
    terms,
    payments,
    addresses,
    documents,
    sourceReferences,
    warnings,
    history,
  ] = await Promise.all([
    all<Record<string, unknown>>(
      `SELECT * FROM quotation_sections WHERE revision_id = ?
       ORDER BY sort_order LIMIT 100`,
      revisionId,
    ),
    all<Record<string, unknown>>(
      `SELECT id, section_id AS sectionId, sort_order AS sortOrder,
        item_code AS itemCode, description, category, product, service,
        location, quantity, unit_of_measure AS unitOfMeasure, meters,
        opening_width_cm AS openingWidthCm,
        opening_height_cm AS openingHeightCm,
        finished_width_cm AS finishedWidthCm,
        finished_height_cm AS finishedHeightCm, area_sqm AS areaSqm,
        price_basis AS priceBasis, unit_price AS unitPrice,
        price_per_sqm AS pricePerSqm, flat_fee AS flatFee,
        discount_amount AS discountAmount, tax_amount AS taxAmount,
        source_line_total AS sourceLineTotal,
        calculated_line_total AS calculatedLineTotal, currency, motor_type AS motorType,
        control_type AS controlType, material, notes, value_states AS valueStates,
        source_sheet AS sourceSheet, source_range AS sourceRange
       FROM quotation_line_items WHERE revision_id = ?
       ORDER BY sort_order LIMIT 500`,
      revisionId,
    ),
    all<Record<string, unknown>>(
      `SELECT id, line_item_id AS lineItemId, project_id AS projectId,
        location, building, apartment, floor, level, room,
        area_label AS areaLabel, opening_width_cm AS openingWidthCm,
        opening_height_cm AS openingHeightCm,
        finished_width_cm AS finishedWidthCm,
        finished_height_cm AS finishedHeightCm, area_sqm AS areaSqm,
        quantity, value_states AS valueStates, source_sheet AS sourceSheet,
        source_range AS sourceRange
       FROM measurements WHERE revision_id = ? LIMIT 500`,
      revisionId,
    ),
    getD1()
      .prepare(
        `SELECT currency, source_subtotal AS sourceSubtotal,
          calculated_subtotal AS calculatedSubtotal,
          discount_rate AS discountRate, discount_amount AS discountAmount,
          source_tax_rate AS sourceTaxRate, source_tax_amount AS sourceTaxAmount,
          calculated_tax_amount AS calculatedTaxAmount,
          source_total AS sourceTotal, calculated_total AS calculatedTotal,
          discrepancy_amount AS discrepancyAmount, payment_status AS paymentStatus,
          value_states AS valueStates, validated_at AS validatedAt
         FROM quotation_financials WHERE revision_id = ?`,
      )
      .bind(revisionId)
      .first<Record<string, unknown>>(),
    all<Record<string, unknown>>(
      `SELECT type, label, source_amount AS sourceAmount,
        calculated_amount AS calculatedAmount, rate, currency,
        value_state AS valueState, source_range AS sourceRange,
        sort_order AS sortOrder
       FROM quotation_charges WHERE revision_id = ? ORDER BY sort_order LIMIT 100`,
      revisionId,
    ),
    getD1()
      .prepare(
        `SELECT quotation_validity AS quotationValidity,
          payment_conditions AS paymentConditions, warranty, return_policy AS returnPolicy,
          installation_observations AS installationObservations,
          maintenance_disclaimer AS maintenanceDisclaimer,
          unforeseen_parts_disclaimer AS unforeseenPartsDisclaimer,
          additional_cost_notice AS additionalCostNotice,
          original_spanish_text AS originalSpanishText
         FROM quotation_terms WHERE revision_id = ?`,
      )
      .bind(revisionId)
      .first<Record<string, unknown>>(),
    all<Record<string, unknown>>(
      `SELECT id, type, amount, currency, payment_date AS paymentDate,
        method, status, label, installment_reference AS installmentReference,
        notes, source_location AS sourceLocation
       FROM payments WHERE revision_id = ? ORDER BY payment_date, created_at LIMIT 250`,
      revisionId,
    ),
    optionalAll<Record<string, unknown>>(
      `SELECT id, type, label, line1, line2, city, province, postal_code AS postalCode,
        country, is_primary AS isPrimary FROM addresses
       WHERE business_id = ? OR (? <> '' AND project_id = ?) LIMIT 100`,
      quotation.businessId,
      quotation.projectId ?? "",
      quotation.projectId ?? "",
    ),
    all<Record<string, unknown>>(
      `SELECT d.id, d.name, d.content_type AS contentType, d.size, d.extension,
        d.document_role AS documentRole, dl.purpose, dl.created_at AS linkedAt
       FROM document_links dl JOIN documents d ON d.id = dl.document_id
       WHERE dl.entity_type = 'quotation_revision' AND dl.entity_id = ?
       ORDER BY dl.created_at DESC LIMIT 100`,
      revisionId,
    ),
    all<Record<string, unknown>>(
      `SELECT sr.id, sr.original_filename AS originalFilename,
        sr.original_uri AS originalUri, sr.uri_scheme AS uriScheme,
        sr.availability, sr.source_origin AS sourceOrigin,
        sr.file_hash AS fileHash, sr.document_id AS documentId,
        ir.source_row_number AS sourceRowNumber,
        ir.worksheet_name AS worksheetName, ir.outcome AS importOutcome,
        f.filename AS importFilename, f.id AS importFileId,
        b.id AS importBatchId, b.name AS importBatchName
       FROM source_references sr
       LEFT JOIN import_rows ir ON ir.id = sr.import_row_id
       LEFT JOIN import_files f ON f.id = ir.import_file_id
       LEFT JOIN import_batches b ON b.id = f.batch_id
       WHERE sr.revision_id = ?
       ORDER BY sr.created_at DESC LIMIT 250`,
      revisionId,
    ),
    all<Record<string, unknown>>(
      `SELECT ii.id, ii.type, ii.severity, ii.status, ii.title, ii.detail,
        ii.source_location AS sourceLocation, ii.resolution
       FROM import_issues ii
       LEFT JOIN import_rows ir ON ir.id = ii.import_row_id
       LEFT JOIN import_files f ON f.id = ii.import_file_id
       LEFT JOIN document_links dl ON dl.document_id = f.document_id
       WHERE ir.revision_id = ?
          OR (dl.entity_type = 'quotation_revision' AND dl.entity_id = ?)
       ORDER BY ii.created_at DESC LIMIT 250`,
      revisionId,
      revisionId,
    ),
    all<Record<string, unknown>>(
      `SELECT action, actor_email AS actorEmail, reason, created_at AS createdAt
       FROM entity_history
       WHERE (entity_type = 'quotation_revision' AND entity_id = ?)
          OR (entity_type = 'quotation' AND entity_id = ?)
       ORDER BY created_at DESC LIMIT 250`,
      revisionId,
      id,
    ),
  ]);

  let manufacturing: Record<string, unknown>[] = [];
  let materialComponents: Record<string, unknown>[] = [];
  if (auth.user.role !== "viewer") {
    manufacturing = await all<Record<string, unknown>>(
      `SELECT id, name, worksheet_type AS worksheetType, source_sheet AS sourceSheet,
        source_range AS sourceRange, calculation_status AS calculationStatus,
        source_formula_summary AS sourceFormulaSummary, notes
       FROM manufacturing_worksheets WHERE revision_id = ? LIMIT 100`,
      revisionId,
    );
    if (manufacturing.length) {
      const ids = manufacturing.map(() => "?").join(",");
      materialComponents = await all<Record<string, unknown>>(
        `SELECT id, worksheet_id AS worksheetId, component_type AS componentType,
          name, quantity, unit_cost AS unitCost, total_cost AS totalCost,
          currency, source_formula AS sourceFormula, formula_result AS formulaResult,
          formula_status AS formulaStatus, source_sheet AS sourceSheet,
          source_range AS sourceRange, sort_order AS sortOrder
         FROM material_components WHERE worksheet_id IN (${ids})
         ORDER BY worksheet_id, sort_order LIMIT 1000`,
        ...manufacturing.map((item) => item.id),
      );
    }
  }

  return Response.json(
    {
      quotation,
      sourceRecord: sourceRecord ?? null,
      revisions,
      revision,
      sections,
      lineItems,
      measurements,
      financials,
      charges,
      terms,
      payments,
      addresses,
      documents,
      sourceReferences,
      warnings,
      history,
      manufacturing,
      materialComponents,
      internalVisible: auth.user.role !== "viewer",
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "cotizaciones", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const current = await getD1()
    .prepare(
      `SELECT q.*, r.id AS revision_id
       FROM quotations q
       LEFT JOIN quotation_revisions r ON r.id = (
         SELECT qr.id FROM quotation_revisions qr
         WHERE qr.quotation_id = q.id
         ORDER BY qr.is_current DESC, qr.revision_number DESC LIMIT 1
       )
       WHERE q.id = ? AND q.archived_at IS NULL`,
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!current) {
    return Response.json(
      { error: "Cotización no encontrada." },
      { status: 404 },
    );
  }
  const quotationNumber = cleanText(
    payload.quotationNumber ?? current.quotation_number,
    120,
  );
  const businessId = cleanText(payload.businessId ?? current.business_id, 80);
  if (!quotationNumber || !businessId) {
    return Response.json(
      {
        error: "Número de cotización y cliente son obligatorios.",
        field: !businessId ? "businessId" : "quotationNumber",
      },
      { status: 400 },
    );
  }
  const business = await getD1()
    .prepare("SELECT id FROM businesses WHERE id = ? AND archived_at IS NULL")
    .bind(businessId)
    .first<{ id: string }>();
  if (!business) {
    return Response.json({ error: "El cliente no existe.", field: "businessId" }, { status: 400 });
  }
  const primaryContactId = cleanText(payload.primaryContactId, 80) || null;
  if (primaryContactId) {
    const contact = await getD1()
      .prepare(
        "SELECT id FROM contacts WHERE id = ? AND business_id = ? AND archived_at IS NULL",
      )
      .bind(primaryContactId, businessId)
      .first<{ id: string }>();
    if (!contact) {
      return Response.json(
        { error: "El contacto no pertenece al cliente seleccionado.", field: "primaryContactId" },
        { status: 400 },
      );
    }
  }
  const projectId = cleanText(payload.projectId, 80) || null;
  if (projectId) {
    const project = await getD1()
      .prepare(
        "SELECT id FROM projects WHERE id = ? AND business_id = ? AND archived_at IS NULL",
      )
      .bind(projectId, businessId)
      .first<{ id: string }>();
    if (!project) {
      return Response.json(
        { error: "El proyecto no pertenece al cliente seleccionado.", field: "projectId" },
        { status: 400 },
      );
    }
  }
  const allowedStatuses = new Set([
    "draft",
    "sent",
    "accepted",
    "rejected",
    "expired",
    "cancelled",
    "unknown",
  ]);
  const allowedTypes = new Set([
    "installation",
    "repair",
    "maintenance",
    "mixed",
    "other",
  ]);
  const status = cleanText(payload.status ?? current.status, 30);
  const quotationType = cleanText(
    payload.quotationType ?? current.quotation_type,
    30,
  );
  if (!allowedStatuses.has(status) || !allowedTypes.has(quotationType)) {
    return Response.json(
      { error: "Estado o tipo de cotización no válido.", field: !allowedStatuses.has(status) ? "status" : "quotationType" },
      { status: 400 },
    );
  }
  const identity = quotationIdentity(quotationNumber);
  const yearValue = Number(payload.quotationYear ?? current.quotation_year);
  const year =
    Number.isInteger(yearValue) && yearValue >= 1900 && yearValue <= 9999
      ? yearValue
      : null;
  const monthValue = Number(payload.quotationMonth);
  const month =
    Number.isInteger(monthValue) && monthValue >= 1 && monthValue <= 12
      ? monthValue
      : null;
  const revisionId = cleanText(payload.revisionId ?? current.revision_id, 80);
  const now = new Date().toISOString();
  const replacementLines = Array.isArray(payload.lines)
    ? normalizeEditableLines(payload.lines)
    : null;
  const currentCurrency = cleanText(
    payload.currency ?? current.currency,
    8,
  ).toUpperCase() || "DOP";
  const calculated = replacementLines
    ? calculateDocument({
        lines: replacementLines,
        discount: payload.discountAmount,
        additionalCharge: payload.additionalChargeAmount,
        taxRate: payload.taxRate,
        advance: payload.paidAmountSnapshot,
      })
    : null;
  if (calculated?.errors.length) {
    return Response.json({ error: calculated.errors[0], field: "lines" }, { status: 400 });
  }
  const statements = [
    getD1()
      .prepare(
        `UPDATE quotations
         SET business_id = ?, primary_contact_id = ?, project_id = ?,
             quotation_number = ?, normalized_quotation_number = ?,
             family_key = ?, quotation_year = ?, title = ?,
             quotation_type = ?, service_category = ?, status = ?,
             currency = ?, updated_at = ?
         WHERE id = ? AND archived_at IS NULL`,
      )
      .bind(
        businessId,
        primaryContactId,
        projectId,
        quotationNumber,
        quotationNumber.toUpperCase().replace(/\s+/g, ""),
        identity.familyKey,
        year,
        cleanText(payload.title, 240) || quotationNumber,
        quotationType,
        cleanText(payload.serviceCategory, 120),
        status,
        currentCurrency,
        now,
        id,
      ),
    getD1()
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, field_name, previous_value,
           new_value, actor_email, reason, created_at
         ) VALUES ('quotation', ?, 'updated', 'record', ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        JSON.stringify(current),
        JSON.stringify(payload),
        auth.user.email,
        cleanText(payload.changeReason, 500) || "Edición en el portal",
        now,
      ),
  ];
  if (revisionId) {
    const revision = await getD1()
      .prepare(
        "SELECT id FROM quotation_revisions WHERE id = ? AND quotation_id = ?",
      )
      .bind(revisionId, id)
      .first<{ id: string }>();
    if (!revision) {
      return Response.json(
        { error: "La revisión seleccionada no pertenece a la cotización." },
        { status: 400 },
      );
    }
    statements.push(
      getD1()
        .prepare(
          `UPDATE quotation_revisions
           SET revision_label = ?, alternative_label = ?, scope_label = ?,
               quotation_date = ?, quotation_month = ?, validity_until = ?,
               customer_facing_notes = ?, internal_notes = ?, updated_at = ?
           WHERE id = ? AND quotation_id = ?`,
        )
        .bind(
          cleanText(payload.revisionLabel, 180),
          cleanText(payload.alternativeLabel, 180),
          cleanText(payload.scopeLabel, 180),
          cleanText(payload.quotationDate, 20) || null,
          month,
          cleanText(payload.validityUntil, 20) || null,
          cleanText(payload.customerFacingNotes, 4_000),
          cleanText(payload.internalNotes, 4_000),
          now,
          revisionId,
          id,
        ),
    );
  }
  if (revisionId && calculated && replacementLines) {
    statements.push(
      getD1()
        .prepare("DELETE FROM quotation_line_items WHERE revision_id = ?")
        .bind(revisionId),
      getD1()
        .prepare(
          `INSERT INTO quotation_financials (
            id, revision_id, currency, calculated_subtotal, discount_amount,
            source_tax_rate, calculated_tax_amount, calculated_total, amount_paid,
            remaining_balance, payment_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(revision_id) DO UPDATE SET
            currency = excluded.currency,
            calculated_subtotal = excluded.calculated_subtotal,
            discount_amount = excluded.discount_amount,
            source_tax_rate = excluded.source_tax_rate,
            calculated_tax_amount = excluded.calculated_tax_amount,
            calculated_total = excluded.calculated_total,
            amount_paid = excluded.amount_paid,
            remaining_balance = excluded.remaining_balance,
            payment_status = excluded.payment_status,
            updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          revisionId,
          currentCurrency,
          calculated.subtotal,
          calculated.discount,
          calculated.taxRate,
          calculated.taxAmount,
          calculated.total,
          calculated.advance,
          calculated.balance,
          quotationPaymentStatus(calculated.advance, calculated.total),
          now,
          now,
        ),
    );
    for (const [index, line] of replacementLines.entries()) {
      const calculatedLine = calculated.lines[index];
      statements.push(
        getD1()
          .prepare(
            `INSERT INTO quotation_line_items (
              id, revision_id, sort_order, description, location, quantity,
              unit_of_measure, finished_width_cm, finished_height_cm, area_sqm,
              price_basis, unit_price, price_per_sqm, calculated_line_total,
              currency, value_states, source_values, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            revisionId,
            index,
            cleanText(line.description, 1000),
            cleanText(line.location, 300),
            calculatedLine.quantity,
            calculatedLine.widthCm,
            calculatedLine.heightCm,
            calculatedLine.areaTotal,
            calculatedLine.areaPerUnit === null ? "unit" : "square_meter",
            calculatedLine.unitPrice,
            calculatedLine.areaPerUnit === null ? null : calculatedLine.unitPrice,
            calculatedLine.lineTotal,
            currentCurrency,
            now,
            now,
          ),
      );
    }
    statements.push(
      getD1()
        .prepare("DELETE FROM quotation_charges WHERE revision_id = ? AND type = 'other'")
        .bind(revisionId),
    );
    const chargeAmount = Math.max(0, Number(payload.additionalChargeAmount) || 0);
    if (chargeAmount > 0) {
      statements.push(
        getD1()
          .prepare(
            `INSERT INTO quotation_charges (
              id, revision_id, type, label, calculated_amount, currency,
              value_state, sort_order
            ) VALUES (?, ?, 'other', ?, ?, ?, 'value', 0)`,
          )
          .bind(
            crypto.randomUUID(),
            revisionId,
            cleanText(payload.additionalChargeLabel, 120) || "Cargo adicional",
            chargeAmount,
            currentCurrency,
          ),
      );
    }
    const terms = payload.terms && typeof payload.terms === "object"
      ? payload.terms as Record<string, unknown>
      : {};
    statements.push(
      getD1()
        .prepare(
          `INSERT INTO quotation_terms (
            id, revision_id, quotation_validity, payment_conditions,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(revision_id) DO UPDATE SET
            quotation_validity = excluded.quotation_validity,
            payment_conditions = excluded.payment_conditions,
            updated_at = excluded.updated_at`,
        )
        .bind(
          crypto.randomUUID(),
          revisionId,
          cleanText(payload.validityUntil, 20),
          cleanText(payload.paymentConditions ?? payload.paymentTermsRaw ?? terms.paymentConditions, 2000),
          now,
          now,
        ),
    );
  }
  statements.push(
    getD1()
      .prepare(
        `INSERT INTO search_documents (
           entity_type, entity_id, title, subtitle, search_text, owner_email,
           updated_at
         ) VALUES ('quotation', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(entity_type, entity_id) DO UPDATE SET
           title = excluded.title,
           subtitle = excluded.subtitle,
           search_text = excluded.search_text,
           owner_email = excluded.owner_email,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        quotationNumber,
        cleanText(payload.title, 240) || quotationNumber,
        [
          quotationNumber,
          cleanText(payload.title, 240),
          cleanText(payload.serviceCategory, 120),
          status,
          year ?? "",
          month ?? "",
        ].join(" "),
        auth.user.email,
        now,
      ),
  );
  await getD1().batch(statements);
  return Response.json({ ok: true, quotationId: id, revisionId });
}

function normalizeEditableLines(value: unknown[]) {
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    const description = cleanText(line.description, 1000);
    return description
      ? [{
          id: cleanText(line.id, 80) || crypto.randomUUID(),
          description,
          quantity: line.quantity,
          widthCm: line.widthCm,
          heightCm: line.heightCm,
          unitPrice: line.unitPrice,
          location: line.location,
        }]
      : [];
  });
}

function quotationPaymentStatus(advance: number, total: number) {
  if (advance <= 0) return "unpaid";
  return advance >= total ? "paid" : "partial";
}
