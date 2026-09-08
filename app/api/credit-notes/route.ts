import { and, eq, isNull } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { businesses, creditNotes } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeInvoiceApi } from "../../lib/invoice-api";
import {
  creditNoteStatuses,
  enumValue,
  isoDate,
  issueYear,
  normalizeInvoiceIdentifier,
  optionalAmount,
} from "../../lib/invoice-domain";
import { cleanText } from "../../lib/crm";
import { upsertSearchDocument } from "../../lib/search";

export async function GET(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "notas-credito" });
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 120);
  const notes =
    (
      await getD1()
        .prepare(
          `SELECT cn.id, cn.business_id AS businessId, b.name AS businessName,
             cn.credit_note_number_raw AS creditNoteNumberRaw,
             cn.ncf_raw AS ncfRaw, cn.issue_date AS issueDate, cn.currency,
             cn.total_amount AS totalAmount, cn.status, cn.reason,
             cn.source_authority AS sourceAuthority,
             COALESCE(SUM(CASE WHEN ca.status = 'applied' THEN ca.amount ELSE 0 END), 0) AS appliedAmount
           FROM credit_notes cn
           JOIN businesses b ON b.id = cn.business_id
           LEFT JOIN credit_note_applications ca ON ca.credit_note_id = cn.id
           WHERE cn.archived_at IS NULL
             AND (? = '' OR cn.credit_note_number_raw LIKE ? OR cn.ncf_raw LIKE ? OR b.name LIKE ?)
           GROUP BY cn.id ORDER BY COALESCE(cn.issue_date, cn.created_at) DESC
           LIMIT 500`,
        )
        .bind(
          q,
          `%${q.replaceAll("%", "")}%`,
          `%${q.replaceAll("%", "")}%`,
          `%${q.replaceAll("%", "")}%`,
        )
        .all()
    ).results ?? [];
  return Response.json({ creditNotes: notes });
}

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "notas-credito", write: true, action: "create" });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const businessId = cleanText(payload.businessId, 80);
  const number = cleanText(payload.creditNoteNumberRaw, 120);
  if (!businessId || !number) {
    return Response.json(
      { error: "Empresa y número de nota de crédito son obligatorios." },
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
  const issueDate = isoDate(payload.issueDate);
  const ncfRaw = cleanText(payload.ncfRaw, 60);
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  try {
    const [creditNote] = await db
      .insert(creditNotes)
      .values({
        id,
        businessId,
        sourceDocumentId: cleanText(payload.sourceDocumentId, 80) || null,
        creditNoteNumberRaw: number,
        creditNoteNumberNormalized: normalizeInvoiceIdentifier(number),
        ncfRaw,
        ncfNormalized: normalizeInvoiceIdentifier(ncfRaw),
        issueDate,
        issueDateRaw: cleanText(payload.issueDateRaw ?? payload.issueDate, 80),
        issueYear: issueYear(issueDate),
        currency: cleanText(payload.currency, 3).toUpperCase() || "DOP",
        reason: cleanText(payload.reason, 1000),
        subtotalAmount: optionalAmount(payload.subtotalAmount),
        taxAmount: optionalAmount(payload.taxAmount),
        totalAmount: optionalAmount(payload.totalAmount),
        status: enumValue(payload.status, creditNoteStatuses, "issued"),
        sourceAuthority: "manual_resolution",
        createdBy: auth.user.email,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    await writeAudit(
      auth.user.email,
      "create",
      "credit_note",
      id,
      number,
    );
    await upsertSearchDocument({
      entityType: "credit_note",
      entityId: id,
      title: number,
      subtitle: ncfRaw,
      searchText: `${number} ${ncfRaw}`,
      ownerEmail: auth.user.email,
      updatedAt: now,
    });
    return Response.json({ creditNote }, { status: 201 });
  } catch {
    return Response.json(
      { error: "La nota de crédito o el NCF ya existe." },
      { status: 409 },
    );
  }
}
