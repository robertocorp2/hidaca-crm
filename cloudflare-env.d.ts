declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    FILES: R2Bucket;
    ASSETS: Fetcher;
    INVOICE_IMPORT_PHASE1_ENABLED?: string;
    INVOICE_PRODUCTION_IMPORT_ENABLED?: string;
  }
}
