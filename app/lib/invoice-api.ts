import { env } from "cloudflare:workers";
import { authorizeApi } from "./authorization";
import {
  invoiceImportRouteDisabledStatus,
  isInvoiceImportPhase1Enabled,
} from "./invoice-import-feature";

export function normalizedInvoiceFeatureEnabled() {
  return isInvoiceImportPhase1Enabled({
    INVOICE_IMPORT_PHASE1_ENABLED: env.INVOICE_IMPORT_PHASE1_ENABLED,
  });
}

export async function authorizeInvoiceApi(options?: {
  write?: boolean;
  admin?: boolean;
}) {
  if (
    invoiceImportRouteDisabledStatus({
      INVOICE_IMPORT_PHASE1_ENABLED: env.INVOICE_IMPORT_PHASE1_ENABLED,
    })
  ) {
    return {
      ok: false as const,
      response: Response.json(
        {
          error:
            "El módulo normalizado de facturación está desactivado. Los registros heredados permanecen disponibles.",
        },
        { status: 404 },
      ),
    };
  }
  const auth = await authorizeApi(options?.admin === true);
  if (!auth.ok) return auth;
  if (options?.write && auth.user.role === "viewer") {
    return {
      ok: false as const,
      response: Response.json(
        { error: "Acceso de solo lectura." },
        { status: 403 },
      ),
    };
  }
  return auth;
}
