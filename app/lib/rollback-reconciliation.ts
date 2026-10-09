import type { D1Database } from "@cloudflare/workers-types";
import { MAINTENANCE_AUTHORITY_KEY, readMaintenanceAuthority, type MaintenanceBucket } from "./maintenance-authority";

type KeyRow = { key: string };
type TimestampRow = { id: string; created_at: string };
type CountRow = { count: number };
type R2ListObject = { key: string; uploaded?: Date | string };
type R2ListResult = { objects: R2ListObject[]; truncated: boolean; cursor?: string };
export type RollbackFiles = Pick<MaintenanceBucket, "get"> & { list(options?: { cursor?: string; limit?: number }): Promise<R2ListResult> };

export type RollbackReconciliation = {
  snapshotAt: string;
  checkedAt: string;
  d1: {
    referencedObjectCount: number;
    postSnapshot: Record<string, { count: number; sample: TimestampRow[] }>;
    maintenanceEntryAudit: { count: number; sample: TimestampRow[] };
    untrackedInboundMessages: { count: number; sample: TimestampRow[] };
    unresolvedWriters: Record<string, { count: number; sample: TimestampRow[] }>;
  };
  r2: {
    inventoryComplete: boolean;
    objectCount: number;
    manifestSha256: string;
    maintenanceAuthority: { present: boolean; mode: "open" | "maintenance" | null; revision: number | null; updatedAfterSnapshot: boolean };
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
  "SELECT object_key AS key FROM ecf_inbound_messages WHERE object_key IS NOT NULL AND object_key <> ''",
];

const POST_SNAPSHOT_QUERIES: Record<string, { sample: string; count: string }> = {
  documents: { sample: "SELECT id, created_at FROM documents WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM documents WHERE created_at > ?" },
  importFiles: { sample: "SELECT id, imported_at AS created_at FROM import_files WHERE imported_at > ? ORDER BY imported_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM import_files WHERE imported_at > ?" },
  ecfArtifacts: { sample: "SELECT id, created_at FROM ecf_artifacts WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM ecf_artifacts WHERE created_at > ?" },
  ecfInboundMessages: { sample: "SELECT id, created_at FROM ecf_inbound_messages WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM ecf_inbound_messages WHERE created_at > ?" },
  voiceRecordings: { sample: "SELECT id, created_at FROM voice_recordings WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM voice_recordings WHERE created_at > ?" },
  whatsappMessages: { sample: "SELECT id, created_at FROM whatsapp_messages WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_messages WHERE created_at > ?" },
  whatsappWebhookEvents: { sample: "SELECT CAST(id AS TEXT) AS id, received_at AS created_at FROM whatsapp_webhook_events WHERE received_at > ? ORDER BY received_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_webhook_events WHERE received_at > ?" },
  whatsappCampaignRecipients: { sample: "SELECT id, updated_at AS created_at FROM whatsapp_campaign_recipients WHERE updated_at > ? ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_campaign_recipients WHERE updated_at > ?" },
  whatsappCampaignDeliveryAttempts: { sample: "SELECT id, created_at FROM whatsapp_campaign_delivery_attempts WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_campaign_delivery_attempts WHERE created_at > ?" },
  prospectingJobs: { sample: "SELECT id, updated_at AS created_at FROM pi_jobs WHERE updated_at > ? ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM pi_jobs WHERE updated_at > ?" },
  projects: { sample: "SELECT id, updated_at AS created_at FROM projects WHERE updated_at > ? ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM projects WHERE updated_at > ?" },
  projectAddresses: { sample: "SELECT id, updated_at AS created_at FROM addresses WHERE project_id IS NOT NULL AND updated_at > ? ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM addresses WHERE project_id IS NOT NULL AND updated_at > ?" },
  projectLocations: { sample: "SELECT id, updated_at AS created_at FROM project_locations WHERE updated_at > ? ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM project_locations WHERE updated_at > ?" },
  projectContacts: { sample: "SELECT project_id || ':' || contact_id AS id, created_at FROM project_contacts WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM project_contacts WHERE created_at > ?" },
  projectSearchDocuments: { sample: "SELECT CAST(row_id AS TEXT) AS id, updated_at AS created_at FROM search_documents WHERE entity_type = 'project' AND updated_at > ? ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM search_documents WHERE entity_type = 'project' AND updated_at > ?" },
  projectHistory: { sample: "SELECT CAST(id AS TEXT) AS id, created_at FROM entity_history WHERE entity_type = 'project' AND created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM entity_history WHERE entity_type = 'project' AND created_at > ?" },
  // Entity edits are not guaranteed to emit a global audit_log row. Include
  // all history so rollback drills catch post-snapshot edits to quotations
  // and other business entities as well as newly-created rows.
  entityHistory: { sample: "SELECT CAST(id AS TEXT) AS id, created_at FROM entity_history WHERE created_at > ? ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM entity_history WHERE created_at > ?" },
  auditLog: { sample: "SELECT CAST(id AS TEXT) AS id, created_at FROM audit_log WHERE created_at > ? AND NOT (entity_type = 'maintenance' AND entity_id = '1' AND action = 'enter') ORDER BY created_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM audit_log WHERE created_at > ? AND NOT (entity_type = 'maintenance' AND entity_id = '1' AND action = 'enter')" },
};

const MAINTENANCE_ENTRY_AUDIT = {
  sample: "SELECT CAST(id AS TEXT) AS id, created_at FROM audit_log WHERE created_at > ? AND entity_type = 'maintenance' AND entity_id = '1' AND action = 'enter' ORDER BY created_at LIMIT 20",
  count: "SELECT COUNT(*) AS count FROM audit_log WHERE created_at > ? AND entity_type = 'maintenance' AND entity_id = '1' AND action = 'enter'",
};

const UNRESOLVED_WRITER_QUERIES: Record<string, { sample: string; count: string }> = {
  whatsappWebhooks: { sample: "SELECT CAST(id AS TEXT) AS id, received_at AS created_at FROM whatsapp_webhook_events WHERE processing_status = 'processing' ORDER BY received_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_webhook_events WHERE processing_status = 'processing'" },
  whatsappCampaigns: { sample: "SELECT id, updated_at AS created_at FROM whatsapp_campaign_recipients WHERE status = 'sending' ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM whatsapp_campaign_recipients WHERE status = 'sending'" },
  prospectingJobs: { sample: "SELECT id, updated_at AS created_at FROM pi_jobs WHERE status = 'running' ORDER BY updated_at LIMIT 20", count: "SELECT COUNT(*) AS count FROM pi_jobs WHERE status = 'running'" },
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
  const [maintenanceEntryCount, maintenanceEntryRows] = await Promise.all([
    d1.prepare(MAINTENANCE_ENTRY_AUDIT.count).bind(snapshotAt).first<CountRow>(),
    d1.prepare(MAINTENANCE_ENTRY_AUDIT.sample).bind(snapshotAt).all<TimestampRow>(),
  ]);
  const [untrackedInboundCount, untrackedInboundRows] = await Promise.all([
    d1.prepare("SELECT COUNT(*) AS count FROM ecf_inbound_messages WHERE object_key IS NULL OR object_key = ''").first<CountRow>(),
    d1.prepare("SELECT id, created_at FROM ecf_inbound_messages WHERE object_key IS NULL OR object_key = '' ORDER BY created_at LIMIT 20").all<TimestampRow>(),
  ]);
  const unresolvedWriters = Object.fromEntries(await Promise.all(Object.entries(UNRESOLVED_WRITER_QUERIES).map(async ([name, queries]) => {
    const [count, rows] = await Promise.all([
      d1.prepare(queries.count).first<CountRow>(),
      d1.prepare(queries.sample).all<TimestampRow>(),
    ]);
    return [name, { count: Number(count?.count ?? 0), sample: rows.results ?? [] }] as const;
  })));

  const objects: string[] = [];
  const postSnapshotObjects = new Set<string>();
  const snapshotMs = Date.parse(snapshotAt);
  let maintenanceAuthorityPresent = false;
  let maintenanceAuthorityUpdatedAfterSnapshot = false;
  let maintenanceAuthorityMode: "open" | "maintenance" | null = null;
  let maintenanceAuthorityRevision: number | null = null;
  try {
    const authority = await readMaintenanceAuthority(files);
    maintenanceAuthorityMode = authority.mode;
    maintenanceAuthorityRevision = authority.revision;
  } catch {
    // The reconciliation response stays inspectable, but validation fails closed.
  }
  let cursor: string | undefined;
  let inventoryComplete = true;
  for (let page = 0; page < 100; page += 1) {
    const result = await files.list({ ...(cursor ? { cursor } : {}), limit: 1_000 }) as R2ListResult;
    for (const object of result.objects) {
      objects.push(object.key);
      if (object.key === MAINTENANCE_AUTHORITY_KEY) {
        maintenanceAuthorityPresent = true;
        maintenanceAuthorityUpdatedAfterSnapshot = Boolean(object.uploaded && new Date(object.uploaded).getTime() > snapshotMs);
      } else if (object.uploaded && new Date(object.uploaded).getTime() > snapshotMs) {
        postSnapshotObjects.add(object.key);
      }
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
      maintenanceEntryAudit: { count: Number(maintenanceEntryCount?.count ?? 0), sample: maintenanceEntryRows.results ?? [] },
      untrackedInboundMessages: { count: Number(untrackedInboundCount?.count ?? 0), sample: untrackedInboundRows.results ?? [] },
      unresolvedWriters,
    },
    r2: {
      inventoryComplete,
      objectCount: objects.length,
      manifestSha256,
      maintenanceAuthority: { present: maintenanceAuthorityPresent, mode: maintenanceAuthorityMode, revision: maintenanceAuthorityRevision, updatedAfterSnapshot: maintenanceAuthorityUpdatedAfterSnapshot },
      postSnapshotObjects: [...postSnapshotObjects].sort(),
      missingReferencedObjects: [...references].filter((key) => !objectSet.has(key)).sort(),
      orphanedObjects: objects.filter((key) => key !== MAINTENANCE_AUTHORITY_KEY && !references.has(key) && !ignoredOrphanPrefixes.some((prefix) => key.startsWith(prefix))).sort(),
    },
  };
}

async function sha256Hex(values: string[]) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(values.slice().sort().join("\n")));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
