export type ImportSummary = {
  id: string;
  filename: string;
  extension: string;
  sourcePath: string;
  templateType: string;
  parserName: string;
  documentKind: string;
  status: string;
  importedBy: string;
  importedAt: string;
  reviewedBy: string | null;
  acceptedAt: string | null;
  errorMessage: string;
  openIssues?: number;
  canonicalLinks: Record<string, string>;
};

export type ImportIssue = {
  id: string;
  type: string;
  severity: string;
  status: string;
  title: string;
  detail: string;
  sourceLocation: string;
  resolution: string;
};

export type ImportCandidate = {
  id: string;
  candidateType: string;
  candidateEntityId: string;
  score: number;
  reasons: string[];
  status: string;
};

export type SourceFieldValue = {
  id: string;
  sourceSheet: string;
  sourcePage: number | null;
  sourceCell: string;
  sourceLabel: string;
  rawValue: string;
  displayValue: string;
  normalizedValue: string;
  canonicalEntity: string;
  canonicalField: string;
  confidence: string;
  valueState: string;
  mappingStatus: string;
};

export type ImportDetail = {
  import: ImportSummary;
  batch: {
    id: string;
    status: string;
    dryRun: boolean;
  };
  document: {
    id: string;
    name: string;
    size: number;
    extension: string;
    sourcePath: string;
    sha256: string;
    parsingStatus: string;
  };
  preview: Record<string, unknown>;
  issues: ImportIssue[];
  candidates: ImportCandidate[];
  sourceValues: SourceFieldValue[];
};

export type RegisterImportRow = {
  id: string;
  source_row_number: number;
  outcome: string;
  match_confidence: string;
  source_filename: string;
  source_document_uri: string;
  source_origin: string;
  normalized_values: {
    date: string | null;
    month: number | null;
    year: number | null;
    quotationNumber: string;
    customerName: string;
    rnc: string;
    contactName: string;
    phone: string;
    mobilePhone: string;
    email: string;
    address: string;
    projectAddress: string;
  };
  raw_values: Record<
    string,
    {
      raw: string;
      display: string;
      formula: string;
      state: string;
      sourceCell: string;
    }
  >;
  warnings: string[];
  errors: string[];
  open_issue_count: number;
};

export type RegisterImportData = {
  batch: Record<string, unknown> & {
    summary?: Record<string, number>;
    total_rows?: number;
    successful_count?: number;
    matched_count?: number;
    duplicate_count?: number;
    review_count?: number;
    failed_count?: number;
  };
  sources: Array<{
    origin_label: string;
    expected_rows: number;
    discovered_rows: number;
    imported_rows: number;
    matched_rows: number;
    duplicate_rows: number;
    review_rows: number;
    failed_rows: number;
  }>;
  rows: RegisterImportRow[];
  total: number;
  limit: number;
  offset: number;
};

export type QuotationSummary = {
  id: string;
  quotationNumber: string;
  quotationYear: number | null;
  title: string;
  quotationType: string;
  serviceCategory: string;
  status: string;
  currency: string;
  businessId: string;
  businessName: string;
  contactName: string | null;
  projectName: string | null;
  currentRevisionId: string | null;
  revisionNumber: number | null;
  revisionLabel: string | null;
  alternativeLabel: string | null;
  quotationDate: string | null;
  quotationMonth: number | null;
  sourceTotal: number | null;
  calculatedTotal: number | null;
  paymentStatus: string | null;
  sourceFilename: string | null;
  importBatchId: string | null;
  rnc?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  contactMobilePhone?: string | null;
  sourceRowNumber?: number | null;
  sourceDocumentUri?: string | null;
  sourceAddress?: string | null;
  sourceProjectAddress?: string | null;
  updatedAt: string;
};

export type CotizacionSourceRecord = {
  sourceRowNumber: number;
  sourceDate: string | null;
  sourceMonth: string | null;
  sourceYear: number | null;
  sourceQuotationNumber: string | null;
  sourceCustomerName: string | null;
  sourceRnc: string | null;
  sourceContact: string | null;
  sourcePhone: string | null;
  sourceMobilePhone: string | null;
  sourceEmail: string | null;
  sourceAddress: string | null;
  sourceProjectAddress: string | null;
  sourceFilename: string | null;
  sourceDocumentUri: string | null;
  sourceWorkbook: string;
  sourceSha256: string;
};

export type QuotationDetail = Record<string, unknown> & {
  quotation: QuotationSummary & Record<string, unknown>;
  sourceRecord: CotizacionSourceRecord | null;
  revisions: Array<Record<string, unknown>>;
  revision: Record<string, unknown> | null;
  lineItems: Array<Record<string, unknown>>;
  measurements: Array<Record<string, unknown>>;
  financials: Record<string, unknown> | null;
  charges: Array<Record<string, unknown>>;
  terms: Record<string, unknown> | null;
  payments: Array<Record<string, unknown>>;
  addresses: Array<Record<string, unknown>>;
  documents: Array<Record<string, unknown>>;
  sourceReferences: Array<Record<string, unknown>>;
  warnings: Array<Record<string, unknown>>;
  history: Array<Record<string, unknown>>;
  manufacturing: Array<Record<string, unknown>>;
  materialComponents: Array<Record<string, unknown>>;
  internalVisible: boolean;
};
