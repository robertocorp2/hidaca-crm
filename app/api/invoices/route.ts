import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { businesses, invoiceLines, invoices } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeInvoiceApi } from "../../lib/invoice-api";
import {
  enumValue,
  invoiceStatuses,
  isoDate,
  issueYear,
  normalizeInvoiceIdentifier,
  optionalAmount,
} from "../../lib/invoice-domain";
import { cleanText } from "../../lib/crm";
import { upsertSearchDocument } from "../../lib/search";
import { calculateInvoice } from "../../lib/invoice-calculations";
import { calculateDocument, calculateDocumentLine } from "../../lib/document-calculations";

type InvoiceListRow = {
  id: string;
  legacyRecordId: string | null;
  businessId: string | null;
  businessName: string;
  businessRnc: string;
  invoiceNumberRaw: string;
  issueDate: string | null;
  dueDate: string | null;
  ncfRaw: string;
  currency: string;
  subtotalAmount: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  balanceAmount: number | null;
  status: string;
  sourceAuthority: string;
  updatedAt: string;
  legacy: number;
};

export async function GET(request: Request) {
  const auth = await authorizeInvoiceApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const status = (url.searchParams.get("status") ?? "").trim();
  const businessId = (url.searchParams.get("businessId") ?? "").trim();
  const quotationId = (url.searchParams.get("quotationId") ?? "").trim();
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit") ?? 250), 1),
    500,
  );
  const conditions = ["i.archived_at IS NULL"];
  const bindings: unknown[] = [];
  if (status && invoiceStatuses.includes(status as never)) {
    conditions.push("i.status = ?");
    bindings.push(status);
  }
  if (businessId) {
    conditions.push("i.business_id = ?");
    bindings.push(businessId);
  }
  if (quotationId) {
    conditions.push("i.quotation_id = ?");
    bindings.push(quotationId);
  }
  if (q) {
    conditions.push(
      "(i.invoice_number_raw LIKE ? OR i.ncf_raw LIKE ? OR b.name LIKE ? OR b.rnc LIKE ?)",
    );
    const term = `%${q.replaceAll("%", "")}%`;
    bindings.push(term, term, term, term);
  }

  const normalized =
    (
      await getD1()
        .prepare(
          `SELECT i.id, i.legacy_record_id AS legacyRecordId,
            i.business_id AS businessId, b.name AS businessName,
            b.rnc AS businessRnc,
            i.invoice_number_raw AS invoiceNumberRaw,
            i.issue_date AS issueDate, i.due_date AS dueDate,
            i.ncf_raw AS ncfRaw, i.currency,
            i.subtotal_amount AS subtotalAmount,
            i.tax_amount AS taxAmount, i.total_amount AS totalAmount,
            CASE
              WHEN EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.invoice_id = i.id AND pa.status = 'applied')
                OR EXISTS (SELECT 1 FROM credit_note_applications ca WHERE ca.invoice_id = i.id AND ca.status = 'applied')
                THEN i.total_amount
                  - (SELECT COALESCE(SUM(pa.amount), 0) FROM payment_allocations pa WHERE pa.invoice_id = i.id AND pa.status = 'applied')
                  - (SELECT COALESCE(SUM(ca.amount), 0) FROM credit_note_applications ca WHERE ca.invoice_id = i.id AND ca.status = 'applied')
              WHEN i.balance_amount_snapshot IS NOT NULL THEN i.balance_amount_snapshot
              WHEN i.status = 'paid' THEN 0
              ELSE i.total_amount
            END AS balanceAmount,
            i.status, i.source_authority AS sourceAuthority,
            i.updated_at AS updatedAt, 0 AS legacy
           FROM invoices i
           JOIN businesses b ON b.id = i.business_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY COALESCE(i.issue_date, i.created_at) DESC
           LIMIT ?`,
        )
        .bind(...bindings, limit)
        .all<InvoiceListRow>()
    ).results ?? [];

  const legacy =
    (
      await getD1()
        .prepare(
          `SELECT br.id, br.id AS legacyRecordId, NULL AS businessId,
             br.customer_name AS businessName,
             COALESCE(NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.rnc'), ''), '') AS businessRnc,
             COALESCE(
               NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.invoice_number'), ''),
               NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.factura'), ''),
               br.title
             ) AS invoiceNumberRaw,
             COALESCE(
               NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.issue_date'), ''),
               NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.fecha'), '')
             ) AS issueDate,
             br.due_date AS dueDate,
             COALESCE(
               NULLIF(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.ncf'), ''),
               ''
             ) AS ncfRaw,
             'DOP' AS currency,
             CAST(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.subtotal') AS REAL) AS subtotalAmount,
             CAST(COALESCE(
               json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.itbis'),
               json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.tax_amount')
             ) AS REAL) AS taxAmount,
             CASE
               WHEN json_type(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.total') IN ('integer', 'real')
                 THEN CAST(json_extract(CASE WHEN json_valid(br.metadata) THEN br.metadata ELSE '{}' END, '$.total') AS REAL)
               WHEN br.amount <> 0 THEN br.amount
               ELSE NULL
             END AS totalAmount,
             CASE WHEN lower(trim(br.status)) IN ('pagado', 'pagada', 'paid') THEN 0 ELSE NULL END AS balanceAmount,
             CASE
               WHEN lower(trim(br.status)) IN ('pagado', 'pagada', 'paid') THEN 'paid'
               WHEN lower(trim(br.status)) IN ('pendiente', 'pending') THEN 'issued'
               ELSE 'unknown'
             END AS status,
             'legacy' AS sourceAuthority,
             br.updated_at AS updatedAt, 1 AS legacy
           FROM business_records br
           WHERE br.module = 'facturas' AND br.archived_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM invoices i WHERE i.legacy_record_id = br.id
             )
             AND (? = '' OR br.title LIKE ? OR br.customer_name LIKE ? OR br.metadata LIKE ?)
           ORDER BY br.updated_at DESC LIMIT ?`,
        )
        .bind(
          q,
          `%${q.replaceAll("%", "")}%`,
          `%${q.replaceAll("%", "")}%`,
          `%${q.replaceAll("%", "")}%`,
          limit,
        )
        .all<InvoiceListRow>()
    ).results ?? [];

  return Response.json(
    { invoices: normalized, legacyInvoices: legacy },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ write: true, action: "create" });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const businessId = cleanText(payload.businessId, 80);
  const invoiceNumberRaw = cleanText(payload.invoiceNumberRaw, 120);
  if (!businessId || !invoiceNumberRaw) {
    return Response.json(
      {
        error: "Empresa y número de factura son obligatorios.",
        field: !businessId ? "businessId" : "invoiceNumberRaw",
      },
      { status: 400 },
    );
  }

  const db = getDb();
  const [business] = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
    .limit(1);
  if (!business) {
    return Response.json({ error: "Empresa no encontrada.", field: "businessId" }, { status: 404 });
  }
  const quotationId = cleanText(payload.quotationId, 80) || null;
  if (quotationId && payload.quotationConversion === true) {
    const quotation = (await getD1().prepare(`
      SELECT id, business_id AS businessId, status
      FROM quotations
      WHERE id = ? AND archived_at IS NULL
      LIMIT 1
    `).bind(quotationId).first<Record<string, unknown>>());
    if (!quotation || quotation.status !== "accepted") {
      return Response.json({ error: "La cotización debe existir y estar aceptada para crear esta factura.", field: "quotationId" }, { status: 409 });
    }
    if (String(quotation.businessId ?? "") !== businessId) {
      return Response.json({ error: "La Empresa de la factura debe coincidir con la cotización.", field: "businessId" }, { status: 400 });
    }
    const contactId = cleanText(payload.contactId, 80);
    if (contactId) {
      const contact = await getD1().prepare("SELECT id FROM contacts WHERE id = ? AND business_id = ? AND archived_at IS NULL LIMIT 1").bind(contactId, businessId).first<{ id: string }>();
      if (!contact) return Response.json({ error: "El Contacto seleccionado no pertenece a la Empresa de la cotización.", field: "contactId" }, { status: 400 });
    }
    const projectId = cleanText(payload.projectId, 80);
    if (projectId) {
      const project = await getD1().prepare("SELECT id FROM projects WHERE id = ? AND business_id = ? AND archived_at IS NULL LIMIT 1").bind(projectId, businessId).first<{ id: string }>();
      if (!project) return Response.json({ error: "El Proyecto seleccionado no pertenece a la Empresa de la cotización.", field: "projectId" }, { status: 400 });
    }
  }

  const issueDate = isoDate(payload.issueDate);
  const dueDate = isoDate(payload.dueDate);
  const ncfRaw = cleanText(payload.ncfRaw, 60);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const lineCalculation = calculateDocument({
    lines: Array.isArray(payload.lines) ? payload.lines as Record<string, unknown>[] : [],
    discount: payload.discountAmount,
    additionalCharge: payload.additionalChargeAmount,
    taxRate: payload.taxRate,
    advance: payload.paidAmountSnapshot,
  });
  if (lineCalculation.errors.length) {
    return Response.json({ error: lineCalculation.errors[0], field: "lines" }, { status: 400 });
  }
  const lineItems = normalizeLines(payload.lines, id);
  const calculated = calculateInvoice({
    lines: lineItems,
    subtotal: payload.subtotalAmount,
    discount: payload.discountAmount,
    additionalCharge: payload.additionalChargeAmount,
    taxRate: payload.taxRate,
    taxAmount: payload.taxAmount,
    advance: payload.paidAmountSnapshot,
  });
  const hasManualFinancials = lineItems.length > 0 || Object.hasOwn(payload, "subtotalAmount");
  try {
    const [invoice] = await db
      .insert(invoices)
      .values({
        id,
        businessId,
        contactId: cleanText(payload.contactId, 80) || null,
        projectId: cleanText(payload.projectId, 80) || null,
        quotationId,
        sourceDocumentId: cleanText(payload.sourceDocumentId, 80) || null,
        invoiceNumberRaw,
        invoiceNumberNormalized:
          normalizeInvoiceIdentifier(invoiceNumberRaw),
        issueDate,
        issueDateRaw: cleanText(payload.issueDateRaw ?? payload.issueDate, 80),
        issueYear: issueYear(issueDate),
        dueDate,
        dueDateRaw: cleanText(payload.dueDateRaw ?? payload.dueDate, 80),
        ncfRaw,
        ncfNormalized: normalizeInvoiceIdentifier(ncfRaw),
        ncfType: cleanText(payload.ncfType, 40),
        status: enumValue(payload.status, invoiceStatuses, "issued"),
        currency: cleanText(payload.currency, 3).toUpperCase() || "DOP",
        paymentTermsRaw: cleanText(payload.paymentTermsRaw, 300),
        purchaseOrderNumber: cleanText(payload.purchaseOrderNumber, 120),
        salesRepresentative: cleanText(payload.salesRepresentative, 180),
        subtotalAmount: hasManualFinancials ? calculated.subtotal : optionalAmount(payload.subtotalAmount),
        discountAmount: hasManualFinancials ? calculated.discount : optionalAmount(payload.discountAmount),
        taxableAmount: hasManualFinancials ? calculated.taxableAmount : optionalAmount(payload.taxableAmount),
        exemptAmount: optionalAmount(payload.exemptAmount),
        taxAmount: hasManualFinancials ? calculated.taxAmount : optionalAmount(payload.taxAmount),
        totalAmount: hasManualFinancials ? calculated.total : optionalAmount(payload.totalAmount),
        paidAmountSnapshot: hasManualFinancials ? calculated.advance : optionalAmount(payload.paidAmountSnapshot),
        balanceAmountSnapshot: hasManualFinancials ? calculated.balance : optionalAmount(payload.balanceAmountSnapshot),
        snapshotAsOf: hasManualFinancials ? now.slice(0, 10) : null,
        sourceAuthority: "manual_resolution",
        sourceValues: JSON.stringify({
          manual: {
            taxRate: calculated.taxRate,
            additionalChargeLabel: cleanText(payload.additionalChargeLabel, 120),
            additionalChargeAmount: calculated.additionalCharge,
            notes: cleanText(payload.notes ?? payload.customerFacingNotes, 4_000),
          },
        }),
        createdBy: auth.user.email,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (lineItems.length) {
      try {
        await db.insert(invoiceLines).values(lineItems);
      } catch (error) {
        await db.delete(invoices).where(eq(invoices.id, id));
        throw error;
      }
    }
    await Promise.all([
      writeAudit(
        auth.user.email,
        "create",
        "invoice",
        id,
        invoiceNumberRaw,
      ),
      upsertSearchDocument({
        entityType: "invoice",
        entityId: id,
        title: invoiceNumberRaw,
        subtitle: `${business.name} ${ncfRaw}`.trim(),
        searchText: `${invoiceNumberRaw} ${business.name} ${ncfRaw}`,
        ownerEmail: auth.user.email,
        updatedAt: now,
      }),
    ]);
    return Response.json({ invoice }, { status: 201 });
  } catch (error) {
    const isConflict = error instanceof Error && /unique/i.test(error.message);
    return Response.json(
      {
        error: isConflict
          ? "La identidad fiscal o el NCF ya existe."
          : "No se pudo guardar la factura.",
        field: isConflict ? "ncfRaw" : undefined,
      },
      { status: 409 },
    );
  }
}

function normalizeLines(value: unknown, invoiceId: string) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];
    const line = entry as Record<string, unknown>;
    const description = cleanText(line.description, 1000);
    if (!description) return [];
    const calculated = calculateDocumentLine(line);
    const normalized = {
      id: crypto.randomUUID(),
      invoiceId,
      lineNumber: index + 1,
      itemCode: cleanText(line.itemCode, 120),
      description,
      location: cleanText(line.location, 300),
      quantity: calculated.quantity,
      widthCm: optionalAmount(line.widthCm),
      heightCm: optionalAmount(line.heightCm),
      areaSqm: calculated.areaTotal,
      unitOfMeasure: cleanText(line.unitOfMeasure, 40),
      unitPrice: optionalAmount(line.unitPrice),
      lineSubtotal: calculated.lineTotal,
      discountAmount: optionalAmount(line.discountAmount),
      taxAmount: optionalAmount(line.taxAmount),
      lineTotal: calculated.lineTotal,
      sourceValues: "{}",
      valueStates: "{}",
    };
    return [normalized];
  });
}
