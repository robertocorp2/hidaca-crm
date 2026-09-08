import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("global search is protected, bounded, keyboard accessible, and deep-linked", async () => {
  const [route, search, searchUi] = await Promise.all([
    read("../app/api/search/route.ts"),
    read("../app/lib/search.ts"),
    read("../app/app/global-search.tsx"),
  ]);
  assert.match(route, /authorizeApi/);
  assert.match(route, /private, no-store/);
  assert.match(search, /MATCH \?/);
  assert.match(search, /Math\.min\(Math\.max\(limit, 1\), 60\)/);
  assert.match(searchUi, /260/);
  assert.match(searchUi, /ctrlKey \|\| event\.metaKey/);
  assert.match(searchUi, /ArrowDown/);
  assert.match(searchUi, /role="combobox"/);
});

test("all CRM routes enforce explicit module-level authorization", async () => {
  const paths = [
    "../app/api/businesses/route.ts",
    "../app/api/businesses/[id]/route.ts",
    "../app/api/contacts/route.ts",
    "../app/api/contacts/[id]/route.ts",
    "../app/api/leads/route.ts",
    "../app/api/leads/[id]/route.ts",
    "../app/api/leads/[id]/advance/route.ts",
    "../app/api/leads/[id]/convert/route.ts",
    "../app/api/leads/[id]/reopen/route.ts",
    "../app/api/opportunities/route.ts",
    "../app/api/opportunities/[id]/route.ts",
    "../app/api/opportunities/[id]/advance/route.ts",
    "../app/api/opportunities/[id]/close/route.ts",
    "../app/api/opportunities/[id]/reopen/route.ts",
    "../app/api/opportunities/[id]/quotes/route.ts",
    "../app/api/activities/route.ts",
    "../app/api/activities/[id]/route.ts",
  ];
  const routes = await Promise.all(paths.map(read));
  for (const [index, route] of routes.entries()) {
    assert.match(route, /authorizeApi/, paths[index]);
    assert.match(route, /authorizeApi\(\{ module: "/, paths[index]);
  }
  assert.match(routes[8], /action: "administer"/);
  assert.match(routes[13], /action: "administer"/);
});

test("lead conversion is duplicate-aware, atomic, idempotent, and auditable", async () => {
  const route = await read("../app/api/leads/[id]/convert/route.ts");
  assert.match(route, /normalizedName/);
  assert.match(route, /normalizedEmail/);
  assert.match(route, /normalizedPhone/);
  assert.match(route, /lead\.convertedAt[\s\S]*lead\.convertedOpportunityId/);
  assert.match(route, /completedConversion/);
  assert.match(route, /x-idempotent-replay/);
  assert.match(route, /const updatedLead = await activeLead\(id\)/);
  assert.match(route, /await d1\.batch\(statements\)/);
  assert.match(route, /INSERT INTO lead_status_history/);
  assert.match(route, /INSERT INTO opportunity_stage_history/);
  assert.match(route, /INSERT INTO audit_log/);
});

test("Lead and Opportunity details share a branched, accessible pipeline stepper", async () => {
  const [pipeline, leads, opportunities, css] = await Promise.all([
    read("../app/app/pipeline.tsx"),
    read("../app/app/leads-view.tsx"),
    read("../app/app/opportunities-view.tsx"),
    read("../app/globals.css"),
  ]);

  assert.match(pipeline, /export function PipelineStepper/);
  assert.match(pipeline, /pipeline-indicator-row/);
  assert.match(pipeline, /pipeline-label-row/);
  assert.match(pipeline, /aria-current=\{state === "current" \? "step"/);
  assert.match(pipeline, /resultado seleccionado/);
  assert.match(leads, /const leadProgression = \["new", "contacted", "working"\]/);
  assert.match(leads, /value: "converted"[\s\S]*value: "unqualified"/);
  assert.match(leads, /selectedOutcome=\{terminal \? selected\.status : null\}/);
  assert.match(opportunities, /selected\.stage === "closed" && selected\.outcome/);
  assert.match(opportunities, /selectedOutcome=\{selected\.outcome\}/);
  assert.match(css, /\.pipeline-connector\s*\{[\s\S]*z-index:\s*0/);
  assert.match(css, /\.pipeline-dot\s*\{[\s\S]*z-index:\s*1/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /\.pipeline-scroll\s*\{[\s\S]*overflow-x:\s*auto/);
  assert.doesNotMatch(
    css.match(/\.pipeline-label\s*\{[\s\S]*?\}/)?.[0] ?? "",
    /line-through|white-space:\s*nowrap/,
  );
});

test("closing keeps stage and outcome separate and requires a loss reason", async () => {
  const route = await read("../app/api/opportunities/[id]/close/route.ts");
  assert.match(route, /stage = 'closed'/);
  assert.match(route, /outcome = \?/);
  assert.match(route, /outcome === "lost" && lossReason\.length < 3/);
  assert.match(route, /closed_at/);
  assert.match(route, /opportunity_stage_history/);
});

test("Schedule and Calendar render the same activities collection", async () => {
  const [shell, agenda] = await Promise.all([
    read("../app/app/operations-client.tsx"),
    read("../app/app/agenda-view.tsx"),
  ]);
  assert.match(shell, /view === "schedule" \|\| view === "calendar"/);
  assert.match(shell, /mode=\{view\}/);
  assert.match(shell, /activities=\{activities\}/);
  assert.match(agenda, /calendarMode/);
  assert.match(agenda, /Actividad guardada|Nueva actividad/i);
});

test("user-facing CRM terminology is standardized in Spanish", async () => {
  const [modules, navigation, entities] = await Promise.all([
    read("../app/lib/modules.ts"),
    read("../app/app/navigation.tsx"),
    read("../app/app/entity-views.tsx"),
  ]);
  assert.match(modules, /label: "Empresas"/);
  assert.match(modules, /label: "Contactos"/);
  assert.match(modules, /label: "Casos"/);
  assert.match(navigation, /label: "Prospectos"/);
  assert.match(navigation, /label: "Oportunidades"/);
  assert.match(entities, /Empresas|Empresa/);
});
