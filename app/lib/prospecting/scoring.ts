import type { Component, Prospect, Score, ScoreSnapshot, ScoringConfig, Snapshot } from "./contracts";
import { distance, hash } from "./domain";
export const SCORING_VERSION = "digital-health-opportunity/1.0.0";
export function eligibleSnapshots(snapshots: Snapshot[], at: string): Snapshot[] {
  const chosen = new Map<string, Snapshot>();
  for (const snapshot of [...snapshots].sort((a, b) => b.retrievedAt.localeCompare(a.retrievedAt) || b.id.localeCompare(a.id))) {
    if (!["complete", "partial"].includes(snapshot.status) || snapshot.expiresAt <= at || snapshot.retrievedAt > at) continue;
    if (!chosen.has(snapshot.source)) chosen.set(snapshot.source, snapshot);
  }
  return [...chosen.values()].sort((a, b) => a.source.localeCompare(b.source));
}
function aggregate(components: Record<string, Component>, minimum: number): Score {
  const all = Object.values(components), total = all.reduce((sum, c) => sum + c.weight, 0);
  const available = all.filter(c => c.value !== null && c.weight > 0);
  const weight = available.reduce((sum, c) => sum + c.weight, 0), coverage = total ? weight / total : 0;
  return { value: weight && coverage >= minimum ? Math.round(available.reduce((sum, c) => sum + c.value! * c.weight, 0) / weight) : null,
    confidence: Math.round(coverage * 100), coverage, unknown: Object.entries(components).filter(([, c]) => c.value === null).map(([name]) => name), components };
}
const component = (value: number | undefined | null, weight: number, evidenceIds: string[], rule: string): Component => ({ value: value != null && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null, weight, evidenceIds, rule });
export async function calculateScores(prospect: Prospect, allSnapshots: Snapshot[], config: ScoringConfig, at: string): Promise<ScoreSnapshot> {
  const snapshots = eligibleSnapshots(allSnapshots, at), page = snapshots.find(s => s.source === "pagespeed"), tech = snapshots.find(s => s.source === "builtwith"), contact = snapshots.find(s => s.source === "hunter"), listing = snapshots.find(s => s.source === "google_places");
  const data = page?.data ?? {}, ids = (s: Snapshot | undefined) => s ? [s.id] : [];
  const healthNames = ["performance", "accessibility", "seo", "trust", "technology"] as const;
  const health: Record<string, Component> = {};
  healthNames.forEach((name, i) => { health[name] = component(name === "technology" ? tech?.data.technology : data[name], config.healthWeights[i], ids(name === "technology" ? tech : page), name === "trust" ? "HTTPS + mobile viewport; conversion paths not assessed" : name === "technology" ? "Known Flash detection; other technology freshness unknown" : "Lighthouse mobile score"); });
  const digitalHealth = aggregate(health, config.minimumCoverage);
  const facts = listing?.data.facts;
  let fit: number | null = null;
  if (facts && (config.targetTypes.length || config.targetCenter)) {
    const criteria: boolean[] = [];
    if (config.targetTypes.length) criteria.push(facts.categories.some(c => config.targetTypes.includes(c)));
    if (config.targetCenter && facts.latitude !== null && facts.longitude !== null) criteria.push(distance(config.targetCenter, { latitude: facts.latitude, longitude: facts.longitude }) <= config.targetCenter.radius);
    if (!config.targetCenter || (facts.latitude !== null && facts.longitude !== null)) fit = criteria.every(Boolean) ? 100 : 0;
  }
  const hasContact = contact && (contact.data.verifiedContacts ?? 0) > 0;
  const reachability = hasContact ? 100 : facts?.phone ? 60 : facts?.website ? 30 : null;
  const opportunity = aggregate({
    need: component(digitalHealth.value === null ? null : 100 - digitalHealth.value, config.opportunityWeights[0], [...new Set(Object.values(health).filter(c => c.value !== null).flatMap(c => c.evidenceIds))], "100 minus supported Digital Health; unknown gaps are excluded"),
    fit: component(fit, config.opportunityWeights[1], ids(listing), "Configured business categories and service area"),
    reachability: component(reachability, config.opportunityWeights[2], hasContact ? ids(contact) : ids(listing), "Verified contact 100; listed phone 60; listed website 30; no buying-intent inference"),
    recency: component(listing ? Math.max(0, 100 - Math.floor((Date.parse(at) - Date.parse(listing.retrievedAt)) / 86400000) * 10) : null, config.opportunityWeights[3], ids(listing), "Source retrieval recency only; not purchase intent"),
    dataConfidence: component(snapshots.length ? digitalHealth.confidence : null, config.opportunityWeights[4], snapshots.map(s => s.id), "Weighted health evidence coverage"),
  }, config.minimumCoverage);
  // Need derived from incomplete health evidence must not imply more certainty.
  opportunity.confidence = Math.min(opportunity.confidence, Math.round((opportunity.coverage + digitalHealth.coverage) / 2 * 100));
  const evidenceIds = [...new Set([...Object.values(health), ...Object.values(opportunity.components)].flatMap(c => c.evidenceIds))].sort();
  const id = `sc_${await hash([prospect.tenantId, prospect.id, SCORING_VERSION, config, at, evidenceIds])}`;
  return { id, tenantId: prospect.tenantId, prospectId: prospect.id, scoringVersion: SCORING_VERSION, configVersion: config.version, calculatedAt: at, digitalHealth, estimatedOpportunity: opportunity, evidenceIds };
}
export function auditFindings(score: ScoreSnapshot, snapshots: Snapshot[]) {
  const findings: { ruleId: string; severity: "info" | "warning" | "critical"; text: string; remediation: string; evidenceIds: string[] }[] = [];
  for (const snapshot of eligibleSnapshots(snapshots, score.calculatedAt)) for (const finding of snapshot.data.findings ?? []) findings.push({ ...finding, evidenceIds: [snapshot.id] });
  for (const [name, c] of Object.entries(score.digitalHealth.components)) {
    if (c.value === null) findings.push({ ruleId: `coverage:${name}`, severity: "info", text: `${name}: sin evidencia suficiente.`, remediation: "Obtener o actualizar evidencia antes de recomendar cambios.", evidenceIds: c.evidenceIds });
    else if (c.value < 50) findings.push({ ruleId: `health:${name}:v1`, severity: "warning", text: `${name}: ${c.value}/100.`, remediation: "Revisar la evidencia y validar el problema con el responsable del sitio.", evidenceIds: c.evidenceIds });
  }
  return findings;
}
