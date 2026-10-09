import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function legacyStyledButtons(source, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = [];
  const legacyClass = /\b(?:primary|secondary|danger|ghost|text|icon)-button\b/;

  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(sourceFile) === "button"
    ) {
      const className = node.attributes.properties.find(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(sourceFile) === "className",
      );
      if (className?.initializer && legacyClass.test(className.initializer.getText(sourceFile))) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        violations.push(`${fileName}:${line}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

test("shared button primitives expose the canonical variant and size contract", async () => {
  const [ui, css, docs, workspace, showcase, entities, projects, operations, dailyBrief] = await Promise.all([
    read("../app/app/ui.tsx"),
    read("../app/globals.css"),
    read("../docs/BUTTONS.md"),
    read("../app/app/record-workspace.tsx"),
    read("../app/app/design-system-showcase.tsx"),
    read("../app/app/entity-views.tsx"),
    read("../app/app/projects-view.tsx"),
    read("../app/app/operations-client.tsx"),
    read("../app/app/daily-brief-panel.tsx"),
  ]);

  assert.match(ui, /export function Button/);
  assert.match(ui, /export function IconButton/);
  assert.match(ui, /<nav aria-label="Paginación" className="pagination">[\s\S]*<Button[\s\S]*variant="secondary"[\s\S]*Página \{page\} de \{totalPages\}[\s\S]*<Button[\s\S]*variant="secondary"/);
  assert.doesNotMatch(css, /\.pagination \.secondary-button\s*\{[^}]*\b(?:min-height|padding|height|width):/);
  for (const variant of ["primary", "secondary", "danger", "ghost", "text"]) {
    assert.match(ui, new RegExp(`${variant}: "${variant}-button"`));
  }
  assert.match(ui, /label: string/);
  assert.match(css, /\.button-size-sm[\s\S]*min-height: 34px/);
  assert.match(css, /\.button-size-lg[\s\S]*min-height: 48px/);
  assert.match(css, /\.icon-button\.button-size-sm[\s\S]*width: 34px/);
  assert.doesNotMatch(css, /\.record-actions > \* \{[^}]*\b(?:font-size|min-height|padding):/);
  assert.match(css, /\.primary-button:focus-visible[\s\S]*\.icon-button:focus-visible/);
  assert.match(docs, /\| Plus \|/);
  assert.match(docs, /\| Overflow \|/);
  assert.match(workspace, /<Button onClick=\{onEdit\} size="sm">/);
  assert.match(showcase, /<IconButton className="ds-icon-button" label="Abrir menú"/);
  assert.doesNotMatch(showcase, /<button[\s\S]{0,120}className="(?:primary|secondary|danger|text)-button/);
  assert.match(showcase, /<Button[\s\S]*variant="secondary"[\s\S]*Filtros/);
  assert.match(showcase, /<Button size="sm" type="button" variant="secondary">[\s\S]*Editar/);
  assert.match(entities, /<Button[\s\S]*variant="primary"/);
  assert.match(entities, /<Button variant="text" onClick=\{clearBusinessFilters\}/);
  assert.match(projects, /<Button variant="primary"/);
  assert.match(operations, /<Button variant="primary" onClick=\{openCreate\}/);
  assert.match(operations, /<IconButton[\s\S]*className="menu-button"/);
  assert.match(operations, /<IconButton[\s\S]*className="mobile-search-button"/);
  assert.match(operations, /className="menu-button"[\s\S]*aria-expanded=\{drawerNavigation \? mobileNav : undefined\}/);
  assert.match(operations, /className="mobile-search-button"[\s\S]*aria-expanded=\{mobileSearchOpen\}/);
  assert.match(operations, /<Button aria-label="Más módulos"[\s\S]*variant="text"/);
  assert.match(operations, /<Button[\s\S]*className="profile-trigger"/);
  assert.match(workspace, /<Button[\s\S]*className="record-more-button"/);
  assert.match(workspace, /<Button[\s\S]*className="danger-menu-item"/);
  assert.match(workspace, /<Button[\s\S]*relationship-empty-action/);
  assert.match(workspace, /<Button className="timeline-link"[\s\S]*variant="text"/);
  assert.match(operations, /<Button[\s\S]*variant="danger"/);
  assert.doesNotMatch(dailyBrief, /<button[\s\S]{0,120}className="(?:primary|secondary|danger|text)-button/);
  assert.match(dailyBrief, /<Button[\s\S]*variant="secondary"[\s\S]*Actualizar/);
  assert.match(dailyBrief, /<Button[\s\S]*variant="text"[\s\S]*Preparar seguimiento/);
  assert.match(dailyBrief, /<Button[\s\S]*variant="secondary"[\s\S]*Rechazar/);
});

test("core workspace actions do not use raw buttons with legacy variant classes", async () => {
  const surfaces = [
    ["entity-views.tsx", "../app/app/entity-views.tsx"],
    ["projects-view.tsx", "../app/app/projects-view.tsx"],
    ["operations-client.tsx", "../app/app/operations-client.tsx"],
    ["daily-brief-panel.tsx", "../app/app/daily-brief-panel.tsx"],
    ["record-workspace.tsx", "../app/app/record-workspace.tsx"],
  ];
  const sources = await Promise.all(surfaces.map(([, path]) => read(path)));
  const violations = surfaces.flatMap(([fileName], index) =>
    legacyStyledButtons(sources[index], fileName),
  );

  assert.deepEqual(
    violations,
    [],
    "use Button or IconButton for semantic actions; keep raw buttons for controls such as tabs",
  );
});
