import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE business.knowledge_releases
    ADD COLUMN publication_origin jsonb,
    ADD COLUMN derivation_scope_key text,
    ALTER COLUMN review_task_ref DROP NOT NULL,
    ALTER COLUMN review_decision_ref DROP NOT NULL,
    DROP CONSTRAINT knowledge_releases_json_ck,
    DROP CONSTRAINT knowledge_releases_effective_uidx,
    ADD CONSTRAINT knowledge_releases_json_ck CHECK (
      jsonb_typeof(revision_ref) = 'object'
      AND jsonb_typeof(authorization_context_ref) = 'object'
      AND (restored_from_release_ref IS NULL OR jsonb_typeof(restored_from_release_ref) = 'object')
      AND ((publication_origin IS NULL
        AND review_task_ref IS NOT NULL AND jsonb_typeof(review_task_ref) = 'object'
        AND review_decision_ref IS NOT NULL AND jsonb_typeof(review_decision_ref) = 'object'
        AND derivation_scope_key IS NULL)
      OR ((publication_origin ->> 'kind' = 'derived-approved'
        AND definition_type IN ('retrieval-evidence-base', 'applicable-rule-set')
        AND review_task_ref IS NULL AND review_decision_ref IS NULL
        AND jsonb_typeof(publication_origin -> 'parentReleaseRefs') = 'array'
        AND jsonb_array_length(publication_origin -> 'parentReleaseRefs') > 0
        AND jsonb_typeof(publication_origin -> 'derivationPolicyRef') = 'object'
        AND jsonb_typeof(publication_origin -> 'contextRef') = 'object'
        AND ((definition_type = 'applicable-rule-set' AND derivation_scope_key IS NOT NULL AND derivation_scope_key <> '')
          OR (definition_type = 'retrieval-evidence-base' AND derivation_scope_key IS NULL))) IS TRUE))
    )`.execute(db);
  await sql`CREATE UNIQUE INDEX knowledge_releases_effective_uidx
    ON business.knowledge_releases(definition_id, effective_from)
    WHERE derivation_scope_key IS NULL`.execute(db);
  await sql`CREATE UNIQUE INDEX knowledge_releases_derived_effective_uidx
    ON business.knowledge_releases(definition_id, derivation_scope_key, effective_from)
    WHERE derivation_scope_key IS NOT NULL`.execute(db);
  await sql`CREATE TABLE business.identification_knowledge_entries (
    project_id text NOT NULL,
    release_id text NOT NULL,
    release_version_id text NOT NULL,
    source_kind text NOT NULL CHECK (source_kind IN ('risk-mechanism', 'standard-library', 'case-library')),
    entry_id text NOT NULL,
    entry_json jsonb NOT NULL,
    source_version_refs jsonb NOT NULL,
    PRIMARY KEY (project_id, release_id, release_version_id, entry_id),
    FOREIGN KEY (release_id, release_version_id) REFERENCES business.knowledge_releases(release_id, version_id)
  )`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.identification_knowledge_entries TO riskflow_app`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM business.knowledge_releases WHERE publication_origin IS NOT NULL)
      THEN RAISE EXCEPTION 'derived knowledge releases require a compatible restore point';
    END IF;
  END $$`.execute(db);
  await sql`DROP TABLE business.identification_knowledge_entries`.execute(db);
  await sql`DROP INDEX business.knowledge_releases_effective_uidx`.execute(db);
  await sql`DROP INDEX business.knowledge_releases_derived_effective_uidx`.execute(db);
  await sql`ALTER TABLE business.knowledge_releases
    DROP CONSTRAINT knowledge_releases_json_ck,
    DROP COLUMN publication_origin,
    DROP COLUMN derivation_scope_key,
    ALTER COLUMN review_task_ref SET NOT NULL,
    ALTER COLUMN review_decision_ref SET NOT NULL,
    ADD CONSTRAINT knowledge_releases_effective_uidx UNIQUE (definition_id, effective_from),
    ADD CONSTRAINT knowledge_releases_json_ck CHECK (
      jsonb_typeof(revision_ref) = 'object'
      AND jsonb_typeof(review_task_ref) = 'object'
      AND jsonb_typeof(review_decision_ref) = 'object'
      AND (restored_from_release_ref IS NULL OR jsonb_typeof(restored_from_release_ref) = 'object')
      AND jsonb_typeof(authorization_context_ref) = 'object'
    )`.execute(db);
}
