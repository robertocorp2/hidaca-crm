import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { businesses, invoices } from "../../../db/schema";
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

type InvoiceListRow = {
  id: string;
  legacyRecordId: string | null;
  businessId: string | null;
  businessName: string;
  invoiceNumberRaw: string;
  issueDate: string | null;
  dueDate: string | null;
  ncfRaw: string;
  currency: string;
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
  if (q) {
    conditions.push(
      "(i.invoice_number_raw LIKE ? OR i.ncf_raw LIKE ? OR b.name LIKE ?)",
    );
    const term = `%${q.replaceAll("%", "")}%`;
    bindings.push(term, term, term);
  }

  const normalized =
    (
      await getD1()
        .prepare(
          `SELECT i.id, i.legacy_record_id AS legacyRecordId,
            i.business_id AS businessId, b.name AS businessName,
            i.invoice_number_raw AS invoiceNumberRaw,
            i.issue_date AS issueDate, i.due_date AS dueDate,
            i.ncf_raw AS ncfRaw, i.currency, i.total_amount AS totalAmount,
            COALESCE(
              i.total_amount
                - (SELECT COALESCE(SUM(pa.amount), 0)
                   FROM payment_allocations pa
                   WHERE pa.invoice_id = i.id AND pa.status = 'applied')
                - (SELECT COALESCE(SUM(ca.amount), 0)
                   FROM credit_note_applications ca
                   WHERE ca.invoice_id = i.id AND ca.status = 'applied'),
              i.balance_amount_snapshot
            ) AS balanceAmount,
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
             br.customer_name AS businessName, br.title AS invoiceNumberRaw,
             NULL AS issueDate, br.due_date AS dueDate, '' AS ncfRaw,
             'DOP' AS currency, br.amount AS totalAmount,
             br.balance AS balanceAmount, br.status, 'legacy' AS sourceAuthority,
             br.updated_at AS updatedAt, 1 AS legacy
           FROM business_records br
           WHERE br.module = 'facturas' AND br.archived_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM invoices i WHERE i.legacy_record_id = br.id
             )
             AND (? = '' OR br.title LIKE ? OR br.customer_name LIKE ?)
           ORDER BY br.updated_at DESC LIMIT ?`,
        )
        .bind(
          q,
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
  const auth = await authorizeInvoiceApi({ write: true });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const businessId = cleanText(payload.businessId, 80);
  const invoiceNumberRaw = cleanText(payload.invoiceNumberRaw, 120);
  if (!businessId || !invoiceNumberRaw) {
    return Response.json(
      { error: "Empresa y número de factura son obligatorios." },
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
    return Response.json({ error: "Empresa no encontrada." }, { status: 404 });
  }

  const issueDate = isoDate(payload.issueDate);
  const dueDate = isoDate(payload.dueDate);
  const ncfRaw = cleanText(payload.ncfRaw, 60);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    const [invoice] = await db
      .insert(invoices)
      .values({
        id,
        businessId,
        contactId: cleanText(payload.contactId, 80) || null,
        projectId: cleanText(payload.projectId, 80) || null,
        quotationId: cleanText(payload.quotationId, 80) || null,
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
        subtotalAmount: optionalAmount(payload.subtotalAmount),
        discountAmount: optionalAmount(payload.discountAmount),
        taxableAmount: optionalAmount(payload.taxableAmount),
        exemptAmount: optionalAmount(payload.exemptAmount),
        taxAmount: optionalAmount(payload.taxAmount),
        totalAmount: optionalAmount(payload.totalAmount),
        sourceAuthority: "manual_resolution",
        sourceValues: "{}",
        createdBy: auth.user.email,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
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
    return Response.json(
      {
        error:
          error instanceof Error && /unique/i.test(error.message)
            ? "La identidad fiscal o el NCF ya existe."
            : "No se pudo guardar la factura.",
      },
      { status: 409 },
    );
  }
}
