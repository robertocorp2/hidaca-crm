import { eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../../db";
import { staffUsers } from "../../../../../db/schema";
import { authorizeApi, persistedDefaultsForRole, permissionsForStaffUser, resolvePermissionMatrix } from "../../../../lib/authorization";
import { activeCapableAdministratorSql, activeEffectiveAdministrators, permissionCatalog, validateOverrides } from "../../../../lib/user-permissions";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "usuarios", action: "view" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const [user] = await getDb().select().from(staffUsers).where(eq(staffUsers.id, Number(id))).limit(1);
  if (!user) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
  const resolved = await permissionsForStaffUser(user);
  return Response.json({ user, ...(await permissionCatalog()), ...resolved });
}

export async function PUT(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "usuarios", action: "administer" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const numericId = Number(id);
  const [target] = await getDb().select().from(staffUsers).where(eq(staffUsers.id, numericId)).limit(1);
  if (!target) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
  if (numericId === auth.user.staffUserId) return Response.json({ error: "No puedes cambiar tus propios permisos." }, { status: 400 });
  const payload = (await request.json()) as { overrides?: unknown };
  const overrides = validateOverrides(payload.overrides);
  if (!overrides) return Response.json({ error: "Los permisos enviados no son válidos." }, { status: 400 });
  if (target.active && target.role === "admin" &&
      !resolvePermissionMatrix(target.role, await persistedDefaultsForRole(target.role), overrides).usuarios.administer &&
      (await activeEffectiveAdministrators(numericId)).length === 0) {
    return Response.json({ error: "Debe permanecer al menos un administrador activo con capacidad de administrar Usuarios." }, { status: 400 });
  }
  const d1 = getD1();
  const now = new Date().toISOString();
  const guardToken = `${now}:${crypto.randomUUID()}`;
  const protectsLastAdmin = target.active && target.role === "admin" &&
    !resolvePermissionMatrix(target.role, await persistedDefaultsForRole(target.role), overrides).usuarios.administer;
  const adminGuard = protectsLastAdmin ? ` AND ${activeCapableAdministratorSql()}` : "";
  const results = await d1.batch([
    d1.prepare(`UPDATE staff_users SET updated_at = ? WHERE id = ?${adminGuard}`).bind(guardToken, numericId, ...(protectsLastAdmin ? [numericId] : [])),
    d1.prepare("DELETE FROM user_permission_overrides WHERE user_id = ? AND EXISTS (SELECT 1 FROM staff_users WHERE id = ? AND updated_at = ?)").bind(numericId, numericId, guardToken),
    ...overrides.map((item) => d1.prepare(
      "INSERT INTO user_permission_overrides (user_id, module, action, effect) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM staff_users WHERE id = ? AND updated_at = ?)",
    ).bind(numericId, item.module, item.action, item.effect, numericId, guardToken)),
    d1.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) SELECT ?, 'change_permissions', 'user', ?, ?, ? WHERE EXISTS (SELECT 1 FROM staff_users WHERE id = ? AND updated_at = ?)")
      .bind(auth.user.email, id, JSON.stringify(overrides), now, numericId, guardToken),
    d1.prepare("UPDATE staff_users SET updated_at = ? WHERE id = ? AND updated_at = ?").bind(now, numericId, guardToken),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    return Response.json({ error: "Debe permanecer al menos un administrador activo con capacidad de administrar Usuarios." }, { status: 400 });
  }
  const resolved = await permissionsForStaffUser(target);
  return Response.json({ overrides, permissions: resolved.permissions, updatedAt: now });
}
