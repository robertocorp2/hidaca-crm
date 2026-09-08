import { env } from "cloudflare:workers";
import { authorizeApi } from "./authorization";
import type { PermissionAction, PermissionModuleKey } from "./modules";
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
  module?: PermissionModuleKey;
  action?: PermissionAction;
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
  const auth = await authorizeApi({
    module: options?.module ?? "facturas",
    action: options?.action ?? (options?.admin ? "administer" : options?.write ? "edit" : "view"),
  });
  if (!auth.ok) return auth;
  return auth;
}
