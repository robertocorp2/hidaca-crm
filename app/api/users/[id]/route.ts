import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { staffUsers } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const numericId = Number(id);
  const payload = (await request.json()) as { active?: boolean };
  if (!Number.isInteger(numericId) || typeof payload.active !== "boolean") {
    return Response.json({ error: "Solicitud no válida." }, { status: 400 });
  }

  const [target] = await getDb()
    .select()
    .from(staffUsers)
    .where(eq(staffUsers.id, numericId))
    .limit(1);
  if (!target) {
    return Response.json({ error: "Usuario no encontrado." }, { status: 404 });
  }
  if (target.email === auth.user.email && payload.active === false) {
    return Response.json(
      { error: "No puedes desactivar tu propio acceso." },
      { status: 400 },
    );
  }

  const [user] = await getDb()
    .update(staffUsers)
    .set({ active: payload.active, updatedAt: new Date().toISOString() })
    .where(eq(staffUsers.id, numericId))
    .returning();
  await writeAudit(
    auth.user.email,
    payload.active ? "activate" : "deactivate",
    "user",
    id,
    target.email,
  );
  return Response.json({ user });
}
