import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("branded not-found route exposes an accessible authenticated recovery path", async () => {
  const page = await readFile(new URL("../app/not-found.tsx", import.meta.url), "utf8");

  assert.match(page, /<main className="login-shell"/);
  assert.match(page, /<h1 id="not-found-title">Página no encontrada<\/h1>/);
  assert.match(page, /aria-labelledby="not-found-title"/);
  assert.match(page, /<Link className="primary-button" href="\/app">/);
  assert.match(page, /El acceso al CRM sigue protegido/);
});
