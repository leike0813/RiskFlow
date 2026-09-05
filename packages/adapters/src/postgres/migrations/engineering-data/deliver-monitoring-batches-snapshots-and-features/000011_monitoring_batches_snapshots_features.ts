import { sql, type Kysely } from "kysely";

const tables = [
  "business.monitoring_snapshot_query_results",
  "business.monitoring_snapshot_features",
  "business.monitoring_snapshot_points",
  "business.monitoring_snapshot_members",
  "business.monitoring_snapshots",
  "business.monitoring_availability_policies",
  "business.monitoring_sample_versions",
  "business.monitoring_batches",
  "business.monitoring_series_revisions",
  "business.monitoring_series",
] as const;

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT UPDATE (current_revision_id) ON TABLE business.monitoring_series TO riskflow_app`.execute(
    db,
  );
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_series (
      series_id text PRIMARY KEY,
      project_id text NOT NULL,
      current_revision_id text,
      created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT monitoring_series_identity_ck CHECK (length(trim(series_id)) BETWEEN 1 AND 200 AND length(trim(project_id)) BETWEEN 1 AND 200),
      CONSTRAINT monitoring_series_project_unique UNIQUE (series_id, project_id)
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_series_revisions (
      revision_id text PRIMARY KEY,
      series_id text NOT NULL,
      project_id text NOT NULL,
      revision_no integer NOT NULL,
      version_id text NOT NULL,
      monitoring_series_ref jsonb NOT NULL,
      project_revision_ref jsonb NOT NULL,
      spatial_scope_ref jsonb NOT NULL,
      monitoring_object text NOT NULL,
      monitoring_indicator text NOT NULL,
      parameter_code text NOT NULL,
      canonical_unit text NOT NULL,
      unit_conversions jsonb NOT NULL,
      effective_period jsonb NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      actor_id text NOT NULL,
      authorization_context_ref jsonb NOT NULL,
      audit_entry_id text NOT NULL,
      occurred_at timestamp with time zone NOT NULL,
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      previous_revision_id text,
      CONSTRAINT monitoring_series_revisions_series_fk FOREIGN KEY (series_id, project_id) REFERENCES business.monitoring_series(series_id, project_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_series_revisions_previous_fk FOREIGN KEY (previous_revision_id, series_id) REFERENCES business.monitoring_series_revisions(revision_id, series_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_series_revisions_no_ck CHECK (revision_no > 0),
      CONSTRAINT monitoring_series_revisions_ref_unique UNIQUE (series_id, version_id),
      CONSTRAINT monitoring_series_revisions_id_unique UNIQUE (revision_id, series_id),
      CONSTRAINT monitoring_series_revisions_no_unique UNIQUE (series_id, revision_no),
      CONSTRAINT monitoring_series_revisions_json_ck CHECK (jsonb_typeof(monitoring_series_ref) = 'object' AND jsonb_typeof(project_revision_ref) = 'object' AND jsonb_typeof(spatial_scope_ref) = 'object' AND jsonb_typeof(unit_conversions) = 'array' AND jsonb_typeof(effective_period) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'),
      CONSTRAINT monitoring_series_revisions_unit_ck CHECK (length(canonical_unit) BETWEEN 1 AND 32),
      CONSTRAINT monitoring_series_revisions_audit_fk FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);

  await sql`
    ALTER TABLE business.monitoring_series
      ADD CONSTRAINT monitoring_series_current_fk
      FOREIGN KEY (current_revision_id, series_id)
      REFERENCES business.monitoring_series_revisions(revision_id, series_id)
      DEFERRABLE INITIALLY DEFERRED`
    .execute(db)
    .catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
    });

  await sql`
    CREATE OR REPLACE FUNCTION business.monitoring_series_current_revision_forward_only()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $function$
    DECLARE
      previous_revision_no integer;
      next_revision_no integer;
    BEGIN
      IF NEW.current_revision_id IS DISTINCT FROM OLD.current_revision_id
         AND OLD.current_revision_id IS NOT NULL THEN
        SELECT revision_no
          INTO previous_revision_no
          FROM business.monitoring_series_revisions
         WHERE revision_id = OLD.current_revision_id
           AND series_id = OLD.series_id;
        SELECT revision_no
          INTO next_revision_no
          FROM business.monitoring_series_revisions
         WHERE revision_id = NEW.current_revision_id
           AND series_id = NEW.series_id;
        IF previous_revision_no IS NULL
           OR next_revision_no IS NULL
           OR next_revision_no <= previous_revision_no THEN
          RAISE EXCEPTION 'monitoring series current revision must move forward'
            USING ERRCODE = 'check_violation';
        END IF;
      END IF;
      RETURN NEW;
    END;
    $function$`.execute(db);
  await sql`
    DROP TRIGGER IF EXISTS monitoring_series_current_revision_forward_only_trigger
      ON business.monitoring_series`.execute(db);
  await sql`
    CREATE TRIGGER monitoring_series_current_revision_forward_only_trigger
      BEFORE UPDATE OF current_revision_id ON business.monitoring_series
      FOR EACH ROW
      EXECUTE FUNCTION business.monitoring_series_current_revision_forward_only()`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_batches (
      batch_id text PRIMARY KEY,
      version_id text NOT NULL,
      project_id text NOT NULL,
      series_id text NOT NULL,
      series_revision_id text NOT NULL,
      monitoring_batch_ref jsonb NOT NULL,
      delivery_key text NOT NULL,
      delivery_fingerprint text NOT NULL,
      sample_artifact_ref jsonb NOT NULL,
      source_version_ref jsonb NOT NULL,
      source_segment_set_ref jsonb NOT NULL,
      project_revision_ref jsonb NOT NULL,
      spatial_scope_ref jsonb NOT NULL,
      window_from timestamp with time zone NOT NULL,
      window_to timestamp with time zone NOT NULL,
      relation_kind text NOT NULL,
      prior_batch_id text,
      sample_count integer NOT NULL,
      occurred_at timestamp with time zone NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      actor_id text NOT NULL,
      authorization_context_ref jsonb NOT NULL,
      audit_entry_id text NOT NULL,
      CONSTRAINT monitoring_batches_series_fk FOREIGN KEY (series_revision_id, series_id) REFERENCES business.monitoring_series_revisions(revision_id, series_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_batches_prior_fk FOREIGN KEY (prior_batch_id, series_id) REFERENCES business.monitoring_batches(batch_id, series_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_batches_id_series_unique UNIQUE (batch_id, series_id),
      CONSTRAINT monitoring_batches_fingerprint_unique UNIQUE (project_id, series_revision_id, delivery_fingerprint),
      CONSTRAINT monitoring_batches_delivery_unique UNIQUE (project_id, delivery_key),
      CONSTRAINT monitoring_batches_window_ck CHECK (window_to > window_from),
      CONSTRAINT monitoring_batches_relation_ck CHECK (relation_kind IN ('original', 'correction', 'supplement')),
      CONSTRAINT monitoring_batches_count_ck CHECK (sample_count BETWEEN 0 AND 100000),
      CONSTRAINT monitoring_batches_fingerprint_ck CHECK (delivery_fingerprint ~ '^[0-9a-f]{64}$'),
      CONSTRAINT monitoring_batches_json_ck CHECK (jsonb_typeof(monitoring_batch_ref) = 'object' AND jsonb_typeof(sample_artifact_ref) = 'object' AND jsonb_typeof(source_version_ref) = 'object' AND jsonb_typeof(source_segment_set_ref) = 'object' AND jsonb_typeof(project_revision_ref) = 'object' AND jsonb_typeof(spatial_scope_ref) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'),
      CONSTRAINT monitoring_batches_audit_fk FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_sample_versions (
      sample_version_id text PRIMARY KEY,
      version_id text NOT NULL,
      project_id text NOT NULL,
      series_id text NOT NULL,
      series_revision_id text NOT NULL,
      batch_id text NOT NULL,
      sample_version_ref jsonb NOT NULL,
      monitoring_batch_ref jsonb NOT NULL,
      monitoring_series_ref jsonb NOT NULL,
      source_sample_key text NOT NULL,
      sampled_at timestamp with time zone NOT NULL,
      value double precision NOT NULL,
      unit text NOT NULL,
      canonical_value double precision NOT NULL,
      canonical_unit text NOT NULL,
      previous_sample_version_id text,
      relation_kind text NOT NULL,
      evidence_references jsonb NOT NULL,
      source_version_ref jsonb NOT NULL,
      source_segment_set_ref jsonb NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT monitoring_sample_versions_batch_fk FOREIGN KEY (batch_id, series_id) REFERENCES business.monitoring_batches(batch_id, series_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_sample_versions_previous_fk FOREIGN KEY (previous_sample_version_id, series_id) REFERENCES business.monitoring_sample_versions(sample_version_id, series_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_sample_versions_id_series_unique UNIQUE (sample_version_id, series_id),
      CONSTRAINT monitoring_sample_versions_batch_key_unique UNIQUE (batch_id, source_sample_key),
      CONSTRAINT monitoring_sample_versions_value_ck CHECK (value <> 'NaN'::double precision AND value <> 'Infinity'::double precision AND value <> '-Infinity'::double precision AND canonical_value <> 'NaN'::double precision AND canonical_value <> 'Infinity'::double precision AND canonical_value <> '-Infinity'::double precision),
      CONSTRAINT monitoring_sample_versions_relation_ck CHECK (relation_kind IN ('original', 'correction', 'supplement')),
      CONSTRAINT monitoring_sample_versions_json_ck CHECK (jsonb_typeof(sample_version_ref) = 'object' AND jsonb_typeof(monitoring_batch_ref) = 'object' AND jsonb_typeof(monitoring_series_ref) = 'object' AND jsonb_typeof(evidence_references) = 'array' AND jsonb_typeof(source_version_ref) = 'object' AND jsonb_typeof(source_segment_set_ref) = 'object'),
      CONSTRAINT monitoring_sample_versions_unit_ck CHECK (length(unit) BETWEEN 1 AND 32 AND length(canonical_unit) BETWEEN 1 AND 32)
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_availability_policies (
      policy_id text PRIMARY KEY,
      version_id text NOT NULL,
      project_id text NOT NULL,
      monitoring_series_ref jsonb NOT NULL,
      availability_policy_ref jsonb NOT NULL,
      policy jsonb NOT NULL,
      policy_sha256 text NOT NULL,
      actor_id text NOT NULL,
      authorization_context_ref jsonb NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      audit_entry_id text NOT NULL,
      CONSTRAINT monitoring_policies_ref_unique UNIQUE (project_id, availability_policy_ref),
      CONSTRAINT monitoring_policies_version_unique UNIQUE (policy_id, version_id),
      CONSTRAINT monitoring_policies_json_ck CHECK (jsonb_typeof(monitoring_series_ref) = 'object' AND jsonb_typeof(availability_policy_ref) = 'object' AND jsonb_typeof(policy) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'),
      CONSTRAINT monitoring_policies_hash_ck CHECK (policy_sha256 ~ '^[0-9a-f]{64}$'),
      CONSTRAINT monitoring_policies_audit_fk FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_snapshots (
      snapshot_id text PRIMARY KEY,
      version_id text NOT NULL,
      project_id text NOT NULL,
      series_id text NOT NULL,
      series_revision_id text NOT NULL,
      monitoring_snapshot_ref jsonb NOT NULL,
      monitoring_series_ref jsonb NOT NULL,
      cutoff timestamp with time zone NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      "window" jsonb NOT NULL,
      availability_policy_ref jsonb NOT NULL,
      algorithm_versions jsonb NOT NULL,
      monitoring_batch_refs jsonb NOT NULL,
      sample_version_refs jsonb NOT NULL,
      availability text NOT NULL,
      coverage_ratio double precision NOT NULL,
      availability_reasons jsonb NOT NULL,
      evidence_references jsonb NOT NULL,
      authorization_snapshot jsonb NOT NULL,
      actor_id text NOT NULL,
      authorization_context_ref jsonb NOT NULL,
      audit_entry_id text NOT NULL,
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      CONSTRAINT monitoring_snapshots_series_fk FOREIGN KEY (series_revision_id, series_id) REFERENCES business.monitoring_series_revisions(revision_id, series_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_snapshots_ref_unique UNIQUE (project_id, monitoring_snapshot_ref),
      CONSTRAINT monitoring_snapshots_availability_ck CHECK (availability IN ('available', 'partial', 'unavailable')),
      CONSTRAINT monitoring_snapshots_coverage_ck CHECK (coverage_ratio <> 'NaN'::double precision AND coverage_ratio <> 'Infinity'::double precision AND coverage_ratio <> '-Infinity'::double precision AND coverage_ratio BETWEEN 0 AND 1),
      CONSTRAINT monitoring_snapshots_json_ck CHECK (jsonb_typeof(monitoring_snapshot_ref) = 'object' AND jsonb_typeof(monitoring_series_ref) = 'object' AND jsonb_typeof("window") = 'object' AND jsonb_typeof(availability_policy_ref) = 'object' AND jsonb_typeof(algorithm_versions) = 'object' AND jsonb_typeof(monitoring_batch_refs) = 'array' AND jsonb_typeof(sample_version_refs) = 'array' AND jsonb_typeof(availability_reasons) = 'array' AND jsonb_typeof(evidence_references) = 'array' AND jsonb_typeof(authorization_snapshot) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'),
      CONSTRAINT monitoring_snapshots_audit_fk FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_snapshot_members (
      project_id text NOT NULL,
      snapshot_id text NOT NULL,
      member_index integer NOT NULL,
      batch_id text NOT NULL,
      sample_version_id text NOT NULL,
      selection_reason text NOT NULL,
      PRIMARY KEY (project_id, snapshot_id, member_index),
      UNIQUE (snapshot_id, sample_version_id),
      CONSTRAINT monitoring_snapshot_members_snapshot_fk FOREIGN KEY (snapshot_id) REFERENCES business.monitoring_snapshots(snapshot_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_snapshot_members_reason_ck CHECK (selection_reason IN ('latest-valid', 'correction', 'supplement', 'original'))
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_snapshot_points (
      project_id text NOT NULL,
      snapshot_id text NOT NULL,
      point_index integer NOT NULL,
      sampled_at timestamp with time zone NOT NULL,
      value double precision,
      unit text NOT NULL,
      status text NOT NULL,
      source_sample_refs jsonb NOT NULL,
      reason_code text,
      PRIMARY KEY (project_id, snapshot_id, point_index),
      CONSTRAINT monitoring_snapshot_points_snapshot_fk FOREIGN KEY (snapshot_id) REFERENCES business.monitoring_snapshots(snapshot_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_snapshot_points_value_ck CHECK (value IS NULL OR (value <> 'NaN'::double precision AND value <> 'Infinity'::double precision AND value <> '-Infinity'::double precision)),
      CONSTRAINT monitoring_snapshot_points_status_ck CHECK (status IN ('available', 'interpolated', 'missing')),
      CONSTRAINT monitoring_snapshot_points_json_ck CHECK (jsonb_typeof(source_sample_refs) = 'array')
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_snapshot_features (
      project_id text NOT NULL,
      snapshot_id text NOT NULL,
      feature_type text NOT NULL,
      value double precision,
      unit text,
      window_size integer NOT NULL,
      input_count integer NOT NULL,
      algorithm_version text NOT NULL,
      status text NOT NULL,
      reason_code text,
      PRIMARY KEY (project_id, snapshot_id, feature_type),
      CONSTRAINT monitoring_snapshot_features_snapshot_fk FOREIGN KEY (snapshot_id) REFERENCES business.monitoring_snapshots(snapshot_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_snapshot_features_value_ck CHECK (value IS NULL OR (value <> 'NaN'::double precision AND value <> 'Infinity'::double precision AND value <> '-Infinity'::double precision)),
      CONSTRAINT monitoring_snapshot_features_type_ck CHECK (feature_type IN ('short-term-slope', 'acceleration', 'dominant-frequency', 'anomaly-score')),
      CONSTRAINT monitoring_snapshot_features_status_ck CHECK (status IN ('available', 'unavailable')),
      CONSTRAINT monitoring_snapshot_features_count_ck CHECK (window_size > 0 AND input_count >= 0)
    )`.execute(db);

  await sql`
    CREATE TABLE IF NOT EXISTS business.monitoring_snapshot_query_results (
      query_result_id text PRIMARY KEY,
      version_id text NOT NULL,
      project_id text NOT NULL,
      query_result_ref jsonb NOT NULL,
      snapshot_id text NOT NULL,
      monitoring_snapshot_ref jsonb NOT NULL,
      authorization_context_ref jsonb NOT NULL,
      requested_by text NOT NULL,
      recorded_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      persisted_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
      audit_entry_id text NOT NULL,
      CONSTRAINT monitoring_snapshot_queries_snapshot_fk FOREIGN KEY (snapshot_id) REFERENCES business.monitoring_snapshots(snapshot_id) ON DELETE RESTRICT,
      CONSTRAINT monitoring_snapshot_queries_ref_unique UNIQUE (project_id, query_result_ref),
      CONSTRAINT monitoring_snapshot_queries_json_ck CHECK (jsonb_typeof(query_result_ref) = 'object' AND jsonb_typeof(monitoring_snapshot_ref) = 'object' AND jsonb_typeof(authorization_context_ref) = 'object'),
      CONSTRAINT monitoring_snapshot_queries_audit_fk FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id) DEFERRABLE INITIALLY DEFERRED
    )`.execute(db);

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`DROP TRIGGER IF EXISTS monitoring_series_current_revision_forward_only_trigger
    ON business.monitoring_series`.execute(db);
  await sql`DROP FUNCTION IF EXISTS business.monitoring_series_current_revision_forward_only()`.execute(
    db,
  );
  for (const table of tables) await sql`DROP TABLE IF EXISTS ${sql.raw(table)} CASCADE`.execute(db);
}
