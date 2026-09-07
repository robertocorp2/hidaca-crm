import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("global search and app navigation expose visible keyboard focus and semantic links", async () => {
  const [css, shell, search] = await Promise.all([
    read("../app/globals.css"),
    read("../app/app/operations-client.tsx"),
    read("../app/app/global-search.tsx"),
  ]);

  assert.match(css, /\.global-search-input:focus-within/);
  assert.match(css, /box-shadow:\s*0 0 0 3px/);
  assert.match(css, /\.sidebar nav a \{[\s\S]*text-decoration:\s*none/);
  assert.match(shell, /className="skip-link"/);
  assert.match(shell, /function NavLink/);
  assert.match(shell, /aria-current=\{active \? "page"/);
  assert.match(shell, /href=\{viewHref/);
  assert.match(search, /role="combobox"/);
});

test("mobile navigation is focus-contained, dismissible, and isolates the workspace", async () => {
  const [css, shell] = await Promise.all([
    read("../app/globals.css"),
    read("../app/app/operations-client.tsx"),
  ]);

  assert.match(
    css,
    /\.sidebar-open\s*\{[\s\S]*?left:\s*0;[\s\S]*?visibility:\s*visible;[\s\S]*?\}/,
  );
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /document\.body\.style\.overflow = "hidden"/);
  assert.match(shell, /inert=\{mobileNav\}/);
  assert.match(shell, /aria-hidden=\{mobileNav \? "true"/);
  assert.match(shell, /window\.requestAnimationFrame/);
  assert.match(
    shell,
    /querySelector<HTMLElement>\("a\[href\]"\)/,
  );
  assert.match(shell, /\.focus\(\{ preventScroll: true \}\)/);
});

test("filters, sorting, pagination, and Calendar state are URL-backed", async () => {
  const [ui, entities, leads, opportunities, agenda] = await Promise.all([
    read("../app/app/ui.tsx"),
    read("../app/app/entity-views.tsx"),
    read("../app/app/leads-view.tsx"),
    read("../app/app/opportunities-view.tsx"),
    read("../app/app/agenda-view.tsx"),
  ]);

  assert.match(ui, /export function useUrlState/);
  assert.match(ui, /window\.history\.replaceState/);
  assert.match(ui, /export function usePagination/);
  assert.match(entities, /useUrlState\("q"\)/);
  assert.match(leads, /useUrlState\("status"\)/);
  assert.match(opportunities, /useUrlState\("stage"\)/);
  assert.match(agenda, /useUrlState\("mode", "month"\)/);
  assert.match(agenda, /useUrlState\(\s*"date"/);
});

test("responsive data views, accessible Calendar controls, and mobile day view are present", async () => {
  const [css, entities, leads, opportunities, agenda] = await Promise.all([
    read("../app/globals.css"),
    read("../app/app/entity-views.tsx"),
    read("../app/app/leads-view.tsx"),
    read("../app/app/opportunities-view.tsx"),
    read("../app/app/agenda-view.tsx"),
  ]);

  assert.match(css, /\.responsive-table td::before/);
  assert.match(entities, /className="responsive-table"/);
  assert.match(leads, /className="responsive-table"/);
  assert.match(opportunities, /className="responsive-table"/);
  assert.match(agenda, /aria-pressed=\{calendarMode === "month"\}/);
  assert.match(agenda, /aria-label="Vista del calendario"/);
  assert.match(agenda, /calendar-\$\{calendarMode\}-mode/);
  assert.match(agenda, /matchMedia\("\(max-width: 520px\)"\)/);
  assert.match(agenda, /setCalendarModeValue\("day"\)/);
  assert.match(
    agenda,
    /Intl\.DateTimeFormat\("es-DO", \{ weekday: "short" \}\)/,
  );
});

test("forms provide recovery feedback, browser metadata, and unsaved-change protection", async () => {
  const [ui, entities, leads, opportunities, agenda] = await Promise.all([
    read("../app/app/ui.tsx"),
    read("../app/app/entity-views.tsx"),
    read("../app/app/leads-view.tsx"),
    read("../app/app/opportunities-view.tsx"),
    read("../app/app/agenda-view.tsx"),
  ]);

  assert.match(ui, /export function InlineAlert/);
  assert.match(ui, /export function useFormGuard/);
  assert.match(ui, /beforeunload/);
  assert.match(entities, /autoComplete="organization"/);
  assert.match(entities, /inputMode="tel"/);
  assert.match(leads, /spellCheck=\{false\}/);
  assert.match(opportunities, /<InlineAlert message=\{error\}/);
  assert.match(agenda, /aria-describedby="attendees-hint"/);
});

test("dashboard renders display labels rather than internal CRM status keys", async () => {
  const shell = await read("../app/app/operations-client.tsx");

  assert.match(shell, /leadStatusLabels\[lead\.status\]/);
  assert.match(shell, /opportunityStageLabels\[opportunity\.stage\]/);
  assert.match(shell, /activityStatusLabels\[activity\.status\]/);
  assert.doesNotMatch(shell, />\{opportunity\.stage\}</);
});
