import { getD1 } from "../../../../../db";
import { authorizeApi } from "../../../../lib/authorization";

function boundedInteger(value: string | null, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0
    ? Math.min(parsed, max)
    : fallback;
}

function parseJson(value: unknown, fallback: unknown) {
  try {
    return JSON.parse(String(value ?? "")) as unknown;
  } catch {
    return fallback;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const url = new URL(request.url);
  const limit = boundedInteger(url.searchParams.get("limit"), 100, 200);
  const offset = boundedInteger(url.searchParams.get("offset"), 0, 1_000_000);
  const outcome = String(url.searchParams.get("outcome") ?? "").trim();
  const origin = String(url.searchParams.get("origin") ?? "").trim();
  const q = String(url.searchParams.get("q") ?? "")
    .trim()
    .slice(0, 120);
  const conditions = ["r.import_file_id = ?"];
  const bindings: unknown[] = [id];
  if (outcome) {
    conditions.push("r.outcome = ?");
    bindings.push(outcome);
  }
  if (origin) {
    conditions.push("r.source_origin = ?");
    bindings.push(origin);
  }
  if (q) {
    conditions.push(
      "(r.normalized_values LIKE ? OR r.source_filename LIKE ? OR r.source_origin LIKE ?)",
    );
    const pattern = `%${q.replace(/[%_]/g, "\\$&")}%`;
    bindings.push(pattern, pattern, pattern);
  }
  const where = conditions.join(" AND ");
  const d1 = getD1();
  const [rowsResult, countResult, batchResult, sourcesResult] =
    await Promise.all([
      d1
        .prepare(
          `SELECT r.*, (
             SELECT count(*) FROM import_issues i
             WHERE i.import_row_id = r.id AND i.status = 'open'
           ) AS open_issue_count
           FROM import_rows r
           WHERE ${where}
           ORDER BY r.source_row_number
           LIMIT ? OFFSET ?`,
        )
        .bind(...bindings, limit, offset)
        .all<Record<string, unknown>>(),
      d1
        .prepare(`SELECT count(*) AS count FROM import_rows r WHERE ${where}`)
        .bind(...bindings)
        .first<{ count: number }>(),
      d1
        .prepare(
          `SELECT b.*, f.id AS import_file_id, f.filename, f.status AS file_status
           FROM import_files f
           JOIN import_batches b ON b.id = f.batch_id
           WHERE f.id = ?`,
        )
        .bind(id)
        .first<Record<string, unknown>>(),
      d1
        .prepare(
          `SELECT s.*
           FROM import_batch_sources s
           JOIN import_files f ON f.batch_id = s.batch_id
           WHERE f.id = ?
           ORDER BY s.origin_label`,
        )
        .bind(id)
        .all<Record<string, unknown>>(),
    ]);
  if (!batchResult) {
    return Response.json(
      { error: "Importación no encontrada." },
      { status: 404 },
    );
  }
  return Response.json(
    {
      batch: {
        ...batchResult,
        summary: parseJson(batchResult.summary_json, {}),
      },
      sources: sourcesResult.results ?? [],
      rows: (rowsResult.results ?? []).map((row) => ({
        ...row,
        raw_values: parseJson(row.raw_values, {}),
        normalized_values: parseJson(row.normalized_values, {}),
        warnings: parseJson(row.warnings, []),
        errors: parseJson(row.errors, []),
      })),
      total: Number(countResult?.count ?? 0),
      limit,
      offset,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id: importFileId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const rowId = String(payload.rowId ?? "");
  const outcome = String(payload.outcome ?? "");
  const allowed = new Set(["ready", "manual_review", "skipped"]);
  if (!rowId || !allowed.has(outcome)) {
    return Response.json(
      { error: "Fila y resultado de revisión válidos son obligatorios." },
      { status: 400 },
    );
  }
  const current = await getD1()
    .prepare(
      `SELECT id, normalized_values, document_kind
       FROM import_rows WHERE id = ? AND import_file_id = ?`,
    )
    .bind(rowId, importFileId)
    .first<{
      id: string;
      normalized_values: string;
      document_kind: string;
    }>();
  if (!current) {
    return Response.json({ error: "Fila no encontrada." }, { status: 404 });
  }
  if (current.document_kind === "invoice_register" && outcome === "ready") {
    return Response.json(
      {
        error:
          "La matriz solo puede vincularse a una factura exacta o marcarse como omitida.",
      },
      { status: 409 },
    );
  }
  const normalizedValues =
    payload.normalizedValues &&
    typeof payload.normalizedValues === "object" &&
    !Array.isArray(payload.normalizedValues)
      ? JSON.stringify(payload.normalizedValues)
      : current.normalized_values;
  const now = new Date().toISOString();
  const statements = [
    getD1()
      .prepare(
        `UPDATE import_rows
         SET outcome = ?, match_confidence = 'manual_review',
             normalized_values = ?, reviewed_by = ?, reviewed_at = ?,
             updated_at = ?
         WHERE id = ? AND import_file_id = ?`,
      )
      .bind(
        outcome,
        normalizedValues,
        auth.user.email,
        now,
        now,
        rowId,
        importFileId,
      ),
  ];
  if (outcome === "ready") {
    statements.push(
      getD1()
        .prepare(
          `UPDATE import_issues
           SET status = 'resolved', resolution = ?, resolved_by = ?,
               resolved_at = ?
           WHERE import_row_id = ? AND status = 'open'`,
        )
        .bind(
          String(payload.resolution ?? "Verificado manualmente.").slice(
            0,
            1_000,
          ),
          auth.user.email,
          now,
          rowId,
        ),
    );
  }
  await getD1().batch(statements);
  return Response.json({ ok: true, rowId, outcome });
}
