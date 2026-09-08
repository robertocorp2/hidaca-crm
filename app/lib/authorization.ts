import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { rolePermissions, staffUsers, userPermissionOverrides } from "../../db/schema";
import {
  isPermissionModuleKey, permissionActions, type EffectivePermissions,
  resolveEffectivePermissions,
  type PermissionAction, type PermissionEffect, type PermissionModuleKey,
  type StaffRole,
} from "./modules";
import { getChatGPTUser, requireChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";

export type PermissionOverride = { module: PermissionModuleKey; action: PermissionAction; effect: PermissionEffect };
export type AuthorizedUser = ChatGPTUser & {
  staffUserId: number;
  role: StaffRole;
  permissions: EffectivePermissions;
};
export type AuthorizationRequirement = { module: PermissionModuleKey; action: PermissionAction };

const INITIAL_OWNER_EMAIL = "robertocorp2@gmail.com";
const normalizedEmail = (email: string) => email.trim().toLowerCase();

export function resolvePermissionMatrix(
  role: StaffRole,
  defaults: Array<{ module: string; action: string; allowed: boolean }> = [],
  overrides: Array<{ module: string; action: string; effect: string }> = [],
): EffectivePermissions {
  return resolveEffectivePermissions(role, defaults, overrides);
}

export async function permissionsForStaffUser(user: { id: number; role: StaffRole }) {
  const db = getDb();
  const [defaults, rawOverrides] = await Promise.all([
    db.select().from(rolePermissions).where(eq(rolePermissions.role, user.role)),
    db.select().from(userPermissionOverrides).where(eq(userPermissionOverrides.userId, user.id)),
  ]);
  const overrides = rawOverrides.filter(
    (item): item is typeof item & PermissionOverride =>
      isPermissionModuleKey(item.module) && permissionActions.includes(item.action) &&
      (item.effect === "allow" || item.effect === "deny"),
  );
  return { permissions: resolvePermissionMatrix(user.role, defaults, overrides), overrides };
}

async function resolveAuthorizedUser(user: ChatGPTUser): Promise<AuthorizedUser | null> {
  const db = getDb();
  const email = normalizedEmail(user.email);
  const now = new Date().toISOString();
  if (email === INITIAL_OWNER_EMAIL) {
    await db.insert(staffUsers).values({
      email, name: user.fullName ?? user.displayName, role: "admin", active: true,
      createdAt: now, updatedAt: now,
    }).onConflictDoNothing({ target: staffUsers.email });
  }
  const [staff] = await db.select().from(staffUsers)
    .where(and(eq(staffUsers.email, email), eq(staffUsers.active, true))).limit(1);
  if (!staff) return null;
  const { permissions } = await permissionsForStaffUser(staff);
  return { ...user, email, staffUserId: staff.id, role: staff.role, permissions };
}

export function can(
  user: Pick<AuthorizedUser, "role" | "permissions">,
  module: PermissionModuleKey,
  action: PermissionAction,
) {
  if (module === "usuarios" && user.role !== "admin") return false;
  if (action !== "view" && !user.permissions[module].view) return false;
  return user.permissions[module][action] === true;
}

export async function getAuthorizedUser() {
  const user = await getChatGPTUser();
  return user ? resolveAuthorizedUser(user) : null;
}

export async function requireAuthorizedUser(returnTo: string): Promise<AuthorizedUser> {
  const user = await requireChatGPTUser(returnTo);
  const authorized = await resolveAuthorizedUser(user);
  if (!authorized) throw new Error("HIDACA_ACCESS_DENIED");
  return authorized;
}

export async function authorizeApi(requirement?: AuthorizationRequirement | boolean): Promise<
  { ok: true; user: AuthorizedUser } | { ok: false; response: Response }
> {
  const user = await getChatGPTUser();
  if (!user) return { ok: false, response: Response.json({ error: "Debes iniciar sesión con ChatGPT." }, { status: 401 }) };
  const authorized = await resolveAuthorizedUser(user);
  if (!authorized) return { ok: false, response: Response.json({ error: "Tu cuenta no está autorizada para HIDACA." }, { status: 403 }) };
  const denied = requirement === true
    ? authorized.role !== "admin"
    : Boolean(requirement && !can(authorized, requirement.module, requirement.action));
  if (denied) return { ok: false, response: Response.json({ error: "No tienes permiso para realizar esta acción." }, { status: 403 }) };
  return { ok: true, user: authorized };
}
