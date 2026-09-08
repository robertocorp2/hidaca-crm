import assert from "node:assert/strict";
import test from "node:test";
import {
  invoiceImportFeatureFlag,
  invoiceImportRouteDisabledStatus,
  isInvoiceImportPhase1Enabled,
  isInvoiceProductionImportEnabled,
  invoiceProductionImportFeatureFlag,
} from "../app/lib/invoice-import-feature";
import { isMultipartFile } from "../app/lib/import-service";
import type {
  ImportReconciliationResult,
  InvoiceImportPreview,
  InvoiceMatchDecision,
  InvoiceSourceManifestEntry,
  InvoiceStagingRow,
  PaymentAllocationDraft,
} from "../app/lib/importers";
import type {
  importCandidates,
  importFiles,
  importIssues,
  payments,
} from "../db/schema";

type ImportIssueInsert = typeof importIssues.$inferInsert;
type ImportCandidateInsert = typeof importCandidates.$inferInsert;
type ImportFileInsert = typeof importFiles.$inferInsert;
type PaymentInsert = typeof payments.$inferInsert;

const invoiceIssueTypes = [
  "ocr_required",
  "duplicate_ncf",
  "cancelled_replacement_ambiguity",
  "tax_treatment_unexplained",
  "negative_balance",
  "payment_evidence_missing",
  "orphan_credit_note",
  "document_matrix_conflict",
] satisfies Array<ImportIssueInsert["type"]>;

const invoiceCandidateTypes = [
  "invoice",
  "payment",
  "credit_note",
  "tax_configuration",
] satisfies Array<ImportCandidateInsert["candidateType"]>;

const documentKinds = [
  "invoice",
  "receipt",
  "payment_evidence",
  "credit_note",
  "invoice_register",
  "other",
] satisfies Array<ImportFileInsert["documentKind"]>;

const paymentEvidenceStatuses = [
  "documented",
  "matrix_only",
  "manual",
  "unverified",
] satisfies Array<PaymentInsert["evidenceStatus"]>;

const manifestEntry = {
  relativePath: "FACTURAS HIDACA/2026/ENERO/F0001.pdf",
  filename: "F0001.pdf",
  extension: ".pdf",
  sizeBytes: 1024,
  sourceModifiedAt: "2026-01-10T00:00:00.000Z",
  sha256: "a".repeat(64),
  downloadStatus: "downloaded",
  deltaStatus: "unchanged",
  parseStatus: "parsed",
  parserName: "pdf",
  parserVersion: "1.0.0",
  warnings: [],
} satisfies InvoiceSourceManifestEntry;

const stagingRow = {
  identityFingerprint: "invoice-fingerprint",
  documentKind: "invoice",
  rawValues: { invoice_number: "F0001" },
  normalizedValues: { invoice_number: "F0001" },
  sourceReferences: [
    {
      documentId: "document-1",
      page: 1,
      rawValue: "F0001",
      displayValue: "F0001",
    },
  ],
} satisfies InvoiceStagingRow;

const matchDecision = {
  decision: "manual_review",
  targetEntityType: "invoice",
  targetEntityId: null,
  confidence: "candidate",
  rule: "Invoice number without a unique NCF never auto-links.",
  evidence: ["document-1:page-1"],
} satisfies InvoiceMatchDecision;

const allocation = {
  paymentStagingId: "payment-staging-1",
  invoiceStagingId: "invoice-staging-1",
  amount: 500,
  currency: "DOP",
  allocationDate: "2026-01-10",
  evidenceDocumentId: "receipt-1",
  decision: "ready",
} satisfies PaymentAllocationDraft;

const reconciliation = {
  expectedFiles: 1,
  parsedFiles: 1,
  partialFiles: 0,
  unreadableFiles: 0,
  invoiceCount: 1,
  duplicateCount: 0,
  reviewCount: 1,
  createdCount: 0,
  linkedCount: 0,
  totals: { invoice_total: 1000 },
  openIssuesByType: { manual_review: 1 },
  balanced: false,
} satisfies ImportReconciliationResult;

const preview = {
  batchId: "batch-1",
  files: [manifestEntry],
  ignoredFiles: ["invoice-reference.pdf"],
  invoices: [stagingRow],
  decisions: [matchDecision],
  allocations: [allocation],
  issues: [
    {
      type: "manual_review",
      severity: "warning",
      sourceLocation: "document-1:page-1",
    },
  ],
  reconciliation,
} satisfies InvoiceImportPreview;

test("invoice import contracts preserve evidence and reconciliation decisions", () => {
  assert.equal(preview.files[0].sha256.length, 64);
  assert.deepEqual(preview.ignoredFiles, ["invoice-reference.pdf"]);
  assert.equal(preview.invoices[0].sourceReferences[0].rawValue, "F0001");
  assert.equal(preview.decisions[0].confidence, "candidate");
  assert.equal(preview.allocations[0].evidenceDocumentId, "receipt-1");
  assert.equal(preview.reconciliation.balanced, false);
  assert.ok(invoiceIssueTypes.includes("duplicate_ncf"));
  assert.ok(invoiceCandidateTypes.includes("invoice"));
  assert.ok(documentKinds.includes("payment_evidence"));
  assert.ok(paymentEvidenceStatuses.includes("matrix_only"));
});

test("normalized invoice functionality is disabled by default", () => {
  assert.equal(invoiceImportFeatureFlag, "INVOICE_IMPORT_PHASE1_ENABLED");
  assert.equal(isInvoiceImportPhase1Enabled(), false);
  assert.equal(isInvoiceImportPhase1Enabled({}), false);
  assert.equal(
    isInvoiceImportPhase1Enabled({
      INVOICE_IMPORT_PHASE1_ENABLED: "false",
    }),
    false,
  );
  assert.equal(
    isInvoiceImportPhase1Enabled({
      INVOICE_IMPORT_PHASE1_ENABLED: " TRUE ",
    }),
    true,
  );
  assert.equal(
    invoiceImportRouteDisabledStatus({
      INVOICE_IMPORT_PHASE1_ENABLED: "true",
    }),
    null,
  );
  assert.equal(invoiceImportRouteDisabledStatus(), 404);
  assert.equal(
    invoiceProductionImportFeatureFlag,
    "INVOICE_PRODUCTION_IMPORT_ENABLED",
  );
  assert.equal(isInvoiceProductionImportEnabled(), false);
  assert.equal(
    isInvoiceProductionImportEnabled({
      INVOICE_PRODUCTION_IMPORT_ENABLED: "true",
    }),
    true,
  );
});

test("multipart uploads are accepted structurally across edge-runtime realms", () => {
  const crossRealmFile = {
    name: "F0048.xlsx",
    size: 1024,
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as FormDataEntryValue;

  assert.equal(isMultipartFile(crossRealmFile), true);
  assert.equal(isMultipartFile("F0048.xlsx"), false);
});
