import { and, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { staffUsers } from "../../db/schema";
import {
  getChatGPTUser,
  requireChatGPTUser,
  type ChatGPTUser,
} from "../chatgpt-auth";

export type AuthorizedUser = ChatGPTUser & {
  role: "admin" | "operator" | "viewer";
};

// Initial owner is the connected Sites account used for this deployment.
// Additional users are managed in the protected Users area and stored in D1.
const INITIAL_OWNER_EMAIL = "robertocorp2@gmail.com";

function normalizedEmail(email: string) {
  return email.trim().toLowerCase();
}

async function resolveAuthorizedUser(
  user: ChatGPTUser,
): Promise<AuthorizedUser | null> {
  const db = getDb();
  const email = normalizedEmail(user.email);
  const now = new Date().toISOString();

  if (email === INITIAL_OWNER_EMAIL) {
    await db
      .insert(staffUsers)
      .values({
        email,
        name: user.fullName ?? user.displayName,
        role: "admin",
        active: true,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: staffUsers.email });
  }

  const [staff] = await db
    .select()
    .from(staffUsers)
    .where(and(eq(staffUsers.email, email), eq(staffUsers.active, true)))
    .limit(1);

  if (!staff) return null;
  return { ...user, email, role: staff.role };
}

export async function getAuthorizedUser(): Promise<AuthorizedUser | null> {
  const user = await getChatGPTUser();
  return user ? resolveAuthorizedUser(user) : null;
}

export async function requireAuthorizedUser(
  returnTo: string,
): Promise<AuthorizedUser> {
  const user = await requireChatGPTUser(returnTo);
  const authorized = await resolveAuthorizedUser(user);
  if (!authorized) {
    throw new Error("HIDACA_ACCESS_DENIED");
  }
  return authorized;
}

export async function authorizeApi(
  adminOnly = false,
): Promise<
  | { ok: true; user: AuthorizedUser }
  | { ok: false; response: Response }
> {
  const user = await getChatGPTUser();
  if (!user) {
    return {
      ok: false,
      response: Response.json(
        { error: "Debes iniciar sesión con ChatGPT." },
        { status: 401 },
      ),
    };
  }

  const authorized = await resolveAuthorizedUser(user);
  if (!authorized) {
    return {
      ok: false,
      response: Response.json(
        { error: "Tu cuenta no está autorizada para HIDACA." },
        { status: 403 },
      ),
    };
  }

  if (adminOnly && authorized.role !== "admin") {
    return {
      ok: false,
      response: Response.json(
        { error: "Esta acción requiere el rol Administrador." },
        { status: 403 },
      ),
    };
  }

  return { ok: true, user: authorized };
}
