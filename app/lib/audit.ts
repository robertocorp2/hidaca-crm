import { getDb } from "../../db";
import { auditLog } from "../../db/schema";

export async function writeAudit(
  actorEmail: string,
  action: string,
  entityType: string,
  entityId: string,
  detail = "",
) {
  await getDb().insert(auditLog).values({
    actorEmail,
    action,
    entityType,
    entityId,
    detail,
    createdAt: new Date().toISOString(),
  });
}
