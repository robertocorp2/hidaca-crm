import { getD1 } from "../../db";
import {
  cleanText,
  isActivityStatus,
  isRelatedRecordType,
  optionalIsoDate,
  type RelatedRecordType,
} from "./crm";
import { relatedRecordExists } from "./relations";
import { searchDocumentStatement } from "./search";

export type ActivityInput = {
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  status: "planned" | "completed" | "cancelled";
  ownerEmail: string;
  attendees: string[];
  location: string;
  relatedType: RelatedRecordType | null;
  relatedId: string | null;
  notes: string;
};

export type ActivityRecord = ActivityInput & {
  id: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: null;
};

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

export async function validateActivityInput(
  payload: Record<string, unknown>,
  actorEmail: string,
): Promise<{ ok: true; value: ActivityInput } | { ok: false; error: string }> {
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
    return {
      ok: false,
      error: "Título, fechas válidas y un estado válido son obligatorios.",
    };
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
    return { ok: false, error: "El registro relacionado no es válido." };
  }

  return {
    ok: true,
    value: {
      title,
      description: cleanText(payload.description, 4000),
      startAt,
      endAt,
      allDay: Boolean(payload.allDay),
      status,
      ownerEmail: cleanText(payload.ownerEmail, 180) || actorEmail,
      attendees: attendeeList(payload.attendees),
      location: cleanText(payload.location, 300),
      relatedType,
      relatedId,
      notes: cleanText(payload.notes, 4000),
    },
  };
}

export async function createActivityRecord({
  actorEmail,
  id = crypto.randomUUID(),
  input,
}: {
  actorEmail: string;
  id?: string;
  input: ActivityInput;
}): Promise<{ activity: ActivityRecord; created: boolean }> {
  const now = new Date().toISOString();
  const activity: ActivityRecord = {
    ...input,
    id,
    createdBy: actorEmail,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  const attendees = JSON.stringify(input.attendees);
  const d1 = getD1();
  const results = await d1.batch([
    d1
      .prepare(
        `INSERT OR IGNORE INTO activities (
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
        attendees,
        activity.location,
        activity.relatedType,
        activity.relatedId,
        activity.notes,
        actorEmail,
        now,
        now,
      ),
    d1
      .prepare(
        `INSERT INTO audit_log
          (actor_email, action, entity_type, entity_id, detail, created_at)
         SELECT ?, 'create', 'activity', ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_log
           WHERE action = 'create' AND entity_type = 'activity' AND entity_id = ?
         )`,
      )
      .bind(actorEmail, activity.id, activity.title, now, activity.id),
    searchDocumentStatement({
      entityType: "activity",
      entityId: activity.id,
      title: activity.title,
      subtitle: `${activity.startAt} ${activity.location}`.trim(),
      searchText: `${activity.title} ${activity.description} ${activity.location} ${activity.notes} ${attendees}`,
      ownerEmail: activity.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return {
    activity,
    created: Number(results[0]?.meta?.changes ?? 0) > 0,
  };
}
