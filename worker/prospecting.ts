import { GooglePlaces, HunterAdapter, ProviderAdapter } from "../app/lib/prospecting/providers";
import { ProspectingError } from "../app/lib/prospecting/contracts";
import { Repository } from "../app/lib/prospecting/repository";
import { WorkerRuntime } from "../app/lib/prospecting/runtime";
import { MaintenanceModeError, withWriteLease } from "../app/lib/write-barrier";

export default {
  async scheduled(_controller, env, ctx) {
    const runtime = new WorkerRuntime(new Repository(env.DB), env, {
      discovery: () => new GooglePlaces(env.GOOGLE_PLACES_API_KEY ?? ""),
      enrichment: provider => {
        if (provider === "pagespeed") return new ProviderAdapter(provider, env.PAGESPEED_API_KEY ?? "");
        if (provider === "builtwith") return new ProviderAdapter(provider, env.BUILTWITH_API_KEY ?? "");
        if (provider === "hunter") return new HunterAdapter(env.HUNTER_API_KEY ?? "");
        throw new ProspectingError("unsupported");
      },
      contactEncryptionKey: () => env.PROSPECTING_CONTACT_ENCRYPTION_KEY ?? "",
    });
    // The core CRM supports one tenant. A future multi-tenant deployment needs
    // an explicitly scoped CRM adapter before adding another tenant here.
    ctx.waitUntil((async () => {
      try {
        await withWriteLease(env.DB, "prospecting-scheduled", () => runtime.tick("hidaca"));
      } catch (error) {
        if (error instanceof MaintenanceModeError) {
          console.info("[prospecting] maintenance mode is active; scheduled writes were skipped");
          return;
        }
        throw error;
      }
    })());
  },
} satisfies ExportedHandler<ProspectingWorkerEnv>;
