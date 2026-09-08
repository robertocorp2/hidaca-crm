import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getD1, getDb } from "../../db";
import {
  ecfArtifacts,
  ecfDocuments,
  ecfIssuerProfiles,
  ecfSequenceAllocations,
  ecfSequenceRanges,
  ecfSubmissionAttempts,
  ecfStatusHistory,
  ecfValidations,
} from "../../db/schema";
import { writeAudit } from "./audit";
import {
  buildFiscalSnapshot,
  ecfTypes,
  generateEcfXml,
  snapshotHash,
  type EcfEnvironment,
  type EcfFiscalSnapshot,
  type EcfType,
  validateFiscalSnapshot,
} from "./ecf-domain";

type RawRow = Record<string, unknown>;

export type EcfReview = {
  invoice: RawRow;
  lines: RawRow[];
  snapshot: EcfFiscalSnapshot;
  issues: ReturnType<typeof validateFiscalSnapshot>;
  existing: RawRow | null;
  environment: EcfEnvironment;
  ecfType: EcfType;
};

export function ecfFeatureEnabled() {
  return env.ECF_ENABLED !== "false";
}

export function ecfProductionEnabled() {
  return env.ECF_PRODUCTION_ENABLED === "true";
}

export async function buildEcfReview(invoiceId: string, input: { ecfType?: unknown; environment?: unknown } = {}): Promise<EcfReview | null> {
  const environment = normalizeEnvironment(input.environment);
  const ecfType = normalizeType(input.ecfType);
  const invoice = await getInvoice(invoiceId);
  if (!invoice) return null;
  const lines = await getRows(`SELECT il.*, tc.code AS tax_configuration_code, tc.label AS tax_configuration_label, tc.rate AS tax_rate FROM invoice_lines il LEFT JOIN tax_configurations tc ON tc.id = il.tax_configuration_id WHERE il.invoice_id = ? ORDER BY il.line_number`, invoiceId);
  const issuerProfile = await getRows(`SELECT * FROM ecf_issuer_profiles WHERE environment = ? AND enabled = 1 ORDER BY updated_at DESC LIMIT 1`, environment).then((rows) => rows[0] ?? null);
  const receiverProfile = await getRows(`SELECT * FROM ecf_party_profiles WHERE business_id = ? LIMIT 1`, stringValue(invoice.business_id)).then((rows) => rows[0] ?? null);
  const snapshot = buildFiscalSnapshot({
    ecfType,
    environment,
    invoice,
    lines,
    issuer: issuerProfile ?? {},
    receiver: receiverProfile ? { ...invoice, ...receiverProfile } : invoice,
    supplements: parseJson(input as RawRow).supplements,
  });
  const issues = validateFiscalSnapshot(snapshot);
  const existing = await getDb().select().from(ecfDocuments)
    .where(and(eq(ecfDocuments.sourceInvoiceId, invoiceId), eq(ecfDocuments.ecfType, ecfType), eq(ecfDocuments.environment, environment)))
    .limit(1).then((rows) => rows[0] ?? null);
  return { invoice, lines, snapshot, issues, existing: existing as RawRow | null, environment, ecfType };
}

export async function generateEcf(input: {
  invoiceId: string;
  ecfType: EcfType;
  environment: EcfEnvironment;
  actorEmail: string;
  idempotencyKey: string;
  supplements?: Record<string, string | number | boolean>;
}) {
  if (input.environment === "production" && !ecfProductionEnabled()) {
    throw new EcfServiceError("PRODUCTION_DISABLED", "El ambiente productivo está bloqueado hasta completar la certificación DGII.", 409);
  }
  const review = await buildEcfReview(input.invoiceId, input);
  if (!review) throw new EcfServiceError("INVOICE_NOT_FOUND", "Factura no encontrada.", 404);
  if (review.existing) return { document: review.existing, duplicate: true, issues: review.issues };
  const errors = review.issues.filter((issue) => issue.severity === "error");
  if (errors.length) throw new EcfValidationError(review.issues);
  const profile = await getDb().select().from(ecfIssuerProfiles)
    .where(and(eq(ecfIssuerProfiles.environment, input.environment), eq(ecfIssuerProfiles.enabled, true))).limit(1);
  if (!profile[0]) throw new EcfServiceError("ISSUER_PROFILE_MISSING", "Configura y habilita el perfil fiscal del emisor antes de generar.", 422);
  const sequence = await allocateSequence(profile[0].id, input.environment, input.ecfType);
  const id = crypto.randomUUID();
  const snapshot = { ...review.snapshot, supplements: input.supplements ?? review.snapshot.supplements };
  const hash = await snapshotHash(snapshot);
  const xml = generateEcfXml(snapshot, sequence.encf);
  const now = new Date().toISOString();
  const db = getDb();
  try {
    const [document] = await db.insert(ecfDocuments).values({
      id,
      sourceInvoiceId: input.invoiceId,
      parentEcfId: "",
      issuerProfileId: profile[0].id,
      environment: input.environment,
      ecfType: input.ecfType,
      encf: sequence.encf,
      status: "generated",
      fiscalSnapshotJson: JSON.stringify(snapshot),
      fiscalSnapshotHash: hash,
      schemaVersion: snapshot.schemaVersion,
      validationSummary: JSON.stringify({ local: "passed", xsd: "pending", warnings: review.issues.filter((issue) => issue.severity !== "error").length }),
      createdBy: input.actorEmail,
      createdAt: now,
      updatedAt: now,
    }).returning();
    await db.insert(ecfSequenceAllocations).values({ id: crypto.randomUUID(), sequenceRangeId: sequence.rangeId, ecfDocumentId: id, encf: sequence.encf, allocatedAt: now });
    await db.insert(ecfSubmissionAttempts).values({ id: crypto.randomUUID(), ecfDocumentId: id, operation: "generate", idempotencyKey: input.idempotencyKey, outcome: "completed", startedAt: now, finishedAt: now });
    if (review.issues.length) await db.insert(ecfValidations).values(review.issues.map((issue) => ({ id: crypto.randomUUID(), ecfDocumentId: id, phase: "local", severity: issue.severity, code: issue.code, path: issue.path, message: issue.message, schemaVersion: "1.0", createdAt: now })));
    const artifact = await saveArtifact(id, input.actorEmail, xml, "xml_unsigned", "application/xml");
    await db.insert(ecfStatusHistory).values({ id: crypto.randomUUID(), ecfDocumentId: id, fromStatus: "draft", toStatus: "generated", actorEmail: input.actorEmail, detail: "XML estructural generado; validación XSD oficial pendiente de configuración.", createdAt: now });
    await writeAudit(input.actorEmail, "generate", "ecf", id, sequence.encf);
    return { document, artifact, issues: review.issues, duplicate: false };
  } catch (error) {
    await db.update(ecfSequenceRanges).set({ nextNumber: sequence.number, updatedAt: now }).where(eq(ecfSequenceRanges.id, sequence.rangeId));
    const existing = await db.select().from(ecfDocuments).where(and(eq(ecfDocuments.sourceInvoiceId, input.invoiceId), eq(ecfDocuments.ecfType, input.ecfType), eq(ecfDocuments.environment, input.environment))).limit(1);
    if (existing[0]) return { document: existing[0], duplicate: true, issues: review.issues };
    throw error;
  }
}

async function allocateSequence(issuerProfileId: string, environment: EcfEnvironment, ecfType: EcfType) {
  const range = await getDb().select().from(ecfSequenceRanges).where(and(eq(ecfSequenceRanges.issuerProfileId, issuerProfileId), eq(ecfSequenceRanges.environment, environment), eq(ecfSequenceRanges.ecfType, ecfType), eq(ecfSequenceRanges.active, true))).limit(1).then((rows) => rows[0]);
  if (!range) throw new EcfServiceError("SEQUENCE_RANGE_MISSING", "No hay un rango e-NCF activo para este tipo y ambiente.", 422);
  const allocated = await getD1().prepare("UPDATE ecf_sequence_ranges SET next_number = next_number + 1, updated_at = ? WHERE id = ? AND active = 1 AND next_number <= end_number RETURNING next_number - 1 AS number").bind(new Date().toISOString(), range.id).first<{ number: number }>();
  if (!allocated?.number) throw new EcfServiceError("SEQUENCE_EXHAUSTED", "El rango e-NCF no tiene secuencias disponibles.", 409);
  return { rangeId: range.id, number: allocated.number, encf: `${range.prefix}${ecfType}${String(allocated.number).padStart(10, "0")}` };
}

async function saveArtifact(ecfDocumentId: string, actorEmail: string, value: string, kind: string, mimeType: string) {
  if (!env.FILES) throw new EcfServiceError("ARTIFACT_STORAGE_MISSING", "El almacenamiento de archivos e-CF no está configurado.", 503);
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join("");
  const id = crypto.randomUUID();
  const storageKey = `ecf/${ecfDocumentId}/${kind}-v1.xml`;
  await env.FILES.put(storageKey, bytes, { httpMetadata: { contentType: mimeType } });
  const [artifact] = await getDb().insert(ecfArtifacts).values({ id, ecfDocumentId, kind, storageKey, mimeType, sha256, byteLength: bytes.byteLength, version: 1, createdBy: actorEmail, createdAt: new Date().toISOString() }).returning();
  return artifact;
}

async function getInvoice(id: string) {
  const rows = await getRows(`SELECT i.*, b.name AS business_name, b.rnc AS business_rnc, b.address AS business_address, b.phone AS business_phone, b.email AS business_email, b.mobile_phone AS business_mobile_phone, c.name AS contact_name, c.email AS contact_email, c.phone AS contact_phone FROM invoices i JOIN businesses b ON b.id = i.business_id LEFT JOIN contacts c ON c.id = i.contact_id WHERE i.id = ? AND i.archived_at IS NULL`, id);
  return rows[0] ?? null;
}

async function getRows<T extends RawRow = RawRow>(query: string, ...bindings: unknown[]) {
  return (await getD1().prepare(query).bind(...bindings).all<T>()).results ?? [];
}

function normalizeType(value: unknown): EcfType { return ecfTypes.includes(String(value) as EcfType) ? String(value) as EcfType : "31"; }
function normalizeEnvironment(value: unknown): EcfEnvironment { return value === "certification" || value === "production" ? value : "test"; }
function stringValue(value: unknown) { return value === null || value === undefined ? "" : String(value).trim(); }
function parseJson(value: RawRow) { return value && typeof value.supplements === "object" && value.supplements ? { supplements: value.supplements as Record<string, string | number | boolean> } : { supplements: {} }; }

export class EcfServiceError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}
export class EcfValidationError extends EcfServiceError {
  constructor(public readonly issues: ReturnType<typeof validateFiscalSnapshot>) { super("VALIDATION_FAILED", "La factura necesita datos fiscales antes de generar el e-CF.", 422); }
}
