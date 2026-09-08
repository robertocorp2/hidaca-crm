import { and, asc, eq, isNull, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { businesses, contacts } from "../../../db/schema";
import { writeAudit } from "../../lib/audit";
import { authorizeApi } from "../../lib/authorization";
import {
  cleanText,
  normalizeEmail,
  normalizePhone,
  normalizeText,
} from "../../lib/crm";
import { upsertSearchDocument } from "../../lib/search";

export async function GET() {
  const auth = await authorizeApi({ module: "contactos", action: "view" });
  if (!auth.ok) return auth.response;
  const rows = await getDb()
    .select()
    .from(contacts)
    .where(isNull(contacts.archivedAt))
    .orderBy(asc(contacts.name))
    .limit(500);
  return Response.json({ contacts: rows });
}

export async function POST(request: Request) {
  const auth = await authorizeApi({ module: "contactos", action: "create" });
  if (!auth.ok) return auth.response;

  const payload = (await request.json()) as Record<string, unknown>;
  const name = cleanText(payload.name, 180);
  const email = cleanText(payload.email, 180);
  const phone = cleanText(payload.phone, 60);
  const mobilePhone = cleanText(payload.mobilePhone, 60);
  const businessId = cleanText(payload.businessId, 80) || null;
  if (!name) {
    return Response.json(
      { error: "Contact Name es obligatorio." },
      { status: 400 },
    );
  }

  const db = getDb();
  if (businessId) {
    const [business] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, businessId), isNull(businesses.archivedAt)))
      .limit(1);
    if (!business) {
      return Response.json(
        { error: "El Business relacionado no existe." },
        { status: 400 },
      );
    }
  }

  const normalizedEmail = normalizeEmail(email);
  const normalizedPhone = normalizePhone(phone);
  const normalizedMobilePhone = normalizePhone(mobilePhone);
  const duplicateConditions = [];
  if (normalizedEmail)
    duplicateConditions.push(eq(contacts.normalizedEmail, normalizedEmail));
  if (normalizedPhone)
    duplicateConditions.push(eq(contacts.normalizedPhone, normalizedPhone));
  if (normalizedMobilePhone)
    duplicateConditions.push(
      eq(contacts.normalizedMobilePhone, normalizedMobilePhone),
    );
  if (duplicateConditions.length) {
    const [duplicate] = await db
      .select({ id: contacts.id, name: contacts.name })
      .from(contacts)
      .where(and(or(...duplicateConditions), isNull(contacts.archivedAt)))
      .limit(1);
    if (duplicate && payload.confirmDuplicate !== true) {
      return Response.json(
        { error: "Ya existe un Contact con ese correo o teléfono.", duplicate },
        { status: 409 },
      );
    }
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [contact] = await db
    .insert(contacts)
    .values({
      id,
      businessId,
      name,
      normalizedName: normalizeText(name),
      email,
      normalizedEmail,
      phone,
      normalizedPhone,
      mobilePhone,
      normalizedMobilePhone,
      title: cleanText(payload.title, 140),
      notes: cleanText(payload.notes, 4000),
      ownerEmail: cleanText(payload.ownerEmail, 180) || auth.user.email,
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await Promise.all([
    writeAudit(auth.user.email, "create", "contact", id, name),
    upsertSearchDocument({
      entityType: "contact",
      entityId: id,
      title: name,
      subtitle: contact.email || contact.mobilePhone || contact.phone,
      searchText: `${name} ${contact.email} ${contact.phone} ${contact.mobilePhone} ${contact.title} ${contact.notes}`,
      ownerEmail: contact.ownerEmail,
      updatedAt: now,
    }),
  ]);
  return Response.json({ contact }, { status: 201 });
}
