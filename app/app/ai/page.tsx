import { requireAuthorizedUser } from "../../lib/authorization";
import { AiClient } from "./ai-client";

export default async function AiPage() {
  const user = await requireAuthorizedUser("/app/ai");
  return <AiClient role={user.role} />;
}
