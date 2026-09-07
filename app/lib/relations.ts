import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../db";
import {
  businessRecords,
  businesses,
  contacts,
  leads,
  opportunities,
} from "../../db/schema";
import type { RelatedRecordType } from "./crm";

export async function relatedRecordExists(
  type: RelatedRecordType,
  id: string,
): Promise<boolean> {
  const db = getDb();
  if (type === "business") {
    const [row] = await db
      .select({ id: businesses.id })
      .from(businesses)
      .where(and(eq(businesses.id, id), isNull(businesses.archivedAt)))
      .limit(1);
    return Boolean(row);
  }
  if (type === "contact") {
    const [row] = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.id, id), isNull(contacts.archivedAt)))
      .limit(1);
    return Boolean(row);
  }
  if (type === "lead") {
    const [row] = await db
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, id), isNull(leads.archivedAt)))
      .limit(1);
    return Boolean(row);
  }
  if (type === "opportunity") {
    const [row] = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        and(eq(opportunities.id, id), isNull(opportunities.archivedAt)),
      )
      .limit(1);
    return Boolean(row);
  }
  const moduleKey = type === "case" ? "ordenes-cambio" : "proyectos";
  const [row] = await db
    .select({ id: businessRecords.id })
    .from(businessRecords)
    .where(
      and(
        eq(businessRecords.id, id),
        eq(businessRecords.module, moduleKey),
        isNull(businessRecords.archivedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
