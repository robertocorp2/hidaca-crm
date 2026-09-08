import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Activity,
  BadgeDollarSign,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  ClipboardPenLine,
  ContactRound,
  CreditCard,
  FileMinusCorner,
  FileText,
  FileUp,
  Files,
  FolderKanban,
  FolderOpen,
  HandCoins,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Milestone,
  ReceiptText,
  Target,
  Truck,
  UserCog,
  UserRoundSearch,
  UsersRound,
} from "lucide-react";

const expectedIcons = new Map([
  ["resumen", LayoutDashboard],
  ["clientes", Building2],
  ["contactos", ContactRound],
  ["proyectos", FolderKanban],
  ["leads", UserRoundSearch],
  ["opportunities", Target],
  ["ordenes-cambio", BriefcaseBusiness],
  ["cotizaciones", FileText],
  ["facturas", ReceiptText],
  ["pagos", CreditCard],
  ["tareas", ListChecks],
  ["hitos", Milestone],
  ["reportes-diarios", ClipboardPenLine],
  ["equipos", Truck],
  ["personal", UsersRound],
  ["suplidores", Handshake],
  ["credit-notes", FileMinusCorner],
  ["receivables", HandCoins],
  ["collections", BadgeDollarSign],
  ["schedule", Activity],
  ["calendar", CalendarDays],
  ["quotations", Files],
  ["imports", FileUp],
  ["documentos", FolderOpen],
  ["usuarios", UserCog],
]);

const navigationSource = await readFile(
  new URL("../app/app/navigation.tsx", import.meta.url),
  "utf8",
);

test("every HIDACA navigation destination has its semantic Lucide icon", () => {
  assert.equal(expectedIcons.size, 25);
  for (const [view, Icon] of expectedIcons) {
    const componentName = Icon.displayName ?? Icon.name;
    const sourceComponentName = view === "credit-notes" ? "FileMinus2" : componentName;
    assert.match(
      navigationSource,
      new RegExp(`view: "${view}"[\\s\\S]{0,100}icon: ${sourceComponentName}`),
      view,
    );
    const markup = renderToStaticMarkup(
      createElement(Icon, { "aria-hidden": true, size: 18, strokeWidth: 2 }),
    );
    assert.match(markup, /^<svg\b/);
    assert.equal(markup.replace(/<[^>]*>/g, ""), "", `${view} rendered text`);
  }
});

test("similar financial and document modules remain visually distinct", () => {
  const views = [
    "cotizaciones",
    "quotations",
    "facturas",
    "credit-notes",
    "receivables",
    "collections",
    "imports",
    "documentos",
  ];
  assert.equal(new Set(views.map((view) => expectedIcons.get(view))).size, views.length);
});

test("navigation source contains no abbreviation icon fallbacks", async () => {
  const source = (
    await Promise.all([
      Promise.resolve(navigationSource),
      readFile(new URL("../app/app/operations-client.tsx", import.meta.url), "utf8"),
      readFile(new URL("../app/lib/modules.ts", import.meta.url), "utf8"),
    ])
  ).join("\n");
  const oldAbbreviations = [
    "IN", "EM", "CO", "PR", "PS", "OP", "CS", "CT", "FA", "PA", "TA", "HI", "RD",
    "EQ", "PE", "SU", "NC", "CC", "CB", "AC", "CL", "QT", "IM", "DO", "US",
  ];

  assert.doesNotMatch(source, new RegExp(`["'](?:${oldAbbreviations.join("|")})["']`));
  assert.doesNotMatch(source, /\bicon\s*[:=]\s*["'][A-Z]{1,4}["']/);
  assert.doesNotMatch(source, /<span>\s*\{icon\}\s*<\/span>/);
});
