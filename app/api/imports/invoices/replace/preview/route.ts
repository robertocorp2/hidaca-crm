import { authorizeInvoiceApi } from "../../../../../lib/invoice-api";
import { isMultipartFile, importMaxSize } from "../../../../../lib/import-service";
import { parseInvoiceReplacementWorkbook } from "../../../../../lib/invoice-replacement";
import { previewInvoiceReplacement } from "../../../../../lib/invoice-replacement-service";

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ module: "importaciones", write: true, admin: true });
  if (!auth.ok) return auth.response;
  const form = await request.formData();
  const file = form.get("file");
  if (
    !file ||
    !isMultipartFile(file) ||
    !file.name.toLowerCase().endsWith(".xlsx") ||
    file.size <= 0 ||
    file.size > importMaxSize
  ) {
    return Response.json(
      { error: "Selecciona el XLSX consolidado de Facturas 2021 (máximo 32 MB)." },
      { status: 400 },
    );
  }
  try {
    const bytes = await file.arrayBuffer();
    const parsed = await parseInvoiceReplacementWorkbook(file.name, bytes);
    const preview = await previewInvoiceReplacement(parsed);
    return Response.json(
      { ok: true, preview },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 422 },
    );
  }
}
