import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("dashboard shell and KPI grid encode the required responsive safeguards", async () => {
  const [css, shell] = await Promise.all([
    read("../app/globals.css"),
    read("../app/app/operations-client.tsx"),
  ]);

  assert.match(css, /grid-template-columns:\s*240px minmax\(0,\s*1fr\)/);
  assert.match(css, /\.app-main\s*\{[\s\S]*min-width:\s*0/);
  assert.match(css, /\.workspace\s*\{[\s\S]*max-width:\s*1500px/);
  assert.match(css, /overflow-x:\s*clip/);
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(
    css,
    /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/,
  );
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.metric-card-currency strong/);
  assert.match(css, /font-size:\s*clamp\(/);
  assert.match(css, /\.metric-grid > \.metric-card-currency strong\s*\{[\s\S]*white-space:\s*nowrap/);
  assert.match(shell, /className="metric-card metric-card-currency"/);
});

test("business and contact labels remain Spanish without changing internal identifiers", async () => {
  const [entityViews, workspace] = await Promise.all([
    read("../app/app/entity-views.tsx"),
    read("../app/app/record-workspace.tsx"),
  ]);
  const source = `${entityViews}\n${workspace}`;

  for (const label of [
    "Nueva empresa",
    "Nuevo contacto",
    "Editar empresa",
    "Editar contacto",
    "Acerca de",
    "Empresa",
    "Contacto",
    "Correo",
    "Teléfono",
    "Celular",
    "Dirección",
    "Cargo",
    "Notas",
  ]) {
    assert.match(
      source,
      new RegExp(`>\\s*${label}\\s*<|\"${label}\"`),
    );
  }

  for (const visibleEnglishLabel of [
    "Nuevo Business",
    "Nuevo Contact",
    "Editar Business",
    "Editar Contact",
    "Job Title",
    "Mobile Phone",
    ">Phone<",
    ">Notes<",
  ]) {
    assert.doesNotMatch(source, new RegExp(visibleEnglishLabel));
  }
});

test("navigation, profile, pipeline, and activities expose accessible Spanish UI", async () => {
  const [css, shell, navigation, crm] = await Promise.all([
    read("../app/globals.css"),
    read("../app/app/operations-client.tsx"),
    read("../app/app/navigation.tsx"),
    read("../app/lib/crm.ts"),
  ]);

  for (const label of [
    "Empresas",
    "Prospectos",
    "Oportunidades",
    "Actividades",
    "Calendario",
  ]) {
    assert.match(navigation, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /aria-haspopup="menu"/);
  assert.match(shell, /role="menuitem"/);
  assert.match(shell, /Cerrar sesión/);
  assert.match(shell, /Ver pipeline/);
  assert.match(shell, /Ver calendario/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /document\.body\.style\.overflow = "hidden"/);
  assert.match(css, /\.snapshot-row:focus-visible/);
  assert.match(crm, /new:\s*"Nuevo"/);
  assert.match(crm, /converted:\s*"Convertido"/);
  assert.match(crm, /negotiation_review:\s*"Negociación \/ revisión"/);
});

test("record detail workspace preserves relationship and permission surfaces", async () => {
  const [workspace, businessApi, contactApi] = await Promise.all([
    read("../app/app/record-workspace.tsx"),
    read("../app/api/businesses/[id]/route.ts"),
    read("../app/api/contacts/[id]/route.ts"),
  ]);
  for (const marker of [
    "record-workspace",
    "record-summary-panel",
    "record-center-panel",
    "record-related-panel",
    "role=\"tablist\"",
    "aria-selected",
    "related-count",
    "onArchived",
    "Eliminar",
    'label: "Proyectos"',
    'label: "Oportunidades"',
    'label: "Cotizaciones"',
    'label: "Facturas"',
    'label: "Casos"',
    'title="Actividades"',
    'title="Historial"',
    'key: "business"',
    'view: "businesses"',
  ]) {
    assert.match(workspace, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  for (const relation of ["invoices", "cases", "history"]) {
    assert.match(businessApi, new RegExp(relation));
    assert.match(contactApi, new RegExp(relation));
  }
});
