ALTER TABLE pi_prospects ADD COLUMN place_id TEXT;
--> statement-breakpoint
ALTER TABLE pi_prospects ADD COLUMN crm_facts TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
UPDATE pi_prospects
SET place_id = COALESCE(place_id, json_extract(facts, '$.placeId')),
    facts = json_object('placeId', COALESCE(json_extract(facts, '$.placeId'), ''))
WHERE place_id IS NULL OR facts <> json_object('placeId', COALESCE(json_extract(facts, '$.placeId'), ''));
--> statement-breakpoint
CREATE TABLE pi_place_context (
 tenant_id TEXT NOT NULL, prospect_id TEXT NOT NULL, place_id TEXT NOT NULL,
 context TEXT NOT NULL, retrieved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 PRIMARY KEY(tenant_id, prospect_id),
 FOREIGN KEY(tenant_id, prospect_id) REFERENCES pi_prospects(tenant_id,id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX pi_place_context_expiry ON pi_place_context(tenant_id, expires_at);
