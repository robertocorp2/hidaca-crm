import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { leads } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import {
  cleanText,
  normalizeEmail,
  normalizePhone,
} from "../../../lib/crm";
import {
  deleteSearchDocument,
  upsertSearchDocument,
} from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const businessName = cleanText(payload.businessName, 180);
  const contactName = cleanText(payload.contactName, 180);
  if (!businessName || !contactName) {
    return Response.json(
      { error: "Business Name y Contact Name son obligatorios." },
      { status: 400 },
    );
  }

  const email = cleanText(payload.email, 180);
  const phone = cleanText(payload.phone, 60);
  const now = new Date().toISOString();
  const [lead] = await getDb()
    .update(leads)
    .set({
      businessName,
      contactName,
      email,
      normalizedEmail: normalizeEmail(email),
      phone,
      normalizedPhone: normalizePhone(phone),
      source: cleanText(payload.source, 120),
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      notes: cleanText(payload.notes, 4000),
      updatedAt: now,
    })
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .returning();
  if (!lead) {
    return Response.json({ error: "Lead no encontrado." }, { status: 404 });
  }

  await Promise.all([
    writeAudit(auth.user.email, "update", "lead", id, businessName),
    upsertSearchDocument({
      entityType: "lead",
      entityId: id,
      title: businessName,
      subtitle: `${contactName} ${email || phone}`.trim(),
      searchText: `${businessName} ${contactName} ${email} ${phone} ${lead.source} ${lead.notes}`,
      ownerEmail: lead.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ lead });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const now = new Date().toISOString();
  const [lead] = await getDb()
    .update(leads)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
    .returning();
  if (!lead) {
    return Response.json({ error: "Lead no encontrado." }, { status: 404 });
  }

  await Promise.all([
    writeAudit(auth.user.email, "archive", "lead", id, lead.businessName),
    deleteSearchDocument("lead", id),
  ]);
  return Response.json({ ok: true });
}
