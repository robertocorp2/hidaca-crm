import { asc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { auditLog, rolePermissions, staffUsers, userPermissionOverrides } from "../../../../db/schema";
import { authorizeApi } from "../../../lib/authorization";

export async function GET() {
  const auth = await authorizeApi({ module: "usuarios", action: "administer" });
  if (!auth.ok) return auth.response;
  const db = getDb();
  const [users, defaults, overrides, audit] = await Promise.all([
    db.select().from(staffUsers).orderBy(asc(staffUsers.id)),
    db.select().from(rolePermissions),
    db.select().from(userPermissionOverrides),
    db.select().from(auditLog).orderBy(asc(auditLog.id)),
  ]);
  const exportedAt = new Date().toISOString();
  return Response.json(
    { exportedAt, staff_users: users, role_permissions: defaults, user_permission_overrides: overrides, audit_log: audit },
    { headers: {
      "cache-control": "private, no-store",
      "content-disposition": `attachment; filename="hidaca-security-${exportedAt.slice(0, 10)}.json"`,
    } },
  );
}
