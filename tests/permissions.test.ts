import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  permissionModules,
  resolveEffectivePermissions,
} from "../app/lib/modules.js";

test("role defaults grant admin, operator and read-only access as designed", () => {
  const admin = resolveEffectivePermissions("admin");
  const operator = resolveEffectivePermissions("operator");
  const viewer = resolveEffectivePermissions("viewer");
  assert.equal(admin.usuarios.administer, true);
  assert.equal(operator.facturas.create, true);
  assert.equal(operator.usuarios.view, false);
  assert.equal(operator.importaciones.administer, false);
  assert.equal(viewer.facturas.view, true);
  assert.equal(viewer.facturas.edit, false);
  assert.equal(admin.ai.approve, true);
  assert.equal(operator.ai.approve, false);
  assert.equal(viewer.ai.approve, false);
});

test("explicit overrides beat inheritance and writes require view", () => {
  const denied = resolveEffectivePermissions("operator", [], [
    { module: "equipos", action: "view", effect: "deny" },
    { module: "equipos", action: "edit", effect: "allow" },
  ]);
  assert.equal(denied.equipos.view, false);
  assert.equal(denied.equipos.edit, false);
  const allowed = resolveEffectivePermissions("viewer", [], [
    { module: "equipos", action: "view", effect: "allow" },
    { module: "equipos", action: "edit", effect: "allow" },
  ]);
  assert.equal(allowed.equipos.edit, true);
});

test("dependencies are enabled transitively without overriding explicit denials", () => {
  const permissions = resolveEffectivePermissions("viewer", [], [
    { module: "proyectos", action: "view", effect: "allow" },
    { module: "clientes", action: "view", effect: "deny" },
    { module: "usuarios", action: "view", effect: "allow" },
  ]);
  assert.equal(permissions.proyectos.view, true);
  assert.equal(permissions.contactos.view, true);
  assert.equal(permissions.clientes.view, false);
  assert.equal(permissions.clientes.edit, false);
  assert.equal(permissions.usuarios.view, false);
});

test("catalog contains every requested module and shared view pairs", () => {
  assert.equal(permissionModules.length, 25);
  assert.deepEqual(permissionModules.find((item) => item.key === "ai")?.actions, ["view", "create", "edit", "approve", "administer"]);
  assert.deepEqual(permissionModules.find((item) => item.key === "whatsapp")?.views, ["whatsapp"]);
  assert.deepEqual(permissionModules.find((item) => item.key === "agenda")?.views, ["schedule", "calendar"]);
  assert.deepEqual(permissionModules.find((item) => item.key === "cotizaciones")?.views, ["cotizaciones", "quotations"]);
  assert.equal(permissionModules.some((item) => String(item.label) === "Configuración"), false);
});

test("0015 is additive and preserves staff_users", async () => {
  const sql = await readFile("drizzle/0015_module_permissions.sql", "utf8");
  assert.match(sql, /CREATE TABLE `role_permissions`/);
  assert.match(sql, /CREATE TABLE `user_permission_overrides`/);
  assert.match(sql, /REFERENCES `staff_users`\(`id`\).*ON DELETE cascade/);
  assert.doesNotMatch(sql, /DROP TABLE [`"]?staff_users/i);
  assert.doesNotMatch(sql, /CREATE TABLE [`"]?staff_users/i);
});
