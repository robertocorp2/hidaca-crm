import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { invoices } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { cleanText } from "../../../lib/crm";
import { authorizeInvoiceApi } from "../../../lib/invoice-api";
import {
  enumValue,
  invoiceStatuses,
  isoDate,
  issueYear,
  normalizeInvoiceIdentifier,
  optionalAmount,
} from "../../../lib/invoice-domain";
import { deleteSearchDocument } from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

async function rows<T>(sqlText: string, id: string) {
  return (
    await getD1().prepare(sqlText).bind(id).all<T>()
  ).results ?? [];
}

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const [invoice] = await rows<Record<string, unknown>>(
    `SELECT i.*, b.name AS business_name, c.name AS contact_name,
       p.name AS project_name, q.quotation_number AS quotation_number,
       d.name AS source_document_name
     FROM invoices i
     JOIN businesses b ON b.id = i.business_id
     LEFT JOIN contacts c ON c.id = i.contact_id
     LEFT JOIN projects p ON p.id = i.project_id
     LEFT JOIN quotations q ON q.id = i.quotation_id
     LEFT JOIN documents d ON d.id = i.source_document_id
     WHERE i.id = ? AND i.archived_at IS NULL`,
    id,
  );
  if (!invoice) {
    return Response.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const [lines, allocations, creditApplications, snapshots, collections, history] =
    await Promise.all([
      rows(
        `SELECT il.*, ps.name AS product_service_name,
           tc.label AS tax_configuration_label, tc.rate AS tax_rate
         FROM invoice_lines il
         LEFT JOIN products_services ps ON ps.id = il.product_service_id
         LEFT JOIN tax_configurations tc ON tc.id = il.tax_configuration_id
         WHERE il.invoice_id = ? ORDER BY il.line_number`,
        id,
      ),
      rows(
        `SELECT pa.*, p.transaction_reference, p.receipt_number,
           p.payment_date, p.method, p.evidence_status
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.invoice_id = ? ORDER BY COALESCE(pa.allocation_date, pa.created_at) DESC`,
        id,
      ),
      rows(
        `SELECT ca.*, cn.credit_note_number_raw, cn.ncf_raw
         FROM credit_note_applications ca
         JOIN credit_notes cn ON cn.id = ca.credit_note_id
         WHERE ca.invoice_id = ? ORDER BY COALESCE(ca.application_date, ca.created_at) DESC`,
        id,
      ),
      rows(
        `SELECT * FROM receivable_snapshots
         WHERE invoice_id = ? ORDER BY as_of DESC`,
        id,
      ),
      rows(
        `SELECT * FROM collection_activities
         WHERE invoice_id = ? AND archived_at IS NULL
         ORDER BY occurred_at DESC`,
        id,
      ),
      rows(
        `SELECT action, field_name, previous_value, new_value, actor_email,
           reason, created_at
         FROM entity_history
         WHERE entity_type = 'invoice' AND entity_id = ?
         ORDER BY created_at DESC LIMIT 250`,
        id,
      ),
    ]);

  return Response.json(
    {
      invoice,
      lines,
      allocations,
      creditApplications,
      snapshots,
      collections,
      history,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi({ write: true });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const [current] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), isNull(invoices.archivedAt)))
    .limit(1);
  if (!current) {
    return Response.json({ error: "Factura no encontrada." }, { status: 404 });
  }

  const issueDate = Object.hasOwn(payload, "issueDate")
    ? isoDate(payload.issueDate)
    : current.issueDate;
  const invoiceNumberRaw = Object.hasOwn(payload, "invoiceNumberRaw")
    ? cleanText(payload.invoiceNumberRaw, 120)
    : current.invoiceNumberRaw;
  const ncfRaw = Object.hasOwn(payload, "ncfRaw")
    ? cleanText(payload.ncfRaw, 60)
    : current.ncfRaw;
  if (!invoiceNumberRaw) {
    return Response.json(
      { error: "El número de factura es obligatorio." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  try {
    const [invoice] = await db
      .update(invoices)
      .set({
        invoiceNumberRaw,
        invoiceNumberNormalized:
          normalizeInvoiceIdentifier(invoiceNumberRaw),
        issueDate,
        issueDateRaw: Object.hasOwn(payload, "issueDate")
          ? cleanText(payload.issueDate, 80)
          : current.issueDateRaw,
        issueYear: issueYear(issueDate),
        dueDate: Object.hasOwn(payload, "dueDate")
          ? isoDate(payload.dueDate)
          : current.dueDate,
        dueDateRaw: Object.hasOwn(payload, "dueDate")
          ? cleanText(payload.dueDate, 80)
          : current.dueDateRaw,
        ncfRaw,
        ncfNormalized: normalizeInvoiceIdentifier(ncfRaw),
        status: Object.hasOwn(payload, "status")
          ? enumValue(payload.status, invoiceStatuses, current.status)
          : current.status,
        paymentTermsRaw: Object.hasOwn(payload, "paymentTermsRaw")
          ? cleanText(payload.paymentTermsRaw, 300)
          : current.paymentTermsRaw,
        purchaseOrderNumber: Object.hasOwn(payload, "purchaseOrderNumber")
          ? cleanText(payload.purchaseOrderNumber, 120)
          : current.purchaseOrderNumber,
        subtotalAmount: Object.hasOwn(payload, "subtotalAmount")
          ? optionalAmount(payload.subtotalAmount)
          : current.subtotalAmount,
        taxAmount: Object.hasOwn(payload, "taxAmount")
          ? optionalAmount(payload.taxAmount)
          : current.taxAmount,
        totalAmount: Object.hasOwn(payload, "totalAmount")
          ? optionalAmount(payload.totalAmount)
          : current.totalAmount,
        cancellationReason: Object.hasOwn(payload, "cancellationReason")
          ? cleanText(payload.cancellationReason, 1000)
          : current.cancellationReason,
        sourceAuthority: "manual_resolution",
        updatedAt: now,
      })
      .where(and(eq(invoices.id, id), isNull(invoices.archivedAt)))
      .returning();
    await writeAudit(
      auth.user.email,
      "update",
      "invoice",
      id,
      invoiceNumberRaw,
    );
    return Response.json({ invoice });
  } catch {
    return Response.json(
      { error: "La identidad fiscal o el NCF entra en conflicto." },
      { status: 409 },
    );
  }
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi({ admin: true, write: true });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const now = new Date().toISOString();
  const [invoice] = await getDb()
    .update(invoices)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(invoices.id, id), isNull(invoices.archivedAt)))
    .returning();
  if (!invoice) {
    return Response.json({ error: "Factura no encontrada." }, { status: 404 });
  }
  await Promise.all([
    writeAudit(
      auth.user.email,
      "archive",
      "invoice",
      id,
      invoice.invoiceNumberRaw,
    ),
    deleteSearchDocument("invoice", id),
  ]);
  return Response.json({ ok: true });
}
