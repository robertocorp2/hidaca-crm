import { and, desc, eq, inArray, isNull, like, or } from "drizzle-orm";
import { getDb } from "../../../db";
import { businessRecords } from "../../../db/schema";
import { authorizeApi, can } from "../../lib/authorization";
import { moduleSearchEntityType } from "../../lib/crm";
import { isModuleKey, modules, permissionModuleForLegacyRecord } from "../../lib/modules";
import { writeAudit } from "../../lib/audit";
import { upsertSearchDocument } from "../../lib/search";

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const moduleKey = url.searchParams.get("module") ?? "";
  const search = url.searchParams.get("search")?.trim() ?? "";
  if (moduleKey && !isModuleKey(moduleKey)) {
    return Response.json({ error: "Módulo no válido." }, { status: 400 });
  }

  const allowedModules = modules.map((item) => item.key).filter((item) => {
    const permissionModule = permissionModuleForLegacyRecord(item);
    return permissionModule && can(auth.user, permissionModule, "view");
  });
  if (moduleKey) {
    const permissionModule = permissionModuleForLegacyRecord(moduleKey);
    if (!permissionModule || !can(auth.user, permissionModule, "view")) {
      return Response.json({ error: "No tienes permiso para consultar este módulo." }, { status: 403 });
    }
  }

  const db = getDb();
  const filters = [isNull(businessRecords.archivedAt)];
  filters.push(inArray(businessRecords.module, allowedModules));
  if (moduleKey) filters.push(eq(businessRecords.module, moduleKey));
  if (search) {
    const term = `%${search.replaceAll("%", "")}%`;
    filters.push(
      or(
        like(businessRecords.title, term),
        like(businessRecords.customerName, term),
        like(businessRecords.contact, term),
      )!,
    );
  }

  const records = await db
    .select()
    .from(businessRecords)
    .where(and(...filters))
    .orderBy(desc(businessRecords.updatedAt))
    .limit(250);

  return Response.json({ records });
}

export async function POST(request: Request) {
  const payload = (await request.json()) as Record<string, unknown>;
  const moduleKey = String(payload.module ?? "");
  const title = String(payload.title ?? "").trim();
  if (!isModuleKey(moduleKey) || !title) {
    return Response.json(
      { error: "Módulo y título son obligatorios." },
      { status: 400 },
    );
  }
  const permissionModule = permissionModuleForLegacyRecord(moduleKey)!;
  const auth = await authorizeApi({ module: permissionModule, action: "create" });
  if (!auth.ok) return auth.response;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const [record] = await getDb()
    .insert(businessRecords)
    .values({
      id,
      module: moduleKey,
      title,
      status: String(payload.status ?? "Activo").trim() || "Activo",
      customerName: String(payload.customerName ?? "").trim(),
      contact: String(payload.contact ?? "").trim(),
      amount: numberValue(payload.amount),
      balance: numberValue(payload.balance),
      dueDate: String(payload.dueDate ?? "").trim() || null,
      notes: String(payload.notes ?? "").trim(),
      metadata: "{}",
      createdBy: auth.user.email,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  await Promise.all([
    writeAudit(auth.user.email, "create", moduleKey, id, title),
    upsertSearchDocument({
      entityType: moduleSearchEntityType(moduleKey),
      entityId: id,
      title,
      subtitle: record.customerName || record.contact,
      searchText: `${title} ${record.customerName} ${record.contact} ${record.notes}`,
      ownerEmail: auth.user.email,
      updatedAt: now,
    }),
  ]);
  return Response.json({ record }, { status: 201 });
}
