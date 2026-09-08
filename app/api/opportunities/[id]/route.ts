import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { businesses, contacts, opportunities } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import {
  cleanText,
  nonNegativeNumber,
  optionalIsoDate,
  opportunityStageLabels,
} from "../../../lib/crm";
import {
  deleteSearchDocument,
  upsertSearchDocument,
} from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "oportunidades", action: "edit" });
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const title = cleanText(payload.title, 200);
  const businessId = cleanText(payload.businessId, 80);
  const primaryContactId = cleanText(payload.primaryContactId, 80) || null;
  if (!title || !businessId) {
    return Response.json(
      { error: "Title y Business son obligatorios." },
      { status: 400 },
    );
  }

  const db = getDb();
  const [business] = await db
    .select()
    .from(businesses)
    .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
    .limit(1);
  if (!business) {
    return Response.json({ error: "Business no encontrado." }, { status: 400 });
  }
  let contact = null;
  if (primaryContactId) {
    [contact] = await db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.id, primaryContactId), isNull(contacts.archivedAt)),
      )
      .limit(1);
    if (!contact || (contact.businessId && contact.businessId !== businessId)) {
      return Response.json(
        { error: "Primary Contact no pertenece al Business seleccionado." },
        { status: 400 },
      );
    }
  }

  const now = new Date().toISOString();
  const [opportunity] = await db
    .update(opportunities)
    .set({
      title,
      businessId,
      primaryContactId,
      estimatedValue: nonNegativeNumber(payload.estimatedValue),
      expectedCloseDate: optionalIsoDate(payload.expectedCloseDate),
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      notes: cleanText(payload.notes, 4000),
      updatedAt: now,
    })
    .where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt)))
    .returning();
  if (!opportunity) {
    return Response.json(
      { error: "Opportunity no encontrada." },
      { status: 404 },
    );
  }

  await Promise.all([
    writeAudit(auth.user.email, "update", "opportunity", id, title),
    upsertSearchDocument({
      entityType: "opportunity",
      entityId: id,
      title,
      subtitle: business.name,
      searchText: `${title} ${business.name} ${contact?.name ?? ""} ${opportunity.notes} ${opportunityStageLabels[opportunity.stage]}`,
      ownerEmail: opportunity.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ opportunity });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "oportunidades", action: "delete" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const now = new Date().toISOString();
  const [opportunity] = await getDb()
    .update(opportunities)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(opportunities.id, id), isNull(opportunities.archivedAt)))
    .returning();
  if (!opportunity) {
    return Response.json(
      { error: "Opportunity no encontrada." },
      { status: 404 },
    );
  }
  await Promise.all([
    writeAudit(
      auth.user.email,
      "archive",
      "opportunity",
      id,
      opportunity.title,
    ),
    deleteSearchDocument("opportunity", id),
  ]);
  return Response.json({ ok: true });
}
