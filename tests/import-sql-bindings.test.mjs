import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

test("import acceptance SQL binds every placeholder exactly once", async () => {
  const path = new URL(
    "../app/api/imports/[id]/accept/route.ts",
    import.meta.url,
  );
  const sourceText = await readFile(path, "utf8");
  const sourceFile = ts.createSourceFile(
    path.pathname,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const checks = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "prepare" &&
      node.arguments.length > 0
    ) {
      const sql = node.arguments[0];
      if (ts.isNoSubstitutionTemplateLiteral(sql) || ts.isStringLiteral(sql)) {
        checks.push({
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          placeholders: (sql.text.match(/\?/g) ?? []).length,
          bindings: node.arguments.length - 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(checks.length > 10);
  for (const check of checks) {
    assert.equal(
      check.bindings,
      check.placeholders,
      `SQL binding mismatch at accept/route.ts:${check.line}`,
    );
  }
});
