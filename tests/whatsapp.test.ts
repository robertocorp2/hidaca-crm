import test from "node:test";
import assert from "node:assert/strict";
import { campaignEligible, isServiceWindowOpen, nextWhatsAppStatus, normalizeWhatsAppNumber } from "../app/lib/whatsapp-core";

test("normaliza y filtra audiencias de WhatsApp por consentimiento", () => {
  assert.equal(normalizeWhatsAppNumber("+1 (809) 555-0199"), "18095550199");
  assert.equal(campaignEligible("opted_in", "+1 809 555 0199"), true);
  assert.equal(campaignEligible("unknown", "+1 809 555 0199"), false);
  assert.equal(campaignEligible("opted_in", "123"), false);
});

test("los estados Meta nunca retroceden y failed es terminal", () => {
  assert.equal(nextWhatsAppStatus("read", "delivered"), "read");
  assert.equal(nextWhatsAppStatus("sent", "delivered"), "delivered");
  assert.equal(nextWhatsAppStatus("failed", "read"), "failed");
});

test("la ventana de servicio exige una fecha futura", () => {
  assert.equal(isServiceWindowOpen(new Date(Date.now() + 60_000).toISOString()), true);
  assert.equal(isServiceWindowOpen(new Date(Date.now() - 60_000).toISOString()), false);
});
