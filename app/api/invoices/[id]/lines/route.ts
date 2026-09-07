import { and, eq, isNull, max } from "drizzle-orm";
import { getDb } from "../../../../../db";
import { invoiceLines, invoices } from "../../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { cleanText } from "../../../../lib/crm";
import { authorizeInvoiceApi } from "../../../../lib/invoice-api";
import { optionalAmount } from "../../../../lib/invoice-domain";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  const auth = await authorizeInvoiceApi({ write: true });
  if (!auth.ok) return auth.response;
  const { id: invoiceId } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const [invoice] = await db
    .select({ id: invoices.id, number: invoices.invoiceNumberRaw })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), isNull(invoices.archivedAt)))
    .limit(1);
  if (!invoice) {
    return Response.json({ error: "Factura no encontrada." }, { status: 404 });
  }
  const [latest] = await db
    .select({ lineNumber: max(invoiceLines.lineNumber) })
    .from(invoiceLines)
    .where(eq(invoiceLines.invoiceId, invoiceId));
  const lineNumber =
    Number(payload.lineNumber) || Number(latest?.lineNumber ?? 0) + 1;
  const description = cleanText(payload.description, 1000);
  if (!description) {
    return Response.json(
      { error: "La descripción de la línea es obligatoria." },
      { status: 400 },
    );
  }
  const [line] = await db
    .insert(invoiceLines)
    .values({
      id: crypto.randomUUID(),
      invoiceId,
      lineNumber,
      productServiceId: cleanText(payload.productServiceId, 80) || null,
      itemCode: cleanText(payload.itemCode, 120),
      description,
      location: cleanText(payload.location, 300),
      quantity: optionalAmount(payload.quantity),
      widthCm: optionalAmount(payload.widthCm),
      heightCm: optionalAmount(payload.heightCm),
      areaSqm: optionalAmount(payload.areaSqm),
      unitOfMeasure: cleanText(payload.unitOfMeasure, 40),
      unitPrice: optionalAmount(payload.unitPrice),
      lineSubtotal: optionalAmount(payload.lineSubtotal),
      discountAmount: optionalAmount(payload.discountAmount),
      taxAmount: optionalAmount(payload.taxAmount),
      lineTotal: optionalAmount(payload.lineTotal),
      taxConfigurationId:
        cleanText(payload.taxConfigurationId, 80) || null,
      sourceValues: "{}",
      valueStates: "{}",
    })
    .returning();
  await writeAudit(
    auth.user.email,
    "create_line",
    "invoice",
    invoiceId,
    `${invoice.number} · línea ${lineNumber}`,
  );
  return Response.json({ line }, { status: 201 });
}
