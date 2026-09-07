import { and, asc, gte, isNull, lte } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { activities } from "../../../db/schema";
import { authorizeApi } from "../../lib/authorization";
import {
  cleanText,
  isActivityStatus,
  isRelatedRecordType,
  optionalIsoDate,
  type RelatedRecordType,
} from "../../lib/crm";
import { relatedRecordExists } from "../../lib/relations";
import { searchDocumentStatement } from "../../lib/search";

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

export async function GET(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const from = optionalIsoDate(url.searchParams.get("from"));
  const to = optionalIsoDate(url.searchParams.get("to"));
  const filters = [isNull(activities.archivedAt)];
  if (from) filters.push(gte(activities.endAt, from));
  if (to) filters.push(lte(activities.startAt, to));
  const rows = await getDb()
    .select()
    .from(activities)
    .where(and(...filters))
    .orderBy(asc(activities.startAt))
    .limit(1000);
  return Response.json({ activities: rows });
}

export async function POST(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
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
  const activity = {
    id: crypto.randomUUID(),
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
    createdBy: auth.user.email,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  const d1 = getD1();
  await d1.batch([
    d1
      .prepare(
        `INSERT INTO activities (
          id, title, description, start_at, end_at, all_day, status,
          owner_email, attendees, location, related_type, related_id, notes,
          created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        activity.id,
        activity.title,
        activity.description,
        activity.startAt,
        activity.endAt,
        activity.allDay ? 1 : 0,
        activity.status,
        activity.ownerEmail,
        activity.attendees,
        activity.location,
        activity.relatedType,
        activity.relatedId,
        activity.notes,
        activity.createdBy,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         VALUES (?, 'create', 'activity', ?, ?, ?)`,
      )
      .bind(auth.user.email, activity.id, title, now),
    searchDocumentStatement({
      entityType: "activity",
      entityId: activity.id,
      title,
      subtitle: `${startAt} ${activity.location}`.trim(),
      searchText: `${title} ${activity.description} ${activity.location} ${activity.notes} ${activity.attendees}`,
      ownerEmail: activity.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ activity }, { status: 201 });
}
