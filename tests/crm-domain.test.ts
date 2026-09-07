import assert from "node:assert/strict";
import test from "node:test";
import {
  isValidLeadTransition,
  isValidOpportunityTransition,
  nextLeadStatus,
  nextOpportunityStage,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  requiredLeadConversionFields,
  toFtsQuery,
} from "../app/lib/crm";

test("lead transitions are ordered and terminal outcomes do not advance", () => {
  assert.equal(nextLeadStatus("new"), "contacted");
  assert.equal(nextLeadStatus("contacted"), "working");
  assert.equal(nextLeadStatus("working"), "unqualified");
  assert.equal(nextLeadStatus("unqualified"), null);
  assert.equal(nextLeadStatus("converted"), null);
  assert.equal(isValidLeadTransition("new", "contacted"), true);
  assert.equal(isValidLeadTransition("new", "working"), false);
  assert.equal(isValidLeadTransition("working", "converted"), false);
});

test("opportunity stages are ordered and closure is terminal", () => {
  assert.equal(nextOpportunityStage("evaluation"), "quote");
  assert.equal(nextOpportunityStage("quote"), "negotiation_review");
  assert.equal(nextOpportunityStage("negotiation_review"), "closed");
  assert.equal(nextOpportunityStage("closed"), null);
  assert.equal(
    isValidOpportunityTransition("quote", "negotiation_review"),
    true,
  );
  assert.equal(isValidOpportunityTransition("quote", "closed"), false);
});

test("conversion validation requires an identity and one contact method", () => {
  assert.deepEqual(
    requiredLeadConversionFields({
      businessName: "",
      contactName: "",
      email: "",
      phone: "",
    }),
    ["Business Name", "Contact Name", "Email or Phone"],
  );
  assert.deepEqual(
    requiredLeadConversionFields({
      businessName: "HIDACA",
      contactName: "Ana",
      email: "",
      phone: "(809) 555-0101",
    }),
    [],
  );
});

test("duplicate keys and FTS input are normalized safely", () => {
  assert.equal(normalizeText("  Construcción   Álvarez, S.R.L. "), "construccion alvarez s r l");
  assert.equal(normalizeEmail(" USER@Example.COM "), "user@example.com");
  assert.equal(normalizePhone("+1 (809) 555-0101"), "18095550101");
  assert.equal(toFtsQuery('Álvarez "Norte"'), '"alvarez"* AND "norte"*');
  assert.equal(toFtsQuery("   "), "");
});
