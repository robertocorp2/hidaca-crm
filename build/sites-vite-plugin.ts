import { createHash } from "node:crypto";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function packageSitesArtifacts(
  root: string,
  options: { requireWorkerArtifact?: boolean } = {},
) {
  const outputDirectory = resolve(root, "dist", ".openai");
  const workerArtifact = resolve(root, "dist", "server", "index.js");
  const workerConfig = resolve(root, "dist", "server", "wrangler.json");
  const hostingConfig = resolve(root, ".openai", "hosting.json");
  const drizzleSource = resolve(root, "drizzle");

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  if (await exists(hostingConfig)) {
    await cp(hostingConfig, resolve(outputDirectory, "hosting.json"));
  }
  if (await exists(drizzleSource)) {
    await cp(drizzleSource, resolve(outputDirectory, "drizzle"), {
      recursive: true,
      filter(source) {
        const relativePath = relative(drizzleSource, source);
        return (
          relativePath !== "rollback" &&
          !relativePath.startsWith(`rollback${sep}`)
        );
      },
    });
    const packagedMigrations = resolve(outputDirectory, "drizzle");
    const migrationFiles = (await import("node:fs/promises")).readdir(
      packagedMigrations,
      { withFileTypes: true },
    );
    for (const entry of await migrationFiles) {
      if (!entry.isFile() || !/^\d{4}_[^/]+\.sql$/.test(entry.name)) continue;
      const filename = resolve(packagedMigrations, entry.name);
      const source = await readFile(filename, "utf8");
      await writeFile(
        filename,
        source.replaceAll(
          ";--> statement-breakpoint",
          ";\n--> statement-breakpoint\n",
        ),
        "utf8",
      );
    }
  }

  const workerArtifactsPresent =
    (await exists(workerArtifact)) && (await exists(workerConfig));
  if (!workerArtifactsPresent) {
    if (options.requireWorkerArtifact) {
      throw new Error(
        "Sites build did not produce the expected production worker artifacts.",
      );
    }
    return;
  }
  const [workerSource, workerConfigSource] = await Promise.all([
    readFile(workerArtifact, "utf8"),
    readFile(workerConfig, "utf8"),
  ]);
  const workerConfiguration = JSON.parse(workerConfigSource) as {
    vars?: Record<string, unknown>;
  };
  const routePattern = "/api/imports/invoices/dry-run";
  const routeRegistered =
    workerSource.includes(`route:${routePattern}`) &&
    workerSource.includes(`pattern: \"${routePattern}\"`);
  if (!routeRegistered) {
    throw new Error(
      `Required invoice dry-run route is missing from ${workerArtifact}.`,
    );
  }
  const staticFeatureDefaultKeys =
    [
      "INVOICE_IMPORT_PHASE1_ENABLED",
      "INVOICE_PRODUCTION_IMPORT_ENABLED",
    ].filter((key) => Object.hasOwn(workerConfiguration.vars ?? {}, key));
  if (staticFeatureDefaultKeys.length) {
    throw new Error(
      "Production worker manifest contains static invoice feature defaults.",
    );
  }
  await writeFile(
    resolve(outputDirectory, "invoice-dry-run-route-manifest.json"),
    `${JSON.stringify(
      {
        route: routePattern,
        method: "POST",
        handler: "app/api/imports/invoices/dry-run/route.ts",
        workerArtifact: "dist/server/index.js",
        workerArtifactSha256: createHash("sha256")
          .update(workerSource)
          .digest("hex"),
        routeRegistered,
        runtimeFeatureFlags: {
          INVOICE_IMPORT_PHASE1_ENABLED: "Sites runtime environment only",
          INVOICE_PRODUCTION_IMPORT_ENABLED: "Sites runtime environment only",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

// Packages Sites metadata and upward migrations after Vite finishes compiling.
export function sites(): Plugin {
  let root = process.cwd();

  return {
    name: "sites",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      root = config.root;
    },
    closeBundle: {
      order: "post",
      sequential: true,
      async handler() {
        // vinext also closes its preliminary client-reference analysis build.
        // Package only after the real client build and Cloudflare relocation.
        if (this.environment?.name !== "client") return;
        await packageSitesArtifacts(root, { requireWorkerArtifact: true });
      },
    },
  };
}
