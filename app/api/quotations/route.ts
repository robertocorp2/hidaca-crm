import { getD1 } from "../../../db";
import { authorizeApi } from "../../lib/authorization";
import { cleanText } from "../../lib/crm";

export async function GET(request: Request) {
  const auth = await authorizeApi();
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
