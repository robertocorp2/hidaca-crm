import { desc } from "drizzle-orm";
import { getDb } from "../../../../db";
import { whatsappConversations } from "../../../../db/schema";
import { authorizeApi } from "../../../lib/authorization";
import { isWhatsAppEnabled } from "../../../lib/whatsapp";

export async function GET() {
  const auth = await authorizeApi({ module: "whatsapp", action: "view" });
  if (!auth.ok) return auth.response;
  if (!isWhatsAppEnabled()) return Response.json({ enabled: false, conversations: [] });
  const rows = await getDb().select().from(whatsappConversations).orderBy(desc(whatsappConversations.updatedAt)).limit(500);
  return Response.json({ enabled: true, conversations: rows });
}
