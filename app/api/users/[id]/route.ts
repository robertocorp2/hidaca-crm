import { eq } from "drizzle-orm";
import { getD1, getDb } from "../../../../db";
import { staffUsers } from "../../../../db/schema";
import { authorizeApi, can, permissionsForStaffUser, resolvePermissionMatrix } from "../../../lib/authorization";
import { activeEffectiveAdministrators, staffRoles, validateOverrides } from "../../../lib/user-permissions";
import type { StaffRole } from "../../../lib/modules";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "usuarios", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const numericId = Number(id);
  const payload = (await request.json()) as { name?: unknown; email?: unknown; role?: unknown; active?: unknown; overrides?: unknown };
  if (!Number.isInteger(numericId)) return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  const [target] = await getDb().select().from(staffUsers).where(eq(staffUsers.id, numericId)).limit(1);
  if (!target) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
  const hasName = payload.name !== undefined;
  const hasEmail = payload.email !== undefined;
  const hasRole = payload.role !== undefined;
  const hasActive = payload.active !== undefined;
  const hasOverrides = payload.overrides !== undefined;
  const overrides = hasOverrides ? validateOverrides(payload.overrides) : null;
  const name = String(payload.name ?? target.name).trim();
  const email = String(payload.email ?? target.email).trim().toLowerCase();
  const role = String(payload.role ?? target.role) as StaffRole;
  const active = hasActive ? payload.active === true : target.active;
  if ((!hasName && !hasEmail && !hasRole && !hasActive && !hasOverrides) || !name ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !staffRoles.has(role) ||
      (hasActive && typeof payload.active !== "boolean") || (hasOverrides && !overrides)) {
    return Response.json({ error: "Los datos enviados no son válidos." }, { status: 400 });
  }
  if (hasOverrides && !can(auth.user, "usuarios", "administer")) {
    return Response.json({ error: "No tienes permiso para personalizar permisos." }, { status: 403 });
  }
  if (numericId === auth.user.staffUserId && (hasEmail || hasRole || hasActive || hasOverrides)) {
    return Response.json({ error: "No puedes cambiar tu propio correo, rol, estado o permisos." }, { status: 400 });
  }
  const removesAdmin = target.active && target.role === "admin" && (!active || role !== "admin");
  const removesAdministration = target.active && target.role === "admin" && hasOverrides &&
    !resolvePermissionMatrix(role, [], overrides!).usuarios.administer;
  if ((removesAdmin || removesAdministration) && (await activeEffectiveAdministrators(numericId)).length === 0) {
    return Response.json({ error: "Debe permanecer al menos un administrador activo con capacidad de administrar Usuarios." }, { status: 400 });
  }
  try {
    const now = new Date().toISOString();
    const d1 = getD1();
    await d1.batch([
      d1.prepare("UPDATE staff_users SET name = ?, email = ?, role = ?, active = ?, updated_at = ? WHERE id = ?")
        .bind(name, email, role, active ? 1 : 0, now, numericId),
      ...(hasOverrides ? [
        d1.prepare("DELETE FROM user_permission_overrides WHERE user_id = ?").bind(numericId),
        ...overrides!.map((item) => d1.prepare("INSERT INTO user_permission_overrides (user_id, module, action, effect) VALUES (?, ?, ?, ?)")
          .bind(numericId, item.module, item.action, item.effect)),
      ] : []),
      d1.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) VALUES (?, 'update', 'user', ?, ?, ?)")
        .bind(auth.user.email, id, JSON.stringify({ before: target, after: { name, email, role, active }, permissionOverrides: hasOverrides ? overrides : undefined }), now),
    ]);
    const [user] = await getDb().select().from(staffUsers).where(eq(staffUsers.id, numericId)).limit(1);
    return Response.json({ user, ...(await permissionsForStaffUser(user)) });
  } catch {
    return Response.json({ error: "No se pudo guardar. Verifica que el correo no esté autorizado." }, { status: 409 });
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "usuarios", action: "delete" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const numericId = Number(id);
  const [target] = await getDb().select().from(staffUsers).where(eq(staffUsers.id, numericId)).limit(1);
  if (!target) return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
  if (numericId === auth.user.staffUserId) return Response.json({ error: "No puedes eliminar tu propio acceso." }, { status: 400 });
  if (target.active && target.role === "admin" && (await activeEffectiveAdministrators(numericId)).length === 0) {
    return Response.json({ error: "Debe permanecer al menos un administrador activo con capacidad de administrar Usuarios." }, { status: 400 });
  }
  const d1 = getD1();
  const now = new Date().toISOString();
  await d1.batch([
    d1.prepare("DELETE FROM staff_users WHERE id = ?").bind(numericId),
    d1.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) VALUES (?, 'delete', 'user', ?, ?, ?)")
      .bind(auth.user.email, id, JSON.stringify({ email: target.email, role: target.role }), now),
  ]);
  return new Response(null, { status: 204 });
}
