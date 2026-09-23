import type { D1Database } from "@cloudflare/workers-types";

export const WRITE_LEASE_ID_HEADER = "x-hidaca-write-lease";
export const WRITE_LEASE_GENERATION_HEADER = "x-hidaca-write-generation";
const DEFAULT_LEASE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_DRAIN_TIMEOUT_MS = 30 * 1000;

type StateRow = {
  id: number;
  mode: "open" | "maintenance";
  generation: number;
  reason: string;
  operator_email: string;
  activated_at: string | null;
  updated_at: string;
};

export type WriteLease = {
  id: string;
  generation: number;
  writerKind: string;
  requestId: string;
  startedAt: string;
  renewedAt: string;
  expiresAt: string;
};

export type ActiveWriter = {
  id: string;
  generation: number;
  writerKind: string;
  requestId: string;
  startedAt: string;
  renewedAt: string;
  expiresAt: string;
};

export type MaintenanceStatus = {
  mode: StateRow["mode"];
  generation: number;
  reason: string;
  operatorEmail: string;
  activatedAt: string | null;
  updatedAt: string;
  activeWriterCount: number;
  activeWriters: ActiveWriter[];
};

export class MaintenanceModeError extends Error {
  readonly code = "MAINTENANCE_MODE";

  constructor(message = "HIDACA está en mantenimiento; las escrituras están pausadas.") {
    super(message);
    this.name = "MaintenanceModeError";
  }
}

export class MaintenanceDrainTimeoutError extends Error {
  readonly code = "MAINTENANCE_DRAIN_TIMEOUT";
  readonly activeWriters: ActiveWriter[];

  constructor(activeWriters: ActiveWriter[]) {
    super("No se drenaron todos los escritores dentro del tiempo límite.");
    this.name = "MaintenanceDrainTimeoutError";
    this.activeWriters = activeWriters;
  }
}

export async function getMaintenanceStatus(d1: D1Database): Promise<MaintenanceStatus> {
  const state = await getState(d1);
  const activeWriters = await allActiveWriters(d1);
  return {
    mode: state.mode,
    generation: state.generation,
    reason: state.reason,
    operatorEmail: state.operator_email,
    activatedAt: state.activated_at,
    updatedAt: state.updated_at,
    activeWriterCount: activeWriters.length,
    activeWriters,
  };
}

export async function acquireWriteLease(
  d1: D1Database,
  writerKind: string,
  requestId = crypto.randomUUID(),
  ttlMs = DEFAULT_LEASE_TTL_MS,
): Promise<WriteLease> {
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1_000, ttlMs)).toISOString();
  const row = await d1
    .prepare(
      `INSERT INTO write_leases
         (id, generation, writer_kind, request_id, started_at, renewed_at, expires_at, outcome)
       SELECT ?, generation, ?, ?, ?, ?, ?, NULL
       FROM maintenance_state
       WHERE id = 1 AND mode = 'open'
       RETURNING id, generation, writer_kind, request_id, started_at, renewed_at, expires_at`,
    )
    .bind(crypto.randomUUID(), writerKind.slice(0, 120), requestId.slice(0, 180), startedAt, startedAt, expiresAt)
    .first<{
      id: string;
      generation: number;
      writer_kind: string;
      request_id: string;
      started_at: string;
      renewed_at: string;
      expires_at: string;
    }>();
  if (!row) throw new MaintenanceModeError();
  return toLease(row);
}

export async function assertWriteLeaseActive(d1: D1Database, lease: Pick<WriteLease, "id" | "generation">, now = new Date().toISOString()) {
  const row = await d1
    .prepare(
      `SELECT l.id
       FROM write_leases l
       JOIN maintenance_state s ON s.id = 1
       WHERE l.id = ? AND l.generation = ? AND l.outcome IS NULL
         AND l.expires_at > ? AND s.mode = 'open' AND s.generation = l.generation`,
    )
    .bind(lease.id, lease.generation, now)
    .first<{ id: string }>();
  if (!row) throw new MaintenanceModeError();
}

export async function renewWriteLease(d1: D1Database, lease: Pick<WriteLease, "id" | "generation">, ttlMs = DEFAULT_LEASE_TTL_MS) {
  const renewedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.max(1_000, ttlMs)).toISOString();
  const result = await d1
    .prepare(
      `UPDATE write_leases
       SET renewed_at = ?, expires_at = ?
       WHERE id = ? AND generation = ? AND outcome IS NULL
         AND EXISTS (SELECT 1 FROM maintenance_state WHERE id = 1 AND mode = 'open' AND generation = ?)`,
    )
    .bind(renewedAt, expiresAt, lease.id, lease.generation, lease.generation)
    .run();
  if (Number(result.meta.changes ?? 0) !== 1) throw new MaintenanceModeError();
  return { ...lease, renewedAt, expiresAt };
}

export async function releaseWriteLease(d1: D1Database, lease: Pick<WriteLease, "id" | "generation">, outcome: "completed" | "failed" = "completed") {
  await d1
    .prepare("UPDATE write_leases SET outcome = ?, renewed_at = ? WHERE id = ? AND generation = ? AND outcome IS NULL")
    .bind(outcome, new Date().toISOString(), lease.id, lease.generation)
    .run();
}

export async function withWriteLease<T>(d1: D1Database, writerKind: string, callback: (lease: WriteLease) => Promise<T>, requestId?: string) {
  const lease = await acquireWriteLease(d1, writerKind, requestId);
  let renewalError: unknown;
  const renewalTimer = setInterval(() => {
    void renewWriteLease(d1, lease).catch((error) => {
      renewalError ??= error;
    });
  }, Math.max(1_000, Math.floor(DEFAULT_LEASE_TTL_MS / 3)));
  try {
    await assertWriteLeaseActive(d1, lease);
    const result = await callback(lease);
    if (renewalError) throw renewalError;
    return result;
  } catch (error) {
    await releaseWriteLease(d1, lease, "failed").catch(() => undefined);
    throw error;
  } finally {
    clearInterval(renewalTimer);
    await releaseWriteLease(d1, lease).catch(() => undefined);
  }
}

export async function enterMaintenance(
  d1: D1Database,
  input: { reason: string; operatorEmail: string; timeoutMs?: number },
) {
  const now = new Date().toISOString();
  const result = await d1
    .prepare(
      `UPDATE maintenance_state
       SET mode = 'maintenance', generation = generation + 1, reason = ?, operator_email = ?, activated_at = ?, updated_at = ?
       WHERE id = 1 AND mode = 'open'`,
    )
    .bind(input.reason.slice(0, 500), input.operatorEmail.slice(0, 320), now, now)
    .run();
  if (Number(result.meta.changes ?? 0) === 1) {
    await d1.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(input.operatorEmail, "enter", "maintenance", "1", JSON.stringify({ reason: input.reason.slice(0, 500) }), now)
      .run();
  }
  const timeoutMs = Math.min(Math.max(input.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS, 0), 60 * 1000);
  const deadline = Date.now() + timeoutMs;
  const state = await getState(d1);
  while (true) {
    const activeWriters = await activeWritersFor(d1, state.generation);
    if (!activeWriters.length) return getMaintenanceStatus(d1);
    if (Date.now() >= deadline) throw new MaintenanceDrainTimeoutError(activeWriters);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

export async function reopenMaintenance(d1: D1Database, operatorEmail: string) {
  const currentState = await getState(d1);
  const activeWriters = await allActiveWriters(d1);
  if (currentState.mode === "maintenance" && activeWriters.length) throw new MaintenanceDrainTimeoutError(activeWriters);
  const now = new Date().toISOString();
  const result = await d1
    .prepare(
      `UPDATE maintenance_state
       SET mode = 'open', generation = generation + 1, reason = '', operator_email = ?, activated_at = NULL, updated_at = ?
       WHERE id = 1 AND mode = 'maintenance'`,
    )
    .bind(operatorEmail.slice(0, 320), now)
    .run();
  if (Number(result.meta.changes ?? 0) === 1) {
    await d1.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(operatorEmail, "reopen", "maintenance", "1", "{}", now)
      .run();
  }
  return getMaintenanceStatus(d1);
}

export function maintenanceResponse(error: MaintenanceModeError = new MaintenanceModeError()) {
  return Response.json(
    { error: error.message, code: error.code },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "60" } },
  );
}

export async function assertRequestWriteLease(d1: D1Database, request: Request) {
  const id = request.headers.get(WRITE_LEASE_ID_HEADER);
  const generationValue = request.headers.get(WRITE_LEASE_GENERATION_HEADER);
  const generation = generationValue ? Number(generationValue) : NaN;
  if (!id || !Number.isInteger(generation)) throw new MaintenanceModeError("La escritura no tiene un lease de mantenimiento válido.");
  await assertWriteLeaseActive(d1, { id, generation });
}

async function getState(d1: D1Database) {
  const state = await d1.prepare("SELECT id, mode, generation, reason, operator_email, activated_at, updated_at FROM maintenance_state WHERE id = 1").first<StateRow>();
  if (!state) throw new Error("WRITE_BARRIER_UNINITIALIZED");
  return state;
}

async function activeWritersFor(d1: D1Database, generation: number) {
  const result = await d1
    .prepare(
      `SELECT id, generation, writer_kind, request_id, started_at, renewed_at, expires_at
       FROM write_leases
       WHERE outcome IS NULL AND generation < ?
       ORDER BY started_at`,
    )
    .bind(generation)
    .all<ActiveWriterRow>();
  return (result.results ?? []).map(toActiveWriter);
}

async function allActiveWriters(d1: D1Database) {
  const result = await d1
    .prepare(
      `SELECT id, generation, writer_kind, request_id, started_at, renewed_at, expires_at
       FROM write_leases
       WHERE outcome IS NULL
       ORDER BY started_at`,
    )
    .all<ActiveWriterRow>();
  return (result.results ?? []).map(toActiveWriter);
}

type ActiveWriterRow = {
  id: string;
  generation: number;
  writer_kind: string;
  request_id: string;
  started_at: string;
  renewed_at: string;
  expires_at: string;
};

function toLease(row: ActiveWriterRow): WriteLease {
  return {
    id: row.id,
    generation: Number(row.generation),
    writerKind: row.writer_kind,
    requestId: row.request_id,
    startedAt: row.started_at,
    renewedAt: row.renewed_at,
    expiresAt: row.expires_at,
  };
}

function toActiveWriter(row: ActiveWriterRow): ActiveWriter {
  return {
    id: row.id,
    generation: Number(row.generation),
    writerKind: row.writer_kind,
    requestId: row.request_id,
    startedAt: row.started_at,
    renewedAt: row.renewed_at,
    expiresAt: row.expires_at,
  };
}
