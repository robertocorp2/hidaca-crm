import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import {
  documents,
  importCandidates,
  importFiles,
  importIssues,
  sourceFieldValues,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { authorizeApi } from "../../../../lib/authorization";
import {
  importStatusFor,
  inChunks,
  issueRows,
  maxSourceValues,
  previewForStorage,
  safeImportSummary,
  sourceValueRows,
} from "../../../../lib/import-service";
import { parseSourceFile } from "../../../../lib/importers";
import { mapHidacaExtraction } from "../../../../lib/importers/hidaca-mapper";

type RouteContext = { params: Promise<{ id: string }> };
type StoredObject = { arrayBuffer(): Promise<ArrayBuffer> };
type FilesBucket = {
  get(key: string): Promise<StoredObject | null>;
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
};

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento R2 no está disponible.");
  return bucket;
}

export async function POST(_: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "importaciones", action: "edit" });
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const db = getDb();
  const [file] = await db
    .select()
    .from(importFiles)
    .where(eq(importFiles.id, id))
    .limit(1);
  if (!file) {
    return Response.json(
      { error: "Importación no encontrada." },
      { status: 404 },
    );
  }
  if (file.status === "accepted") {
    return Response.json(
      { error: "Una importación aceptada no se puede reprocesar." },
      { status: 409 },
    );
  }
  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, file.documentId))
    .limit(1);
  if (!document) {
    return Response.json(
      { error: "El documento de origen no existe." },
      { status: 409 },
    );
  }
  const bucket = filesBucket();
  const object = await bucket.get(document.objectKey);
  if (!object) {
    return Response.json(
      { error: "El archivo original no está disponible en R2." },
      { status: 409 },
    );
  }
  try {
    const bytes = await object.arrayBuffer();
    const extraction = await parseSourceFile(file.filename, bytes);
    const preview = mapHidacaExtraction(file.filename, extraction);
    const raw = new TextEncoder().encode(JSON.stringify(extraction));
    await bucket.put(file.extractedObjectKey, Uint8Array.from(raw).buffer, {
      httpMetadata: { contentType: "application/json" },
    });
    const status = importStatusFor(preview, extraction.partial);
    const now = new Date().toISOString();
    await Promise.all([
      db
        .delete(sourceFieldValues)
        .where(eq(sourceFieldValues.importFileId, id)),
      db.delete(importIssues).where(eq(importIssues.importFileId, id)),
      db.delete(importCandidates).where(eq(importCandidates.importFileId, id)),
    ]);
    await db
      .update(importFiles)
      .set({
        parserName: extraction.parserName,
        parserVersion: extraction.parserVersion,
        templateType: preview.templateType,
        status,
        rawExtractedData: JSON.stringify({
          format: extraction.format,
          sheets: extraction.sheets.map((sheet) => ({
            name: sheet.name,
            range: sheet.range,
            cells: sheet.cells.length,
          })),
          pages: extraction.pages.length,
          hasMacros: extraction.hasMacros,
          warnings: extraction.warnings,
        }),
        extractedSize: raw.byteLength,
        normalizedPreview: JSON.stringify(previewForStorage(preview)),
        errorMessage: "",
        reviewedBy: auth.user.email,
        reviewedAt: now,
      })
      .where(eq(importFiles.id, id));
    await db
      .update(documents)
      .set({
        parserName: extraction.parserName,
        parsingStatus: extraction.partial ? "partial" : "parsed",
      })
      .where(eq(documents.id, document.id));
    await inChunks(
      sourceValueRows(id, preview.sourceValues),
      150,
      async (chunk) => {
        if (chunk.length) await db.insert(sourceFieldValues).values(chunk);
      },
    );
    const issues = [...preview.issues];
    if (preview.sourceValues.length > maxSourceValues) {
      issues.push({
        type: "security_limit",
        severity: "warning",
        title: "La vista de campos se limitó para revisión.",
        detail: `Se muestran ${maxSourceValues} valores; la extracción completa permanece en R2.`,
      });
    }
    await inChunks(issueRows(id, issues, now), 150, async (chunk) => {
      if (chunk.length) await db.insert(importIssues).values(chunk);
    });
    await writeAudit(
      auth.user.email,
      "retry_import",
      "import_file",
      id,
      `${file.filename} (${status})`,
    );
    const [stored] = await db
      .select()
      .from(importFiles)
      .where(eq(importFiles.id, id))
      .limit(1);
    return Response.json({ import: safeImportSummary(stored) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(importFiles)
      .set({ status: "failed", errorMessage: message.slice(0, 4_000) })
      .where(eq(importFiles.id, id));
    return Response.json(
      {
        error: `El archivo original se conservó, pero el reproceso falló: ${message}`,
      },
      { status: 422 },
    );
  }
}
