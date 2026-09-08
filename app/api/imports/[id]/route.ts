import { asc, eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import {
  documents,
  importBatches,
  importCandidates,
  importFiles,
  importIssues,
  sourceFieldValues,
} from "../../../../db/schema";
import { authorizeApi, can } from "../../../lib/authorization";
import { parseJson, safeImportSummary } from "../../../lib/import-service";

type RouteContext = { params: Promise<{ id: string }> };

function redactInternalPreview(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const preview = structuredClone(value) as {
    manufacturing?: Array<{
      components?: Array<Record<string, unknown>>;
      formulaSummary?: unknown;
    }>;
  };
  if (preview.manufacturing) {
    preview.manufacturing = preview.manufacturing.map((worksheet) => ({
      ...worksheet,
      formulaSummary: {},
      components: (worksheet.components ?? []).map((component) => {
        const safe = { ...component };
        delete safe.unitCost;
        delete safe.totalCost;
        delete safe.sourceFormula;
        delete safe.formulaResult;
        delete safe.sourceValues;
        return safe;
      }),
    }));
  }
  return preview;
}

export async function GET(_: Request, context: RouteContext) {
  const auth = await authorizeApi({ module: "importaciones", action: "view" });
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
  const [[batch], [document], issues, candidates, values] = await Promise.all([
    db
      .select()
      .from(importBatches)
      .where(eq(importBatches.id, file.batchId))
      .limit(1),
    db
      .select({
        id: documents.id,
        name: documents.name,
        contentType: documents.contentType,
        size: documents.size,
        extension: documents.extension,
        sha256: documents.sha256,
        sourcePath: documents.sourcePath,
        documentRole: documents.documentRole,
        parsingStatus: documents.parsingStatus,
        importedAt: documents.importedAt,
        createdBy: documents.createdBy,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(eq(documents.id, file.documentId))
      .limit(1),
    db
      .select()
      .from(importIssues)
      .where(eq(importIssues.importFileId, id))
      .orderBy(asc(importIssues.createdAt))
      .limit(1_000),
    db
      .select()
      .from(importCandidates)
      .where(eq(importCandidates.importFileId, id))
      .orderBy(asc(importCandidates.candidateType))
      .limit(500),
    db
      .select()
      .from(sourceFieldValues)
      .where(eq(sourceFieldValues.importFileId, id))
      .orderBy(
        asc(sourceFieldValues.sourcePage),
        asc(sourceFieldValues.sourceSheet),
        asc(sourceFieldValues.sourceCell),
      )
      .limit(5_000),
  ]);
  const preview = parseJson<unknown>(file.normalizedPreview, {});
  const mayAdminister = can(auth.user, "importaciones", "administer");
  const safePreview = mayAdminister ? preview : redactInternalPreview(preview);
  return Response.json(
    {
      import: safeImportSummary(file),
      batch,
      document,
      preview: safePreview,
      issues,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        reasons: parseJson(candidate.reasons, []),
      })),
      sourceValues:
        !mayAdminister
          ? values.filter(
              (value) =>
                value.canonicalEntity !== "material_component" &&
                value.canonicalEntity !== "manufacturing_worksheet",
            )
          : values,
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}
