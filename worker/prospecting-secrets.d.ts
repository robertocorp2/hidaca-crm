/** Managed secret bindings, deliberately absent from the web worker config.
 * These declarations augment Wrangler-generated non-secret binding types. */
interface ProspectingWorkerEnv {
  GOOGLE_PLACES_API_KEY?: string;
  PAGESPEED_API_KEY?: string;
  BUILTWITH_API_KEY?: string;
  HUNTER_API_KEY?: string;
  PROSPECTING_CONTACT_ENCRYPTION_KEY?: string;
}
