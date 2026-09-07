import { getD1 } from "../../../../../db";
import { authorizeApi } from "../../../../lib/authorization";
import {
  normalizeEmail,
  normalizePhone,
  normalizeText,
} from "../../../../lib/crm";
import type { RegisterNormalizedValues } from "../../../../lib/importers";

type RegisterRowRecord = {
  id: string;
  import_file_id: string;
  source_row_number: number;
  row_fingerprint: string;
  normalized_values: string;
  source_filename: string;
  source_origin: string;
};

type ExistingBusiness = {
  id: string;
  name: string;
  normalized_name: string;
  normalized_rnc: string;
  email: string;
  phone: string;
  mobile_phone: string;
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

async function matchBusiness(value: RegisterNormalizedValues) {
  const d1 = getD1();
  const candidates = await d1
    .prepare(
      `SELECT id, name, normalized_name, normalized_rnc, email, phone,
              mobile_phone
       FROM businesses
       WHERE archived_at IS NULL
         AND (
           (? <> '' AND normalized_rnc = ?) OR
           (? <> '' AND lower(email) = ?) OR
           (? <> '' AND normalized_name = ?) OR
           (? <> '' AND (
             replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ?
             OR replace(replace(replace(replace(replace(mobile_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ?
           ))
         )
       LIMIT 20`,
    )
    .bind(
      value.normalizedRnc,
      value.normalizedRnc,
      value.normalizedEmail,
      value.normalizedEmail,
      value.normalizedCustomerName,
      value.normalizedCustomerName,
      value.normalizedMobilePhone || value.normalizedPhone,
      value.normalizedMobilePhone || value.normalizedPhone,
      value.normalizedMobilePhone || value.normalizedPhone,
    )
    .all<ExistingBusiness>();
  const rows = candidates.results ?? [];
  const exactRnc = value.normalizedRnc
    ? rows.filter((row) => row.normalized_rnc === value.normalizedRnc)
    : [];
  if (exactRnc.length === 1) return { business: exactRnc[0], reason: "rnc" };
  if (exactRnc.length > 1) return { business: null, reason: "ambiguous_rnc" };

  const exactName = rows.filter(
    (row) => row.normalized_name === value.normalizedCustomerName,
  );
  const compatibleName = exactName.filter(
    (row) =>
      !value.normalizedRnc ||
      !row.normalized_rnc ||
      row.normalized_rnc === value.normalizedRnc,
  );
  if (exactName.length && !compatibleName.length) {
    return { business: null, reason: "conflicting_rnc" };
  }

  const phone = value.normalizedMobilePhone || value.normalizedPhone;
  const exactContact = rows.filter((row) => {
    const sameEmail =
      value.normalizedEmail &&
      normalizeEmail(row.email) === value.normalizedEmail;
    const samePhone =
      phone &&
      [normalizePhone(row.phone), normalizePhone(row.mobile_phone)].includes(
        phone,
      );
    return (
      (sameEmail || samePhone) &&
      row.normalized_name === value.normalizedCustomerName
    );
  });
  if (exactContact.length === 1) {
    return { business: exactContact[0], reason: "contact_identity" };
  }
  if (exactContact.length > 1) {
    return { business: null, reason: "ambiguous_match" };
  }
  if (exactName.length) {
    return { business: null, reason: "name_only_match" };
  }
  if (rows.length > 0) {
    return { business: null, reason: "ambiguous_match" };
  }
  return { business: null, reason: "new" };
}

async function addRowIssue(
  row: RegisterRowRecord,
  type: string,
  title: string,
  detail: string,
  actor: string,
) {
  const now = new Date().toISOString();
  await getD1().batch([
    getD1()
      .prepare(
        `UPDATE import_rows
         SET outcome = 'manual_review', match_confidence = 'manual_review',
             reviewed_by = ?, reviewed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(actor, now, now, row.id),
    getD1()
      .prepare(
        `INSERT INTO import_issues (
           id, import_file_id, import_row_id, type, severity, status,
           title, detail, source_location, created_at
         ) VALUES (?, ?, ?, ?, 'blocking', 'open', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        row.import_file_id,
        row.id,
        type,
        title,
        detail,
        `Registro combinado!${row.source_row_number}`,
        now,
      ),
  ]);
}

async function processRow(row: RegisterRowRecord, actor: string) {
  const value = parseJson<RegisterNormalizedValues>(
    row.normalized_values,
    {} as RegisterNormalizedValues,
  );
  if (!value.customerName || !value.quotationNumber) {
    await addRowIssue(
      row,
      "missing_required",
      "La fila no tiene identidad canónica suficiente.",
      "Cliente y número de cotización son obligatorios para aceptar.",
      actor,
    );
    return "manual_review";
  }
  const match = await matchBusiness(value);
  if (
    match.reason === "ambiguous_rnc" ||
    match.reason === "conflicting_rnc" ||
    match.reason === "ambiguous_match" ||
    match.reason === "name_only_match"
  ) {
    await addRowIssue(
      row,
      "conflicting_value",
      "El cliente requiere selección manual.",
      `Motivo de coincidencia: ${match.reason}. No se modificó ningún cliente.`,
      actor,
    );
    return "manual_review";
  }

  const d1 = getD1();
  const now = new Date().toISOString();
  const businessId = match.business?.id ?? crypto.randomUUID();
  const statements: D1PreparedStatement[] = [];
  if (!match.business) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO businesses (
             id, name, normalized_name, customer_type, rnc, normalized_rnc,
             email, phone, mobile_phone, address, notes, source_metadata,
             owner_email, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
        )
        .bind(
          businessId,
          value.customerName.slice(0, 240),
          value.normalizedCustomerName,
          value.customerType,
          value.rnc,
          value.normalizedRnc,
          value.email,
          value.phone,
          value.mobilePhone,
          value.address,
          JSON.stringify({ importRowId: row.id, source: "combined_register" }),
          actor,
          actor,
          now,
          now,
        ),
    );
  }

  const addressExists = value.address
    ? await d1
        .prepare(
          `SELECT id FROM addresses
           WHERE business_id = ? AND type = 'billing' AND line1 = ?
           LIMIT 1`,
        )
        .bind(businessId, value.address)
        .first<{ id: string }>()
    : null;
  if (value.address && !addressExists) {
    statements.push(
      d1
        .prepare(
          `INSERT INTO addresses (
             id, business_id, type, label, line1, is_primary, source_metadata,
             created_by, created_at, updated_at
           ) VALUES (?, ?, 'billing', 'Dirección del registro', ?, 1, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          businessId,
          value.address,
          JSON.stringify({ importRowId: row.id }),
          actor,
          now,
          now,
        ),
    );
  }

  let contactId: string | null = null;
  if (value.contactName) {
    const contact = await d1
      .prepare(
        `SELECT id FROM contacts
         WHERE archived_at IS NULL AND business_id = ?
           AND (
             (? <> '' AND normalized_email = ?) OR
             (? <> '' AND normalized_phone = ?) OR
             (? <> '' AND normalized_mobile_phone = ?)
           )
         LIMIT 2`,
      )
      .bind(
        businessId,
        value.normalizedEmail,
        value.normalizedEmail,
        value.normalizedPhone,
        value.normalizedPhone,
        value.normalizedMobilePhone,
        value.normalizedMobilePhone,
      )
      .all<{ id: string }>();
    if ((contact.results ?? []).length === 1) {
      contactId = contact.results![0]!.id;
    } else if ((contact.results ?? []).length > 1) {
      await addRowIssue(
        row,
        "conflicting_value",
        "El contacto requiere selección manual.",
        "Hay varias coincidencias exactas para el contacto.",
        actor,
      );
      return "manual_review";
    } else {
      contactId = crypto.randomUUID();
      statements.push(
        d1
          .prepare(
            `INSERT INTO contacts (
               id, business_id, name, normalized_name, email, normalized_email, phone,
               normalized_phone, mobile_phone, normalized_mobile_phone,
               title, notes, source_metadata, owner_email, created_by,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)`,
          )
          .bind(
            contactId,
            businessId,
            value.contactName,
            normalizeText(value.contactName),
            value.email,
            value.normalizedEmail,
            value.phone,
            value.normalizedPhone,
            value.mobilePhone,
            value.normalizedMobilePhone,
            JSON.stringify({ importRowId: row.id }),
            actor,
            actor,
            now,
            now,
          ),
      );
    }
  }

  let projectId: string | null = null;
  if (value.projectAddress) {
    const project = await d1
      .prepare(
        `SELECT p.id
         FROM projects p
         JOIN addresses a ON a.project_id = p.id AND a.type = 'project'
         WHERE p.business_id = ? AND p.archived_at IS NULL AND a.line1 = ?
         LIMIT 1`,
      )
      .bind(businessId, value.projectAddress)
      .first<{ id: string }>();
    projectId = project?.id ?? crypto.randomUUID();
    if (!project) {
      const projectAddressId = crypto.randomUUID();
      statements.push(
        d1
          .prepare(
            `INSERT INTO projects (
               id, business_id, primary_contact_id, name, description,
               project_type, service_category, status, notes, source_metadata,
               owner_email, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, '', '', '', 'active', '', ?, ?, ?, ?, ?)`,
          )
          .bind(
            projectId,
            businessId,
            contactId,
            value.projectAddress.slice(0, 240),
            JSON.stringify({ importRowId: row.id }),
            actor,
            actor,
            now,
            now,
          ),
        d1
          .prepare(
            `INSERT INTO addresses (
               id, project_id, type, label, line1, is_primary, source_metadata,
               created_by, created_at, updated_at
             ) VALUES (?, ?, 'project', 'Dirección de proyecto', ?, 1, ?, ?, ?, ?)`,
          )
          .bind(
            projectAddressId,
            projectId,
            value.projectAddress,
            JSON.stringify({ importRowId: row.id }),
            actor,
            now,
            now,
          ),
        d1
          .prepare(
            `INSERT INTO project_locations (
               id, project_id, address_id, label, source_metadata, created_by,
               created_at, updated_at
             ) VALUES (?, ?, ?, 'Ubicación principal', ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            projectId,
            projectAddressId,
            JSON.stringify({ importRowId: row.id }),
            actor,
            now,
            now,
          ),
      );
      if (contactId) {
        statements.push(
          d1
            .prepare(
              `INSERT OR IGNORE INTO project_contacts (
                 project_id, contact_id, role, is_primary, notes, created_by,
                 created_at
               ) VALUES (?, ?, '', 1, '', ?, ?)`,
            )
            .bind(projectId, contactId, actor, now),
        );
      }
    }
  }

  const existingQuotation = await d1
    .prepare(
      `SELECT id, quotation_number
       FROM quotations
       WHERE business_id = ? AND family_key = ?
         AND archived_at IS NULL
         AND (quotation_year IS NULL OR ? IS NULL OR quotation_year = ?)
       ORDER BY updated_at DESC
       LIMIT 2`,
    )
    .bind(businessId, value.quotationFamilyKey, value.year, value.year)
    .all<{ id: string; quotation_number: string }>();
  if ((existingQuotation.results ?? []).length > 1) {
    await addRowIssue(
      row,
      "revision_candidate",
      "Hay varias familias de cotización posibles.",
      "Debe seleccionarse manualmente la cotización canónica.",
      actor,
    );
    return "manual_review";
  }

  const quotationId = existingQuotation.results?.[0]?.id ?? crypto.randomUUID();
  let revisionId: string;
  let createdQuotation = false;
  let createdRevision = false;
  let outcome: "imported" | "matched";
  if (!existingQuotation.results?.length) {
    createdQuotation = true;
    createdRevision = true;
    revisionId = crypto.randomUUID();
    statements.push(
      d1
        .prepare(
          `INSERT INTO quotations (
             id, business_id, primary_contact_id, project_id, quotation_number,
             normalized_quotation_number, family_key, quotation_year, title,
             quotation_type, service_category, status, currency,
             source_metadata, owner_email, created_by, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'other', '', 'unknown', '', ?,
                     ?, ?, ?, ?)`,
        )
        .bind(
          quotationId,
          businessId,
          contactId,
          projectId,
          value.quotationNumber,
          value.normalizedQuotationNumber,
          value.quotationFamilyKey,
          value.year,
          value.quotationNumber,
          JSON.stringify({ importRowId: row.id, source: "combined_register" }),
          actor,
          actor,
          now,
          now,
        ),
      d1
        .prepare(
          `INSERT INTO quotation_revisions (
             id, quotation_id, identity_key, revision_number, quotation_date,
             quotation_month, source_date_raw, source_month_raw,
             source_year_raw, is_current, source_metadata, created_by,
             created_at, updated_at
           ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        )
        .bind(
          revisionId,
          quotationId,
          `register:${row.row_fingerprint.slice(0, 32)}`,
          value.date,
          value.month,
          value.date ?? "",
          value.month ? String(value.month) : "",
          value.year ? String(value.year) : "",
          JSON.stringify({
            importRowId: row.id,
            sourceFilename: row.source_filename,
          }),
          actor,
          now,
          now,
        ),
    );
    outcome = "imported";
  } else {
    const existingRevision = await d1
      .prepare(
        `SELECT r.id
         FROM quotation_revisions r
         LEFT JOIN source_references s ON s.revision_id = r.id
         WHERE r.quotation_id = ?
           AND (
             r.identity_key = ? OR
             (coalesce(r.quotation_date, '') = coalesce(?, '')
              AND s.original_filename = ?)
           )
         LIMIT 1`,
      )
      .bind(
        quotationId,
        `register:${row.row_fingerprint.slice(0, 32)}`,
        value.date,
        row.source_filename,
      )
      .first<{ id: string }>();
    if (existingRevision) {
      revisionId = existingRevision.id;
      outcome = "matched";
    } else {
      createdRevision = true;
      revisionId = crypto.randomUUID();
      const revisionNumber = await d1
        .prepare(
          `SELECT coalesce(max(revision_number), 0) + 1 AS number
           FROM quotation_revisions WHERE quotation_id = ?`,
        )
        .bind(quotationId)
        .first<{ number: number }>();
      statements.push(
        d1
          .prepare(
            "UPDATE quotation_revisions SET is_current = 0, updated_at = ? WHERE quotation_id = ?",
          )
          .bind(now, quotationId),
        d1
          .prepare(
            `INSERT INTO quotation_revisions (
               id, quotation_id, identity_key, revision_number, revision_label,
               quotation_date, quotation_month, source_date_raw,
               source_month_raw, source_year_raw, is_current, source_metadata,
               created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
          )
          .bind(
            revisionId,
            quotationId,
            `register:${row.row_fingerprint.slice(0, 32)}`,
            Number(revisionNumber?.number ?? 1),
            `Registro fila ${row.source_row_number}`,
            value.date,
            value.month,
            value.date ?? "",
            value.month ? String(value.month) : "",
            value.year ? String(value.year) : "",
            JSON.stringify({
              importRowId: row.id,
              sourceFilename: row.source_filename,
            }),
            actor,
            now,
            now,
          ),
      );
      outcome = "imported";
    }
  }

  statements.push(
    d1
      .prepare(
        `UPDATE source_references
         SET revision_id = ?, updated_at = ?
         WHERE import_row_id = ?`,
      )
      .bind(revisionId, now, row.id),
    d1
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
        quotationId,
        value.quotationNumber,
        value.customerName,
        [
          value.quotationNumber,
          value.customerName,
          value.contactName,
          value.rnc,
          value.phone,
          value.mobilePhone,
          value.email,
          value.address,
          value.projectAddress,
          row.source_filename,
          row.source_origin,
          value.date ?? "",
          value.month ?? "",
          value.year ?? "",
        ].join(" "),
        actor,
        now,
      ),
    d1
      .prepare(
        `UPDATE import_rows
         SET outcome = ?, business_id = ?, contact_id = ?, project_id = ?,
             quotation_id = ?, revision_id = ?, accepted_by = ?,
             accepted_at = ?, updated_at = ?
         WHERE id = ? AND outcome = 'ready'`,
      )
      .bind(
        outcome,
        businessId,
        contactId,
        projectId,
        quotationId,
        revisionId,
        actor,
        now,
        now,
        row.id,
      ),
    d1
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, field_name, previous_value,
           new_value, source_document_id, actor_email, reason, created_at
         ) VALUES ('quotation', ?, ?, '', '', ?, NULL, ?, ?, ?)`,
      )
      .bind(
        quotationId,
        createdQuotation
          ? "created_from_register"
          : createdRevision
            ? "revision_added_from_register"
            : "source_matched_from_register",
        value.quotationNumber,
        actor,
        `Import row ${row.source_row_number}`,
        now,
      ),
  );
  await d1.batch(statements);
  return outcome;
}

async function refreshBatch(importFileId: string) {
  const d1 = getD1();
  const [totals, storedSummary, created] = await Promise.all([
    d1
      .prepare(
        `SELECT
         count(*) AS total,
         sum(CASE WHEN outcome = 'imported' THEN 1 ELSE 0 END) AS imported,
         sum(CASE WHEN outcome = 'matched' THEN 1 ELSE 0 END) AS matched,
         sum(CASE WHEN warnings LIKE '%"duplicate_candidate"%'
                  THEN 1 ELSE 0 END) AS duplicates,
         sum(CASE WHEN outcome = 'manual_review' THEN 1 ELSE 0 END) AS review,
         sum(CASE WHEN outcome = 'failed' THEN 1 ELSE 0 END) AS failed,
         sum(CASE WHEN outcome = 'ready' THEN 1 ELSE 0 END) AS ready,
         sum(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) AS pending
       FROM import_rows WHERE import_file_id = ?`,
      )
      .bind(importFileId)
      .first<Record<string, number>>(),
    d1
      .prepare(
        `SELECT b.summary_json, f.normalized_preview
         FROM import_files f JOIN import_batches b ON b.id = f.batch_id
         WHERE f.id = ?`,
      )
      .bind(importFileId)
      .first<{ summary_json: string; normalized_preview: string }>(),
    d1
      .prepare(
        `SELECT
           (SELECT count(*) FROM businesses b
            JOIN import_rows r
              ON json_extract(b.source_metadata, '$.importRowId') = r.id
            WHERE r.import_file_id = ?) AS businesses,
           (SELECT count(*) FROM contacts c
            JOIN import_rows r
              ON json_extract(c.source_metadata, '$.importRowId') = r.id
            WHERE r.import_file_id = ?) AS contacts,
           (SELECT count(*) FROM projects p
            JOIN import_rows r
              ON json_extract(p.source_metadata, '$.importRowId') = r.id
            WHERE r.import_file_id = ?) AS projects,
           (SELECT count(*) FROM quotations q
            JOIN import_rows r
              ON json_extract(q.source_metadata, '$.importRowId') = r.id
            WHERE r.import_file_id = ?) AS quotations,
           (SELECT count(*) FROM quotation_revisions qr
            JOIN import_rows r
              ON json_extract(qr.source_metadata, '$.importRowId') = r.id
            WHERE r.import_file_id = ?) AS revisions`,
      )
      .bind(
        importFileId,
        importFileId,
        importFileId,
        importFileId,
        importFileId,
      )
      .first<Record<string, number>>(),
  ]);
  const remaining = Number(totals?.ready ?? 0) + Number(totals?.pending ?? 0);
  const status =
    remaining === 0 &&
    Number(totals?.review ?? 0) === 0 &&
    Number(totals?.failed ?? 0) === 0
      ? "completed"
      : "review_required";
  const now = new Date().toISOString();
  const preview = parseJson<{ summary?: Record<string, unknown> }>(
    storedSummary?.normalized_preview ?? "{}",
    {},
  );
  const summary = {
    ...preview.summary,
    ...parseJson<Record<string, unknown>>(
      storedSummary?.summary_json ?? "{}",
      {},
    ),
    sourceRowsDiscovered: Number(totals?.total ?? 0),
    rowsReady: Number(totals?.ready ?? 0),
    rowsImported: Number(totals?.imported ?? 0),
    rowsMatched: Number(totals?.matched ?? 0),
    duplicateCandidates: Number(totals?.duplicates ?? 0),
    manualReviewRecords: Number(totals?.review ?? 0),
    failedRows: Number(totals?.failed ?? 0),
    importedBusinesses: Number(created?.businesses ?? 0),
    importedContacts: Number(created?.contacts ?? 0),
    importedProjects: Number(created?.projects ?? 0),
    importedQuotations: Number(created?.quotations ?? 0),
    importedRevisions: Number(created?.revisions ?? 0),
  };
  await d1.batch([
    d1
      .prepare(
        `UPDATE import_batches
         SET status = ?, dry_run = 0, total_rows = ?, successful_count = ?,
             matched_count = ?, duplicate_count = ?, review_count = ?,
             failed_count = ?, summary_json = ?, completed_at = ?
         WHERE id = (SELECT batch_id FROM import_files WHERE id = ?)`,
      )
      .bind(
        status,
        Number(totals?.total ?? 0),
        Number(totals?.imported ?? 0),
        Number(totals?.matched ?? 0),
        Number(totals?.duplicates ?? 0),
        Number(totals?.review ?? 0),
        Number(totals?.failed ?? 0),
        JSON.stringify(summary),
        now,
        importFileId,
      ),
    d1
      .prepare(
        "UPDATE import_files SET status = ?, accepted_at = ? WHERE id = ?",
      )
      .bind(
        status === "completed" ? "accepted" : "review_required",
        now,
        importFileId,
      ),
    d1
      .prepare(
        `UPDATE import_batch_sources
         SET imported_rows = (
               SELECT count(*) FROM import_rows r
               WHERE r.import_file_id = ?
                 AND r.source_origin = import_batch_sources.origin_label
                 AND r.outcome = 'imported'
             ),
             matched_rows = (
               SELECT count(*) FROM import_rows r
               WHERE r.import_file_id = ?
                 AND r.source_origin = import_batch_sources.origin_label
                 AND r.outcome = 'matched'
             ),
             duplicate_rows = (
               SELECT count(*) FROM import_rows r
               WHERE r.import_file_id = ?
                 AND r.source_origin = import_batch_sources.origin_label
                 AND r.warnings LIKE '%"duplicate_candidate"%'
             ),
             review_rows = (
               SELECT count(*) FROM import_rows r
               WHERE r.import_file_id = ?
                 AND r.source_origin = import_batch_sources.origin_label
                 AND r.outcome = 'manual_review'
             ),
             failed_rows = (
               SELECT count(*) FROM import_rows r
               WHERE r.import_file_id = ?
                 AND r.source_origin = import_batch_sources.origin_label
                 AND r.outcome = 'failed'
             )
         WHERE batch_id = (
           SELECT batch_id FROM import_files WHERE id = ?
         )`,
      )
      .bind(
        importFileId,
        importFileId,
        importFileId,
        importFileId,
        importFileId,
        importFileId,
      ),
  ]);
  return { totals, remaining, done: remaining === 0 };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as {
    limit?: unknown;
  };
  const requestedLimit = Number(payload.limit ?? 50);
  const limit =
    Number.isInteger(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 75)
      : 50;
  const file = await getD1()
    .prepare("SELECT id, template_type FROM import_files WHERE id = ?")
    .bind(id)
    .first<{ id: string; template_type: string }>();
  if (!file || file.template_type !== "register") {
    return Response.json(
      { error: "El lote no corresponde a un registro consolidado." },
      { status: 404 },
    );
  }
  const selected = await getD1()
    .prepare(
      `SELECT id, import_file_id, source_row_number, row_fingerprint,
              normalized_values, source_filename, source_origin
       FROM import_rows
       WHERE import_file_id = ? AND outcome = 'ready' AND accepted_at IS NULL
       ORDER BY source_row_number
       LIMIT ?`,
    )
    .bind(id, limit)
    .all<RegisterRowRecord>();
  let imported = 0;
  let matched = 0;
  let review = 0;
  let failed = 0;
  for (const row of selected.results ?? []) {
    try {
      const result = await processRow(row, auth.user.email);
      if (result === "imported") imported += 1;
      else if (result === "matched") matched += 1;
      else review += 1;
    } catch (error) {
      failed += 1;
      const now = new Date().toISOString();
      const message = error instanceof Error ? error.message : String(error);
      await getD1().batch([
        getD1()
          .prepare(
            `UPDATE import_rows
             SET outcome = 'failed', errors = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(JSON.stringify([`accept_error:${message}`]), now, row.id),
        getD1()
          .prepare(
            `INSERT INTO import_issues (
               id, import_file_id, import_row_id, type, severity, status,
               title, detail, source_location, created_at
             ) VALUES (?, ?, ?, 'incomplete_record', 'error', 'open',
                       'La fila no pudo aceptarse.', ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            id,
            row.id,
            message.slice(0, 4_000),
            `Registro combinado!${row.source_row_number}`,
            now,
          ),
      ]);
    }
  }
  const progress = await refreshBatch(id);
  return Response.json({
    processed: (selected.results ?? []).length,
    imported,
    matched,
    review,
    failed,
    ...progress,
  });
}
