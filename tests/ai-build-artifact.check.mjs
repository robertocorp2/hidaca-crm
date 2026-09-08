import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) files.push(...(await javascriptFiles(path)));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

test("client artifacts do not contain server-only Ollama credentials", async () => {
  const files = await javascriptFiles(new URL("../dist/client/", import.meta.url));
  const assets = await Promise.all(files.map((file) => readFile(file, "utf8")));
  for (const asset of assets) {
    assert.equal(asset.includes("OLLAMA_API_KEY"), false);
    assert.equal(asset.includes("Authorization: Bearer"), false);
  }
});
