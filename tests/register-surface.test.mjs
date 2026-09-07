import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("register dry run is staged, hash-idempotent, and separate from canonical writes", async () => {
  const [dryRun, acceptance] = await Promise.all([
    read("../app/api/imports/register/route.ts"),
    read("../app/api/imports/[id]/accept-register/route.ts"),
  ]);
  assert.match(dryRun, /authorizeApi/);
  assert.match(dryRun, /role === "viewer"/);
  assert.match(dryRun, /eq\(importFiles\.sha256, hash\)/);
  assert.match(dryRun, /existing\?\.templateType === "register"/);
  assert.match(dryRun, /templateType: "register"/);
  assert.match(dryRun, /dryRunProjection/);
  assert.match(dryRun, /importRows/);
  assert.doesNotMatch(dryRun, /INSERT INTO businesses/);
  assert.match(acceptance, /WHERE import_file_id = \? AND outcome = 'ready'/);
  assert.match(acceptance, /row_fingerprint/);
  assert.match(acceptance, /name_only_match/);
  assert.doesNotMatch(acceptance, /reason: "exact_name"/);
  assert.match(acceptance, /created_from_register/);
  assert.match(acceptance, /warnings LIKE '%"duplicate_candidate"%'/);
  assert.match(acceptance, /UPDATE import_batch_sources/);
});

test("quotation portal exposes source metadata, revisions, warnings, edits, and all required filters", async () => {
  const [view, listRoute, detailRoute] = await Promise.all([
    read("../app/app/quotation-view.tsx"),
    read("../app/api/quotations/route.ts"),
    read("../app/api/quotations/[id]/route.ts"),
  ]);
  for (const label of [
    "Resumen y cliente",
    "Fecha, revisión y alternativa",
    "Resumen financiero",
    "Partidas",
    "Mediciones",
    "Pagos y balance",
    "Términos y condiciones",
    "Documentos fuente",
    "Metadatos de importación",
    "Advertencias de importación",
    "Historial de revisiones",
    "Auditoría",
  ]) {
    assert.match(view, new RegExp(label, "i"));
  }
  for (const filter of [
    "dateFrom",
    "dateTo",
    "month",
    "year",
    "projectId",
    "paymentStatus",
    "minTotal",
    "maxTotal",
    "sourceFilename",
    "importBatchId",
    "serviceCategory",
  ]) {
    assert.match(view, new RegExp(`"${filter}"`));
    assert.match(listRoute, new RegExp(filter));
  }
  assert.match(detailRoute, /export async function PATCH/);
  assert.match(detailRoute, /sourceReferences/);
  assert.match(detailRoute, /entity_history/);
  assert.match(detailRoute, /search_documents/);
});

test("project and contact screens expose normalized relationships and source records", async () => {
  const [projects, projectRoute, contacts, contactRoute] = await Promise.all([
    read("../app/app/projects-view.tsx"),
    read("../app/api/projects/[id]/route.ts"),
    read("../app/app/entity-views.tsx"),
    read("../app/api/contacts/[id]/route.ts"),
  ]);
  for (const value of [
    "Dirección de proyecto",
    "Edificio",
    "Apartamento",
    "Piso",
    "Habitación",
    "Balcón",
    "Cotizaciones",
    "Documentos fuente",
  ]) {
    assert.match(projects, new RegExp(value, "i"));
  }
  assert.match(projectRoute, /project_contacts/);
  assert.match(projectRoute, /project_locations/);
  assert.match(contacts, /ContactRelatedSections/);
  assert.match(contactRoute, /project_contacts/);
  assert.match(contactRoute, /source_references/);
});
