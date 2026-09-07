import { getD1 } from "../../../../../db";
import { writeAudit } from "../../../../lib/audit";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";

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
  if (payload.confirm !== "REVERTIR LOTE" || !String(payload.reason ?? "").trim()) {
    return Response.json(
      { error: "Confirma REVERTIR LOTE e indica el motivo." },
      { status: 400 },
    );
  }
  const { id } = await context.params;
  const batch = await getD1()
    .prepare("SELECT id, status FROM import_batches WHERE id = ?")
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!batch) {
    return Response.json({ error: "Lote no encontrado." }, { status: 404 });
  }
  if (batch.status === "reversed") {
    return Response.json({ idempotent: true, batchId: id });
  }
  if (batch.status !== "completed") {
    return Response.json(
      { error: "Solo un lote completado puede revertirse." },
      { status: 409 },
    );
  }
  const dependencies = await getD1()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM payment_allocations pa
         JOIN invoices i ON i.id = pa.invoice_id
         WHERE i.import_batch_id = ? AND pa.status = 'applied'
           AND (pa.import_batch_id IS NULL OR pa.import_batch_id <> ?)) +
        (SELECT COUNT(*) FROM credit_note_applications ca
         JOIN invoices i ON i.id = ca.invoice_id
         WHERE i.import_batch_id = ? AND ca.status = 'applied'
           AND (ca.import_batch_id IS NULL OR ca.import_batch_id <> ?)) +
        (SELECT COUNT(*) FROM collection_activities c
         JOIN invoices i ON i.id = c.invoice_id
         WHERE i.import_batch_id = ? AND c.archived_at IS NULL) AS count`,
    )
    .bind(id, id, id, id, id)
    .first<{ count: number }>();
  if (Number(dependencies?.count ?? 0) > 0) {
    return Response.json(
      {
        error:
          "Existen movimientos posteriores vinculados. Deben revisarse antes de revertir.",
      },
      { status: 409 },
    );
  }
  const now = new Date().toISOString();
  const reason = String(payload.reason).trim().slice(0, 1000);
  const statements = [
    getD1()
      .prepare(
        `DELETE FROM search_documents WHERE
          (entity_type = 'invoice' AND entity_id IN (
            SELECT id FROM invoices WHERE import_batch_id = ?
          )) OR
          (entity_type = 'payment' AND entity_id IN (
            SELECT id FROM payments WHERE import_batch_id = ?
          )) OR
          (entity_type = 'credit_note' AND entity_id IN (
            SELECT id FROM credit_notes WHERE import_batch_id = ?
          ))`,
      )
      .bind(id, id, id),
    getD1()
      .prepare(
        `UPDATE payment_allocations SET status = 'reversed'
         WHERE import_batch_id = ? AND status = 'applied'`,
      )
      .bind(id),
    getD1()
      .prepare(
        `UPDATE credit_note_applications SET status = 'reversed'
         WHERE import_batch_id = ? AND status = 'applied'`,
      )
      .bind(id),
    getD1()
      .prepare(
        `UPDATE invoices SET archived_at = ?, updated_at = ?
         WHERE import_batch_id = ? AND archived_at IS NULL`,
      )
      .bind(now, now, id),
    getD1()
      .prepare(
        `UPDATE credit_notes SET archived_at = ?, updated_at = ?
         WHERE import_batch_id = ? AND archived_at IS NULL`,
      )
      .bind(now, now, id),
    getD1()
      .prepare(
        `UPDATE payments SET status = 'void', voided_at = ?, void_reason = ?,
           updated_at = ? WHERE import_batch_id = ? AND status <> 'void'`,
      )
      .bind(now, `Reversión de lote: ${reason}`, now, id),
    getD1()
      .prepare(
        `UPDATE receivable_snapshots SET reversed_at = ?,
           reversal_reason = ? WHERE import_batch_id = ? AND reversed_at IS NULL`,
      )
      .bind(now, reason, id),
    getD1()
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, actor_email, reason, created_at
         )
         SELECT 'invoice', id, 'batch_reverse', ?, ?, ? FROM invoices
         WHERE import_batch_id = ?`,
      )
      .bind(auth.user.email, reason, now, id),
    getD1()
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, actor_email, reason, created_at
         )
         SELECT 'payment', id, 'batch_reverse', ?, ?, ? FROM payments
         WHERE import_batch_id = ?`,
      )
      .bind(auth.user.email, reason, now, id),
    getD1()
      .prepare(
        `INSERT INTO entity_history (
           entity_type, entity_id, action, actor_email, reason, created_at
         )
         SELECT 'credit_note', id, 'batch_reverse', ?, ?, ? FROM credit_notes
         WHERE import_batch_id = ?`,
      )
      .bind(auth.user.email, reason, now, id),
    getD1()
      .prepare(
        `UPDATE import_batches SET status = 'reversed', completed_at = ?
         WHERE id = ?`,
      )
      .bind(now, id),
  ];
  await getD1().batch(statements);
  await writeAudit(
    auth.user.email,
    "reverse_invoice_batch",
    "import_batch",
    id,
    reason,
  );
  return Response.json({
    idempotent: false,
    batchId: id,
    message:
      "Registros canónicos desactivados; evidencia y staging preservados.",
  });
}
