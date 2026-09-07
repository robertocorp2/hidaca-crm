import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../../../../db";
import { businessRecords } from "../../../../db/schema";
import { writeAudit } from "../../../lib/audit";
import { authorizeApi } from "../../../lib/authorization";
import { moduleSearchEntityType } from "../../../lib/crm";
import {
  deleteSearchDocument,
  upsertSearchDocument,
} from "../../../lib/search";

type RouteContext = { params: Promise<{ id: string }> };

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function PATCH(request: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const title = String(payload.title ?? "").trim();
  if (!title) {
    return Response.json({ error: "El título es obligatorio." }, { status: 400 });
  }

  const [record] = await getDb()
    .update(businessRecords)
    .set({
      title,
      status: String(payload.status ?? "Activo").trim() || "Activo",
      customerName: String(payload.customerName ?? "").trim(),
      contact: String(payload.contact ?? "").trim(),
      amount: numberValue(payload.amount),
      balance: numberValue(payload.balance),
      dueDate: String(payload.dueDate ?? "").trim() || null,
      notes: String(payload.notes ?? "").trim(),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(businessRecords.id, id), isNull(businessRecords.archivedAt)))
    .returning();

  if (!record) {
    return Response.json({ error: "Registro no encontrado." }, { status: 404 });
  }
  await Promise.all([
    writeAudit(auth.user.email, "update", record.module, id, title),
    upsertSearchDocument({
      entityType: moduleSearchEntityType(record.module),
      entityId: id,
      title,
      subtitle: record.customerName || record.contact,
      searchText: `${title} ${record.customerName} ${record.contact} ${record.notes}`,
      ownerEmail: record.createdBy,
      updatedAt: record.updatedAt,
    }),
  ]);
  return Response.json({ record });
}

export async function DELETE(_: Request, context: RouteContext) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  if (auth.user.role === "viewer") {
    return Response.json({ error: "Acceso de solo lectura." }, { status: 403 });
  }

  const { id } = await context.params;
  const [record] = await getDb()
    .update(businessRecords)
    .set({
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(businessRecords.id, id), isNull(businessRecords.archivedAt)))
    .returning();

  if (!record) {
    return Response.json({ error: "Registro no encontrado." }, { status: 404 });
  }
  await Promise.all([
    writeAudit(
      auth.user.email,
      "archive",
      record.module,
      id,
      record.title,
    ),
    deleteSearchDocument(moduleSearchEntityType(record.module), id),
  ]);
  return Response.json({ ok: true });
}
