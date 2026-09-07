import { asc, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../db";
import { businesses } from "../../../db/schema";
import { cleanText, normalizeText } from "../../lib/crm";
import {
  inferCustomerType,
  normalizeRnc,
  validateCustomerIdentity,
} from "../../lib/source-domain";
import { writeAudit } from "../../lib/audit";
import { authorizeApi } from "../../lib/authorization";
import { upsertSearchDocument } from "../../lib/search";

export async function GET() {
  const auth = await authorizeApi({ module: "clientes", action: "view" });
  if (!auth.ok) return auth.response;
  const rows = await getDb()
    .select()
    .from(businesses)
    .where(isNull(businesses.archivedAt))
    .orderBy(asc(businesses.name))
    .limit(500);
  return Response.json({ businesses: rows });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "clientes", action: "create" });
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as Record<string, unknown>;
  const name = cleanText(payload.name, 180);
  const normalizedName = normalizeText(name);
  const customerType =
    payload.customerType ?? inferCustomerType(name, payload.rnc);
  const identity = validateCustomerIdentity({
    name,
    type: customerType,
    rnc: payload.rnc,
  });
  if (identity.errors.length) {
    return Response.json(
      { error: identity.errors[0], errors: identity.errors },
      { status: 400 },
    );
  }

  const db = getDb();
  const [duplicate] = await db
    .select({ id: businesses.id, name: businesses.name })
    .from(businesses)
    .where(eq(businesses.normalizedName, normalizedName))
    .limit(1);
  if (duplicate && payload.confirmDuplicate !== true) {
    return Response.json(
      { error: "Ya existe un Business con ese nombre.", duplicate },
      { status: 409 },
    );
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [business] = await db
    .insert(businesses)
    .values({
      id,
      name,
      normalizedName,
      customerType: identity.type!,
      rnc: cleanText(payload.rnc, 30),
      normalizedRnc: normalizeRnc(payload.rnc),
      email: cleanText(payload.email, 180),
      phone: cleanText(payload.phone, 60),
      mobilePhone: cleanText(payload.mobilePhone, 60),
      address: cleanText(payload.address, 300),
      notes: cleanText(payload.notes, 4000),
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await Promise.all([
    writeAudit(auth.user.email, "create", "business", id, name),
    upsertSearchDocument({
      entityType: "business",
      entityId: id,
      title: name,
      subtitle: business.rnc || business.email || business.phone,
      searchText: `${name} ${business.rnc} ${business.email} ${business.phone} ${business.mobilePhone} ${business.address} ${business.notes}`,
      ownerEmail: business.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ business }, { status: 201 });
}
