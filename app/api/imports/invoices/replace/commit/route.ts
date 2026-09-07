import { authorizeInvoiceApi } from "../../../../../lib/invoice-api";
import { isMultipartFile, importMaxSize } from "../../../../../lib/import-service";
import {
  invoiceReplacementConfirmation,
  parseInvoiceReplacementWorkbook,
} from "../../../../../lib/invoice-replacement";
import {
  commitInvoiceReplacement,
  InvoiceReplacementConflict,
} from "../../../../../lib/invoice-replacement-service";

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "importaciones", write: true, admin: true });
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const file = form.get("file");
  const confirmation = String(form.get("confirmation") ?? "").trim();
  const expectedWorkbookHash = String(form.get("workbookHash") ?? "").trim();
  const expectedStateFingerprint = String(form.get("stateFingerprint") ?? "").trim();
  if (confirmation !== invoiceReplacementConfirmation) {
    return Response.json(
      { error: `Escribe exactamente ${invoiceReplacementConfirmation} para confirmar la purga irreversible.` },
      { status: 400 },
    );
  }
  if (
    !file ||
    !isMultipartFile(file) ||
    !file.name.toLowerCase().endsWith(".xlsx") ||
    file.size <= 0 ||
    file.size > importMaxSize
  ) {
    return Response.json(
      { error: "Vuelve a seleccionar el mismo XLSX consolidado de Facturas 2021." },
      { status: 400 },
    );
  }
  if (!/^[a-f0-9]{64}$/.test(expectedWorkbookHash) || !/^[a-f0-9]{64}$/.test(expectedStateFingerprint)) {
    return Response.json(
      { error: "La confirmación no corresponde a una previsualización válida." },
      { status: 400 },
    );
  }
  try {
    const bytes = await file.arrayBuffer();
    const parsed = await parseInvoiceReplacementWorkbook(file.name, bytes);
    const result = await commitInvoiceReplacement({
      parsed,
      bytes,
      expectedWorkbookHash,
      expectedStateFingerprint,
      actorEmail: auth.user.email,
    });
    return Response.json(result, {
      headers: { "cache-control": "private, no-store" },
    });
  } catch (error) {
    if (error instanceof InvoiceReplacementConflict) {
      return Response.json(
        { error: error.message, preview: error.preview },
        { status: error.status },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  }
}
