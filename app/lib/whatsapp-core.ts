export const whatsappStatuses = ["received", "sent", "delivered", "read", "failed", "uncertain"] as const;
export type WhatsAppStatus = (typeof whatsappStatuses)[number];

export function normalizeWhatsAppNumber(value: string) { return value.replace(/[^\d]/g, ""); }
const statusRank: Record<WhatsAppStatus, number> = { received: 0, uncertain: 1, sent: 2, delivered: 3, read: 4, failed: 5 };
export function nextWhatsAppStatus(current: WhatsAppStatus, incoming: WhatsAppStatus): WhatsAppStatus { if (current === "failed") return current; if (incoming === "failed") return incoming; return statusRank[incoming] >= statusRank[current] ? incoming : current; }
export function isServiceWindowOpen(expiresAt: string | null | undefined, now = Date.now()) { return Boolean(expiresAt && Date.parse(expiresAt) > now); }
export function campaignEligible(consent: string, phone: string) { return consent === "opted_in" && normalizeWhatsAppNumber(phone).length >= 8; }
