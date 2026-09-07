import { getD1 } from "../../../../../db";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { GET as getQuotation } from "../route";

type RouteContext = { params: Promise<{ id: string }> };

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object")) : [];
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi({ write: true, action: "create" });
  if (!auth.ok) return auth.response;

  const quotationResponse = await getQuotation(request, context);
  const quotationPayload = await quotationResponse.json() as Record<string, unknown>;
  if (!quotationResponse.ok) return Response.json(quotationPayload, { status: quotationResponse.status });

  const quotation = (quotationPayload.quotation ?? {}) as Record<string, unknown>;
  if (text(quotation.status) !== "accepted") {
    return Response.json({ error: "Solo las cotizaciones aceptadas pueden convertirse en factura." }, { status: 409 });
  }
  const id = (await context.params).id;
  const existingInvoices = (await getD1().prepare(`
    SELECT id, invoice_number_raw AS invoiceNumberRaw, status, currency,
      total_amount AS totalAmount, issue_date AS issueDate
    FROM invoices
    WHERE quotation_id = ? AND archived_at IS NULL
    ORDER BY COALESCE(issue_date, created_at) DESC
    LIMIT 50
  `).bind(id).all<Record<string, unknown>>()).results ?? [];

  const revision = (quotationPayload.revision ?? {}) as Record<string, unknown>;
  const financials = (quotationPayload.financials ?? {}) as Record<string, unknown>;
  const terms = (quotationPayload.terms ?? {}) as Record<string, unknown>;
  const charges = rows(quotationPayload.charges);
  const lines = rows(quotationPayload.lineItems).map((line) => ({
    id: crypto.randomUUID(),
    description: text(line.description),
    quantity: text(line.quantity) || "1",
    widthCm: text(line.finishedWidthCm ?? line.openingWidthCm),
    heightCm: text(line.finishedHeightCm ?? line.openingHeightCm),
    unitPrice: text(line.unitPrice),
    itemCode: text(line.itemCode),
    location: text(line.location),
  }));
  const state = {
    fields: {
      businessId: text(quotation.businessId),
      invoiceNumberRaw: "",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: "",
      status: "draft",
      ncfRaw: "",
      paymentTermsRaw: text(terms.paymentConditions),
      purchaseOrderNumber: "",
      salesRepresentative: "",
      contactId: text(quotation.primaryContactId),
      projectId: text(quotation.projectId),
      quotationId: id,
      currency: text(quotation.currency) || "DOP",
    },
    lines,
    financials: {
      discount: text(financials.discountAmount),
      additionalChargeLabel: text(charges[0]?.label) || "Cargo adicional",
      additionalChargeAmount: text(charges[0]?.calculatedAmount),
      taxRate: text(financials.sourceTaxRate) || "18",
      advance: "",
    },
    terms: {
      paymentConditions: text(terms.paymentConditions),
      customerFacingNotes: text(revision.customerFacingNotes),
      internalNotes: text(revision.internalNotes),
    },
  };

  return Response.json({
    quotationId: id,
    quotationNumber: text(quotation.quotationNumber),
    status: text(quotation.status),
    revisionId: text(revision.id),
    existingInvoices,
    warning: existingInvoices.length ? "Esta cotización ya tiene facturas. Puedes crear otra para facturación parcial o progresiva." : undefined,
    state,
  }, { headers: { "cache-control": "private, no-store" } });
}
