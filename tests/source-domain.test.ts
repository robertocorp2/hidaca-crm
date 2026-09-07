import assert from "node:assert/strict";
import test from "node:test";
import {
  inferCustomerType,
  normalizeCurrency,
  normalizeRnc,
  normalizeSourceValue,
  parseLocaleNumber,
  parseSourceDate,
  quotationIdentity,
  validateCustomerIdentity,
  valueStateOf,
} from "../app/lib/source-domain";

test("value states distinguish blank, zero, not applicable, and invalid", () => {
  assert.equal(valueStateOf(""), "blank");
  assert.equal(valueStateOf(null), "blank");
  assert.equal(valueStateOf(0), "zero");
  assert.equal(valueStateOf("RD$ 0.00"), "zero");
  assert.equal(valueStateOf("N/A"), "not_applicable");
  assert.equal(valueStateOf("No calculado"), "not_calculated");
  assert.equal(valueStateOf("#REF!"), "invalid");
  assert.equal(valueStateOf("18%"), "value");
});

test("locale numbers preserve signs and parse DOP/USD formatting", () => {
  assert.equal(parseLocaleNumber("RD$ 18,118.90"), 18118.9);
  assert.equal(parseLocaleNumber("1.234,50"), 1234.5);
  assert.equal(parseLocaleNumber("(US$ 250.00)"), -250);
  assert.equal(parseLocaleNumber("N/A"), null);
  assert.equal(parseLocaleNumber(""), null);
});

test("customer validation supports individuals without RNC", () => {
  assert.deepEqual(
    validateCustomerIdentity({
      name: "Ana Pérez",
      type: "individual",
      rnc: "",
    }).errors,
    [],
  );
  assert.deepEqual(
    validateCustomerIdentity({
      name: "Quimocaribe SAS",
      type: "organization",
      rnc: "101-06921-1",
    }).errors,
    [],
  );
  assert.ok(
    validateCustomerIdentity({
      name: "Quimocaribe SAS",
      type: "organization",
      rnc: "123",
    }).errors.length > 0,
  );
  assert.equal(inferCustomerType("Ana Pérez", ""), "individual");
  assert.equal(inferCustomerType("Quimocaribe SAS", ""), "organization");
});

test("quotation identity preserves base number and revision hint", () => {
  assert.deepEqual(quotationIdentity("C060-2023-1"), {
    raw: "C060-2023-1",
    baseNumber: "C060-2023",
    year: 2023,
    revisionHint: 1,
    familyKey: "c060-2023",
  });
  assert.equal(quotationIdentity("M028-2025").revisionHint, null);
  assert.equal(quotationIdentity("sin número").year, null);
});

test("dates and identifiers normalize without inventing values", () => {
  assert.deepEqual(parseSourceDate("24/02/2025"), {
    iso: "2025-02-24",
    suspicious: false,
  });
  assert.equal(parseSourceDate("31/02/2025").suspicious, true);
  assert.equal(parseSourceDate("").suspicious, false);
  assert.equal(normalizeRnc("1-01-06921-1"), "101069211");
  assert.equal(normalizeCurrency("RD$"), "DOP");
  assert.equal(normalizeCurrency("US$"), "USD");
});

test("source values retain raw and normalized evidence separately", () => {
  const value = normalizeSourceValue(" (809) 555-0101 ", {
    entity: "contact",
    field: "phone",
    sourceLabel: "Celular",
    sourceSheet: "Instalación",
    sourceCell: "A14",
    confidence: "high",
    transformation: "digits_only",
  });
  assert.equal(value.rawValue, " (809) 555-0101 ");
  assert.equal(value.normalizedValue, "8095550101");
  assert.equal(value.mappingStatus, "mapped");
  assert.equal(value.sourceCell, "A14");
});
