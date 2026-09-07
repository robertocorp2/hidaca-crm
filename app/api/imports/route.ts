import { env } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";
import { getD1, getDb } from "../../../db";
import {
  documents,
  contacts,
  importBatches,
  importCandidates,
  importFiles,
  importIssues,
  quotations,
  sourceFieldValues,
} from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeApi } from "../../lib/authorization";
import {
  importMaxSize,
  importStatusFor,
  inChunks,
  issueRows,
  maxSourceValues,
  parserFailureIssue,
  previewForStorage,
  safeImportSummary,
  sha256Hex,
  sourceValueRows,
} from "../../lib/import-service";
import {
  isSupportedImportExtension,
  normalizedExtension,
  parseSourceFile,
} from "../../lib/importers";
import { mapHidacaExtraction } from "../../lib/importers/hidaca-mapper";
import { normalizeEmail, normalizePhone, normalizeText } from "../../lib/crm";
import { normalizeRnc } from "../../lib/source-domain";

type FilesBucket = {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  delete(key: string): Promise<void>;
};

function filesBucket() {
  const bucket = (env as unknown as { FILES?: FilesBucket }).FILES;
  if (!bucket) throw new Error("El almacenamiento R2 no está disponible.");
  return bucket;
}

function allowedMimeType(extension: string, mime: string) {
  if (!mime || mime === "application/octet-stream") return true;
  const allowed: Record<string, string[]> = {
    ".pdf": ["application/pdf"],
    ".xlsx": [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ],
    ".xlsm": [
      "application/vnd.ms-excel.sheet.macroenabled.12",
      "application/zip",
    ],
    ".xlsb": [
      "application/vnd.ms-excel.sheet.binary.macroenabled.12",
      "application/zip",
    ],
  };
  return allowed[extension]?.includes(mime.toLowerCase()) ?? false;
}

export async function GET() {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const db = getDb();
  const rows = await db
    .select()
    .from(importFiles)
    .orderBy(desc(importFiles.importedAt))
    .limit(250);
  const counts = await db
    .select({
      importFileId: importIssues.importFileId,
      openIssues: sql<number>`count(*)`,
    })
    .from(importIssues)
    .where(eq(importIssues.status, "open"))
    .groupBy(importIssues.importFileId);
  const countMap = new Map(
    counts.map((item) => [item.importFileId, Number(item.openIssues)]),
  );
  return Response.json(
    {
      imports: rows.map((row) => ({
        ...safeImportSummary(row),
        openIssues: countMap.get(row.id) ?? 0,
      })),
    },
    { headers: { "cache-control": "private, no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("file");
  const sourcePath = String(form.get("sourcePath") ?? "")
    .trim()
    .slice(0, 1_000);
  const batchName =
    String(form.get("batchName") ?? "")
      .trim()
      .slice(0, 180) || `Importación ${new Date().toLocaleDateString("es-DO")}`;
  if (!(file instanceof File)) {
    return Response.json({ error: "Selecciona un archivo." }, { status: 400 });
  }
  const extension = normalizedExtension(file.name);
  if (
    !isSupportedImportExtension(extension) ||
    !allowedMimeType(extension, file.type) ||
    file.size === 0 ||
    file.size > importMaxSize
  ) {
    return Response.json(
      {
        error: "Archivo no permitido. Máximo 32 MB: PDF, XLSX, XLSM o XLSB.",
      },
      { status: 400 },
    );
  }

  const bytes = await file.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const documentId = crypto.randomUUID();
  const importFileId = crypto.randomUUID();
  const objectKey = `imports/${importFileId}/source`;
  const extractedObjectKey = `imports/${importFileId}/extracted.json`;
  const bucket = filesBucket();

  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  const db = getDb();
  try {
    await getD1().batch([
      getD1()
        .prepare(
          `INSERT INTO import_batches (
             id, name, status, source, file_count, created_by, created_at
           ) VALUES (?, ?, 'processing', 'upload', 1, ?, ?)`,
        )
        .bind(batchId, batchName, auth.user.email, now),
      getD1()
        .prepare(
          `INSERT INTO documents (
             id, record_id, name, object_key, content_type, size, extension,
             sha256, source_path, document_role, parser_name, parsing_status,
             imported_at, created_by, created_at
           ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'source', '',
                     'pending', ?, ?, ?)`,
        )
        .bind(
          documentId,
          file.name.slice(0, 180),
          objectKey,
          file.type || "application/octet-stream",
          file.size,
          extension,
          hash,
          sourcePath,
          now,
          auth.user.email,
          now,
        ),
      getD1()
        .prepare(
          `INSERT INTO import_files (
             id, batch_id, document_id, filename, extension, source_path,
             sha256, status, extracted_object_key, imported_by, imported_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .bind(
          importFileId,
          batchId,
          documentId,
          file.name.slice(0, 180),
          extension,
          sourcePath,
          hash,
          extractedObjectKey,
          auth.user.email,
          now,
        ),
    ]);
  } catch (error) {
    await bucket.delete(objectKey);
    return Response.json(
      {
        error: `No se pudo registrar el archivo: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 500 },
    );
  }

  const [duplicate] = await db
    .select({ id: importFiles.id, filename: importFiles.filename })
    .from(importFiles)
    .where(eq(importFiles.sha256, hash))
    .orderBy(importFiles.importedAt)
    .limit(2)
    .then((rows) => rows.filter((row) => row.id !== importFileId));

  try {
    const extraction = await parseSourceFile(file.name, bytes);
    const preview = mapHidacaExtraction(file.name, extraction);
    const rawJson = JSON.stringify(extraction);
    const rawBytes = new TextEncoder().encode(rawJson);
    await bucket.put(
      extractedObjectKey,
      rawBytes.buffer.slice(
        rawBytes.byteOffset,
        rawBytes.byteOffset + rawBytes.byteLength,
      ),
      { httpMetadata: { contentType: "application/json" } },
    );

    const issues = [...preview.issues];
    if (preview.sourceValues.length > maxSourceValues) {
      issues.push({
        type: "security_limit",
        severity: "warning",
        title: "La vista de campos se limitó para revisión.",
        detail: `Se muestran ${maxSourceValues} de ${preview.sourceValues.length} valores; la extracción completa permanece en R2.`,
      });
    }
    if (duplicate) {
      issues.push({
        type: "duplicate_file",
        severity: "blocking",
        title: "Este archivo ya fue importado.",
        detail: `Coincide por SHA-256 con ${duplicate.filename}.`,
      });
    }
    let status: "parsed" | "partial" | "review_required" | "duplicate" =
      duplicate ? "duplicate" : importStatusFor(preview, extraction.partial);
    const lateIssueDrafts: Parameters<typeof issueRows>[1] = [];
    const values = sourceValueRows(importFileId, preview.sourceValues);
    const storedIssues = issueRows(importFileId, issues, now);

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
        extractedSize: rawBytes.byteLength,
        normalizedPreview: JSON.stringify(previewForStorage(preview)),
      })
      .where(eq(importFiles.id, importFileId));
    await db
      .update(documents)
      .set({
        parserName: extraction.parserName,
        parsingStatus:
          status === "parsed"
            ? "parsed"
            : extraction.partial
              ? "partial"
              : "parsed",
      })
      .where(eq(documents.id, documentId));
    await inChunks(values, 150, async (chunk) => {
      if (chunk.length) await db.insert(sourceFieldValues).values(chunk);
    });
    await inChunks(storedIssues, 150, async (chunk) => {
      if (chunk.length) await db.insert(importIssues).values(chunk);
    });
    if (duplicate) {
      await db.insert(importCandidates).values({
        id: crypto.randomUUID(),
        importFileId,
        candidateType: "source_document",
        candidateEntityId: duplicate.id,
        score: 1,
        reasons: JSON.stringify(["sha256_exact"]),
      });
    }

    const normalizedName = normalizeText(preview.business.name);
    const normalizedRnc = normalizeRnc(preview.business.rnc);
    const normalizedEmail = normalizeEmail(preview.business.email);
    const normalizedPhone = normalizePhone(
      preview.business.mobilePhone || preview.business.phone,
    );
    if (normalizedName || normalizedRnc || normalizedEmail || normalizedPhone) {
      const candidates = await getD1()
        .prepare(
          `SELECT id, name, normalized_name, normalized_rnc, email, phone,
                  mobile_phone
           FROM businesses
           WHERE archived_at IS NULL
             AND (
               (? <> '' AND normalized_name = ?) OR
               (? <> '' AND normalized_rnc = ?) OR
               (? <> '' AND lower(email) = ?) OR
               (? <> '' AND (
                 replace(replace(replace(replace(replace(phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ?
                 OR replace(replace(replace(replace(replace(mobile_phone, ' ', ''), '-', ''), '(', ''), ')', ''), '+', '') = ?
               ))
             )
           LIMIT 10`,
        )
        .bind(
          normalizedName,
          normalizedName,
          normalizedRnc,
          normalizedRnc,
          normalizedEmail,
          normalizedEmail,
          normalizedPhone,
          normalizedPhone,
          normalizedPhone,
        )
        .all<{
          id: string;
          name: string;
          normalized_name: string;
          normalized_rnc: string;
          email: string;
          phone: string;
          mobile_phone: string;
        }>();
      for (const candidate of candidates.results ?? []) {
        const reasons: string[] = [];
        if (normalizedName && candidate.normalized_name === normalizedName) {
          reasons.push("normalized_name");
        }
        if (normalizedRnc && candidate.normalized_rnc === normalizedRnc) {
          reasons.push("rnc");
        }
        if (
          normalizedEmail &&
          normalizeEmail(candidate.email) === normalizedEmail
        ) {
          reasons.push("email");
        }
        const candidatePhone = normalizePhone(
          candidate.mobile_phone || candidate.phone,
        );
        if (normalizedPhone && candidatePhone === normalizedPhone) {
          reasons.push("phone");
        }
        await db.insert(importCandidates).values({
          id: crypto.randomUUID(),
          importFileId,
          candidateType: "business",
          candidateEntityId: candidate.id,
          score: Math.min(1, reasons.length * 0.3 + 0.1),
          reasons: JSON.stringify(reasons),
        });
        if (
          (normalizedRnc &&
            candidate.normalized_rnc &&
            candidate.normalized_rnc !== normalizedRnc) ||
          (normalizedEmail &&
            candidate.email &&
            normalizeEmail(candidate.email) !== normalizedEmail) ||
          (normalizedPhone &&
            candidatePhone &&
            candidatePhone !== normalizedPhone)
        ) {
          lateIssueDrafts.push({
            type: "conflicting_value",
            severity: "warning",
            title: `Los datos no coinciden con ${candidate.name}.`,
            detail:
              "Revisa RNC, correo y teléfonos antes de seleccionar o crear el cliente.",
          });
        }
      }
      if ((candidates.results ?? []).length > 0) {
        lateIssueDrafts.push({
          type: "duplicate_customer",
          severity: "warning",
          title: "Se encontraron posibles clientes duplicados.",
          detail: "Selecciona un registro existente o confirma la creación.",
        });
      }
    }

    const contactEmail = normalizeEmail(preview.contact.email);
    const contactPhone = normalizePhone(preview.contact.phone);
    const contactMobile = normalizePhone(preview.contact.mobilePhone);
    if (contactEmail || contactPhone || contactMobile) {
      const contactCandidates = await db
        .select({
          id: contacts.id,
          name: contacts.name,
          normalizedEmail: contacts.normalizedEmail,
          normalizedPhone: contacts.normalizedPhone,
          normalizedMobilePhone: contacts.normalizedMobilePhone,
        })
        .from(contacts)
        .where(
          sql`archived_at IS NULL AND (
            (${contactEmail} <> '' AND normalized_email = ${contactEmail}) OR
            (${contactPhone} <> '' AND normalized_phone = ${contactPhone}) OR
            (${contactMobile} <> '' AND normalized_mobile_phone = ${contactMobile}) OR
            (${contactPhone} <> '' AND normalized_mobile_phone = ${contactPhone}) OR
            (${contactMobile} <> '' AND normalized_phone = ${contactMobile})
          )`,
        )
        .limit(10);
      for (const candidate of contactCandidates) {
        const reasons: string[] = [];
        if (contactEmail && candidate.normalizedEmail === contactEmail) {
          reasons.push("email");
        }
        if (
          contactPhone &&
          [candidate.normalizedPhone, candidate.normalizedMobilePhone].includes(
            contactPhone,
          )
        ) {
          reasons.push("phone");
        }
        if (
          contactMobile &&
          [candidate.normalizedPhone, candidate.normalizedMobilePhone].includes(
            contactMobile,
          )
        ) {
          reasons.push("mobile_phone");
        }
        await db.insert(importCandidates).values({
          id: crypto.randomUUID(),
          importFileId,
          candidateType: "contact",
          candidateEntityId: candidate.id,
          score: Math.min(1, reasons.length * 0.3 + 0.2),
          reasons: JSON.stringify(reasons),
        });
      }
      if (contactCandidates.length > 0) {
        lateIssueDrafts.push({
          type: "duplicate_customer",
          severity: "warning",
          title: "Se encontraron posibles contactos duplicados.",
          detail:
            "Selecciona un Contact existente o confirma la creación de uno nuevo.",
        });
      }
    }

    const quoteIdentity = preview.quotation.baseNumber;
    if (quoteIdentity) {
      const quoteCandidates = await db
        .select({
          id: quotations.id,
          quotationNumber: quotations.quotationNumber,
          quotationYear: quotations.quotationYear,
          title: quotations.title,
        })
        .from(quotations)
        .where(eq(quotations.quotationNumber, quoteIdentity))
        .limit(20);
      for (const candidate of quoteCandidates) {
        await db.insert(importCandidates).values({
          id: crypto.randomUUID(),
          importFileId,
          candidateType: "quotation_revision",
          candidateEntityId: candidate.id,
          score:
            candidate.quotationYear === preview.quotation.quotationYear
              ? 0.9
              : 0.65,
          reasons: JSON.stringify([
            "quotation_number",
            ...(candidate.quotationYear === preview.quotation.quotationYear
              ? ["quotation_year"]
              : []),
          ]),
        });
      }
      if (quoteCandidates.length > 0) {
        lateIssueDrafts.push({
          type: "revision_candidate",
          severity: "warning",
          title: "La cotización puede ser una revisión o alternativa.",
          detail:
            "Vincúlala a la cotización original para conservar la historia.",
        });
      }
    }
    if (lateIssueDrafts.length > 0 && status !== "duplicate") {
      status = "review_required";
      await db
        .update(importFiles)
        .set({ status })
        .where(eq(importFiles.id, importFileId));
      await db
        .insert(importIssues)
        .values(issueRows(importFileId, lateIssueDrafts, now));
    }

    await db
      .update(importBatches)
      .set({
        status: status === "parsed" ? "completed" : "review_required",
        successfulCount: status === "parsed" ? 1 : 0,
        reviewCount: status === "parsed" ? 0 : 1,
        completedAt: new Date().toISOString(),
      })
      .where(eq(importBatches.id, batchId));
    await writeAudit(
      auth.user.email,
      "import",
      "source_document",
      importFileId,
      `${file.name} (${status})`,
    );
    const [stored] = await db
      .select()
      .from(importFiles)
      .where(eq(importFiles.id, importFileId))
      .limit(1);
    return Response.json(
      {
        import: safeImportSummary(stored),
        openIssues: storedIssues.length + lateIssueDrafts.length,
      },
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failure = issueRows(
      importFileId,
      [parserFailureIssue(message, file.name)],
      now,
    );
    await db.insert(importIssues).values(failure);
    await db
      .update(importFiles)
      .set({ status: "failed", errorMessage: message.slice(0, 4_000) })
      .where(eq(importFiles.id, importFileId));
    await db
      .update(documents)
      .set({ parsingStatus: "failed" })
      .where(eq(documents.id, documentId));
    await db
      .update(importBatches)
      .set({
        status: "review_required",
        reviewCount: 1,
        failedCount: 1,
        completedAt: new Date().toISOString(),
      })
      .where(eq(importBatches.id, batchId));
    await writeAudit(
      auth.user.email,
      "import_failed",
      "source_document",
      importFileId,
      `${file.name}: ${message}`,
    );
    const [stored] = await db
      .select()
      .from(importFiles)
      .where(eq(importFiles.id, importFileId))
      .limit(1);
    return Response.json(
      {
        import: safeImportSummary(stored),
        openIssues: 1,
        warning: "El archivo se conservó y se envió a revisión manual.",
      },
      { status: 202 },
    );
  }
}
