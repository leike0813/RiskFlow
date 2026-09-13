import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const digestPattern = sql`'^[0-9a-f]{64}$'`;
const structuredScoringRuleDefinitionType = "structured-scoring-rule";
const applicableRuleSetDefinitionType = "applicable-rule-set";

const tables = [
  "business.scoring_rule_revision_metadata",
  "business.rule_relations",
  "business.rule_conflict_review_links",
  "business.applicable_rule_set_revision_metadata",
  "business.assessment_basis_release_sets",
] as const;

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(tables.join(", "))} TO riskflow_app`.execute(
    db,
  );
  await sql`REVOKE UPDATE, DELETE ON TABLE ${sql.raw(tables.join(", "))} FROM riskflow_app`.execute(
    db,
  );
};

/**
 * C19 只存不可变关系事实：正文与逐项筛选仍在 C04，C16 仍是发布生命周期 SSOT。
 * 全部表只追加，应用角色仅 SELECT/INSERT。
 *
 * 事实粒度：发布前检测的候选正文摘要、比较基线与快照摘要属于「修订级」事实，
 * 单点保存在 `scoring_rule_revision_metadata`；`rule_relations` 只保存逐条关系事实
 * 并外键绑定该候选 C16 revision，避免在每行重复同一次检测的基线。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.scoring_rule_revision_metadata")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("compatibility_ref", jsonb, (column) => column.notNull())
    .addColumn("artifact_entity_id", "text", (column) => column.notNull())
    .addColumn("artifact_version_id", "text", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("relation_digest", "char(64)", (column) => column.notNull())
    .addColumn("base_release_id", "text")
    .addColumn("base_release_version_id", "text")
    .addColumn("base_release_ref", jsonb)
    .addColumn("base_revision_ref", jsonb)
    .addColumn("item_count", "integer", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("scoring_rule_revision_metadata_pk", ["revision_id", "version_id"])
    .addForeignKeyConstraint(
      "scoring_rule_revision_metadata_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "scoring_rule_revision_metadata_identity_ck",
      sql`revision_id <> '' AND version_id <> '' AND project_id <> ''
        AND definition_type = ${sql.lit(structuredScoringRuleDefinitionType)}
        AND artifact_entity_id <> '' AND artifact_version_id <> '' AND command_id <> ''`,
    )
    .addCheckConstraint(
      "scoring_rule_revision_metadata_digest_ck",
      sql`content_digest ~ ${digestPattern} AND relation_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "scoring_rule_revision_metadata_base_ck",
      sql`(base_release_id IS NULL AND base_release_version_id IS NULL
          AND base_release_ref IS NULL AND base_revision_ref IS NULL)
        OR (base_release_id IS NOT NULL AND base_release_version_id IS NOT NULL
          AND base_release_ref IS NOT NULL AND base_revision_ref IS NOT NULL)`,
    )
    .addCheckConstraint("scoring_rule_revision_metadata_item_count_ck", sql`item_count >= 0`)
    .addCheckConstraint(
      "scoring_rule_revision_metadata_json_ck",
      sql`jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(compatibility_ref) = 'object'
        AND jsonb_typeof(artifact_ref) = 'object'
        AND (base_release_ref IS NULL OR jsonb_typeof(base_release_ref) = 'object')
        AND (base_revision_ref IS NULL OR jsonb_typeof(base_revision_ref) = 'object')`,
    )
    .execute();

  await sql`
    ALTER TABLE business.scoring_rule_revision_metadata
      ADD CONSTRAINT scoring_rule_revision_metadata_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.rule_relations")
    .ifNotExists()
    .addColumn("relation_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("revision_version_id", "text", (column) => column.notNull())
    .addColumn("relation_kind", "text", (column) => column.notNull())
    .addColumn("policy_ref", jsonb, (column) => column.notNull())
    .addColumn("left_rule_id", "text", (column) => column.notNull())
    .addColumn("left_rule_version_id", "text", (column) => column.notNull())
    .addColumn("left_rule_version_ref", jsonb, (column) => column.notNull())
    .addColumn("right_rule_id", "text", (column) => column.notNull())
    .addColumn("right_rule_version_id", "text", (column) => column.notNull())
    .addColumn("right_rule_version_ref", jsonb, (column) => column.notNull())
    .addColumn("overlap", jsonb, (column) => column.notNull())
    .addColumn("overlap_digest", "char(64)", (column) => column.notNull())
    .addColumn("retained_rule_id", "text")
    .addColumn("retained_rule_version_id", "text")
    .addColumn("retained_rule_version_ref", jsonb)
    .addColumn("excluded_rule_id", "text")
    .addColumn("excluded_rule_version_id", "text")
    .addColumn("excluded_rule_version_ref", jsonb)
    .addColumn("evidence_references", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("rule_relations_pk", ["relation_id", "version_id"])
    .addUniqueConstraint("rule_relations_identity_uidx", [
      "project_id",
      "revision_id",
      "left_rule_version_id",
      "right_rule_version_id",
      "overlap_digest",
    ])
    .addForeignKeyConstraint(
      "rule_relations_revision_fk",
      ["revision_id", "revision_version_id"],
      "business.knowledge_revisions",
      ["revision_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "rule_relations_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "rule_relations_identity_ck",
      sql`relation_id <> '' AND version_id <> '' AND project_id <> ''
        AND revision_id <> '' AND revision_version_id <> ''
        AND relation_kind IN ('conflict', 'overlap')
        AND left_rule_id <> '' AND left_rule_version_id <> ''
        AND right_rule_id <> '' AND right_rule_version_id <> ''
        AND command_id <> ''`,
    )
    .addCheckConstraint("rule_relations_digest_ck", sql`overlap_digest ~ ${digestPattern}`)
    .addCheckConstraint(
      "rule_relations_json_ck",
      sql`jsonb_typeof(policy_ref) = 'object'
        AND jsonb_typeof(left_rule_version_ref) = 'object'
        AND jsonb_typeof(right_rule_version_ref) = 'object'
        AND jsonb_typeof(overlap) = 'object'
        AND jsonb_typeof(evidence_references) = 'array'
        AND (retained_rule_version_ref IS NULL OR jsonb_typeof(retained_rule_version_ref) = 'object')
        AND (excluded_rule_version_ref IS NULL OR jsonb_typeof(excluded_rule_version_ref) = 'object')`,
    )
    .addCheckConstraint(
      "rule_relations_retained_ck",
      sql`(retained_rule_id IS NULL AND retained_rule_version_id IS NULL
          AND retained_rule_version_ref IS NULL)
        OR (retained_rule_id IS NOT NULL AND retained_rule_version_id IS NOT NULL
          AND retained_rule_version_ref IS NOT NULL)`,
    )
    .addCheckConstraint(
      "rule_relations_excluded_ck",
      sql`(excluded_rule_id IS NULL AND excluded_rule_version_id IS NULL
          AND excluded_rule_version_ref IS NULL)
        OR (excluded_rule_id IS NOT NULL AND excluded_rule_version_id IS NOT NULL
          AND excluded_rule_version_ref IS NOT NULL)`,
    )
    .execute();

  await sql`
    ALTER TABLE business.rule_relations
      ADD CONSTRAINT rule_relations_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.rule_conflict_review_links")
    .ifNotExists()
    .addColumn("link_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("relation_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("attempt", "integer", (column) => column.notNull())
    .addColumn("review_attempt_id", "text", (column) => column.notNull())
    .addColumn("review_task_ref", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("rule_conflict_review_links_attempt_uidx", [
      "relation_id",
      "version_id",
      "attempt",
    ])
    .addUniqueConstraint("rule_conflict_review_links_task_uidx", [
      "project_id",
      "review_attempt_id",
    ])
    .addForeignKeyConstraint(
      "rule_conflict_review_links_relation_fk",
      ["relation_id", "version_id"],
      "business.rule_relations",
      ["relation_id", "version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "rule_conflict_review_links_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "rule_conflict_review_links_identity_ck",
      sql`link_id <> '' AND relation_id <> '' AND version_id <> '' AND project_id <> ''
        AND review_attempt_id <> '' AND command_id <> ''`,
    )
    .addCheckConstraint("rule_conflict_review_links_attempt_ck", sql`attempt >= 1`)
    .addCheckConstraint(
      "rule_conflict_review_links_json_ck",
      sql`jsonb_typeof(review_task_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.rule_conflict_review_links
      ADD CONSTRAINT rule_conflict_review_links_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.applicable_rule_set_revision_metadata")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("definition_type", "text", (column) => column.notNull())
    .addColumn("project_revision_ref", jsonb, (column) => column.notNull())
    .addColumn("applicability_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("configuration_set_ref", jsonb, (column) => column.notNull())
    .addColumn("compatibility_ref", jsonb, (column) => column.notNull())
    .addColumn("artifact_entity_id", "text", (column) => column.notNull())
    .addColumn("artifact_version_id", "text", (column) => column.notNull())
    .addColumn("artifact_ref", jsonb, (column) => column.notNull())
    .addColumn("content_digest", "char(64)", (column) => column.notNull())
    .addColumn("decision_digest", "char(64)", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("applicable_rule_set_revision_metadata_pk", [
      "revision_id",
      "version_id",
    ])
    .addForeignKeyConstraint(
      "applicable_rule_set_revision_metadata_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "applicable_rule_set_revision_metadata_identity_ck",
      sql`revision_id <> '' AND version_id <> '' AND project_id <> ''
        AND definition_type = ${sql.lit(applicableRuleSetDefinitionType)}
        AND artifact_entity_id <> '' AND artifact_version_id <> '' AND command_id <> ''`,
    )
    .addCheckConstraint(
      "applicable_rule_set_revision_metadata_digest_ck",
      sql`content_digest ~ ${digestPattern} AND decision_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "applicable_rule_set_revision_metadata_json_ck",
      sql`jsonb_typeof(project_revision_ref) = 'object'
        AND jsonb_typeof(applicability_snapshot_ref) = 'object'
        AND jsonb_typeof(configuration_set_ref) = 'object'
        AND jsonb_typeof(compatibility_ref) = 'object'
        AND jsonb_typeof(artifact_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.applicable_rule_set_revision_metadata
      ADD CONSTRAINT applicable_rule_set_revision_metadata_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createTable("business.assessment_basis_release_sets")
    .ifNotExists()
    .addColumn("set_id", "text", (column) => column.notNull())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("preparation_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("preparation_snapshot_id", "text", (column) => column.notNull())
    .addColumn("preparation_snapshot_version_id", "text", (column) => column.notNull())
    .addColumn("applicability_snapshot_ref", jsonb, (column) => column.notNull())
    .addColumn("applicable_rule_set_release_ref", jsonb, (column) => column.notNull())
    .addColumn("applicable_rule_set_release_id", "text", (column) => column.notNull())
    .addColumn("applicable_rule_set_release_version_id", "text", (column) => column.notNull())
    .addColumn("configuration_set_ref", jsonb, (column) => column.notNull())
    .addColumn("required_at", timestamptz, (column) => column.notNull())
    .addColumn("issued_at", timestamptz, (column) => column.notNull())
    .addColumn("member_digest", "char(64)", (column) => column.notNull())
    .addColumn("identity_digest", "char(64)", (column) => column.notNull())
    .addColumn("member_snapshot", jsonb, (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("actor_ref", "text", (column) => column.notNull())
    .addColumn("authorization_context_ref", jsonb, (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("assessment_basis_release_sets_pk", ["set_id", "version_id"])
    .addUniqueConstraint("assessment_basis_release_sets_identity_uidx", [
      "project_id",
      "preparation_snapshot_id",
      "preparation_snapshot_version_id",
      "required_at",
      "member_digest",
    ])
    .addForeignKeyConstraint(
      "assessment_basis_release_sets_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "assessment_basis_release_sets_identity_ck",
      sql`set_id <> '' AND version_id <> '' AND project_id <> ''
        AND preparation_snapshot_id <> '' AND preparation_snapshot_version_id <> ''
        AND applicable_rule_set_release_id <> ''
        AND applicable_rule_set_release_version_id <> ''
        AND command_id <> '' AND actor_ref <> ''`,
    )
    .addCheckConstraint(
      "assessment_basis_release_sets_digest_ck",
      sql`member_digest ~ ${digestPattern} AND identity_digest ~ ${digestPattern}`,
    )
    .addCheckConstraint(
      "assessment_basis_release_sets_json_ck",
      sql`jsonb_typeof(preparation_snapshot_ref) = 'object'
        AND jsonb_typeof(applicability_snapshot_ref) = 'object'
        AND jsonb_typeof(applicable_rule_set_release_ref) = 'object'
        AND jsonb_typeof(configuration_set_ref) = 'object'
        AND jsonb_typeof(member_snapshot) = 'object'
        AND jsonb_typeof(authorization_context_ref) = 'object'`,
    )
    .execute();

  await sql`
    ALTER TABLE business.assessment_basis_release_sets
      ADD CONSTRAINT assessment_basis_release_sets_audit_fk
      FOREIGN KEY (audit_entry_id)
      REFERENCES audit.entries(audit_entry_id)
      DEFERRABLE INITIALLY DEFERRED
  `.execute(db);

  await db.schema
    .createIndex("scoring_rule_revision_metadata_project_idx")
    .ifNotExists()
    .on("business.scoring_rule_revision_metadata")
    .columns(["project_id", "definition_type", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("rule_relations_project_kind_idx")
    .ifNotExists()
    .on("business.rule_relations")
    .columns(["project_id", "revision_id", "relation_kind", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("rule_relations_left_rule_idx")
    .ifNotExists()
    .on("business.rule_relations")
    .columns(["left_rule_id", "left_rule_version_id"])
    .execute();
  await db.schema
    .createIndex("rule_relations_right_rule_idx")
    .ifNotExists()
    .on("business.rule_relations")
    .columns(["right_rule_id", "right_rule_version_id"])
    .execute();
  await db.schema
    .createIndex("rule_conflict_review_links_project_idx")
    .ifNotExists()
    .on("business.rule_conflict_review_links")
    .columns(["project_id", "relation_id", "version_id"])
    .execute();
  await db.schema
    .createIndex("applicable_rule_set_revision_metadata_project_idx")
    .ifNotExists()
    .on("business.applicable_rule_set_revision_metadata")
    .columns(["project_id", "definition_type", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("assessment_basis_release_sets_project_idx")
    .ifNotExists()
    .on("business.assessment_basis_release_sets")
    .columns(["project_id", "required_at", "recorded_at"])
    .execute();
  await db.schema
    .createIndex("assessment_basis_release_sets_preparation_idx")
    .ifNotExists()
    .on("business.assessment_basis_release_sets")
    .columns(["project_id", "preparation_snapshot_id", "preparation_snapshot_version_id"])
    .execute();

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`REVOKE ALL PRIVILEGES ON TABLE ${sql.raw(tables.join(", "))}
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);
  await db.schema.dropIndex("assessment_basis_release_sets_preparation_idx").ifExists().execute();
  await db.schema.dropIndex("assessment_basis_release_sets_project_idx").ifExists().execute();
  await db.schema
    .dropIndex("applicable_rule_set_revision_metadata_project_idx")
    .ifExists()
    .execute();
  await db.schema.dropIndex("rule_conflict_review_links_project_idx").ifExists().execute();
  await db.schema.dropIndex("rule_relations_right_rule_idx").ifExists().execute();
  await db.schema.dropIndex("rule_relations_left_rule_idx").ifExists().execute();
  await db.schema.dropIndex("rule_relations_project_kind_idx").ifExists().execute();
  await db.schema.dropIndex("scoring_rule_revision_metadata_project_idx").ifExists().execute();
  await db.schema.dropTable("business.assessment_basis_release_sets").ifExists().execute();
  await db.schema.dropTable("business.applicable_rule_set_revision_metadata").ifExists().execute();
  await db.schema.dropTable("business.rule_conflict_review_links").ifExists().execute();
  await db.schema.dropTable("business.rule_relations").ifExists().execute();
  await db.schema.dropTable("business.scoring_rule_revision_metadata").ifExists().execute();
}
