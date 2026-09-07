import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("cotizaciones replacement is admin-only, row-exact, and limited to its real data source", async () => {
  const [route, operations, panel] = await Promise.all([
    read("../app/api/cotizaciones/replace/route.ts"),
    read("../app/app/operations-client.tsx"),
    read("../app/app/cotizaciones-replacement-panel.tsx"),
  ]);
  assert.match(route, /authorizeApi\(true\)/);
  assert.match(route, /EXPECTED_COUNT = 133/);
  assert.match(route, /business_records WHERE module = 'cotizaciones'/);
  assert.match(route, /backups\/cotizaciones-business-records/);
  assert.match(route, /DELETE FROM business_records WHERE module = 'cotizaciones'/);
  assert.match(route, /DELETE FROM opportunity_quotes WHERE quote_record_id/);
  assert.match(route, /blockingReferences/);
  assert.match(route, /rowsToInsert/);
  assert.match(route, /MAX_D1_PARAMETERS = 100/);
  assert.match(route, /insertBatches\("business_records"/);
  assert.match(route, /duplicateQuotationNumbers/);
  assert.doesNotMatch(route, /DELETE FROM quotations/);
  assert.match(operations, /CotizacionesReplacementPanel/);
  assert.match(operations, /CotizacionSourceDetails/);
  assert.match(panel, /Validar libro/);
  assert.match(panel, /Reemplazar \{dryRun\?\.targetCount/);
  assert.match(panel, /API is the authority/);
});
