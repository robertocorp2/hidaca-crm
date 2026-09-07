import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("implements a private Spanish ChatGPT sign-in entry", async () => {
  const [page, layout, auth] = await Promise.all([
    read("../app/page.tsx"),
    read("../app/layout.tsx"),
    read("../app/chatgpt-auth.ts"),
  ]);
  assert.match(layout, /<html lang="es">/i);
  assert.match(layout, /index:\s*false/);
  assert.match(page, /Iniciar sesión con ChatGPT/i);
  assert.match(page, /Los datos no están disponibles públicamente/i);
  assert.match(auth, /oai-authenticated-user-email/);
  assert.match(auth, /safeRelativeReturnPath/);
});

test("enforces ChatGPT identity plus a server-side D1 allowlist", async () => {
  const [authorization, protectedPage] = await Promise.all([
    read("../app/lib/authorization.ts"),
    read("../app/app/page.tsx"),
  ]);
  assert.match(authorization, /getChatGPTUser/);
  assert.match(authorization, /staffUsers/);
  assert.match(authorization, /eq\(staffUsers\.active, true\)/);
  assert.match(authorization, /adminOnly/);
  assert.match(protectedPage, /getAuthorizedUser/);
  assert.match(protectedPage, /Cuenta no autorizada/i);
});

test("protects mutating APIs and preserves viewer read-only access", async () => {
  const routes = await Promise.all([
    read("../app/api/records/route.ts"),
    read("../app/api/records/[id]/route.ts"),
    read("../app/api/documents/route.ts"),
    read("../app/api/documents/[id]/route.ts"),
    read("../app/api/users/route.ts"),
  ]);
  for (const route of routes) assert.match(route, /authorizeApi/);
  assert.match(routes[0], /role === "viewer"/);
  assert.match(routes[1], /archivedAt/);
  assert.match(routes[2], /maxSize = 10 \* 1024 \* 1024/);
  assert.match(routes[3], /cache-control.*private, no-store/s);
  assert.match(routes[4], /authorizeApi\(true\)/);

  const [operationsClient, ui] = await Promise.all([
    read("../app/app/operations-client.tsx"),
    read("../app/app/ui.tsx"),
  ]);
  assert.match(operationsClient, /role="alertdialog"/);
  assert.match(ui, /timeZone: withTime \? undefined : "UTC"/);
  assert.doesNotMatch(operationsClient, /window\.confirm/);
});

test("includes the D1 schema, migration, R2 binding, and all requested modules", async () => {
  const [schema, migration, hosting, moduleSource] = await Promise.all([
    read("../db/schema.ts"),
    read("../drizzle/0000_sour_fat_cobra.sql"),
    read("../.openai/hosting.json"),
    read("../app/lib/modules.ts"),
  ]);
  for (const table of [
    "staff_users",
    "business_records",
    "documents",
    "audit_log",
  ]) {
    assert.match(schema, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  for (const moduleKey of [
    "clientes",
    "contactos",
    "proyectos",
    "cotizaciones",
    "facturas",
    "pagos",
    "ordenes-cambio",
    "tareas",
    "hitos",
    "reportes-diarios",
    "equipos",
    "personal",
    "suplidores",
  ]) {
    assert.match(moduleSource, new RegExp(`"${moduleKey}"`));
  }
  const hostingConfig = JSON.parse(hosting);
  assert.equal(hostingConfig.d1, "DB");
  assert.equal(hostingConfig.r2, "FILES");
  assert.match(hostingConfig.project_id, /^appgprj_/);
});
