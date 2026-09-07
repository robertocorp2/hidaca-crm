import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { staffUsers } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeApi } from "../../lib/authorization";

const roles = new Set(["admin", "operator", "viewer"]);

export async function GET() {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const users = await getDb().select().from(staffUsers).orderBy(asc(staffUsers.name));
  return Response.json({ users });
}

export async function POST(request: Request) {
  const auth = await authorizeApi(true);
  if (!auth.ok) return auth.response;
  const payload = (await request.json()) as Record<string, unknown>;
  const email = String(payload.email ?? "").trim().toLowerCase();
  const name = String(payload.name ?? "").trim();
  const role = String(payload.role ?? "operator");
  if (!email.includes("@") || !name || !roles.has(role)) {
    return Response.json(
      { error: "Nombre, correo y rol válido son obligatorios." },
      { status: 400 },
    );
  }

  const now = new Date().toISOString();
  const [user] = await getDb()
    .insert(staffUsers)
    .values({
      email,
      name,
      role: role as "admin" | "operator" | "viewer",
      active: true,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: staffUsers.email,
      set: {
        name,
        role: role as "admin" | "operator" | "viewer",
        active: true,
        updatedAt: now,
      },
    })
    .returning();

  await writeAudit(auth.user.email, "allow", "user", String(user.id), email);
  return Response.json({ user }, { status: 201 });
}
