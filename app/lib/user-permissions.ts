import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { staffUsers } from "../../db/schema";
import {
  isPermissionModuleKey,
  permissionActions,
  permissionModules,
  rolePermissionDefaults,
  type PermissionAction,
  type PermissionEffect,
  type PermissionModuleKey,
  type StaffRole,
} from "./modules";
import { permissionsForStaffUser, type PermissionOverride } from "./authorization";

export const staffRoles = new Set<StaffRole>(["admin", "operator", "viewer"]);

export function validateOverrides(value: unknown): PermissionOverride[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const parsed: PermissionOverride[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const candidate = item as Record<string, unknown>;
    const moduleKey = String(candidate.module ?? "") as PermissionModuleKey;
    const action = String(candidate.action ?? "") as PermissionAction;
    const effect = String(candidate.effect ?? "") as PermissionEffect;
    const key = `${moduleKey}:${action}`;
    const catalogItem = permissionModules.find((entry) => entry.key === moduleKey);
    if (!isPermissionModuleKey(moduleKey) || !permissionActions.includes(action) ||
        !catalogItem?.actions.includes(action as never) ||
        !["allow", "deny"].includes(effect) || seen.has(key)) return null;
    seen.add(key);
    parsed.push({ module: moduleKey, action, effect });
  }
  return parsed;
}

export function permissionCatalog() {
  return {
    modules: permissionModules,
    actions: permissionActions,
    roleDefaults: rolePermissionDefaults,
  };
}

export async function activeEffectiveAdministrators(excludingId?: number) {
  const admins = await getDb().select().from(staffUsers)
    .where(and(eq(staffUsers.role, "admin"), eq(staffUsers.active, true)));
  const capable = [];
  for (const admin of admins) {
    if (admin.id === excludingId) continue;
    const { permissions } = await permissionsForStaffUser(admin);
    if (permissions.usuarios.administer) capable.push(admin);
  }
  return capable;
}
