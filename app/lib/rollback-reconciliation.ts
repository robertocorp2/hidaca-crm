import type { D1Database } from "@cloudflare/workers-types";

type KeyRow = { key: string };
type TimestampRow = { id: string; created_at: string };
type CountRow = { count: number };
type R2ListObject = { key: string; uploaded?: Date | string };
type R2ListResult = { objects: R2ListObject[]; truncated: boolean; cursor?: string };
export type RollbackFiles = { list(options?: { cursor?: string; limit?: number }): Promise<R2ListResult> };

export type RollbackReconciliation = {
  snapshotAt: string;
  checkedAt: string;
  d1: {
    referencedObjectCount: number;
    postSnapshot: Record<string, { count: number; sample: TimestampRow[] }>;
  };
  r2: {
    inventoryComplete: boolean;
    objectCount: number;
    manifestSha256: string;
    postSnapshotObjects: string[];
    missingReferencedObjects: string[];
    orphanedObjects: string[];
  };
};

const REFERENCE_QUERIES = [
  "SELECT object_key AS key FROM documents WHERE object_key <> ''",
  "SELECT extracted_object_key AS key FROM import_files WHERE extracted_object_key <> ''",
  "SELECT storage_key AS key FROM ecf_artifacts WHERE storage_key <> ''",
  "SELECT object_key AS key FROM voice_recordings WHERE object_key <> ''",
  "SELECT media_key AS key FROM whatsapp_messages WHERE media_key IS NOT NULL AND media_key <> ''",
];

const POST_SNAPSHOT_QUERIES: Record<string, { sample: string; count: string }> = {
  documents: { sample: "SELECT id, created_at FROM documents WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM documents WHERE created_at > ?" },
  importFiles: { sample: "SELECT id, imported_at AS created_at FROM import_files WHERE imported_at > ? ORDER BY imported_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM import_files WHERE imported_at > ?" },
  ecfArtifacts: { sample: "SELECT id, created_at FROM ecf_artifacts WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM ecf_artifacts WHERE created_at > ?" },
  voiceRecordings: { sample: "SELECT id, created_at FROM voice_recordings WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM voice_recordings WHERE created_at > ?" },
  whatsappMessages: { sample: "SELECT id, created_at FROM whatsapp_messages WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_messages WHERE created_at > ?" },
  auditLog: { sample: "SELECT CAST(id AS TEXT) AS id, created_at FROM audit_log WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM audit_log WHERE created_at > ?" },
};

export async function reconcileRollback(d1: D1Database, files: RollbackFiles, snapshotAt: string): Promise<RollbackReconciliation> {
  const references = new Set<string>();
  for (const query of REFERENCE_QUERIES) {
    const rows = await d1.prepare(query).all<KeyRow>();
    for (const row of rows.results ?? []) references.add(row.key);
  }

  const postSnapshot = Object.fromEntries(await Promise.all(Object.entries(POST_SNAPSHOT_QUERIES).map(async ([name, queries]) => {
    const [count, rows] = await Promise.all([
      d1.prepare(queries.count).bind(snapshotAt).first<CountRow>(),
      d1.prepare(queries.sample).bind(snapshotAt).all<TimestampRow>(),
    ]);
    return [name, { count: Number(count?.count ?? 0), sample: rows.results ?? [] }] as const;
  })));

  const objects: string[] = [];
  const postSnapshotObjects = new Set<string>();
  const snapshotMs = Date.parse(snapshotAt);
  let cursor: string | undefined;
  let inventoryComplete = true;
  for (let page = 0; page < 100; page += 1) {
    const result = await files.list({ ...(cursor ? { cursor } : {}), limit: 1_000 }) as R2ListResult;
    for (const object of result.objects) {
      objects.push(object.key);
      if (object.uploaded && new Date(object.uploaded).getTime() > snapshotMs) postSnapshotObjects.add(object.key);
    }
    if (!result.truncated) break;
    if (!result.cursor) {
      inventoryComplete = false;
      break;
    }
    cursor = result.cursor;
    if (page === 99) inventoryComplete = false;
  }

  const objectSet = new Set(objects);
  const ignoredOrphanPrefixes = ["backups/"];
  const manifestSha256 = await sha256Hex(objects);
  return {
    snapshotAt,
    checkedAt: new Date().toISOString(),
    d1: {
      referencedObjectCount: references.size,
      postSnapshot,
    },
    r2: {
      inventoryComplete,
      objectCount: objects.length,
      manifestSha256,
      postSnapshotObjects: [...postSnapshotObjects].sort(),
      missingReferencedObjects: [...references].filter((key) => !objectSet.has(key)).sort(),
      orphanedObjects: objects.filter((key) => !references.has(key) && !ignoredOrphanPrefixes.some((prefix) => key.startsWith(prefix))).sort(),
    },
  };
}

async function sha256Hex(values: string[]) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(values.slice().sort().join("\n")));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
