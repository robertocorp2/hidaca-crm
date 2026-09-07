import test from "node:test";
import assert from "node:assert/strict";
import { buildFiscalSnapshot, generateEcfXml, snapshotHash, validateFiscalSnapshot, xmlEscape } from "../app/lib/ecf-domain";
import { rolePermissionDefaults } from "../app/lib/modules";

const base = {
  ecfType: "31" as const,
  environment: "test" as const,
  invoice: {
    id: "inv-1", invoice_number_raw: "F-1", issue_date: "2026-08-20", due_date: "2026-09-20", currency: "DOP", payment_terms_raw: "Contado", subtotal_amount: 100, discount_amount: 0, taxable_amount: 100, exempt_amount: 0, tax_amount: 18, total_amount: 118,
  },
  lines: [{ line_number: 1, description: "Servicio de construcción", quantity: 1, unit_of_measure: "unidad", unit_price: 100, line_subtotal: 100, line_total: 100, tax_amount: 18, tax_configuration_code: "ITBIS" }],
  issuer: { legalName: "HIDACA Constructora S.R.L.", rnc: "131880600", fiscalAddress: "Santo Domingo", provinceCode: "01", municipalityCode: "01" },
  receiver: { name: "Cliente Demo", identityValue: "101000000", address: "Santo Domingo", email: "cliente@example.com" },
};

test("builds a fiscal snapshot and reports only conditional warnings", () => {
  const snapshot = buildFiscalSnapshot(base);
  const issues = validateFiscalSnapshot(snapshot);
  assert.equal(snapshot.sourceInvoiceId, "inv-1");
  assert.equal(issues.some((issue) => issue.severity === "error"), false);
  assert.equal(issues.some((issue) => issue.code === "MISSING_UNIT"), false);
});

test("missing issuer and line data is actionable", () => {
  const snapshot = buildFiscalSnapshot({ ...base, issuer: {}, lines: [{ description: "" }] });
  const issues = validateFiscalSnapshot(snapshot);
  assert.ok(issues.some((issue) => issue.code === "MISSING_ISSUER_RNC"));
  assert.ok(issues.some((issue) => issue.code === "MISSING_LINE_DESCRIPTION"));
  assert.ok(issues.some((issue) => issue.code === "MISSING_LINE_QUANTITY"));
});

test("snapshot hash is stable and XML escapes imported values", async () => {
  const snapshot = buildFiscalSnapshot(base);
  assert.equal(await snapshotHash(snapshot), await snapshotHash(snapshot));
  assert.notEqual(await snapshotHash(snapshot), await snapshotHash({ ...snapshot, receiver: { ...snapshot.receiver, name: "Otro cliente" } }));
  assert.equal(xmlEscape("A&B <obra>"), "A&amp;B &lt;obra&gt;");
  const xml = generateEcfXml(snapshot, "E310000000001");
  assert.match(xml, /<eNCF>E310000000001<\/eNCF>/);
  assert.match(xml, /A&amp;B|Servicio de construcción/);
});

test("e-CF permissions keep viewer read-only and restrict sensitive operator actions", () => {
  assert.equal(rolePermissionDefaults.viewer.facturas.ecf_generate, false);
  assert.equal(rolePermissionDefaults.operator.facturas.ecf_generate, true);
  assert.equal(rolePermissionDefaults.operator.facturas.ecf_sign, false);
  assert.equal(rolePermissionDefaults.admin.facturas.ecf_sign, true);
});
