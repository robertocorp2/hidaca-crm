import { getD1 } from "../../../../../db";
import { writeAudit } from "../../../../lib/audit";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";

type StagingRow = {
  id: string;
  importFileId: string;
  documentId: string;
  identityFingerprint: string;
  documentKind: string;
  rawValues: string;
  normalizedValues: string;
  outcome: string;
  sourceRowNumber: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ write: true, admin: true });
  if (!auth.ok) return auth.response;
  const payload = (await request.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (payload.confirm !== "ACEPTAR PILOTO") {
    return Response.json(
      { error: "Escribe ACEPTAR PILOTO para confirmar el lote controlado." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  const resolved = await getD1()
    .prepare(
      `SELECT id, status, dry_run AS dryRun FROM import_batches WHERE id = ?
       UNION ALL
       SELECT ib.id, ib.status, ib.dry_run AS dryRun
       FROM import_files f JOIN import_batches ib ON ib.id = f.batch_id
       WHERE f.id = ? LIMIT 1`,
    )
    .bind(id, id)
    .first<{ id: string; status: string; dryRun: number }>();
  if (!resolved) {
    return Response.json({ error: "Lote no encontrado." }, { status: 404 });
  }
  if (resolved.status === "completed") {
    return Response.json({
      idempotent: true,
      batchId: resolved.id,
      message: "El lote ya fue aceptado.",
    });
  }
  if (!resolved.dryRun) {
    return Response.json(
      { error: "Solo una simulación aprobada puede aceptarse." },
      { status: 409 },
    );
  }
  const blocking = await getD1()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM import_issues ii JOIN import_files f ON f.id = ii.import_file_id
       WHERE f.batch_id = ? AND ii.status = 'open'
         AND ii.severity IN ('blocking', 'error')`,
    )
    .bind(resolved.id)
    .first<{ count: number }>();
  if (Number(blocking?.count ?? 0) > 0) {
    return Response.json(
      {
        error:
          "El lote conserva incidencias bloqueantes. Resuélvelas antes de aceptar.",
      },
      { status: 409 },
    );
  }
  const unresolvedRows = await getD1()
    .prepare(
      `SELECT COUNT(*) AS count
       FROM import_rows ir JOIN import_files f ON f.id = ir.import_file_id
       WHERE f.batch_id = ? AND ir.outcome IN (
         'pending', 'duplicate_candidate', 'manual_review', 'failed'
       )`,
    )
    .bind(resolved.id)
    .first<{ count: number }>();
  if (Number(unresolvedRows?.count ?? 0) > 0) {
    return Response.json(
      {
        error:
          "Todas las filas deben quedar listas, vinculadas u omitidas antes de aceptar.",
      },
      { status: 409 },
    );
  }
  const rows =
    (
      await getD1()
        .prepare(
          `SELECT ir.id, ir.import_file_id AS importFileId,
             f.document_id AS documentId,
             ir.identity_fingerprint AS identityFingerprint,
             ir.document_kind AS documentKind, ir.raw_values AS rawValues,
             ir.normalized_values AS normalizedValues, ir.outcome
             , ir.source_row_number AS sourceRowNumber
           FROM import_rows ir JOIN import_files f ON f.id = ir.import_file_id
           WHERE f.batch_id = ? AND ir.outcome IN ('ready', 'matched')
           ORDER BY CASE ir.document_kind
             WHEN 'invoice' THEN 0 WHEN 'credit_note' THEN 1 ELSE 2 END,
             f.filename, ir.source_row_number`,
        )
        .bind(resolved.id)
        .all<StagingRow>()
    ).results ?? [];
  if (!rows.length) {
    return Response.json(
      { error: "No hay filas aprobadas para aceptar." },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const statements = [];
  const linksByFile = new Map<string, Record<string, string[]>>();
  let createdInvoices = 0;
  let createdPayments = 0;
  let createdCreditNotes = 0;
  let linked = 0;

  for (const row of rows) {
    const values = parseObject(row.normalizedValues);
    const raw = parseObject(row.rawValues);
    const fileLinks = linksByFile.get(row.importFileId) ?? {
      invoices: [],
      payments: [],
      creditNotes: [],
    };
    linksByFile.set(row.importFileId, fileLinks);
    if (row.outcome === "matched") {
      linked += 1;
      const targetId = text(values.matched_entity_id);
      if (!targetId) {
        return Response.json(
          { error: `La fila vinculada ${row.id} perdió su destino exacto.` },
          { status: 409 },
        );
      }
      const targetType =
        text(values.matched_entity_type) === "payment"
          ? "payment"
          : text(values.matched_entity_type) === "credit_note"
            ? "credit_note"
            : "invoice";
      if (targetType === "payment") fileLinks.payments.push(targetId);
      else if (targetType === "credit_note")
        fileLinks.creditNotes.push(targetId);
      else fileLinks.invoices.push(targetId);
      statements.push(
        getD1()
          .prepare(
            `INSERT OR IGNORE INTO document_links (
               document_id, entity_type, entity_id, purpose, created_by, created_at
             ) VALUES (?, ?, ?, 'paired_representation', ?, ?)`,
          )
          .bind(row.documentId, targetType, targetId, auth.user.email, now),
        historyStatement(
          targetType,
          targetId,
          row.documentId,
          auth.user.email,
          `batch:${resolved.id}:exact_link`,
          now,
        ),
        getD1()
          .prepare(
            `UPDATE import_rows SET accepted_by = ?, accepted_at = ?,
               updated_at = ? WHERE id = ? AND outcome = 'matched'`,
          )
          .bind(auth.user.email, now, now, row.id),
      );
      if (row.documentKind === "invoice_register" && targetType === "invoice") {
        const invoiceTotal = amount(values.total_amount);
        const paidAmount = amount(values.paid_amount_snapshot);
        const balanceAmount = amount(values.balance_amount_snapshot);
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO receivable_snapshots (
                 id, invoice_id, as_of, source_document_id, import_batch_id,
                 invoice_total, paid_amount, balance_amount, status_raw,
                 status_normalized, source_sheet, source_row_number,
                 raw_values, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              `${targetId}-snapshot-${row.sourceRowNumber}`,
              targetId,
              now.slice(0, 10),
              row.documentId,
              resolved.id,
              invoiceTotal,
              paidAmount,
              balanceAmount,
              text(values.closing_raw),
              snapshotStatus(
                text(values.status),
                invoiceTotal,
                paidAmount,
                balanceAmount,
              ),
              text(row.documentKind),
              row.sourceRowNumber,
              row.rawValues,
              now,
            ),
        );
      }
      continue;
    }
    const businessId = text(values.business_id);
    if (!businessId) {
      return Response.json(
        { error: `La fila ${row.id} no tiene una empresa exacta aprobada.` },
        { status: 409 },
      );
    }
    if (row.documentKind === "invoice") {
      const entityId = stableEntityId("invoice", row.identityFingerprint);
      fileLinks.invoices.push(entityId);
      createdInvoices += 1;
      const issueDate = date(values.issue_date);
      statements.push(
        getD1()
          .prepare(
            `INSERT INTO invoices (
               id, business_id, source_document_id, import_batch_id,
               invoice_number_raw, invoice_number_normalized,
               issue_date, issue_date_raw, issue_year, ncf_raw,
               ncf_normalized, document_version, status, currency,
               subtotal_amount, tax_amount, total_amount,
               source_authority, source_values, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       ?, ?, ?, ?)`,
          )
          .bind(
            entityId,
            businessId,
            row.documentId,
            resolved.id,
            original(raw.invoice_number, values.invoice_number),
            identifier(values.invoice_number),
            issueDate,
            original(raw.issue_date, values.issue_date),
            year(issueDate),
            original(raw.ncf, values.ncf),
            identifier(values.ncf),
            positiveInteger(values.version_number, 1),
            text(values.status) || "issued",
            text(values.currency) || "DOP",
            amount(values.subtotal_amount),
            amount(values.tax_amount),
            amount(values.total_amount),
            "issued_document",
            row.rawValues,
            auth.user.email,
            now,
            now,
          ),
        historyStatement(
          "invoice",
          entityId,
          row.documentId,
          auth.user.email,
          resolved.id,
          now,
        ),
        linkStatement(
          row.documentId,
          "invoice",
          entityId,
          "issued_document",
          auth.user.email,
          now,
        ),
        searchStatement(
          "invoice",
          entityId,
          original(raw.invoice_number, values.invoice_number),
          text(values.business_name),
          `${original(raw.invoice_number, values.invoice_number)} ${text(
            values.business_name,
          )} ${original(raw.ncf, values.ncf)}`,
          auth.user.email,
          now,
        ),
      );
      arrayObjects(values.line_items).forEach((line, index) => {
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO invoice_lines (
                 id, invoice_id, line_number, item_code, description,
                 quantity, unit_of_measure, unit_price, tax_amount, line_total,
                 source_sheet, source_range, source_values, value_states
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
            )
            .bind(
              `${entityId}-line-${index + 1}`,
              entityId,
              index + 1,
              text(line.item_code),
              text(line.description),
              amount(line.quantity),
              text(line.unit_of_measure),
              amount(line.unit_price),
              amount(line.tax_amount),
              amount(line.line_total),
              text(line.source_sheet),
              line.source_row ? `row:${text(line.source_row)}` : "",
              JSON.stringify(line),
            ),
        );
      });
    } else if (
      row.documentKind === "receipt" ||
      row.documentKind === "payment_evidence"
    ) {
      const entityId = stableEntityId("payment", row.identityFingerprint);
      fileLinks.payments.push(entityId);
      createdPayments += 1;
      statements.push(
        getD1()
          .prepare(
            `INSERT INTO payments (
               id, business_id, source_document_id, import_batch_id, type,
               amount, currency, payment_date, method, status, label,
               transaction_reference, receipt_number, evidence_status,
               source_values, source_location, created_by, created_at, updated_at
             ) VALUES (?, ?, ?, ?, 'partial', ?, ?, ?, ?, 'received', ?, ?, ?,
                       'documented', ?, ?, ?, ?, ?)`,
          )
          .bind(
            entityId,
            businessId,
            row.documentId,
            resolved.id,
            amount(values.payment_amount ?? values.total_amount),
            text(values.currency) || "DOP",
            date(values.payment_date),
            text(values.method),
            original(raw.receipt_number, values.receipt_number),
            original(raw.transaction_reference, values.transaction_reference),
            original(raw.receipt_number, values.receipt_number),
            row.rawValues,
            row.id,
            auth.user.email,
            now,
            now,
          ),
        historyStatement(
          "payment",
          entityId,
          row.documentId,
          auth.user.email,
          resolved.id,
          now,
        ),
        linkStatement(
          row.documentId,
          "payment",
          entityId,
          "payment_evidence",
          auth.user.email,
          now,
        ),
        searchStatement(
          "payment",
          entityId,
          original(raw.receipt_number, values.receipt_number) ||
            `Pago ${entityId}`,
          text(values.business_name),
          `${original(
            raw.transaction_reference,
            values.transaction_reference,
          )} ${text(values.business_name)}`,
          auth.user.email,
          now,
        ),
      );
      const allocationInvoiceId = text(values.allocation_invoice_id);
      const allocationAmount = amount(values.allocation_amount);
      if (
        allocationInvoiceId &&
        allocationAmount !== null &&
        allocationAmount > 0
      ) {
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO payment_allocations (
                 id, payment_id, invoice_id, amount, currency,
                 allocation_date, source_document_id, status,
                 import_batch_id, created_by, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, 'applied', ?, ?, ?)`,
            )
            .bind(
              `${entityId}-allocation-1`,
              entityId,
              allocationInvoiceId,
              allocationAmount,
              text(values.currency) || "DOP",
              date(values.payment_date),
              row.documentId,
              resolved.id,
              auth.user.email,
              now,
            ),
          refreshInvoiceStatement(allocationInvoiceId, now),
        );
      }
    } else if (row.documentKind === "credit_note") {
      const entityId = stableEntityId("credit", row.identityFingerprint);
      fileLinks.creditNotes.push(entityId);
      createdCreditNotes += 1;
      const issueDate = date(values.issue_date);
      statements.push(
        getD1()
          .prepare(
            `INSERT INTO credit_notes (
               id, business_id, source_document_id, import_batch_id,
               credit_note_number_raw, credit_note_number_normalized,
               ncf_raw, ncf_normalized, issue_date, issue_date_raw, issue_year,
               currency, reason, subtotal_amount, tax_amount, total_amount,
               status, source_authority, source_values, created_by,
               created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                       'issued', 'issued_document', ?, ?, ?, ?)`,
          )
          .bind(
            entityId,
            businessId,
            row.documentId,
            resolved.id,
            original(raw.invoice_number, values.invoice_number),
            identifier(values.invoice_number),
            original(raw.ncf, values.ncf),
            identifier(values.ncf),
            issueDate,
            original(raw.issue_date, values.issue_date),
            year(issueDate),
            text(values.currency) || "DOP",
            text(values.reason),
            amount(values.subtotal_amount),
            amount(values.tax_amount),
            amount(values.total_amount),
            row.rawValues,
            auth.user.email,
            now,
            now,
          ),
        historyStatement(
          "credit_note",
          entityId,
          row.documentId,
          auth.user.email,
          resolved.id,
          now,
        ),
        linkStatement(
          row.documentId,
          "credit_note",
          entityId,
          "credit_note",
          auth.user.email,
          now,
        ),
        searchStatement(
          "credit_note",
          entityId,
          original(raw.invoice_number, values.invoice_number),
          text(values.business_name),
          `${original(raw.invoice_number, values.invoice_number)} ${text(
            values.business_name,
          )} ${original(raw.ncf, values.ncf)}`,
          auth.user.email,
          now,
        ),
      );
      const applicationInvoiceId = text(
        values.credit_application_invoice_id,
      );
      const applicationAmount = amount(values.credit_application_amount);
      if (
        applicationInvoiceId &&
        applicationAmount !== null &&
        applicationAmount > 0
      ) {
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO credit_note_applications (
                 id, credit_note_id, invoice_id, amount, application_date,
                 status, source_document_id, import_batch_id, created_by,
                 created_at
               ) VALUES (?, ?, ?, ?, ?, 'applied', ?, ?, ?, ?)`,
            )
            .bind(
              `${entityId}-application-1`,
              entityId,
              applicationInvoiceId,
              applicationAmount,
              issueDate,
              row.documentId,
              resolved.id,
              auth.user.email,
              now,
            ),
          refreshInvoiceStatement(applicationInvoiceId, now),
          getD1()
            .prepare(
              `UPDATE credit_notes SET status = CASE
                 WHEN total_amount IS NOT NULL AND ? >= total_amount - 0.005
                   THEN 'applied' ELSE status END,
                 updated_at = ? WHERE id = ?`,
            )
            .bind(applicationAmount, now, entityId),
        );
      }
      arrayObjects(values.line_items).forEach((line, index) => {
        statements.push(
          getD1()
            .prepare(
              `INSERT INTO credit_note_lines (
                 id, credit_note_id, line_number, item_code, description,
                 quantity, unit_of_measure, unit_price, tax_amount, line_total,
                 source_sheet, source_range, source_values, value_states
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
            )
            .bind(
              `${entityId}-line-${index + 1}`,
              entityId,
              index + 1,
              text(line.item_code),
              text(line.description),
              amount(line.quantity),
              text(line.unit_of_measure),
              amount(line.unit_price),
              amount(line.tax_amount),
              amount(line.line_total),
              text(line.source_sheet),
              line.source_row ? `row:${text(line.source_row)}` : "",
              JSON.stringify(line),
            ),
        );
      });
    } else {
      continue;
    }
    statements.push(
      getD1()
        .prepare(
          `UPDATE import_rows SET outcome = 'imported', accepted_by = ?,
             accepted_at = ?, updated_at = ? WHERE id = ? AND outcome = 'ready'`,
        )
        .bind(auth.user.email, now, now, row.id),
    );
  }
  for (const [fileId, links] of linksByFile) {
    statements.push(
      getD1()
        .prepare(
          `UPDATE import_files SET status = 'accepted', canonical_links = ?,
             accepted_by = ?, accepted_at = ?, reviewed_by = COALESCE(reviewed_by, ?),
             reviewed_at = COALESCE(reviewed_at, ?) WHERE id = ?`,
        )
        .bind(
          JSON.stringify(links),
          auth.user.email,
          now,
          auth.user.email,
          now,
          fileId,
        ),
    );
  }
  statements.push(
    getD1()
      .prepare(
        `UPDATE import_batches SET status = 'completed', dry_run = 0,
           successful_count = ?, matched_count = ?, completed_at = ?
         WHERE id = ? AND status <> 'completed'`,
      )
      .bind(
        createdInvoices + createdPayments + createdCreditNotes,
        linked,
        now,
        resolved.id,
      ),
  );
  try {
    await getD1().batch(statements);
  } catch (error) {
    return Response.json(
      {
        error: `La aceptación fue revertida sin escrituras parciales: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 409 },
    );
  }
  await writeAudit(
    auth.user.email,
    "accept_invoice_pilot",
    "import_batch",
    resolved.id,
    JSON.stringify({
      createdInvoices,
      createdPayments,
      createdCreditNotes,
      linked,
    }),
  );
  return Response.json({
    idempotent: false,
    batchId: resolved.id,
    createdInvoices,
    createdPayments,
    createdCreditNotes,
    linked,
  });
}

function historyStatement(
  entityType: string,
  entityId: string,
  documentId: string,
  actor: string,
  batchId: string,
  now: string,
) {
  return getD1()
    .prepare(
      `INSERT INTO entity_history (
         entity_type, entity_id, action, source_document_id, actor_email,
         reason, created_at
       ) VALUES (?, ?, 'import_create', ?, ?, ?, ?)`,
    )
    .bind(
      entityType,
      entityId,
      documentId,
      actor,
      batchId.startsWith("batch:") ? batchId : `batch:${batchId}`,
      now,
    );
}
function linkStatement(
  documentId: string,
  entityType: string,
  entityId: string,
  purpose: string,
  actor: string,
  now: string,
) {
  return getD1()
    .prepare(
      `INSERT INTO document_links (
         document_id, entity_type, entity_id, purpose, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(documentId, entityType, entityId, purpose, actor, now);
}
function searchStatement(
  entityType: string,
  entityId: string,
  title: string,
  subtitle: string,
  searchText: string,
  ownerEmail: string,
  now: string,
) {
  return getD1()
    .prepare(
      `INSERT INTO search_documents (
         entity_type, entity_id, title, subtitle, search_text,
         owner_email, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entity_type, entity_id) DO UPDATE SET
         title = excluded.title, subtitle = excluded.subtitle,
         search_text = excluded.search_text,
         owner_email = excluded.owner_email, updated_at = excluded.updated_at`,
    )
    .bind(
      entityType,
      entityId,
      title,
      subtitle,
      searchText,
      ownerEmail,
      now,
    );
}
function refreshInvoiceStatement(invoiceId: string, now: string) {
  return getD1()
    .prepare(
      `UPDATE invoices SET status = CASE
         WHEN status IN ('cancelled', 'replaced') THEN status
         WHEN total_amount IS NULL THEN status
         WHEN total_amount
           - COALESCE((SELECT SUM(amount) FROM payment_allocations
                       WHERE invoice_id = invoices.id AND status = 'applied'), 0)
           - COALESCE((SELECT SUM(amount) FROM credit_note_applications
                       WHERE invoice_id = invoices.id AND status = 'applied'), 0)
           <= 0.005 THEN 'paid'
         WHEN COALESCE((SELECT SUM(amount) FROM payment_allocations
                        WHERE invoice_id = invoices.id AND status = 'applied'), 0)
            + COALESCE((SELECT SUM(amount) FROM credit_note_applications
                        WHERE invoice_id = invoices.id AND status = 'applied'), 0)
            > 0 THEN 'partial'
         WHEN due_date IS NOT NULL AND due_date < ? THEN 'overdue'
         ELSE status END,
         updated_at = ? WHERE id = ?`,
    )
    .bind(now.slice(0, 10), now, invoiceId);
}
function parseObject(value: string) {
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return {};
  }
}
function stableEntityId(prefix: string, fingerprint: string) {
  return `${prefix}-${fingerprint.replace(/[^a-z0-9-]/gi, "").slice(0, 48)}`;
}
function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}
function original(raw: unknown, normalized: unknown) {
  return text(raw) || text(normalized);
}
function identifier(value: unknown) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function amount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function date(value: unknown) {
  const result = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}
function year(value: string | null) {
  return value ? Number(value.slice(0, 4)) : null;
}
function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function arrayObjects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}
function snapshotStatus(
  status: string,
  invoiceTotal: number | null,
  paidAmount: number | null,
  balanceAmount: number | null,
) {
  if (status === "cancelled") return "cancelled";
  if (balanceAmount !== null && balanceAmount <= 0.005) return "paid";
  if (
    (paidAmount !== null && paidAmount > 0) ||
    (invoiceTotal !== null &&
      balanceAmount !== null &&
      balanceAmount < invoiceTotal)
  )
    return "partial";
  return balanceAmount === null ? "unknown" : "unpaid";
}
