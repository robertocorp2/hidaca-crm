import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { packageSitesArtifacts } from "../build/sites-vite-plugin";
import { packageSitesArchive } from "../scripts/package-sites-archive.mjs";

test("Sites packaging excludes rollback SQL from deployable migrations", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hidaca-sites-package-"));
  try {
    await mkdir(path.join(root, ".openai"), { recursive: true });
    await mkdir(path.join(root, "drizzle", "rollback"), { recursive: true });
    await writeFile(
      path.join(root, ".openai", "hosting.json"),
      JSON.stringify({ project_id: "test", d1: "DB", r2: "FILES" }),
    );
    await writeFile(
      path.join(root, "drizzle", "0000_up.sql"),
      "CREATE TABLE safe_table (id text PRIMARY KEY);",
    );
    await writeFile(
      path.join(root, "drizzle", "rollback", "0000_down.sql"),
      "DROP TABLE safe_table;",
    );

    await packageSitesArtifacts(root);

    const packagedUp = await readFile(
      path.join(root, "dist", ".openai", "drizzle", "0000_up.sql"),
      "utf8",
    );
    assert.match(packagedUp, /CREATE TABLE safe_table/);
    await assert.rejects(
      access(
        path.join(
          root,
          "dist",
          ".openai",
          "drizzle",
          "rollback",
          "0000_down.sql",
        ),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("final Sites archive contains only forward migrations and metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hidaca-sites-archive-"));
  const archivePath = path.join(root, "deployment.tar.gz");
  try {
    await mkdir(path.join(root, ".openai"), { recursive: true });
    await mkdir(path.join(root, "dist", "server"), { recursive: true });
    await mkdir(path.join(root, "dist", ".openai", "drizzle", "rollback"), {
      recursive: true,
    });
    await mkdir(path.join(root, "drizzle", "meta"), { recursive: true });
    await mkdir(path.join(root, "drizzle", "rollback"), { recursive: true });
    await mkdir(path.join(root, "drizzle", "archive"), { recursive: true });

    await writeFile(
      path.join(root, ".openai", "hosting.json"),
      JSON.stringify({ project_id: "test", d1: "DB", r2: "FILES" }),
    );
    await writeFile(path.join(root, "dist", "server", "index.js"), "export {};\n");
    await writeFile(
      path.join(root, "dist", ".openai", "drizzle", "rollback", "stale.sql"),
      "DROP TABLE addresses;",
    );

    for (let index = 0; index <= 14; index += 1) {
      const number = String(index).padStart(4, "0");
      await writeFile(
        path.join(root, "drizzle", `${number}_migration.sql`),
        `-- forward migration ${number}\n`,
      );
    }
    await writeFile(
      path.join(root, "drizzle", "meta", "_journal.json"),
      '{"entries":[]}\n',
    );
    await writeFile(
      path.join(root, "drizzle", "meta", "0000_snapshot.json"),
      "{}\n",
    );
    await writeFile(
      path.join(root, "drizzle", "meta", "0010_snapshot.json"),
      "{}\n",
    );
    await writeFile(
      path.join(root, "drizzle", "meta", "notes.txt"),
      "must not ship\n",
    );
    await writeFile(
      path.join(root, "drizzle", "rollback", "0000_down.sql"),
      "DROP TABLE addresses;\n",
    );
    await writeFile(
      path.join(root, "drizzle", "archive", "old.sql"),
      "DROP TABLE addresses;\n",
    );

    await packageSitesArchive(root, archivePath);

    const entries = execFileSync("tar", ["-tzf", archivePath], {
      encoding: "utf8",
    })
      .split(/\r?\n/)
      .filter(
        (entry) =>
          entry.startsWith("dist/.openai/drizzle/") && !entry.endsWith("/"),
      )
      .map((entry) => entry.slice("dist/.openai/drizzle/".length))
      .sort();
    const expectedMigrations = Array.from({ length: 15 }, (_, index) =>
      `${String(index).padStart(4, "0")}_migration.sql`,
    );
    assert.deepEqual(entries, [
      ...expectedMigrations,
      "meta/0000_snapshot.json",
      "meta/0010_snapshot.json",
      "meta/_journal.json",
    ]);
    assert.ok(!entries.some((entry) => entry.includes("rollback")));
    assert.ok(!entries.some((entry) => entry.includes("archive")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
