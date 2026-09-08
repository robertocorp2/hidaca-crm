import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { ecfIssuerProfiles, ecfSequenceRanges } from "../../../../db/schema";
import { authorizeInvoiceApi } from "../../../lib/invoice-api";
import { ecfTypes, type EcfEnvironment } from "../../../lib/ecf-domain";

export async function GET() {
  const auth = await authorizeInvoiceApi({ action: "ecf_configure" });
  if (!auth.ok) return auth.response;
  const [profiles, ranges] = await Promise.all([getDb().select().from(ecfIssuerProfiles), getDb().select().from(ecfSequenceRanges)]);
  return Response.json({ profiles, ranges }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeInvoiceApi({ action: "ecf_configure" });
  if (!auth.ok) return auth.response;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const environment = normalizeEnvironment(payload.environment);
  const rnc = text(payload.rnc);
  if (!rnc) return Response.json({ error: "El RNC del emisor es obligatorio." }, { status: 400 });
  const db = getDb();
  const now = new Date().toISOString();
  try {
    const [profile] = await db.insert(ecfIssuerProfiles).values({
      id: crypto.randomUUID(), environment, rnc, legalName: text(payload.legalName), commercialName: text(payload.commercialName), fiscalAddress: text(payload.fiscalAddress), provinceCode: text(payload.provinceCode), municipalityCode: text(payload.municipalityCode), phone: text(payload.phone), email: text(payload.email), softwareName: text(payload.softwareName) || "HIDACA Constructora", softwareVersion: text(payload.softwareVersion), enabled: false, createdBy: auth.user.email, createdAt: now, updatedAt: now,
    }).returning();
    return Response.json({ profile }, { status: 201 });
  } catch {
    return Response.json({ error: "Ya existe un perfil para ese RNC y ambiente." }, { status: 409 });
  }
}

export async function PUT(request: Request) {
  const auth = await authorizeInvoiceApi({ action: "ecf_configure" });
  if (!auth.ok) return auth.response;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const profileId = text(payload.profileId);
  const ecfType = text(payload.ecfType);
  const startNumber = Number(payload.startNumber);
  const endNumber = Number(payload.endNumber);
  if (!profileId || !ecfTypes.includes(ecfType as never) || !Number.isInteger(startNumber) || !Number.isInteger(endNumber) || startNumber < 1 || endNumber < startNumber) return Response.json({ error: "Perfil, tipo e-CF y rango e-NCF son obligatorios." }, { status: 400 });
  const [profile] = await getDb().select().from(ecfIssuerProfiles).where(eq(ecfIssuerProfiles.id, profileId)).limit(1);
  if (!profile) return Response.json({ error: "Perfil fiscal no encontrado." }, { status: 404 });
  const now = new Date().toISOString();
  try {
    const [range] = await getDb().insert(ecfSequenceRanges).values({ id: crypto.randomUUID(), issuerProfileId: profileId, environment: profile.environment, ecfType, prefix: "E", startNumber, endNumber, nextNumber: startNumber, active: true, createdBy: auth.user.email, createdAt: now, updatedAt: now }).returning();
    return Response.json({ range }, { status: 201 });
  } catch { return Response.json({ error: "Ya existe un rango para ese perfil, ambiente y tipo." }, { status: 409 }); }
}

export async function PATCH(request: Request) {
  const auth = await authorizeInvoiceApi({ action: "ecf_configure" });
  if (!auth.ok) return auth.response;
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const profileId = text(payload.profileId);
  if (!profileId || typeof payload.enabled !== "boolean") return Response.json({ error: "Perfil y estado de habilitación son obligatorios." }, { status: 400 });
  const [profile] = await getDb().update(ecfIssuerProfiles).set({ enabled: payload.enabled, updatedAt: new Date().toISOString() }).where(eq(ecfIssuerProfiles.id, profileId)).returning();
  if (!profile) return Response.json({ error: "Perfil fiscal no encontrado." }, { status: 404 });
  return Response.json({ profile }, { headers: { "cache-control": "private, no-store" } });
}

function normalizeEnvironment(value: unknown): EcfEnvironment { return value === "certification" || value === "production" ? value : "test"; }
function text(value: unknown) { return value === null || value === undefined ? "" : String(value).trim().slice(0, 500); }
