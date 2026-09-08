import { and, asc, gte, isNull, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { activities } from "../../../db/schema";
import { authorizeApi } from "../../lib/authorization";
import { createActivityRecord, validateActivityInput } from "../../lib/activity-service";
import { optionalIsoDate } from "../../lib/crm";

export async function GET(request: Request) {
  const auth = await authorizeApi({ module: "agenda", action: "view" });
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
  const auth = await authorizeApi({ module: "agenda", action: "create" });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const validated = await validateActivityInput(payload, auth.user.email);
  if (!validated.ok) {
    return Response.json({ error: validated.error }, { status: 400 });
  }
  const { activity } = await createActivityRecord({
    actorEmail: auth.user.email,
    input: validated.value,
  });
  return Response.json({ activity }, { status: 201 });
}
