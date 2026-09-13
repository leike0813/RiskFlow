import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;

const tables = [
  "business.identification_knowledge_validations",
  "business.identification_knowledge_revision_bindings",
  "business.identification_knowledge_release_bindings",
  "business.identification_knowledge_authoring_attempts",
] as const;

const definitionTypeCheck = sql`definition_type IN (
  'process-model',
  'risk-mechanism',
  'standard-library',
  'case-library',
  'retrieval-evidence-base'
)`;

const auditForeignKey = async (db: Kysely<unknown>, table: string, name: string): Promise<void> => {
  await sql`
    ALTER TABLE ${sql.raw(table)}
      ADD CONSTRAINT ${sql.raw(name)}
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);
};

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT UPDATE (stage, result_revision_ref, failure_artifact_ref, review_task_ref, persisted_at)
    ON TABLE business.identification_knowledge_authoring_attempts TO riskflow_app`.execute(db);
};

/**
 * C17 只追加索引事实：正文始终保存在 C04 内容寻址工件中，这里只保存受约束的
 * 工程/版本引用、摘要、逐项决定、命令与审计身份。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.identification_knowledge_validations")
    .ifNotExists()
    .addColumn("validation_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("package_digest", "text", (column) => column.notNull())
    .addColumn("validation_policy_ref", jsonb, (column) => column.notNull())
    .addColumn("preparation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("candidate_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("validation_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("decisions", jsonb, (column) => column.notNull())
    .addColumn("disposition", "text", (column) => column.notNull())
    .addColumn("rejection_class", "text")
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("identification_knowledge_validations_pk", [
      "validation_id",
      "version_id",
    ])
    .addUniqueConstraint("identification_knowledge_validations_idempotency_unique", [
      "project_id",
      "idempotency_key",
    ])
    .addUniqueConstraint("identification_knowledge_validations_artifact_unique", [
      "project_id",
      "validation_artifact_ref",
    ])
    .addCheckConstraint(
      "identification_knowledge_validations_digest_ck",
      sql`package_digest ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "identification_knowledge_validations_disposition_ck",
      sql`disposition IN ('accepted', 'rejected')
        AND (
          (disposition = 'rejected' AND rejection_class IN ('repairable', 'terminal'))
          OR (disposition = 'accepted' AND rejection_class IS NULL)
        )`,
    )
    .addCheckConstraint("identification_knowledge_validations_type_ck", definitionTypeCheck)
    .addCheckConstraint(
      "identification_knowledge_validations_identity_ck",
      sql`schema_version = '1'
        AND length(trim(validation_id)) > 0
        AND length(trim(version_id)) > 0
        AND length(trim(project_id)) > 0
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0
        AND length(trim(actor_ref)) > 0`,
    )
    .addCheckConstraint(
      "identification_knowledge_validations_json_ck",
      sql`jsonb_typeof(validation_policy_ref) = 'object'
        AND jsonb_typeof(preparation_snapshot_ref) = 'object'
        AND jsonb_typeof(candidate_artifact_ref) = 'object'
        AND jsonb_typeof(validation_artifact_ref) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'
        AND jsonb_typeof(decisions) = 'array'`,
    )
    .addForeignKeyConstraint(
      "identification_knowledge_validations_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("identification_knowledge_validations_project_idx")
    .ifNotExists()
    .on("business.identification_knowledge_validations")
    .columns(["project_id", "definition_type", "validation_id", "version_id"])
    .execute();

  await auditForeignKey(
    db,
    "business.identification_knowledge_validations",
    "identification_knowledge_validations_audit_fk",
  );

  await db.schema
    .createTable("business.identification_knowledge_revision_bindings")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("revision_version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("binding_kind", "text", (column) => column.notNull())
    .addColumn("validation_id", "text")
    .addColumn("validation_version_id", "text")
    .addColumn("package_digest", "text")
    .addColumn("agent_task_ref", jsonb)
    .addColumn("failure_artifact_ref", jsonb)
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("identification_knowledge_revision_bindings_pk", [
      "revision_id",
      "revision_version_id",
    ])
    .addUniqueConstraint("identification_knowledge_revision_bindings_idempotency_unique", [
      "project_id",
      "idempotency_key",
    ])
    .addCheckConstraint(
      "identification_knowledge_revision_bindings_kind_ck",
      sql`binding_kind IN ('validated', 'failure-review-only')
        AND (
          (
            binding_kind = 'validated'
            AND validation_id IS NOT NULL
            AND validation_version_id IS NOT NULL
            AND package_digest IS NOT NULL
            AND package_digest ~ '^[0-9a-f]{64}$'
            AND failure_artifact_ref IS NULL
          )
          OR (
            binding_kind = 'failure-review-only'
            AND failure_artifact_ref IS NOT NULL
            AND validation_id IS NULL
            AND validation_version_id IS NULL
            AND package_digest IS NULL
          )
        )`,
    )
    .addCheckConstraint("identification_knowledge_revision_bindings_type_ck", definitionTypeCheck)
    .addCheckConstraint(
      "identification_knowledge_revision_bindings_identity_ck",
      sql`schema_version = '1'
        AND length(trim(revision_id)) > 0
        AND length(trim(revision_version_id)) > 0
        AND length(trim(project_id)) > 0
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0`,
    )
    .addCheckConstraint(
      "identification_knowledge_revision_bindings_json_ck",
      sql`(agent_task_ref IS NULL OR jsonb_typeof(agent_task_ref) = 'object')
        AND (failure_artifact_ref IS NULL OR jsonb_typeof(failure_artifact_ref) = 'object')`,
    )
    .addForeignKeyConstraint(
      "identification_knowledge_revision_bindings_validation_fk",
      ["validation_id", "validation_version_id"],
      "business.identification_knowledge_validations",
      ["validation_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "identification_knowledge_revision_bindings_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("identification_knowledge_revision_bindings_project_idx")
    .ifNotExists()
    .on("business.identification_knowledge_revision_bindings")
    .columns(["project_id", "definition_type", "revision_id", "revision_version_id"])
    .execute();

  await auditForeignKey(
    db,
    "business.identification_knowledge_revision_bindings",
    "identification_knowledge_revision_bindings_audit_fk",
  );

  await db.schema
    .createTable("business.identification_knowledge_release_bindings")
    .ifNotExists()
    .addColumn("release_id", "text", (column) => column.notNull())
    .addColumn("release_version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("revision_version_id", "text", (column) => column.notNull())
    .addColumn("candidate_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("composite_member_release_refs", jsonb)
    .addColumn("bound_at", timestamptz, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("identification_knowledge_release_bindings_pk", [
      "release_id",
      "release_version_id",
    ])
    .addUniqueConstraint("identification_knowledge_release_bindings_idempotency_unique", [
      "project_id",
      "idempotency_key",
    ])
    .addCheckConstraint("identification_knowledge_release_bindings_type_ck", definitionTypeCheck)
    .addCheckConstraint(
      "identification_knowledge_release_bindings_identity_ck",
      sql`schema_version = '1'
        AND length(trim(release_id)) > 0
        AND length(trim(release_version_id)) > 0
        AND length(trim(project_id)) > 0
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0`,
    )
    .addCheckConstraint(
      "identification_knowledge_release_bindings_json_ck",
      sql`jsonb_typeof(candidate_artifact_ref) = 'object'
        AND (
          composite_member_release_refs IS NULL
          OR (
            jsonb_typeof(composite_member_release_refs) = 'array'
            AND jsonb_array_length(composite_member_release_refs) = 3
          )
        )`,
    )
    .addForeignKeyConstraint(
      "identification_knowledge_release_bindings_revision_fk",
      ["revision_id", "revision_version_id"],
      "business.identification_knowledge_revision_bindings",
      ["revision_id", "revision_version_id"],
    )
    .addForeignKeyConstraint(
      "identification_knowledge_release_bindings_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("identification_knowledge_release_bindings_project_idx")
    .ifNotExists()
    .on("business.identification_knowledge_release_bindings")
    .columns(["project_id", "definition_type", "release_id", "release_version_id"])
    .execute();

  await auditForeignKey(
    db,
    "business.identification_knowledge_release_bindings",
    "identification_knowledge_release_bindings_audit_fk",
  );

  await db.schema
    .createTable("business.identification_knowledge_authoring_attempts")
    .ifNotExists()
    .addColumn("attempt_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("schema_version", "text", (column) => column.notNull().defaultTo("1"))
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("manifest_artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("preparation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("manifest_digest", "text", (column) => column.notNull())
    .addColumn("agent_task_ref", jsonb, (column) => column.notNull())
    .addColumn("stage", "text", (column) => column.notNull())
    .addColumn("result_revision_ref", jsonb)
    .addColumn("failure_artifact_ref", jsonb)
    .addColumn("review_task_ref", jsonb)
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("identification_knowledge_authoring_attempts_pk", [
      "attempt_id",
      "version_id",
    ])
    .addUniqueConstraint("identification_knowledge_authoring_attempts_idempotency_unique", [
      "project_id",
      "idempotency_key",
    ])
    .addUniqueConstraint("identification_knowledge_authoring_attempts_task_unique", [
      "project_id",
      "agent_task_ref",
    ])
    .addCheckConstraint("identification_knowledge_authoring_attempts_type_ck", definitionTypeCheck)
    .addCheckConstraint(
      "identification_knowledge_authoring_attempts_stage_ck",
      sql`stage IN (
          'prepared',
          'task-started',
          'completed',
          'failure-revision-bound',
          'review-linked'
        )
        AND (
          (stage = 'completed' AND result_revision_ref IS NOT NULL)
          OR (stage <> 'completed' AND result_revision_ref IS NULL)
        )
        AND (
          (stage IN ('prepared', 'task-started', 'completed') AND failure_artifact_ref IS NULL AND review_task_ref IS NULL)
          OR (stage = 'failure-revision-bound' AND failure_artifact_ref IS NOT NULL AND review_task_ref IS NULL)
          OR (stage = 'review-linked' AND failure_artifact_ref IS NOT NULL AND review_task_ref IS NOT NULL)
        )`,
    )
    .addCheckConstraint(
      "identification_knowledge_authoring_attempts_digest_ck",
      sql`manifest_digest ~ '^[0-9a-f]{64}$'`,
    )
    .addCheckConstraint(
      "identification_knowledge_authoring_attempts_identity_ck",
      sql`schema_version = '1'
        AND length(trim(attempt_id)) > 0
        AND length(trim(version_id)) > 0
        AND length(trim(project_id)) > 0
        AND length(trim(command_id)) > 0
        AND length(trim(idempotency_key)) > 0`,
    )
    .addCheckConstraint(
      "identification_knowledge_authoring_attempts_json_ck",
      sql`jsonb_typeof(manifest_artifact_ref) = 'object'
        AND jsonb_typeof(preparation_snapshot_ref) = 'object'
        AND jsonb_typeof(agent_task_ref) = 'object'
        AND (result_revision_ref IS NULL OR jsonb_typeof(result_revision_ref) = 'object')
        AND (failure_artifact_ref IS NULL OR jsonb_typeof(failure_artifact_ref) = 'object')
        AND (review_task_ref IS NULL OR jsonb_typeof(review_task_ref) = 'object')`,
    )
    .addForeignKeyConstraint(
      "identification_knowledge_authoring_attempts_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .execute();

  await db.schema
    .createIndex("identification_knowledge_authoring_attempts_project_idx")
    .ifNotExists()
    .on("business.identification_knowledge_authoring_attempts")
    .columns(["project_id", "definition_type", "attempt_id", "version_id"])
    .execute();

  await auditForeignKey(
    db,
    "business.identification_knowledge_authoring_attempts",
    "identification_knowledge_authoring_attempts_audit_fk",
  );

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await db.schema
    .dropIndex("identification_knowledge_authoring_attempts_project_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("identification_knowledge_release_bindings_project_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("identification_knowledge_revision_bindings_project_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropIndex("identification_knowledge_validations_project_idx")
    .ifExists()
    .execute();
  await db.schema
    .dropTable("business.identification_knowledge_authoring_attempts")
    .ifExists()
    .execute();
  await db.schema
    .dropTable("business.identification_knowledge_release_bindings")
    .ifExists()
    .execute();
  await db.schema
    .dropTable("business.identification_knowledge_revision_bindings")
    .ifExists()
    .execute();
  await db.schema.dropTable("business.identification_knowledge_validations").ifExists().execute();
}
