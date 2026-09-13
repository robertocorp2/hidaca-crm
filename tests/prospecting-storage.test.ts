import assert from "node:assert/strict";
import test from "node:test";
import { Repository } from "../app/lib/prospecting/repository";
import { context, database, facts } from "./prospecting-support";

test("Google Place ID is durable while listing context expires", async () => {
  const db = database();
  try {
    const prospect = await db.repo.canonicalize(context, facts);
    const stored = db.sqlite.prepare("SELECT place_id,facts FROM pi_prospects WHERE id=?").get(prospect.id) as { place_id: string; facts: string };
    assert.equal(stored.place_id, facts.placeId);
    assert.deepEqual(JSON.parse(stored.facts), { placeId: facts.placeId });

    const now = new Date().toISOString(), expires = new Date(Date.now() + 60_000).toISOString();
    db.sqlite.prepare("UPDATE pi_place_context SET context=?,retrieved_at=?,expires_at=? WHERE tenant_id=? AND prospect_id=?").run(JSON.stringify(facts), now, expires, context.tenantId, prospect.id);
    const fresh = await db.repo.getProspect(context.tenantId, prospect.id);
    assert.equal(fresh?.name, facts.name);
    assert.equal(fresh?.rating, facts.rating);

    db.sqlite.prepare("UPDATE pi_place_context SET expires_at='2000-01-01'").run();
    const expired = await new Repository(db.binding).getProspect(context.tenantId, prospect.id);
    assert.equal(expired?.placeId, facts.placeId);
    assert.equal(expired?.name, "");
    assert.equal(expired?.rating, null);
  } finally { db.sqlite.close(); }
});
