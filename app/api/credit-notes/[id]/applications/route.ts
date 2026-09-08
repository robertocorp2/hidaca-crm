import { and, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import {
  creditNoteApplications,
  creditNotes,
  invoices,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { isoDate, optionalAmount } from "../../../../lib/invoice-domain";
import { cleanText } from "../../../../lib/crm";
import {
  refreshCreditNoteStatus,
  refreshInvoiceBalanceStatus,
} from "../../../../lib/invoice-balances";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeInvoiceApi({ module: "notas-credito", write: true });
  if (!auth.ok) return auth.response;
  const { id: creditNoteId } = await context.params;
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
  const [creditNote] = await db
    .select()
    .from(creditNotes)
    .where(eq(creditNotes.id, creditNoteId))
    .limit(1);
  const [invoice] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.businessId, creditNote?.businessId ?? "")))
    .limit(1);
  if (!creditNote || !invoice) {
    return Response.json(
      { error: "Nota o factura compatible no encontrada." },
      { status: 404 },
    );
  }
  const totals = await getD1()
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS applied
       FROM credit_note_applications
       WHERE credit_note_id = ? AND status = 'applied'`,
    )
    .bind(creditNoteId)
    .first<{ applied: number }>();
  if (
    creditNote.totalAmount !== null &&
    Number(totals?.applied ?? 0) + amount > creditNote.totalAmount + 0.005
  ) {
    return Response.json(
      { error: "El monto excede el crédito disponible." },
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
      { error: "El crédito excede el balance de la factura." },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [application] = await db
    .insert(creditNoteApplications)
    .values({
      id,
      creditNoteId,
      invoiceId,
      amount,
      applicationDate: isoDate(payload.applicationDate) ?? now.slice(0, 10),
      sourceDocumentId: cleanText(payload.sourceDocumentId, 80) || null,
      status: "applied",
      createdBy: auth.user.email,
      createdAt: now,
    })
    .returning();
  await Promise.all([
    refreshInvoiceBalanceStatus(invoiceId, now),
    refreshCreditNoteStatus(creditNoteId, now),
  ]);
  await writeAudit(
    auth.user.email,
    "apply",
    "credit_note_application",
    id,
    `${creditNote.creditNoteNumberRaw} → ${invoice.invoiceNumberRaw}`,
  );
  return Response.json({ application }, { status: 201 });
}
