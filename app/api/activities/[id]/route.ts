import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { activities } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import {
  cleanText,
  isActivityStatus,
  isRelatedRecordType,
  optionalIsoDate,
  type RelatedRecordType,
} from "../../../lib/crm";
import { relatedRecordExists } from "../../../lib/relations";
import {
  deleteSearchDocument,
  upsertSearchDocument,
} from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

function attendeeList(value: unknown): string[] {
  const source = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(",")
        .map((item) => item.trim());
  return source
    .map((item) => cleanText(item, 180))
    .filter(Boolean)
    .slice(0, 50);
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const title = cleanText(payload.title, 200);
  const startAt = optionalIsoDate(payload.startAt);
  const endAt = optionalIsoDate(payload.endAt);
  const status = payload.status ?? "planned";
  if (
    !title ||
    !startAt ||
    !endAt ||
    new Date(endAt).getTime() < new Date(startAt).getTime() ||
    !isActivityStatus(status)
  ) {
    return Response.json(
      {
        error:
          "Title, fechas válidas y un Status válido son obligatorios.",
      },
      { status: 400 },
    );
  }
  const rawRelatedType = payload.relatedType;
  const relatedType: RelatedRecordType | null = isRelatedRecordType(
    rawRelatedType,
  )
    ? rawRelatedType
    : null;
  const relatedId = cleanText(payload.relatedId, 80) || null;
  if (
    (rawRelatedType || relatedId) &&
    (!relatedType ||
      !relatedId ||
      !(await relatedRecordExists(relatedType, relatedId)))
  ) {
    return Response.json(
      { error: "El registro relacionado no es válido." },
      { status: 400 },
    );
  }
  const now = new Date().toISOString();
  const [activity] = await getDb()
    .update(activities)
    .set({
      title,
      description: cleanText(payload.description, 4000),
      startAt,
      endAt,
      allDay: Boolean(payload.allDay),
      status,
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      attendees: JSON.stringify(attendeeList(payload.attendees)),
      location: cleanText(payload.location, 300),
      relatedType,
      relatedId,
      notes: cleanText(payload.notes, 4000),
      updatedAt: now,
    })
    .where(and(eq(activities.id, id), isNull(activities.archivedAt)))
    .returning();
  if (!activity) {
    return Response.json(
      { error: "Schedule entry no encontrada." },
      { status: 404 },
    );
  }
  await Promise.all([
    writeAudit(auth.user.email, "update", "activity", id, title),
    upsertSearchDocument({
      entityType: "activity",
      entityId: id,
      title,
      subtitle: `${startAt} ${activity.location}`.trim(),
      searchText: `${title} ${activity.description} ${activity.location} ${activity.notes} ${activity.attendees}`,
      ownerEmail: activity.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ activity });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const now = new Date().toISOString();
  const [activity] = await getDb()
    .update(activities)
    .set({ archivedAt: now, updatedAt: now })
    .where(and(eq(activities.id, id), isNull(activities.archivedAt)))
    .returning();
  if (!activity) {
    return Response.json(
      { error: "Schedule entry no encontrada." },
      { status: 404 },
    );
  }
  await Promise.all([
    writeAudit(
      auth.user.email,
      "archive",
      "activity",
      id,
      activity.title,
    ),
    deleteSearchDocument("activity", id),
  ]);
  return Response.json({ ok: true });
}
