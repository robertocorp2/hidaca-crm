import { requireAuthorizedUser } from "../../lib/authorization";
import { ProspectingClient } from "./prospecting-client";
export const metadata = { title: "Inteligencia comercial · HIDACA" };
export const dynamic = "force-dynamic";
export default async function ProspectingPage() {
  const user = await requireAuthorizedUser("/app/prospecting");
  return <ProspectingClient role={user.role} />;
}
