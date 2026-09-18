import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("branded not-found route exposes an accessible authenticated recovery path", async () => {
  const page = await readFile(new URL("../app/not-found.tsx", import.meta.url), "utf8");

  assert.match(page, /<main className="login-shell"/);
  assert.match(page, /<h1 id="not-found-title">Página no encontrada<\/h1>/);
  assert.equal((page.match(/<h1\b/g) ?? []).length, 1);
  assert.match(page, /aria-labelledby="not-found-title"/);
  assert.match(page, /<Link className="primary-button" href="\/app">/);
  assert.match(page, /El acceso al CRM sigue protegido/);
  assert.doesNotMatch(page, /(?:\/api\/|drizzle|database|db\.|fetch\()/i);
});

test("branded not-found shell keeps responsive content within the viewport", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const shell = css.match(/\.login-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const card = css.match(/\.login-card\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(shell, /min-height:\s*100vh/);
  assert.match(shell, /padding:\s*28px/);
  assert.match(card, /box-sizing:\s*border-box/);
  assert.match(card, /max-width:\s*510px/);
  assert.match(card, /min-width:\s*0/);
  assert.match(card, /width:\s*100%/);
});
