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
import { calculateInvoice } from "../../../lib/invoice-calculations";
import { calculateDocument, calculateDocumentLine } from "../../../lib/document-calculations";

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
    `SELECT i.*, b.name AS business_name, b.rnc AS business_rnc,
       b.address AS business_address, b.phone AS business_phone,
       b.mobile_phone AS business_mobile_phone, b.email AS business_email,
       c.name AS contact_name, c.phone AS contact_phone,
       c.mobile_phone AS contact_mobile_phone, c.email AS contact_email,
       p.name AS project_name, p.description AS project_description,
       q.quotation_number AS quotation_number,
       (SELECT trim(a.line1 || CASE WHEN a.line2 <> '' THEN ', ' || a.line2 ELSE '' END)
        FROM addresses a
        WHERE a.project_id = p.id
        ORDER BY a.is_primary DESC, a.created_at ASC LIMIT 1) AS project_address,
       d.id AS source_document_id,
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
      { error: "El número de factura es obligatorio.", field: "invoiceNumberRaw" },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const replacementLines = Array.isArray(payload.lines)
    ? normalizeLines(payload.lines, id)
    : null;
  const currentSourceValues = parseObject(current.sourceValues);
  const manualSource = parseObject(currentSourceValues.manual);
  if (replacementLines) {
    const lineCalculation = calculateDocument({
      lines: payload.lines as Record<string, unknown>[],
      discount: payload.discountAmount ?? current.discountAmount,
      additionalCharge:
        payload.additionalChargeAmount ?? manualSource.additionalChargeAmount,
      taxRate: payload.taxRate ?? manualSource.taxRate,
      advance: payload.paidAmountSnapshot ?? current.paidAmountSnapshot,
    });
    if (lineCalculation.errors.length) {
      return Response.json({ error: lineCalculation.errors[0], field: "lines" }, { status: 400 });
    }
  }
  const calculated = calculateInvoice({
    lines: replacementLines ?? undefined,
    subtotal: payload.subtotalAmount ?? current.subtotalAmount,
    discount: payload.discountAmount ?? current.discountAmount,
    additionalCharge:
      payload.additionalChargeAmount ?? manualSource.additionalChargeAmount,
    taxRate: payload.taxRate ?? manualSource.taxRate,
    taxAmount: Object.hasOwn(payload, "taxAmount") ? payload.taxAmount : current.taxAmount,
    advance: payload.paidAmountSnapshot ?? current.paidAmountSnapshot,
  });
  const recalculate = replacementLines !== null || [
    "subtotalAmount", "discountAmount", "additionalChargeAmount", "taxRate",
    "taxAmount", "paidAmountSnapshot",
  ].some((key) => Object.hasOwn(payload, key));
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
        contactId: Object.hasOwn(payload, "contactId")
          ? cleanText(payload.contactId, 80) || null
          : current.contactId,
        projectId: Object.hasOwn(payload, "projectId")
          ? cleanText(payload.projectId, 80) || null
          : current.projectId,
        quotationId: Object.hasOwn(payload, "quotationId")
          ? cleanText(payload.quotationId, 80) || null
          : current.quotationId,
        status: Object.hasOwn(payload, "status")
          ? enumValue(payload.status, invoiceStatuses, current.status)
          : current.status,
        paymentTermsRaw: Object.hasOwn(payload, "paymentTermsRaw")
          ? cleanText(payload.paymentTermsRaw, 300)
          : current.paymentTermsRaw,
        purchaseOrderNumber: Object.hasOwn(payload, "purchaseOrderNumber")
          ? cleanText(payload.purchaseOrderNumber, 120)
          : current.purchaseOrderNumber,
        salesRepresentative: Object.hasOwn(payload, "salesRepresentative")
          ? cleanText(payload.salesRepresentative, 180)
          : current.salesRepresentative,
        subtotalAmount: recalculate ? calculated.subtotal : current.subtotalAmount,
        discountAmount: recalculate ? calculated.discount : current.discountAmount,
        taxableAmount: recalculate ? calculated.taxableAmount : current.taxableAmount,
        taxAmount: recalculate ? calculated.taxAmount : current.taxAmount,
        totalAmount: recalculate ? calculated.total : current.totalAmount,
        paidAmountSnapshot: recalculate ? calculated.advance : current.paidAmountSnapshot,
        balanceAmountSnapshot: recalculate ? calculated.balance : current.balanceAmountSnapshot,
        snapshotAsOf: recalculate ? now.slice(0, 10) : current.snapshotAsOf,
        sourceValues: JSON.stringify({
          ...currentSourceValues,
          manual: {
            ...manualSource,
            taxRate: recalculate ? calculated.taxRate : manualSource.taxRate,
            additionalChargeLabel: Object.hasOwn(payload, "additionalChargeLabel")
              ? cleanText(payload.additionalChargeLabel, 120)
              : manualSource.additionalChargeLabel,
            additionalChargeAmount: recalculate
              ? calculated.additionalCharge
              : manualSource.additionalChargeAmount,
            notes: Object.hasOwn(payload, "notes")
              ? cleanText(payload.notes, 4_000)
              : manualSource.notes,
          },
        }),
        cancellationReason: Object.hasOwn(payload, "cancellationReason")
          ? cleanText(payload.cancellationReason, 1000)
          : current.cancellationReason,
        sourceAuthority: "manual_resolution",
        updatedAt: now,
      })
      .where(and(eq(invoices.id, id), isNull(invoices.archivedAt)))
      .returning();
    if (replacementLines !== null) {
      const d1 = getD1();
      await d1.batch([
        d1.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(id),
        ...replacementLines.map((line) =>
          d1
            .prepare(
              `INSERT INTO invoice_lines (
                 id, invoice_id, line_number, item_code, description, location,
                 quantity, width_cm, height_cm, area_sqm, unit_of_measure,
                 unit_price, line_subtotal, discount_amount, tax_amount,
                 line_total, source_values, value_states
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .bind(
              line.id, line.invoiceId, line.lineNumber, line.itemCode,
              line.description, line.location, line.quantity, line.widthCm,
              line.heightCm, line.areaSqm, line.unitOfMeasure, line.unitPrice,
              line.lineSubtotal, line.discountAmount, line.taxAmount,
              line.lineTotal, line.sourceValues, line.valueStates,
            ),
        ),
      ]);
    }
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
      { error: "La identidad fiscal o el NCF entra en conflicto.", field: "ncfRaw" },
      { status: 409 },
    );
  }
}

function normalizeLines(value: unknown[], invoiceId: string) {
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    const description = cleanText(line.description, 1000);
    if (!description) return [];
    const calculatedLine = calculateDocumentLine(line);
    return [{
      id: crypto.randomUUID(),
      invoiceId,
      lineNumber: index + 1,
      itemCode: cleanText(line.itemCode, 120),
      description,
      location: cleanText(line.location, 300),
      quantity: calculatedLine.quantity,
      widthCm: optionalAmount(line.widthCm),
      heightCm: optionalAmount(line.heightCm),
      areaSqm: calculatedLine.areaTotal,
      unitOfMeasure: cleanText(line.unitOfMeasure, 40),
      unitPrice: optionalAmount(line.unitPrice),
      lineSubtotal: calculatedLine.lineTotal,
      discountAmount: optionalAmount(line.discountAmount),
      taxAmount: optionalAmount(line.taxAmount),
      lineTotal: calculatedLine.lineTotal,
      sourceValues: "{}",
      valueStates: "{}",
    }];
  });
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
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
