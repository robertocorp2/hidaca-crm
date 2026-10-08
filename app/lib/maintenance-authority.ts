const KEY = "__control/maintenance-state.v1.json";
const MAX_CAS_ATTEMPTS = 8;

export type MaintenanceBucket = {
  get(key: string): Promise<{ etag: string; json<T>(): Promise<T> } | null>;
  put(key: string, value: string, options: { onlyIf: { etagMatches: string }; httpMetadata?: { contentType: string } }): Promise<{ etag: string } | null>;
};

export type MaintenanceAuthority = {
  schemaVersion: 1;
  revision: number;
  mode: "open" | "maintenance";
  reason: string;
  operatorEmail: string;
  activatedAt: string | null;
  updatedAt: string;
};

export class MaintenanceAuthorityUnavailableError extends Error {
  readonly code = "MAINTENANCE_AUTHORITY_UNAVAILABLE";
  constructor(message = "The authoritative maintenance control is unavailable; writes are paused.") {
    super(message);
    this.name = "MaintenanceAuthorityUnavailableError";
  }
}

export class MaintenanceAuthorityConflictError extends Error {
  readonly code = "MAINTENANCE_AUTHORITY_CONFLICT";
  constructor() {
    super("The authoritative maintenance control changed repeatedly; writes are paused.");
    this.name = "MaintenanceAuthorityConflictError";
  }
}

export async function readMaintenanceAuthority(bucket: MaintenanceBucket): Promise<MaintenanceAuthority> {
  try {
    const object = await bucket.get(KEY);
    if (!object) throw new MaintenanceAuthorityUnavailableError("The authoritative maintenance control is not initialized; writes are paused.");
    const value = await object.json<unknown>();
    if (!isAuthority(value)) throw new MaintenanceAuthorityUnavailableError("The authoritative maintenance control is invalid; writes are paused.");
    return value;
  } catch (error) {
    if (error instanceof MaintenanceAuthorityUnavailableError) throw error;
    throw new MaintenanceAuthorityUnavailableError();
  }
}

export async function enterMaintenanceAuthority(
  bucket: MaintenanceBucket,
  input: { reason: string; operatorEmail: string },
) {
  return updateAuthority(bucket, (current) => {
    const now = new Date().toISOString();
    return { ...current, revision: current.revision + 1, mode: "maintenance", reason: current.mode === "maintenance" ? current.reason : input.reason.slice(0, 500), operatorEmail: input.operatorEmail.slice(0, 320), activatedAt: current.activatedAt ?? now, updatedAt: now };
  });
}

export async function reopenMaintenanceAuthority(bucket: MaintenanceBucket, operatorEmail: string, expectedRevision: number) {
  return updateAuthority(bucket, (current) => {
    if (current.revision !== expectedRevision) throw new MaintenanceAuthorityConflictError();
    if (current.mode === "open") return current;
    const now = new Date().toISOString();
    return { ...current, revision: current.revision + 1, mode: "open", reason: "", operatorEmail: operatorEmail.slice(0, 320), activatedAt: null, updatedAt: now };
  });
}

async function updateAuthority(bucket: MaintenanceBucket, change: (current: MaintenanceAuthority) => MaintenanceAuthority) {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    let object;
    let current: MaintenanceAuthority;
    try {
      object = await bucket.get(KEY);
      if (!object) throw new MaintenanceAuthorityUnavailableError("The authoritative maintenance control is not initialized; writes are paused.");
      const value = await object.json<unknown>();
      if (!isAuthority(value)) throw new MaintenanceAuthorityUnavailableError("The authoritative maintenance control is invalid; writes are paused.");
      current = value;
    } catch (error) {
      if (error instanceof MaintenanceAuthorityUnavailableError) throw error;
      throw new MaintenanceAuthorityUnavailableError();
    }
    const next = change(current);
    if (next === current) return current;
    try {
      const saved = await bucket.put(KEY, JSON.stringify(next), { onlyIf: { etagMatches: object.etag }, httpMetadata: { contentType: "application/json" } });
      if (saved) return next;
    } catch {
      throw new MaintenanceAuthorityUnavailableError();
    }
  }
  throw new MaintenanceAuthorityConflictError();
}

function isAuthority(value: unknown): value is MaintenanceAuthority {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return item.schemaVersion === 1 && Number.isSafeInteger(item.revision) && Number(item.revision) >= 0 &&
    (item.mode === "open" || item.mode === "maintenance") && typeof item.reason === "string" &&
    typeof item.operatorEmail === "string" && (item.activatedAt === null || typeof item.activatedAt === "string") &&
    typeof item.updatedAt === "string";
}
