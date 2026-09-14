import assert from "node:assert/strict";
import test from "node:test";
import { canonicalWhatsAppWebhookIdentity } from "../app/lib/whatsapp-webhook-identity";

test("webhook identity is stable across JSON field order and batch order", () => {
  const first = canonicalWhatsAppWebhookIdentity({
    entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: "wamid-1", type: "text", text: { body: "Hola" } }] } }] }],
  });
  const reordered = canonicalWhatsAppWebhookIdentity({
    entry: [{ changes: [{ value: { messages: [{ text: { body: "Hola" }, type: "text", id: "wamid-1" }], metadata: { phone_number_id: "phone-1" } } }] }],
  });
  assert.equal(first, reordered);
});

test("webhook identity keeps id-less records deterministic and count-sensitive", () => {
  const one = canonicalWhatsAppWebhookIdentity({ entry: [{ changes: [{ value: { messages: [{ from: "18095550199", type: "text", text: { body: "Hola" } }] } }] }] });
  const two = canonicalWhatsAppWebhookIdentity({ entry: [{ changes: [{ value: { messages: [{ from: "18095550199", type: "text", text: { body: "Hola" } }, { from: "18095550199", type: "text", text: { body: "Hola" } }] } }] }] });
  assert.ok(one);
  assert.ok(two);
  assert.notEqual(one, two);
});
