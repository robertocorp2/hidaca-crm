type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: Record<string, unknown>;
    }>;
  }>;
};

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Returns stable provider identities for a webhook batch. Provider IDs are
 * preferred so redelivery is independent of JSON formatting or field order;
 * payload records without an ID use a canonical record fallback.
 */
export function canonicalWhatsAppWebhookIdentity(payload: WhatsAppWebhookPayload): string | null {
  const identities: string[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const phoneNumberId = String((value.metadata as { phone_number_id?: unknown } | undefined)?.phone_number_id ?? "");
      for (const message of (value.messages as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = message.id;
        identities.push(id ? `message|${phoneNumberId}|${String(id)}` : `message-fallback|${phoneNumberId}|${stableJson(message)}`);
      }
      for (const status of (value.statuses as Array<Record<string, unknown>> | undefined) ?? []) {
        const id = status.id;
        identities.push(id ? `status|${phoneNumberId}|${String(id)}|${String(status.status ?? "")}` : `status-fallback|${phoneNumberId}|${stableJson(status)}`);
      }
    }
  }
  return identities.length ? identities.sort().join("\n") : null;
}
