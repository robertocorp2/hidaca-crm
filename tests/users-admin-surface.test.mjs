import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const route = await readFile(new URL("../app/api/users/[id]/route.ts", import.meta.url), "utf8");
const client = await readFile(new URL("../app/app/operations-client.tsx", import.meta.url), "utf8");
const users = await readFile(new URL("../app/app/users-admin-view.tsx", import.meta.url), "utf8");

test("authorized-user API supports role edits and deletion with admin safeguards", () => {
  assert.match(route, /export async function PATCH/);
  assert.match(route, /payload\.role/);
  assert.match(route, /Debe permanecer al menos un administrador activo/);
  assert.match(route, /No puedes cambiar tu propio correo, rol, estado o permisos/);
  assert.match(route, /export async function DELETE/);
  assert.match(route, /No puedes eliminar tu propio acceso/);
  assert.match(route, /INSERT INTO audit_log/);
});

test("authorized-user UI exposes permission editing and confirmed deletion", () => {
  assert.match(client, /UsersAdminView/);
  assert.match(users, /General/);
  assert.match(users, /Permisos/);
  assert.match(users, /method: "DELETE"/);
  assert.match(users, /Eliminar permanentemente el acceso/);
  assert.match(users, /Restablecer rol/);
  assert.match(users, /Permitir todos/);
  assert.match(users, /Solo lectura/);
  assert.match(users, /Quitar todos/);
});

test("authorized-user tabs expose stable keyboard and panel relationships", () => {
  assert.match(users, /aria-label="Secciones de usuario"/);
  assert.match(users, /id="user-tab-general"/);
  assert.match(users, /aria-controls="user-panel-general"/);
  assert.match(users, /id="user-tab-permissions"/);
  assert.match(users, /aria-controls="user-panel-permissions"/);
  assert.match(users, /role="tabpanel"/);
  assert.match(users, /aria-labelledby="user-tab-general"/);
  assert.match(users, /aria-labelledby="user-tab-permissions"/);
  assert.match(users, /hidden=\{tab !== "general"\}/);
  assert.match(users, /hidden=\{tab !== "permissions"\}/);
  assert.match(users, /ArrowRight/);
  assert.match(users, /ArrowLeft/);
  assert.match(users, /event\.key === "Home"/);
  assert.match(users, /event\.key === "End"/);
  assert.match(users, /const navigationKey = \["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"\]\.includes\(event\.key\)/);
  assert.match(users, /if \(!navigationKey\) return;/);
  assert.match(users, /event\.preventDefault\(\);/);
  assert.match(users, /tabButtons\.current\[nextTab\]\?\.focus\(\)/);
  assert.match(users, /aria-selected=\{tab === "general"\}/);
  assert.match(users, /aria-selected=\{tab === "permissions"\}/);
  assert.match(users, /tabIndex=\{tab === "general" \? 0 : -1\}/);
  assert.match(users, /tabIndex=\{tab === "permissions" \? 0 : -1\}/);
  assert.match(users, /type="button">General/);
  assert.match(users, /type="button">Permisos/);
});
