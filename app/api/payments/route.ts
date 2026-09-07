import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { businesses, payments } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeInvoiceApi } from "../../lib/invoice-api";
import { isoDate, optionalAmount } from "../../lib/invoice-domain";
import { cleanText } from "../../lib/crm";
import { upsertSearchDocument } from "../../lib/search";

export async function GET(request: Request) {
  const auth = await authorizeInvoiceApi();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const status = (url.searchParams.get("status") ?? "").trim();
  const conditions = ["1 = 1"];
  const bindings: unknown[] = [];
  if (status) {
    conditions.push("p.status = ?");
    bindings.push(status);
  }
  if (q) {
    conditions.push(
      "(p.receipt_number LIKE ? OR p.transaction_reference LIKE ? OR b.name LIKE ?)",
    );
    const term = `%${q.replaceAll("%", "")}%`;
    bindings.push(term, term, term);
  }
  const normalized =
    (
      await getD1()
        .prepare(
          `SELECT p.id, p.business_id AS businessId, b.name AS businessName,
             p.amount, p.currency, p.payment_date AS paymentDate,
             p.method, p.status, p.receipt_number AS receiptNumber,
             p.transaction_reference AS transactionReference,
             p.evidence_status AS evidenceStatus,
             COALESCE(SUM(CASE WHEN pa.status = 'applied' THEN pa.amount ELSE 0 END), 0) AS allocatedAmount,
             CASE WHEN p.amount IS NULL THEN NULL ELSE
               p.amount - COALESCE(SUM(CASE WHEN pa.status = 'applied' THEN pa.amount ELSE 0 END), 0)
             END AS unallocatedAmount
           FROM payments p
           JOIN businesses b ON b.id = p.business_id
           LEFT JOIN payment_allocations pa ON pa.payment_id = p.id
           WHERE ${conditions.join(" AND ")}
           GROUP BY p.id
           ORDER BY COALESCE(p.payment_date, p.created_at) DESC
           LIMIT 500`,
        )
        .bind(...bindings)
        .all()
    ).results ?? [];

  const legacy =
    (
      await getD1()
        .prepare(
          `SELECT br.id, br.customer_name AS businessName, br.amount,
             'DOP' AS currency, NULL AS paymentDate, '' AS method,
             br.status, br.title AS receiptNumber, '' AS transactionReference,
             'legacy' AS evidenceStatus, 0 AS allocatedAmount,
             br.amount AS unallocatedAmount
           FROM business_records br
           WHERE br.module = 'pagos' AND br.archived_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM payments p WHERE p.legacy_record_id = br.id
             )
             AND (? = '' OR br.title LIKE ? OR br.customer_name LIKE ?)
           ORDER BY br.updated_at DESC LIMIT 500`,
        )
        .bind(
          q,
          `%${q.replaceAll("%", "")}%`,
          `%${q.replaceAll("%", "")}%`,
        )
        .all()
    ).results ?? [];

  return Response.json(
    { payments: normalized, legacyPayments: legacy },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ write: true });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const businessId = cleanText(payload.businessId, 80);
  const amount = optionalAmount(payload.amount);
  if (!businessId || amount === null || amount <= 0) {
    return Response.json(
      { error: "Empresa y monto positivo son obligatorios." },
      { status: 400 },
    );
  }
  const db = getDb();
  const [business] = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
    .limit(1);
  if (!business) {
    return Response.json({ error: "Empresa no encontrada." }, { status: 404 });
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [payment] = await db
    .insert(payments)
    .values({
      id,
      businessId,
      projectId: cleanText(payload.projectId, 80) || null,
      sourceDocumentId: cleanText(payload.sourceDocumentId, 80) || null,
      type: "partial",
      amount,
      currency: cleanText(payload.currency, 3).toUpperCase() || "DOP",
      paymentDate: isoDate(payload.paymentDate),
      method: cleanText(payload.method, 80),
      status: "received",
      label: cleanText(payload.label, 180),
      transactionReference: cleanText(payload.transactionReference, 180),
      receiptNumber: cleanText(payload.receiptNumber, 120),
      payerName: cleanText(payload.payerName, 180),
      bankName: cleanText(payload.bankName, 180),
      accountLast4: cleanText(payload.accountLast4, 4),
      evidenceStatus: cleanText(payload.sourceDocumentId, 80)
        ? "documented"
        : "manual",
      notes: cleanText(payload.notes, 2000),
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await writeAudit(
    auth.user.email,
    "create",
    "payment",
    id,
    `Pago ${payment.receiptNumber || id}`,
  );
  await upsertSearchDocument({
    entityType: "payment",
    entityId: id,
    title: payment.receiptNumber || `Pago ${id}`,
    subtitle: payment.transactionReference,
    searchText: `${payment.receiptNumber} ${payment.transactionReference}`,
    ownerEmail: auth.user.email,
    updatedAt: now,
  });
  return Response.json({ payment }, { status: 201 });
}
