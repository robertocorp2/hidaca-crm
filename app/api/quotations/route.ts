import { getD1 } from "../../../db";
import { authorizeApi } from "../../lib/authorization";
import { cleanText } from "../../lib/crm";
import { writeAudit } from "../../lib/audit";
import { upsertSearchDocument } from "../../lib/search";
import { calculateDocument } from "../../lib/document-calculations";

export async function GET(request: Request) {
  const auth = await authorizeApi({ module: "cotizaciones", action: "view" });
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const query = cleanText(params.get("q"), 120);
  const status = cleanText(params.get("status"), 30);
  const type = cleanText(params.get("type"), 30);
  const businessId = cleanText(params.get("businessId"), 80);
  const projectId = cleanText(params.get("projectId"), 80);
  const paymentStatus = cleanText(params.get("paymentStatus"), 30);
  const serviceCategory = cleanText(params.get("serviceCategory"), 120);
  const sourceFilename = cleanText(params.get("sourceFilename"), 160);
  const importBatchId = cleanText(params.get("importBatchId"), 80);
  const dateFrom = cleanText(params.get("dateFrom"), 20);
  const dateTo = cleanText(params.get("dateTo"), 20);
  const year = Number(params.get("year"));
  const month = Number(params.get("month"));
  const minTotalRaw = params.get("minTotal");
  const maxTotalRaw = params.get("maxTotal");
  const minTotal =
    minTotalRaw !== null && minTotalRaw.trim() !== ""
      ? Number(minTotalRaw)
      : null;
  const maxTotal =
    maxTotalRaw !== null && maxTotalRaw.trim() !== ""
      ? Number(maxTotalRaw)
      : null;
  const limit = Math.min(Math.max(Number(params.get("limit")) || 100, 1), 250);
  const offset = Math.min(
    Math.max(Number(params.get("offset")) || 0, 0),
    5_000,
  );
  const where = ["q.archived_at IS NULL"];
  const bindings: unknown[] = [];
  if (query) {
    where.push(
      `(q.quotation_number LIKE ? OR q.title LIKE ? OR b.name LIKE ?
        OR b.rnc LIKE ? OR b.email LIKE ? OR b.phone LIKE ?
        OR b.mobile_phone LIKE ? OR c.name LIKE ? OR c.email LIKE ?
        OR c.phone LIKE ? OR c.mobile_phone LIKE ? OR p.name LIKE ?
        OR EXISTS (
          SELECT 1 FROM source_references qs
          WHERE qs.revision_id = r.id AND qs.original_filename LIKE ?
        )
        OR json_extract(ir.raw_values, '$.sourceQuotationNumber') LIKE ? OR json_extract(ir.raw_values, '$.sourceCustomerName') LIKE ?
        OR json_extract(ir.raw_values, '$.sourceRnc') LIKE ? OR json_extract(ir.raw_values, '$.sourceContact') LIKE ?
        OR json_extract(ir.raw_values, '$.sourcePhone') LIKE ? OR json_extract(ir.raw_values, '$.sourceMobilePhone') LIKE ?
        OR json_extract(ir.raw_values, '$.sourceEmail') LIKE ? OR json_extract(ir.raw_values, '$.sourceAddress') LIKE ?
        OR json_extract(ir.raw_values, '$.sourceProjectAddress') LIKE ? OR ir.source_filename LIKE ?
        OR ir.source_document_uri LIKE ?)`,
    );
    const like = `%${query}%`;
    bindings.push(
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
      like,
    );
  }
  if (status) {
    where.push("q.status = ?");
    bindings.push(status);
  }
  if (type) {
    where.push("q.quotation_type = ?");
    bindings.push(type);
  }
  if (serviceCategory) {
    where.push("q.service_category = ?");
    bindings.push(serviceCategory);
  }
  if (businessId) {
    where.push("q.business_id = ?");
    bindings.push(businessId);
  }
  if (projectId) {
    where.push("q.project_id = ?");
    bindings.push(projectId);
  }
  if (Number.isInteger(year) && year > 1900 && year < 2200) {
    where.push("q.quotation_year = ?");
    bindings.push(year);
  }
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    where.push("r.quotation_month = ?");
    bindings.push(month);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
    where.push("r.quotation_date >= ?");
    bindings.push(dateFrom);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
    where.push("r.quotation_date <= ?");
    bindings.push(dateTo);
  }
  if (paymentStatus) {
    where.push("f.payment_status = ?");
    bindings.push(paymentStatus);
  }
  if (minTotal !== null && Number.isFinite(minTotal)) {
    where.push("coalesce(f.source_total, f.calculated_total) >= ?");
    bindings.push(minTotal);
  }
  if (maxTotal !== null && Number.isFinite(maxTotal)) {
    where.push("coalesce(f.source_total, f.calculated_total) <= ?");
    bindings.push(maxTotal);
  }
  if (sourceFilename) {
    where.push(
      `EXISTS (
        SELECT 1 FROM source_references sf
        WHERE sf.revision_id = r.id AND sf.original_filename LIKE ?
      ) OR ir.source_filename LIKE ?`,
    );
    bindings.push(`%${sourceFilename}%`);
    bindings.push(`%${sourceFilename}%`);
  }
  if (importBatchId) {
    where.push(
      `EXISTS (
        SELECT 1 FROM import_rows ir
        JOIN import_files imf ON imf.id = ir.import_file_id
        WHERE ir.revision_id = r.id AND imf.batch_id = ?
      )`,
    );
    bindings.push(importBatchId);
  }

  const sql = `
    SELECT q.id,
      CASE WHEN ir.id IS NOT NULL THEN coalesce(json_extract(ir.raw_values, '$.sourceQuotationNumber'), '') ELSE q.quotation_number END AS quotationNumber,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceYear') ELSE q.quotation_year END AS quotationYear,
      CASE WHEN ir.id IS NOT NULL THEN coalesce(json_extract(ir.raw_values, '$.sourceCustomerName'), '') ELSE q.title END AS title,
      q.quotation_type AS quotationType,
      q.service_category AS serviceCategory, q.status, q.currency,
      q.business_id AS businessId,
      CASE WHEN ir.id IS NOT NULL THEN coalesce(json_extract(ir.raw_values, '$.sourceCustomerName'), '') ELSE b.name END AS businessName,
      q.primary_contact_id AS primaryContactId,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceContact') ELSE c.name END AS contactName,
      q.project_id AS projectId, p.name AS projectName,
      q.opportunity_id AS opportunityId,
      q.owner_email AS ownerEmail, q.updated_at AS updatedAt,
      r.id AS currentRevisionId, r.revision_number AS revisionNumber,
      r.revision_label AS revisionLabel,
      r.alternative_label AS alternativeLabel,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceDate') ELSE r.quotation_date END AS quotationDate,
      r.quotation_month AS quotationMonth,
      f.source_total AS sourceTotal,
      f.calculated_total AS calculatedTotal,
      f.payment_status AS paymentStatus,
      CASE WHEN ir.id IS NOT NULL THEN ir.source_filename ELSE (SELECT sr.original_filename FROM source_references sr
       WHERE sr.revision_id = r.id ORDER BY sr.created_at DESC LIMIT 1)
        END AS sourceFilename,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceRnc') ELSE b.rnc END AS rnc,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourcePhone') ELSE c.phone END AS contactPhone,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceMobilePhone') ELSE c.mobile_phone END AS contactMobilePhone,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceEmail') ELSE c.email END AS contactEmail,
      CASE WHEN ir.id IS NOT NULL THEN ir.source_row_number ELSE NULL END AS sourceRowNumber,
      CASE WHEN ir.id IS NOT NULL THEN ir.source_document_uri ELSE NULL END AS sourceDocumentUri,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceAddress') ELSE NULL END AS sourceAddress,
      CASE WHEN ir.id IS NOT NULL THEN json_extract(ir.raw_values, '$.sourceProjectAddress') ELSE NULL END AS sourceProjectAddress,
      (SELECT ib.id FROM import_rows ir
       JOIN import_files inf ON inf.id = ir.import_file_id
       JOIN import_batches ib ON ib.id = inf.batch_id
       WHERE ir.revision_id = r.id ORDER BY ir.accepted_at DESC LIMIT 1)
        AS importBatchId
    FROM quotations q
    JOIN businesses b ON b.id = q.business_id
    LEFT JOIN contacts c ON c.id = q.primary_contact_id
    LEFT JOIN projects p ON p.id = q.project_id
    LEFT JOIN quotation_revisions r ON r.id = (
      SELECT current.id FROM quotation_revisions current
      WHERE current.quotation_id = q.id
      ORDER BY current.is_current DESC, current.revision_number DESC,
               current.updated_at DESC LIMIT 1
    )
    LEFT JOIN quotation_financials f ON f.revision_id = r.id
    LEFT JOIN import_rows ir ON ir.revision_id = r.id AND ir.source_origin = 'cotizaciones_replacement'
    WHERE ${where.join(" AND ")}
    ORDER BY COALESCE(r.quotation_date, q.updated_at) DESC, q.updated_at DESC
    LIMIT ? OFFSET ?`;
  bindings.push(limit, offset);
  const result = await getD1()
    .prepare(sql)
    .bind(...bindings)
    .all<Record<string, unknown>>();

  return Response.json(
    { quotations: result.results, limit, offset },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "cotizaciones", action: "create" });
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as Record<string, unknown>;
  const quotationNumber = cleanText(payload.quotationNumber, 120);
  const businessId = cleanText(payload.businessId, 80);
  if (!quotationNumber || !businessId) {
    return Response.json({
      error: "Empresa y número de cotización son obligatorios.",
      field: !businessId ? "businessId" : "quotationNumber",
    }, { status: 400 });
  }
  const business = await getD1()
    .prepare("SELECT id, name FROM businesses WHERE id = ? AND archived_at IS NULL")
    .bind(businessId)
    .first<{ id: string; name: string }>();
  if (!business) return Response.json({ error: "La empresa no existe.", field: "businessId" }, { status: 400 });

  const contactId = cleanText(payload.primaryContactId, 80);
  if (contactId) {
    const contact = await getD1().prepare("SELECT id FROM contacts WHERE id = ? AND business_id = ? AND archived_at IS NULL").bind(contactId, businessId).first();
    if (!contact) return Response.json({ error: "El contacto no pertenece a la empresa seleccionada.", field: "primaryContactId" }, { status: 400 });
  }
  const projectId = cleanText(payload.projectId, 80);
  if (projectId) {
    const project = await getD1().prepare("SELECT id FROM projects WHERE id = ? AND business_id = ? AND archived_at IS NULL").bind(projectId, businessId).first();
    if (!project) return Response.json({ error: "El proyecto no pertenece a la empresa seleccionada.", field: "projectId" }, { status: 400 });
  }

  const status = cleanText(payload.status, 30) || "draft";
  const quotationType = cleanText(payload.quotationType, 30) || "other";
  const validStatuses = ["draft", "sent", "accepted", "rejected", "expired", "cancelled", "unknown"];
  const validTypes = ["installation", "repair", "maintenance", "mixed", "other"];
  if (!validStatuses.includes(status) || !validTypes.includes(quotationType)) {
    return Response.json({ error: "Estado o tipo de cotización no válido.", field: !validStatuses.includes(status) ? "status" : "quotationType" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const date = cleanText(payload.quotationDate, 20) || null;
  const year = validYear(payload.quotationYear) ?? (date ? Number(date.slice(0, 4)) : null);
  const revisionLabel = cleanText(payload.revisionLabel, 180);
  const alternativeLabel = cleanText(payload.alternativeLabel, 180);
  const identityKey = `${normalizeQuotationNumber(quotationNumber)}|${revisionLabel}|${alternativeLabel}`;
  const currency = cleanText(payload.currency, 8).toUpperCase() || "DOP";
  const rawLines = normalizeQuotationLines(payload.lines);
  const calculation = calculateDocument({
    lines: rawLines,
    discount: payload.discountAmount,
    additionalCharge: payload.additionalChargeAmount,
    taxRate: payload.taxRate,
    advance: payload.paidAmountSnapshot,
  });
  if (calculation.errors.length) return Response.json({ error: calculation.errors[0], field: "lines" }, { status: 400 });
  if (!rawLines.length) return Response.json({ error: "Agrega al menos una partida con descripción.", field: "lines" }, { status: 400 });

  const statements: D1PreparedStatement[] = [
    getD1().prepare(`INSERT INTO quotations (
      id, business_id, primary_contact_id, project_id, quotation_number,
      normalized_quotation_number, family_key, quotation_year, title,
      quotation_type, service_category, status, currency, source_metadata,
      owner_email, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`)
      .bind(id, businessId, contactId || null, projectId || null, quotationNumber,
        normalizeQuotationNumber(quotationNumber), normalizeQuotationNumber(quotationNumber), year,
        cleanText(payload.title, 240) || quotationNumber, quotationType,
        cleanText(payload.serviceCategory, 120), status, currency, auth.user.email,
        auth.user.email, now, now),
    getD1().prepare(`INSERT INTO quotation_revisions (
      id, quotation_id, identity_key, revision_number, revision_label,
      alternative_label, scope_label, quotation_date, quotation_month,
      validity_until, is_current, customer_facing_notes, internal_notes,
      source_metadata, created_by, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 1, ?, ?, '{}', ?, ?, ?)`)
      .bind(revisionId, id, identityKey, revisionLabel, alternativeLabel,
        cleanText(payload.scopeLabel, 180), date, date ? Number(date.slice(5, 7)) : null,
        cleanText(payload.validityUntil, 20) || null,
        cleanText(payload.customerFacingNotes ?? (payload.terms as Record<string, unknown> | undefined)?.customerFacingNotes, 4000),
        cleanText(payload.internalNotes ?? (payload.terms as Record<string, unknown> | undefined)?.internalNotes, 4000),
        auth.user.email, now, now),
    getD1().prepare(`INSERT INTO quotation_financials (
      id, revision_id, currency, calculated_subtotal, discount_amount,
      source_tax_rate, calculated_tax_amount, calculated_total, amount_paid,
      remaining_balance, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), revisionId, currency, calculation.subtotal, calculation.discount,
        calculation.taxRate, calculation.taxAmount, calculation.total, calculation.advance,
        calculation.balance, paymentStatus(calculation.advance, calculation.total), now, now),
  ];
  for (const [index, line] of rawLines.entries()) {
    const calculated = calculation.lines[index];
    statements.push(getD1().prepare(`INSERT INTO quotation_line_items (
      id, revision_id, sort_order, description, location, quantity,
      unit_of_measure, finished_width_cm, finished_height_cm, area_sqm,
      price_basis, unit_price, price_per_sqm, calculated_line_total,
      currency, value_states, source_values, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, '{}', '{}', ?, ?)`)
      .bind(crypto.randomUUID(), revisionId, index, cleanText(line.description, 1000),
        cleanText(line.location, 300), calculated.quantity, calculated.widthCm,
        calculated.heightCm, calculated.areaTotal, calculated.areaPerUnit === null ? "unit" : "square_meter",
        calculated.unitPrice, calculated.areaPerUnit === null ? null : calculated.unitPrice,
        calculated.lineTotal, currency, now, now));
  }
  const terms = (payload.terms && typeof payload.terms === "object" ? payload.terms : {}) as Record<string, unknown>;
  statements.push(getD1().prepare(`INSERT INTO quotation_terms (
    id, revision_id, quotation_validity, payment_conditions,
    additional_cost_notice, original_spanish_text, source_values,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?)`)
    .bind(crypto.randomUUID(), revisionId, cleanText(payload.validityUntil, 20),
      cleanText(payload.paymentConditions ?? payload.paymentTermsRaw ?? terms.paymentConditions, 2000),
      cleanText(terms.additionalCostNotice, 2000), cleanText(terms.originalSpanishText, 4000), now, now));
  const charge = Math.max(0, Number(payload.additionalChargeAmount) || 0);
  if (charge > 0) {
    statements.push(getD1().prepare(`INSERT INTO quotation_charges (
      id, revision_id, type, label, calculated_amount, currency, value_state, sort_order
    ) VALUES (?, ?, 'other', ?, ?, ?, 'value', 0)`)
      .bind(crypto.randomUUID(), revisionId, cleanText(payload.additionalChargeLabel, 120) || "Cargo adicional", charge, currency));
  }
  try {
    await getD1().batch(statements);
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) {
      return Response.json({ error: "El número de cotización ya existe para esta revisión.", field: "quotationNumber" }, { status: 409 });
    }
    return Response.json({ error: "No se pudo guardar la cotización." }, { status: 500 });
  }
  await Promise.all([
    writeAudit(auth.user.email, "create", "quotation", id, quotationNumber),
    upsertSearchDocument({ entityType: "quotation", entityId: id, title: quotationNumber, subtitle: business.name, searchText: `${quotationNumber} ${business.name} ${cleanText(payload.title, 240)}`, ownerEmail: auth.user.email, updatedAt: now }),
  ]);
  return Response.json({ quotationId: id, revisionId, quotation: { id, quotationNumber, businessId, title: cleanText(payload.title, 240) || quotationNumber, status, currency } }, { status: 201 });
}

function normalizeQuotationLines(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && cleanText((entry as Record<string, unknown>).description, 1000))).map((entry) => ({
    id: cleanText(entry.id, 80) || crypto.randomUUID(),
    description: cleanText(entry.description, 1000),
    quantity: entry.quantity,
    widthCm: entry.widthCm,
    heightCm: entry.heightCm,
    unitPrice: entry.unitPrice,
    location: entry.location,
  }));
}

function validYear(value: unknown) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 1900 && year <= 9999 ? year : null;
}

function normalizeQuotationNumber(value: string) {
  return value.toUpperCase().replace(/\s+/g, "");
}

function paymentStatus(advance: number, total: number) {
  if (advance <= 0) return "unpaid";
  return advance >= total ? "paid" : "partial";
}
