import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("..", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

test("all requested creation surfaces use the shared modal", async () => {
  const files = {
    businesses: "app/app/entity-views.tsx",
    contacts: "app/app/entity-views.tsx",
    projects: "app/app/projects-view.tsx",
    leads: "app/app/leads-view.tsx",
    opportunities: "app/app/opportunities-view.tsx",
    agenda: "app/app/agenda-view.tsx",
    casesAndCotizaciones: "app/app/operations-client.tsx",
  };

  const contents = new Map();
  for (const [name, path] of Object.entries(files)) {
    contents.set(name, await source(path));
  }

  assert.match(contents.get("businesses"), /title=\{editing \? "Editar empresa" : "Nueva empresa"\}[\s\S]*<BusinessForm/);
  assert.match(contents.get("contacts"), /title=\{editing \? "Editar contacto" : "Nuevo contacto"\}[\s\S]*<ContactForm/);
  assert.match(contents.get("projects"), /title=\{editing \? "Editar proyecto" : "Nuevo proyecto"\}[\s\S]*<ProjectForm/);
  assert.match(contents.get("leads"), /title=\{editing \? "Editar prospecto" : "Nuevo prospecto"\}[\s\S]*<LeadForm/);
  assert.match(contents.get("opportunities"), /title=\{editing \? "Editar oportunidad" : "Nueva oportunidad"\}[\s\S]*<OpportunityForm/);
  assert.match(contents.get("agenda"), /title=\{editing \? "Editar actividad" : "Nueva actividad"\}[\s\S]*<ActivityForm/);
  assert.match(contents.get("casesAndCotizaciones"), /title=\{editing \? "Editar registro" : "Nuevo registro"\}[\s\S]*<RecordForm/);
});

test("modal forms do not retain a second inline form heading", async () => {
  const files = [
    "app/app/entity-views.tsx",
    "app/app/projects-view.tsx",
    "app/app/leads-view.tsx",
    "app/app/opportunities-view.tsx",
    "app/app/agenda-view.tsx",
    "app/app/operations-client.tsx",
  ];

  for (const file of files) {
    const content = await source(file);
    assert.doesNotMatch(content, /<form[^>]+className="record-form"[\s\S]*?<div className="form-heading">/);
  }
});

test("modal layout preserves viewport scrolling and Cotizaciones page flow", async () => {
  const css = await source("app/globals.css");
  assert.match(css, /\.modal-backdrop[\s\S]*?position: fixed;/);
  assert.match(css, /\.modal-dialog[\s\S]*?max-height: calc\(100vh - 48px\);/);
  assert.match(css, /\.modal-dialog[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.workspace[\s\S]*?padding-top: clamp\(40px, 4vw, 56px\);/);
  assert.match(css, /\.replacement-panel[\s\S]*?position: relative;/);
});
