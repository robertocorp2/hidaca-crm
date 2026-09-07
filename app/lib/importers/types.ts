import type {
  CanonicalSourceValue,
  ImportIssueDraft,
  QuotationType,
  ValueState,
} from "../source-domain";

export type JsonPrimitive = string | number | boolean | null;

export type ExtractedCell = {
  sheet: string;
  address: string;
  row: number;
  column: number;
  rawValue: JsonPrimitive;
  displayValue: string;
  formula: string;
  cellType: string;
};

export type ExtractedSheet = {
  name: string;
  range: string;
  cells: ExtractedCell[];
  merges: string[];
};

export type ExtractedPage = {
  pageNumber: number;
  text: string;
};

export type ImportExtraction = {
  format: "pdf" | "xlsx" | "xlsm" | "xlsb";
  parserName: string;
  parserVersion: string;
  sheets: ExtractedSheet[];
  pages: ExtractedPage[];
  hasMacros: boolean;
  partial: boolean;
  warnings: string[];
};

export type NormalizedLineItem = {
  sourceSheet: string;
  sourceRange: string;
  description: string;
  itemCode: string;
  category: string;
  location: string;
  quantity: number | null;
  unitOfMeasure: string;
  meters: number | null;
  openingWidthCm: number | null;
  openingHeightCm: number | null;
  finishedWidthCm: number | null;
  finishedHeightCm: number | null;
  areaSqm: number | null;
  priceBasis: "unit" | "square_meter" | "flat_fee" | "other" | null;
  unitPrice: number | null;
  pricePerSqm: number | null;
  flatFee: number | null;
  sourceLineTotal: number | null;
  calculatedLineTotal: number | null;
  currency: string;
  notes: string;
  valueStates: Record<string, ValueState>;
  sourceValues: Record<string, string>;
};

export type NormalizedCharge = {
  type:
    | "installation"
    | "repair"
    | "maintenance"
    | "transportation"
    | "scaffolding"
    | "technical_supervision"
    | "discount"
    | "tax"
    | "other";
  label: string;
  sourceAmount: number | null;
  calculatedAmount: number | null;
  rate: number | null;
  currency: string;
  valueState: ValueState;
  sourceLocation: string;
};

export type NormalizedMaterialComponent = {
  name: string;
  componentType:
    | "slat"
    | "box"
    | "tube"
    | "motor"
    | "side_cap"
    | "control"
    | "receiver"
    | "material"
    | "labor"
    | "other";
  quantity: number | null;
  unitCost: number | null;
  totalCost: number | null;
  sourceFormula: string;
  formulaResult: string;
  formulaStatus: "valid" | "broken" | "unsupported" | "not_calculated";
  sourceSheet: string;
  sourceRange: string;
  sourceValues: Record<string, string>;
};

export type NormalizedImportPreview = {
  templateType:
    | "installation"
    | "repair_maintenance"
    | "production"
    | "register"
    | "unknown";
  company: {
    legalName: string;
    rnc: string;
    address: string;
    phone: string;
    email: string;
    salesRepresentative: string;
    department: string;
  };
  business: {
    name: string;
    customerType: "organization" | "individual";
    rnc: string;
    email: string;
    phone: string;
    mobilePhone: string;
    address: string;
  };
  contact: {
    name: string;
    email: string;
    phone: string;
    mobilePhone: string;
  };
  project: {
    name: string;
    description: string;
    serviceCategory: string;
    address: string;
  };
  quotation: {
    quotationNumber: string;
    baseNumber: string;
    quotationYear: number | null;
    title: string;
    quotationType: QuotationType;
    serviceCategory: string;
    currency: string;
  };
  revision: {
    revisionNumber: number;
    revisionLabel: string;
    alternativeLabel: string;
    scopeLabel: string;
    quotationDate: string | null;
    sourceDateRaw: string;
    identityKey: string;
  };
  lineItems: NormalizedLineItem[];
  financials: {
    currency: string;
    sourceSubtotal: number | null;
    calculatedSubtotal: number | null;
    discountRate: number | null;
    discountAmount: number | null;
    sourceTaxRate: number | null;
    sourceTaxAmount: number | null;
    calculatedTaxAmount: number | null;
    sourceTotal: number | null;
    calculatedTotal: number | null;
    discrepancyAmount: number | null;
    paymentStatus: "unpaid" | "partial" | "paid" | "overdue" | "unknown";
    valueStates: Record<string, ValueState>;
    sourceValues: Record<string, string>;
  };
  charges: NormalizedCharge[];
  payments: Array<{
    type: "advance" | "partial" | "final" | "refund" | "adjustment";
    amount: number | null;
    currency: string;
    paymentDate: string | null;
    method: string;
    status: "pending" | "received" | "cleared" | "void" | "unknown";
    label: string;
    installmentReference: string;
    notes: string;
    sourceLocation: string;
    sourceValues: Record<string, string>;
  }>;
  terms: {
    quotationValidity: string;
    paymentConditions: string;
    warranty: string;
    returnPolicy: string;
    installationObservations: string;
    maintenanceDisclaimer: string;
    unforeseenPartsDisclaimer: string;
    additionalCostNotice: string;
    originalSpanishText: string;
  };
  manufacturing: Array<{
    name: string;
    worksheetType:
      "material_breakdown" | "bill_of_materials" | "production" | "other";
    sourceSheet: string;
    sourceRange: string;
    calculationStatus:
      "valid" | "warning" | "broken" | "unsupported" | "not_calculated";
    components: NormalizedMaterialComponent[];
    formulaSummary: Record<string, string>;
  }>;
  sourceValues: CanonicalSourceValue[];
  issues: ImportIssueDraft[];
};

export type InvoiceDocumentKind =
  | "invoice"
  | "receipt"
  | "payment_evidence"
  | "credit_note"
  | "invoice_register"
  | "other";

export type InvoiceSourceManifestEntry = {
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  sourceModifiedAt: string | null;
  sha256: string;
  downloadStatus: "downloaded" | "inaccessible";
  deltaStatus:
    | "unchanged"
    | "added"
    | "changed"
    | "removed"
    | "inaccessible";
  parseStatus:
    | "parsed"
    | "partial"
    | "unreadable"
    | "unsupported"
    | "irrelevant";
  parserName: string;
  parserVersion: string;
  warnings: string[];
};

export type InvoiceStagingRow = {
  identityFingerprint: string;
  documentKind: InvoiceDocumentKind;
  rawValues: Record<string, unknown>;
  normalizedValues: Record<string, unknown>;
  sourceReferences: Array<{
    documentId: string;
    field?: string;
    sheet?: string;
    page?: number;
    row?: number;
    cell?: string;
    rawValue: string;
    displayValue: string;
    formula?: string;
  }>;
};

export type InvoiceMatchDecision = {
  decision:
    | "create"
    | "link"
    | "duplicate"
    | "new_version"
    | "cancelled_replaced"
    | "manual_review"
    | "exclude";
  targetEntityType: string;
  targetEntityId: string | null;
  confidence: "exact_unique" | "candidate" | "manual";
  rule: string;
  evidence: string[];
};

export type PaymentAllocationDraft = {
  paymentStagingId: string;
  invoiceStagingId: string;
  amount: number;
  currency: string;
  allocationDate: string | null;
  evidenceDocumentId: string;
  decision: "ready" | "manual_review" | "blocked";
};

export type ImportReconciliationResult = {
  expectedFiles: number;
  parsedFiles: number;
  partialFiles: number;
  unreadableFiles: number;
  invoiceCount: number;
  duplicateCount: number;
  reviewCount: number;
  createdCount: number;
  linkedCount: number;
  totals: Record<string, number | null>;
  openIssuesByType: Record<string, number>;
  balanced: boolean;
};

export type InvoiceImportPreview = {
  batchId: string;
  files: InvoiceSourceManifestEntry[];
  /** PDFs are intentionally excluded from spreadsheet-led invoice batches. */
  ignoredFiles: string[];
  invoices: InvoiceStagingRow[];
  decisions: InvoiceMatchDecision[];
  allocations: PaymentAllocationDraft[];
  issues: Array<{
    type: string;
    severity: string;
    sourceLocation: string;
  }>;
  reconciliation: ImportReconciliationResult;
};
