import { asc, eq } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import { staffUsers } from "../../../db/schema";
import { authorizeApi, can, permissionsForStaffUser } from "../../lib/authorization";
import { permissionCatalog, staffRoles, validateOverrides } from "../../lib/user-permissions";
import type { StaffRole } from "../../lib/modules";

export async function GET() {
  const auth = await authorizeApi({ module: "usuarios", action: "view" });
  if (!auth.ok) return auth.response;
  const rows = await getDb().select().from(staffUsers).orderBy(asc(staffUsers.name));
  const users = await Promise.all(rows.map(async (user) => ({ ...user, ...(await permissionsForStaffUser(user)) })));
  return Response.json({ users, ...permissionCatalog() });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "usuarios", action: "create" });
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const email = String(payload.email ?? "").trim().toLowerCase();
  const name = String(payload.name ?? "").trim();
  const role = String(payload.role ?? "operator") as StaffRole;
  const active = payload.active === undefined ? true : payload.active === true;
  const overrides = validateOverrides(payload.overrides);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !staffRoles.has(role) || !overrides) {
    return Response.json({ error: "Nombre, correo, rol y permisos válidos son obligatorios." }, { status: 400 });
  }
  if (overrides.length && !can(auth.user, "usuarios", "administer")) {
    return Response.json({ error: "No tienes permiso para personalizar permisos." }, { status: 403 });
  }
  const [existing] = await getDb().select({ id: staffUsers.id }).from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  if (existing) return Response.json({ error: "Ese correo ya está autorizado." }, { status: 409 });
  const d1 = getD1();
  const now = new Date().toISOString();
  await d1.batch([
    d1.prepare("INSERT INTO staff_users (email, name, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(email, name, role, active ? 1 : 0, now, now),
    ...overrides.map((item) => d1.prepare(
      "INSERT INTO user_permission_overrides (user_id, module, action, effect) SELECT id, ?, ?, ? FROM staff_users WHERE email = ?",
    ).bind(item.module, item.action, item.effect, email)),
    d1.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) VALUES (?, 'authorize', 'user', ?, ?, ?)")
      .bind(auth.user.email, email, JSON.stringify({ name, role, active, overrides }), now),
  ]);
  const [user] = await getDb().select().from(staffUsers).where(eq(staffUsers.email, email)).limit(1);
  const resolved = await permissionsForStaffUser(user);
  return Response.json({ user, ...resolved }, { status: 201 });
}
