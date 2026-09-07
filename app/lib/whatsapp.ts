import { env } from "cloudflare:workers";
import { normalizeWhatsAppNumber } from "./whatsapp-core";
export { campaignEligible, isServiceWindowOpen, nextWhatsAppStatus, normalizeWhatsAppNumber, whatsappStatuses, type WhatsAppStatus } from "./whatsapp-core";

export function isWhatsAppEnabled() {
  return env.WHATSAPP_ENABLED !== "false";
}

export function isWhatsAppCampaignsEnabled() {
  return isWhatsAppEnabled() && env.WHATSAPP_CAMPAIGNS_ENABLED === "true";
}


function toHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyWhatsAppSignature(rawBody: string, header: string | null, secret = env.WHATSAPP_APP_SECRET) {
  if (!header || !secret || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const expected = `sha256=${digest}`;
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ header.charCodeAt(index);
  return diff === 0;
}

export function whatsappConfig() {
  const hasAnyCredential = Boolean(env.WHATSAPP_ACCESS_TOKEN || env.WHATSAPP_APP_SECRET || env.WHATSAPP_VERIFY_TOKEN || env.WHATSAPP_WABA_ID || env.WHATSAPP_PHONE_NUMBER_ID);
  const configured = Boolean(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_WABA_ID && env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN);
  return {
    enabled: isWhatsAppEnabled(),
    campaignsEnabled: isWhatsAppCampaignsEnabled(),
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    wabaId: env.WHATSAPP_WABA_ID ?? "",
    graphVersion: env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0",
    configured,
    status: !isWhatsAppEnabled() ? "DISABLED" : !hasAnyCredential ? "UNCONFIGURED" : !configured ? "PARTIALLY_CONFIGURED" : "CONNECTED",
  };
}

export async function graphFetch(path: string, init: RequestInit = {}) {
  if (!env.WHATSAPP_ACCESS_TOKEN) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const version = env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0";
  const response = await fetch(`https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`META_GRAPH_${response.status}:${detail.slice(0, 500)}`);
  }
  return response;
}

export async function sendWhatsAppMessage(to: string, payload: Record<string, unknown>) {
  const response = await graphFetch(`${env.WHATSAPP_PHONE_NUMBER_ID ?? ""}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: normalizeWhatsAppNumber(to), ...payload }),
  });
  return response.json() as Promise<{ messages?: Array<{ id: string }> }>;
}

export async function markWhatsAppMessageRead(messageId: string) {
  await graphFetch(`${env.WHATSAPP_PHONE_NUMBER_ID ?? ""}/messages`, { method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }) });
}

export async function syncWhatsAppTemplates() {
  if (!env.WHATSAPP_WABA_ID) throw new Error("WHATSAPP_NOT_CONFIGURED");
  const response = await graphFetch(`${env.WHATSAPP_WABA_ID}/message_templates?limit=100`);
  return response.json() as Promise<{ data?: Array<Record<string, unknown>> }>;
}

export async function downloadMetaMedia(mediaId: string) {
  const metadata = await graphFetch(mediaId);
  const info = await metadata.json() as { url?: string; mime_type?: string };
  if (!info.url || !env.WHATSAPP_ACCESS_TOKEN) throw new Error("META_MEDIA_UNAVAILABLE");
  const response = await fetch(info.url, { headers: { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` } });
  if (!response.ok) throw new Error(`META_MEDIA_${response.status}`);
  return { body: await response.arrayBuffer(), contentType: info.mime_type ?? "application/octet-stream" };
}
