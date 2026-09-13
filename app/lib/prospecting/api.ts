import { ProspectingError, retryable, type Context } from "./contracts";
import { ProspectingService } from "./service";
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ProspectingError("invalid_request", "Se requiere JSON.");
  if (!request.body) throw new ProspectingError("invalid_request");
  const reader = request.body.getReader(); let size = 0, body = ""; const decoder = new TextDecoder();
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 65536) { await reader.cancel(); throw new ProspectingError("invalid_request", "Solicitud demasiado grande."); } body += decoder.decode(part.value, { stream: true }); }
  try { return JSON.parse(body + decoder.decode()); } catch { throw new ProspectingError("invalid_request", "JSON inválido."); }
}
export async function handleApi(request: Request, path: string[], context: Context, service: ProspectingService): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Request-Id": context.requestId, "X-Content-Type-Options": "nosniff" };
  try {
    const url = new URL(request.url), origin = request.headers.get("origin");
    if (request.method !== "GET" && origin && origin !== url.origin) throw new ProspectingError("forbidden");
    const route = path.join("/"), method = request.method;
    let result: unknown; let status = 200;
    if (method === "GET" && route === "prospects") result = url.searchParams.has("ids") ? await service.summaries(context, url.searchParams.get("ids")!.split(",")) : await service.list(context, url.searchParams.get("cursor") ?? "", Number(url.searchParams.get("limit") ?? 20));
    else if (method === "GET" && route === "prospecting-settings") result = await service.settings(context);
    else if (method === "GET" && route === "prospecting-capabilities") result = await service.policy(context);
    else if (method === "PUT" && route === "prospecting-settings") result = await service.savePolicy(context, await readBody(request));
    else if (method === "GET" && route === "prospecting-metrics") result = await service.metrics(context);
    else if (method === "POST" && route === "prospect-searches") { result = await service.search(context, await readBody(request)); status = 202; }
    else if (method === "GET" && path[0] === "prospect-searches" && path.length === 2) result = await service.searchResult(context, path[1]);
    else if (method === "GET" && path[0] === "prospects" && path.length === 2) result = await service.detail(context, path[1]);
    else if (method === "POST" && path[0] === "prospects" && path.length === 3 && ["enrichment", "audits"].includes(path[2])) { result = await service.enrich(context, path[1], await readBody(request), path[2] === "audits"); status = 202; }
    else if (method === "DELETE" && path[0] === "prospects" && path[2] === "contact-data" && path.length === 3) result = await service.deleteContacts(context, path[1]);
    else if (method === "POST" && route === "prospect-selections/preview") result = await service.preview(context, await readBody(request));
    else if (method === "POST" && route === "prospect-selections/convert") { result = await service.convert(context, await readBody(request)); status = 202; }
    else if (method === "POST" && route === "prospect-selections/repair") { result = await service.repair(context, await readBody(request)); status = 202; }
    else if (method === "POST" && route === "prospect-selections/bulk") { result = await service.bulk(context, await readBody(request)); status = 202; }
    else if (method === "GET" && path[0] === "prospect-selections" && path.length === 2) result = await service.bulkStatus(context, path[1]);
    else if (method === "POST" && path[0] === "prospect-selections" && path[2] === "cancel" && path.length === 3) result = await service.cancelBulk(context, path[1]);
    else if (method === "GET" && path[0] === "jobs" && path.length === 2) result = await service.job(context, path[1]);
    else if (method === "POST" && path[0] === "jobs" && path[2] === "retry" && path.length === 3) result = await service.retry(context, path[1]);
    else throw new ProspectingError("not_found");
    return Response.json({ apiVersion: "v1", requestId: context.requestId, data: result }, { status, headers });
  } catch (error) {
    const e = error instanceof ProspectingError ? error : new ProspectingError("unknown", "No se pudo completar la solicitud.");
    const status = ({ invalid_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, unsupported: 422, policy_blocked: 403, budget_exhausted: 429, rate_limited: 429, timeout: 504, unavailable: 503, unknown: 500 } as const)[e.code];
    return Response.json({ apiVersion: "v1", requestId: context.requestId, error: { code: e.code, message: e.message, retryable: retryable(e.code) } }, { status, headers: { ...headers, ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}) } });
  }
}
