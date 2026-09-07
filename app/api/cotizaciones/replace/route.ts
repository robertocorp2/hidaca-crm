import { env } from "cloudflare:workers";
import { getD1 } from "../../../../db";
import { parseSourceFile, type ExtractedCell } from "../../../lib/importers";
import { authorizeApi } from "../../../lib/authorization";

const EXPECTED_COUNT = 133;
// D1 accepts at most 100 bound parameters per SQL statement.
const MAX_D1_PARAMETERS = 100;
const SOURCE_SHEET = "Registro";
const SOURCE_HEADERS = [
  "Fecha", "Mes", "Año", "Cotización NO:", "Cliente", "RNC", "Contacto",
  "Telefono", "Celular", "Correo", "Direccion", "Direccion de Proyecto",
  "Archivo de Origen", "Enlace al Documento",
] as const;

type SourceField = (typeof SOURCE_HEADERS)[number];
type SourceRow = {
  sourceRowNumber: number;
  fields: Record<SourceField, string | null>;
  dueDate: string | null;
  documentUrl: string | null;
};
type FilesBucket = { put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown> };

function filesBucket() {
  return (env as unknown as { FILES: FilesBucket }).FILES;
}

function value(cell: ExtractedCell | undefined) {
  const text = String(cell?.displayValue ?? cell?.rawValue ?? "").trim();
  return text || null;
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

function isoDate(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function hyperlink(cell: ExtractedCell | undefined) {
  const formula = cell?.formula ?? "";
  const match = formula.match(/^HYPERLINK\(\s*"((?:[^"]|"")*)"\s*[,;]/i);
  if (match) return match[1].replace(/""/g, '"');
  const displayed = value(cell);
  return displayed && /^(?:https?:\/\/|file:\/\/|drive:)/i.test(displayed) ? displayed : null;
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function parseWorkbook(file: File) {
  const bytes = await file.arrayBuffer();
  const extraction = await parseSourceFile(file.name, bytes);
  const sheet = extraction.sheets.find((candidate) => normalized(candidate.name) === normalized(SOURCE_SHEET));
  if (!sheet || extraction.sheets.length !== 1) throw new Error("El libro debe contener únicamente la hoja Registro.");
  const cells = new Map(sheet.cells.map((cell) => [`${cell.row}:${cell.column}`, cell]));
  const headerRow = 1;
  const columns = SOURCE_HEADERS.map((header, column) => {
    const actual = value(cells.get(`${headerRow}:${column}`));
    if (normalized(actual ?? "") !== normalized(header)) throw new Error(`Encabezado inválido en columna ${column + 1}: se esperaba ${header}.`);
    return column;
  });
  const rows: SourceRow[] = [];
  for (let row = 2; row <= 134; row += 1) {
    const fields = Object.fromEntries(SOURCE_HEADERS.map((header, index) => [header, value(cells.get(`${row}:${columns[index]}`))])) as Record<SourceField, string | null>;
    const linkCell = cells.get(`${row}:${columns[13]}`);
    fields["Enlace al Documento"] = hyperlink(linkCell) ?? fields["Enlace al Documento"];
    rows.push({ sourceRowNumber: row + 1, fields, dueDate: isoDate(fields.Fecha), documentUrl: fields["Enlace al Documento"] });
  }
  if (rows.length !== EXPECTED_COUNT) throw new Error(`Se esperaban ${EXPECTED_COUNT} filas y se encontraron ${rows.length}.`);
  return { rows, sourceSha256: await sha256(bytes), worksheets: extraction.sheets.map((item) => item.name) };
}

function duplicates(rows: SourceRow[]) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const number = row.fields["Cotización NO:"];
    if (number) counts.set(number, (counts.get(number) ?? 0) + 1);
  }
  return [...counts].filter(([, count]) => count > 1).map(([number, count]) => ({ number, count }));
}

function sourceMetadata(row: SourceRow, sourceFilename: string, sourceSha256: string) {
  return JSON.stringify({
    kind: "cotizaciones_spreadsheet",
    worksheet: SOURCE_SHEET,
    sourceRowNumber: row.sourceRowNumber,
    sourceFilename,
    sourceSha256,
    fields: row.fields,
  });
}

function insertMany(table: string, columns: string[], rows: unknown[][]) {
  const placeholders = `(${columns.map(() => "?").join(", ")})`;
  return { sql: `INSERT INTO ${table} (${columns.join(", ")}) VALUES ${rows.map(() => placeholders).join(", ")}`, values: rows.flat() };
}

function insertBatches(table: string, columns: string[], rows: unknown[][]) {
  const maxRows = Math.floor(MAX_D1_PARAMETERS / columns.length);
  const batches = [] as Array<ReturnType<typeof insertMany>>;
  for (let start = 0; start < rows.length; start += maxRows) batches.push(insertMany(table, columns, rows.slice(start, start + maxRows)));
  return batches;
}

async function count(table: string, where = "") {
  const row = await getD1().prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function cotizacionesReferences() {
  const target = "IN (SELECT id FROM business_records WHERE module = 'cotizaciones')";
  const [opportunityQuotes, businesses, contacts, projects, quotations, invoices, payments] = await Promise.all([
    count("opportunity_quotes", `WHERE quote_record_id ${target}`),
    count("businesses", `WHERE legacy_record_id ${target}`),
    count("contacts", `WHERE legacy_record_id ${target}`),
    count("projects", `WHERE legacy_record_id ${target}`),
    count("quotations", `WHERE legacy_record_id ${target}`),
    count("invoices", `WHERE legacy_record_id ${target}`),
    count("payments", `WHERE legacy_record_id ${target}`),
  ]);
  return {
    // This is a join table, not an Opportunity record. Its rows must be removed
    // before removing the replaced legacy Cotizaciones.
    opportunityQuotes,
    businesses,
    contacts,
    projects,
    quotations,
    invoices,
    payments,
  };
}

function hasBlockingReferences(references: Awaited<ReturnType<typeof cotizacionesReferences>>) {
  return references.businesses + references.contacts + references.projects + references.quotations + references.invoices + references.payments > 0;
}

async function reconcile(rows: SourceRow[]) {
  const stored = await getD1().prepare("SELECT metadata FROM business_records WHERE module = 'cotizaciones' AND archived_at IS NULL").all<{ metadata: string }>();
  const byRow = new Map<number, Record<SourceField, string | null>>();
  for (const record of stored.results ?? []) {
    try {
      const parsed = JSON.parse(record.metadata) as { sourceRowNumber?: number; fields?: Record<SourceField, string | null> };
      if (parsed.sourceRowNumber && parsed.fields) byRow.set(parsed.sourceRowNumber, parsed.fields);
    } catch { /* malformed legacy metadata is an explicit mismatch */ }
  }
  const missing: number[] = [];
  const mismatches: Array<{ row: number; field: SourceField }> = [];
  for (const row of rows) {
    const saved = byRow.get(row.sourceRowNumber);
    if (!saved) { missing.push(row.sourceRowNumber); continue; }
    for (const field of SOURCE_HEADERS) if (saved[field] !== row.fields[field]) mismatches.push({ row: row.sourceRowNumber, field });
  }
  const expectedRows = new Set(rows.map((row) => row.sourceRowNumber));
  const extra = [...byRow.keys()].filter((row) => !expectedRows.has(row));
  return { missing, extra, mismatches };
}

export async function POST(request: Request) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const file = form.get("file");
  const action = String(form.get("action") ?? "dry-run");
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx") || file.size === 0 || file.size > 5_000_000) {
    return Response.json({ error: "Selecciona el libro XLSX de Cotizaciones (máximo 5 MB)." }, { status: 400 });
  }
  try {
    const parsed = await parseWorkbook(file);
    const targetCount = await count("business_records", "WHERE module = 'cotizaciones'");
    const references = await cotizacionesReferences();
    const dryRun = {
      worksheets: parsed.worksheets,
      sourceRows: parsed.rows.length,
      validRows: parsed.rows.length,
      transformedRows: parsed.rows.filter((row) => row.dueDate !== null).length,
      rowsToInsert: parsed.rows.length,
      rowsToUpdate: 0,
      rowsToSkip: 0,
      rowsBlocked: 0,
      duplicateQuotationNumbers: duplicates(parsed.rows),
      missingQuotationNumbers: parsed.rows.filter((row) => !row.fields["Cotización NO:"]).map((row) => row.sourceRowNumber),
      blankDateRows: parsed.rows.filter((row) => !row.fields.Fecha).map((row) => row.sourceRowNumber),
      businessesMatched: 0,
      businessesCreated: 0,
      contactsMatched: 0,
      contactsCreated: 0,
      unresolvedRelationships: 0,
      opportunityQuoteLinksToRemove: references.opportunityQuotes,
      blockingReferences: hasBlockingReferences(references) ? references : null,
      monetarySourceFields: 0,
      targetCount,
      sourceSha256: parsed.sourceSha256,
    };
    if (action === "dry-run") return Response.json({ ok: true, dryRun }, { headers: { "cache-control": "private, no-store" } });
    if (action !== "replace" || form.get("confirm") !== "REEMPLAZAR") return Response.json({ error: "La confirmación explícita es obligatoria." }, { status: 400 });
    const db = getD1();
    if (hasBlockingReferences(references)) {
      return Response.json({ error: "Existen referencias de CRM que impedirían reemplazar Cotizaciones sin modificar datos ajenos.", references }, { status: 409 });
    }
    const previous = await db.prepare("SELECT * FROM business_records WHERE module = 'cotizaciones' ORDER BY created_at").all<Record<string, unknown>>();
    if ((previous.results ?? []).length !== targetCount) return Response.json({ error: "El respaldo no coincide con el conteo de Cotizaciones; no se modificó nada." }, { status: 409 });
    const now = new Date().toISOString();
    const backupId = crypto.randomUUID();
    const backupObjectKey = `backups/cotizaciones-business-records/${backupId}.json`;
    const unrelatedBefore = { businesses: await count("businesses"), contacts: await count("contacts"), opportunities: await count("opportunities"), projects: await count("projects"), quotations: await count("quotations") };
    const relatedOpportunityQuotes = await db.prepare("SELECT * FROM opportunity_quotes WHERE quote_record_id IN (SELECT id FROM business_records WHERE module = 'cotizaciones')").all<Record<string, unknown>>();
    await filesBucket().put(backupObjectKey, JSON.stringify({ backupId, createdAt: now, table: "business_records", module: "cotizaciones", records: previous.results, removedOpportunityQuoteLinks: relatedOpportunityQuotes.results, unrelatedBefore }), { httpMetadata: { contentType: "application/json" } });
    const rows = parsed.rows.map((row) => [crypto.randomUUID(), "cotizaciones", row.fields["Cotización NO:"] ?? "", "", row.fields.Cliente ?? "", row.fields.Contacto ?? "", 0, 0, row.dueDate, "", sourceMetadata(row, file.name, parsed.sourceSha256), auth.user.email, now, now]);
    const recordInserts = insertBatches("business_records", ["id", "module", "title", "status", "customer_name", "contact", "amount", "balance", "due_date", "notes", "metadata", "created_by", "created_at", "updated_at"], rows);
    const ids = rows.map((row) => String(row[0]));
    const searchInserts = insertBatches("search_documents", ["entity_type", "entity_id", "title", "subtitle", "search_text", "owner_email", "updated_at"], parsed.rows.map((row, index) => ["quote", ids[index], row.fields["Cotización NO:"] ?? "", row.fields.Cliente ?? "", [...SOURCE_HEADERS.map((field) => row.fields[field]), String(row.sourceRowNumber)].filter(Boolean).join(" "), auth.user.email, now]));
    await db.batch([
      db.prepare("DELETE FROM search_documents WHERE entity_type = 'quote' AND entity_id IN (SELECT id FROM business_records WHERE module = 'cotizaciones')"),
      db.prepare("DELETE FROM opportunity_quotes WHERE quote_record_id IN (SELECT id FROM business_records WHERE module = 'cotizaciones')"),
      db.prepare("DELETE FROM business_records WHERE module = 'cotizaciones'"),
      ...recordInserts.map((insert) => db.prepare(insert.sql).bind(...insert.values)),
      ...searchInserts.map((insert) => db.prepare(insert.sql).bind(...insert.values)),
      db.prepare("INSERT INTO audit_log (actor_email, action, entity_type, entity_id, detail, created_at) VALUES (?, 'replace', 'cotizaciones', ?, ?, ?)").bind(auth.user.email, backupId, JSON.stringify({ sourceSha256: parsed.sourceSha256, sourceRows: EXPECTED_COUNT, backupObjectKey }), now),
    ]);
    const finalCount = await count("business_records", "WHERE module = 'cotizaciones' AND archived_at IS NULL");
    const reconciliation = await reconcile(parsed.rows);
    const unrelatedAfter = { businesses: await count("businesses"), contacts: await count("contacts"), opportunities: await count("opportunities"), projects: await count("projects"), quotations: await count("quotations") };
    if (finalCount !== EXPECTED_COUNT || reconciliation.missing.length || reconciliation.extra.length || reconciliation.mismatches.length || JSON.stringify(unrelatedBefore) !== JSON.stringify(unrelatedAfter)) {
      return Response.json({ error: "La reconciliación posterior falló; el respaldo está disponible.", backupId, backupObjectKey, finalCount, reconciliation, unrelatedBefore, unrelatedAfter }, { status: 500 });
    }
    return Response.json({ ok: true, backupId, backupObjectKey, originalCount: targetCount, deleted: targetCount, imported: EXPECTED_COUNT, finalCount, reconciliation, dryRun, unrelatedBefore, unrelatedAfter });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 422 });
  }
}
