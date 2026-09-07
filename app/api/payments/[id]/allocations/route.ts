import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  invoices,
  paymentAllocations,
  payments,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { isoDate, optionalAmount } from "../../../../lib/invoice-domain";
import { cleanText } from "../../../../lib/crm";
import { refreshInvoiceBalanceStatus } from "../../../../lib/invoice-balances";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ module: "pagos", write: true });
  if (!auth.ok) return auth.response;
  const { id: paymentId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const invoiceId = cleanText(payload.invoiceId, 80);
  const amount = optionalAmount(payload.amount);
  if (!invoiceId || amount === null || amount <= 0) {
    return Response.json(
      { error: "Factura y monto positivo son obligatorios." },
      { status: 400 },
    );
  }
  const db = getDb();
  const [payment] = await db
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, payment?.businessId ?? "")))
    .limit(1);
  if (!payment || !invoice) {
    return Response.json(
      { error: "Pago o factura compatible no encontrado." },
      { status: 404 },
    );
  }
  if (!["documented", "manual"].includes(payment.evidenceStatus)) {
    return Response.json(
      { error: "La asignación requiere evidencia de pago identificable." },
      { status: 409 },
    );
  }
  const totals = await getD1()
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS applied
       FROM payment_allocations WHERE payment_id = ? AND status = 'applied'`,
    )
    .bind(paymentId)
    .first<{ applied: number }>();
  if (payment.amount !== null && Number(totals?.applied ?? 0) + amount > payment.amount + 0.005) {
    return Response.json(
      { error: "El monto excede el saldo disponible del pago." },
      { status: 409 },
    );
  }
  const invoiceBalance = await getD1()
    .prepare(
      `SELECT CASE WHEN total_amount IS NULL THEN NULL ELSE
         total_amount
         - COALESCE((SELECT SUM(amount) FROM payment_allocations
                     WHERE invoice_id = ? AND status = 'applied'), 0)
         - COALESCE((SELECT SUM(amount) FROM credit_note_applications
                     WHERE invoice_id = ? AND status = 'applied'), 0)
       END AS balance FROM invoices WHERE id = ?`,
    )
    .bind(invoiceId, invoiceId, invoiceId)
    .first<{ balance: number | null }>();
  if (
    invoiceBalance?.balance !== null &&
    invoiceBalance?.balance !== undefined &&
    amount > invoiceBalance.balance + 0.005
  ) {
    return Response.json(
      { error: "El monto excede el balance de la factura." },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [allocation] = await db
    .insert(paymentAllocations)
    .values({
      id,
      paymentId,
      invoiceId,
      amount,
      currency: payment.currency,
      allocationDate: isoDate(payload.allocationDate) ?? now.slice(0, 10),
      sourceDocumentId: cleanText(payload.sourceDocumentId, 80) || null,
      status: "applied",
      createdBy: auth.user.email,
      createdAt: now,
    })
    .returning();
  await refreshInvoiceBalanceStatus(invoiceId, now);
  await writeAudit(
    auth.user.email,
    "allocate",
    "payment_allocation",
    id,
    `${paymentId} → ${invoice.invoiceNumberRaw}`,
  );
  return Response.json({ allocation }, { status: 201 });
}
