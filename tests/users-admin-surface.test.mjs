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
