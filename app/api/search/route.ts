import { authorizeApi, can } from "../../lib/authorization";
import { permissionModules } from "../../lib/modules";
import { cleanText, searchEntityLabels } from "../../lib/crm";
import { searchBusinessData } from "../../lib/search";

function resultHref(entityType: string, entityId: string) {
  const encoded = encodeURIComponent(entityId);
  const viewMap: Record<string, string> = {
    business: "businesses",
    contact: "contacts",
    lead: "leads",
    opportunity: "opportunities",
    case: "cases",
    project: "proyectos",
    quote: "cotizaciones",
    quotation: "quotations",
    invoice: "facturas",
    payment: "pagos",
    task: "tareas",
    milestone: "hitos",
    daily_report: "reportes-diarios",
    equipment: "equipos",
    staff: "personal",
    supplier: "suplidores",
    document: "documentos",
    activity: "schedule",
  };
  const view = viewMap[entityType] ?? "resumen";
  return `/app?view=${encodeURIComponent(view)}&record=${encoded}`;
}

export async function GET(request: Request) {
  const auth = await authorizeApi();
  if (!auth.ok) return auth.response;
  const query = cleanText(new URL(request.url).searchParams.get("q"), 120);
  if (query.length < 2) {
    return Response.json(
      { groups: [], query },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    const allowedEntityTypes = permissionModules
      .filter((module) => can(auth.user, module.key, "view"))
      .flatMap((module) => [...module.entities]);
    const results = await searchBusinessData(query, 48, allowedEntityTypes);
    const grouped = new Map<
      string,
      Array<{
        entityType: string;
        entityId: string;
        title: string;
        subtitle: string;
        href: string;
      }>
    >();
    for (const result of results) {
      const items = grouped.get(result.entityType) ?? [];
      items.push({
        entityType: result.entityType,
        entityId: result.entityId,
        title: result.title,
        subtitle: result.subtitle,
        href: resultHref(result.entityType, result.entityId),
      });
      grouped.set(result.entityType, items);
    }
    const groups = [...grouped.entries()].map(([entityType, items]) => ({
      entityType,
      label: searchEntityLabels[entityType] ?? "Records",
      items,
    }));
    return Response.json(
      { groups, query },
      { headers: { "cache-control": "private, no-store" } },
    );
  } catch {
    return Response.json(
      { error: "La búsqueda no está disponible temporalmente." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
