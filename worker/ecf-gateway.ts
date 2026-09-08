/**
 * Public fiscal gateway. It is intentionally separate from the owner-only
 * CRM Worker. Deploy it only with dedicated DGII bindings and secrets.
 * This gateway never exposes the HIDACA application or its UI.
 */
interface GatewayEnv {
  DB: D1Database;
  FILES: R2Bucket;
  ECF_GATEWAY_SHARED_SECRET?: string;
  ECF_GATEWAY_ENABLED?: string;
}

const gateway = {
  async fetch(request: Request, env: GatewayEnv): Promise<Response> {
    if (env.ECF_GATEWAY_ENABLED !== "true") return json({ error: "Fiscal gateway disabled." }, 503);
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname.endsWith("/fe/autenticacion/api/semilla")) return seed();
    if (request.method === "POST" && url.pathname.endsWith("/fe/autenticacion/api/validacioncertificado")) return certificateValidation(request);
    if (request.method === "POST" && url.pathname.endsWith("/fe/recepcion/api/ecf")) return receive(request, env, "ecf");
    if (request.method === "POST" && url.pathname.endsWith("/fe/aprobacioncomercial/api/ecf")) return receive(request, env, "approval");
    return json({ error: "Fiscal endpoint not found." }, 404);
  },
};

export default gateway;

async function receive(request: Request, env: GatewayEnv, operation: string) {
  const body = await readXml(request);
  if (!body) return json({ error: "XML payload is required." }, 400);
  if (body.length > 5_000_000 || /<!DOCTYPE|<!ENTITY/i.test(body)) return json({ error: "XML payload rejected." }, 413);
  if (!/<(?:ECF|ACECF)\b/i.test(body) || !/<Signature\b/i.test(body)) return json({ error: "Signed XML is required." }, 400);
  const encf = tag(body, "eNCF") || tag(body, "ENCF");
  const issuerRnc = tag(body, "RNCEmisor");
  const id = crypto.randomUUID();
  const key = `ecf-gateway/inbound/${new Date().toISOString().slice(0, 10)}/${id}.xml`;
  await env.FILES.put(key, new TextEncoder().encode(body), { httpMetadata: { contentType: "application/xml" } });
  await env.DB.prepare("INSERT INTO ecf_inbound_messages (id, environment, operation, issuer_rnc, encf, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, "test", operation, issuerRnc, encf, "received_pending_validation", new Date().toISOString()).run();
  if (operation === "approval") return xml(`<ACECF><DetalleAprobacionComercial><eNCF>${escapeXml(encf)}</eNCF><Estado>0</Estado></DetalleAprobacionComercial></ACECF>`);
  return xml(`<ARECF><DetalleAcusederecibo><Version>1.0</Version><RNCEmisor>${escapeXml(issuerRnc)}</RNCEmisor><eNCF>${escapeXml(encf)}</eNCF><Estado>0</Estado><FechaHoraAcuseRecibo>${new Date().toISOString()}</FechaHoraAcuseRecibo></DetalleAcusederecibo></ARECF>`);
}

async function certificateValidation(request: Request) {
  const body = await readXml(request);
  if (!body || body.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(body)) return json({ error: "Signed certificate XML is required." }, 400);
  return json({ error: "Certificate validation requires the configured server-side verifier." }, 503);
}

async function readXml(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const value = form.get("xml");
    return value instanceof File ? await value.text() : typeof value === "string" ? value : "";
  }
  return await request.text();
}

function seed() {
  return xml(`<SemillaModel><valor>${crypto.randomUUID()}</valor><fecha>${new Date().toISOString()}</fecha></SemillaModel>`);
}
function tag(xmlValue: string, name: string) { return xmlValue.match(new RegExp(`<${name}[^>]*>([^<]*)</${name}>`, "i"))?.[1]?.trim() ?? ""; }
function escapeXml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;"); }
function xml(body: string) { return new Response(`<?xml version="1.0" encoding="UTF-8"?>${body}`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" } }); }
function json(body: Record<string, unknown>, status: number) { return Response.json(body, { status, headers: { "cache-control": "no-store" } }); }
