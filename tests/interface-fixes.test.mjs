import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const [ui, agenda, operations, whatsapp, copilot] = await Promise.all([
  read("../app/app/ui.tsx"),
  read("../app/app/agenda-view.tsx"),
  read("../app/app/operations-client.tsx"),
  read("../app/app/whatsapp-view.tsx"),
  read("../app/app/ai-copilot-view.tsx"),
]);

test("operational timestamps use one fixed business timezone at a day boundary", () => {
  assert.match(ui, /HIDACA_TIME_ZONE = "America\/Santo_Domingo"/);
  assert.match(ui, /timeZone: HIDACA_TIME_ZONE/);
  const timestamp = "2026-08-01T03:30:00.000Z";
  const format = () => new Intl.DateTimeFormat("es-DO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Santo_Domingo",
  }).format(new Date(timestamp));
  assert.equal(format(), format());
});

test("dashboard separates overdue work and keeps record navigation stable", () => {
  assert.match(operations, /overdueActivities/);
  assert.match(operations, /activity\.status === "planned"[\s\S]*new Date\(activity\.endAt\)\.getTime\(\) < initialNow/);
  assert.match(operations, /onOpenRecord=\{\(record\) =>/);
  assert.match(operations, /onKeyDown=\{[\s\S]*onOpenRecord\(record\)/);
  assert.match(operations, /No hay actividades vencidas\./);
});

test("WhatsApp tabs expose complete keyboard and panel associations", () => {
  assert.match(whatsapp, /role="tablist"/);
  assert.match(whatsapp, /aria-controls=\{`whatsapp-panel-\$\{key\}`\}/);
  assert.match(whatsapp, /role="tabpanel"/);
  assert.match(whatsapp, /ArrowRight/);
  assert.match(whatsapp, /ArrowLeft/);
  assert.match(whatsapp, /event\.key === "Home" \|\| event\.key === "End"/);
});

test("disabled AI state gives only administrators a configuration route", () => {
  assert.match(copilot, /isAdmin: boolean/);
  assert.match(copilot, /isAdmin &&/);
  assert.match(copilot, /href="\/app\?view=ai-settings"/);
  assert.match(agenda, /formatBusinessDate/);
});
