import { and, eq } from "drizzle-orm";
import { getDb } from "../../../../../db";
import {
  importCandidates,
  importFiles,
  importIssues,
  sourceFieldValues,
} from "../../../../../db/schema";
import { writeAudit } from "../../../../lib/audit";
import { authorizeApi } from "../../../../lib/authorization";
import { cleanText } from "../../../../lib/crm";
import {
  mappingConfidences,
  type MappingConfidence,
} from "../../../../lib/source-domain";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }
  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const db = getDb();
  const [file] = await db
    .select({ id: importFiles.id, status: importFiles.status })
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
      { error: "La importación aceptada ya no admite correcciones." },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const sourceFieldValueId = cleanText(payload.sourceFieldValueId, 80);
  const issueId = cleanText(payload.issueId, 80);
  const candidateId = cleanText(payload.candidateId, 80);
  const result: Record<string, unknown> = { ok: true };

  if (sourceFieldValueId) {
    const canonicalEntity = cleanText(payload.canonicalEntity, 80);
    const canonicalField = cleanText(payload.canonicalField, 120);
    const normalizedValue = cleanText(payload.normalizedValue, 20_000);
    const confidence = mappingConfidences.includes(
      payload.confidence as MappingConfidence,
    )
      ? (payload.confidence as MappingConfidence)
      : "manual_review";
    if (!canonicalEntity || !canonicalField) {
      return Response.json(
        { error: "Entidad y campo canónico son obligatorios." },
        { status: 400 },
      );
    }
    const [value] = await db
      .update(sourceFieldValues)
      .set({
        canonicalEntity,
        canonicalField,
        normalizedValue,
        confidence,
        mappingStatus: "corrected",
        correctedBy: auth.user.email,
        correctedAt: now,
      })
      .where(
        and(
          eq(sourceFieldValues.id, sourceFieldValueId),
          eq(sourceFieldValues.importFileId, id),
        ),
      )
      .returning();
    if (!value) {
      return Response.json(
        { error: "Valor de origen no encontrado." },
        { status: 404 },
      );
    }
    result.sourceValue = value;
  }

  if (issueId) {
    const action = cleanText(payload.issueAction, 20);
    const resolution = cleanText(payload.resolution, 4_000);
    if (!["resolve", "dismiss"].includes(action) || resolution.length < 3) {
      return Response.json(
        {
          error:
            "Selecciona resolver o descartar e indica una razón de al menos 3 caracteres.",
        },
        { status: 400 },
      );
    }
    const [issue] = await db
      .update(importIssues)
      .set({
        status: action === "resolve" ? "resolved" : "dismissed",
        resolution,
        resolvedBy: auth.user.email,
        resolvedAt: now,
      })
      .where(
        and(
          eq(importIssues.id, issueId),
          eq(importIssues.importFileId, id),
          eq(importIssues.status, "open"),
        ),
      )
      .returning();
    if (!issue) {
      return Response.json(
        { error: "Advertencia abierta no encontrada." },
        { status: 404 },
      );
    }
    result.issue = issue;
  }

  if (candidateId) {
    const candidateAction = cleanText(payload.candidateAction, 20);
    if (!["select", "reject"].includes(candidateAction)) {
      return Response.json(
        { error: "Selecciona o rechaza el candidato." },
        { status: 400 },
      );
    }
    const [candidate] = await db
      .update(importCandidates)
      .set({
        status: candidateAction === "select" ? "selected" : "rejected",
        decidedBy: auth.user.email,
        decidedAt: now,
      })
      .where(
        and(
          eq(importCandidates.id, candidateId),
          eq(importCandidates.importFileId, id),
        ),
      )
      .returning();
    if (!candidate) {
      return Response.json(
        { error: "Candidato no encontrado." },
        { status: 404 },
      );
    }
    if (candidateAction === "select") {
      await db
        .update(importCandidates)
        .set({
          status: "rejected",
          decidedBy: auth.user.email,
          decidedAt: now,
        })
        .where(
          and(
            eq(importCandidates.importFileId, id),
            eq(importCandidates.candidateType, candidate.candidateType),
          ),
        );
      await db
        .update(importCandidates)
        .set({
          status: "selected",
          decidedBy: auth.user.email,
          decidedAt: now,
        })
        .where(eq(importCandidates.id, candidateId));
    }
    result.candidate = candidate;
  }

  if (!sourceFieldValueId && !issueId && !candidateId) {
    return Response.json(
      { error: "No se recibió ninguna acción de revisión." },
      { status: 400 },
    );
  }
  await db
    .update(importFiles)
    .set({ reviewedBy: auth.user.email, reviewedAt: now })
    .where(eq(importFiles.id, id));
  await writeAudit(
    auth.user.email,
    "review",
    "import_file",
    id,
    JSON.stringify({
      sourceFieldValueId,
      issueId,
      candidateId,
    }),
  );
  return Response.json(result);
}
