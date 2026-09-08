export const invoiceImportFeatureFlag =
  "INVOICE_IMPORT_PHASE1_ENABLED" as const;
export const invoiceProductionImportFeatureFlag =
  "INVOICE_PRODUCTION_IMPORT_ENABLED" as const;

type InvoiceImportFeatureEnvironment = {
  INVOICE_IMPORT_PHASE1_ENABLED?: string;
  INVOICE_PRODUCTION_IMPORT_ENABLED?: string;
};

export function isInvoiceImportPhase1Enabled(
  environment: InvoiceImportFeatureEnvironment = {},
) {
  return environment.INVOICE_IMPORT_PHASE1_ENABLED?.trim().toLowerCase() ===
    "true";
}

// A null result means API authorization may continue. A disabled feature is
// intentionally hidden from the public route surface.
export function invoiceImportRouteDisabledStatus(
  environment: InvoiceImportFeatureEnvironment = {},
) {
  return isInvoiceImportPhase1Enabled(environment) ? null : 404;
}

export function isInvoiceProductionImportEnabled(
  environment: InvoiceImportFeatureEnvironment = {},
) {
  return environment.INVOICE_PRODUCTION_IMPORT_ENABLED?.trim().toLowerCase() ===
    "true";
}
