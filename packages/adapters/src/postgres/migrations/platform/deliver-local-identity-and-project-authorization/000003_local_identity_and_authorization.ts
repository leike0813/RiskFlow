import { sql, type Kysely } from "kysely";

const jsonb = sql`jsonb`;
const timestamptz = sql`timestamp with time zone`;
const bytea = sql`bytea`;

const accessRoles = [
  "system-administrator",
  "project-risk-manager",
  "reviewer",
  "field-responder",
  "business-viewer",
] as const;

const grantApp = async (db: Kysely<unknown>): Promise<void> => {
  await sql`REVOKE ALL PRIVILEGES ON TABLE
    business.local_accounts,
    business.local_credentials,
    business.local_login_attempts,
    business.local_sessions,
    business.access_projects,
    business.access_spatial_scopes,
    business.access_spatial_scope_revisions,
    business.project_memberships,
    business.project_membership_revisions,
    business.project_membership_revision_roles,
    business.project_membership_revision_scopes,
    business.source_access_policies,
    business.source_access_policy_revisions,
    business.source_access_policy_revision_accounts,
    business.source_access_policy_revision_scopes,
    business.authorization_contexts,
    business.security_audit_events
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer`.execute(db);

  await sql`GRANT SELECT ON TABLE business.local_accounts TO riskflow_app`.execute(db);
  await sql`GRANT INSERT (account_id, login_name, display_name, status,
    security_version, current_credential_version, password_change_required,
    created_at, updated_at, disabled_at)
    ON TABLE business.local_accounts TO riskflow_app`.execute(db);
  await sql`GRANT UPDATE (status, security_version, current_credential_version,
    password_change_required, updated_at, disabled_at)
    ON TABLE business.local_accounts TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.local_credentials TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.local_login_attempts TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT, UPDATE (last_seen_at, idle_expires_at, revoked_at, revocation_reason)
    ON TABLE business.local_sessions TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.access_projects TO riskflow_app`.execute(db);
  await sql`GRANT UPDATE (status, access_version, updated_at)
    ON TABLE business.access_projects TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.access_spatial_scopes TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT UPDATE (current_revision_id)
    ON TABLE business.access_spatial_scopes TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.access_spatial_scope_revisions TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.project_memberships TO riskflow_app`.execute(db);
  await sql`GRANT UPDATE (current_revision_id)
    ON TABLE business.project_memberships TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.project_membership_revisions TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.project_membership_revision_roles TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.project_membership_revision_scopes TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.source_access_policies TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT UPDATE (current_revision_id)
    ON TABLE business.source_access_policies TO riskflow_app`.execute(db);
  await sql`GRANT SELECT, INSERT ON TABLE business.source_access_policy_revisions TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.source_access_policy_revision_accounts TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.source_access_policy_revision_scopes TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.authorization_contexts TO riskflow_app`.execute(
    db,
  );
  await sql`GRANT SELECT, INSERT ON TABLE business.security_audit_events TO riskflow_app`.execute(
    db,
  );
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.local_accounts")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("login_name", "text", (column) => column.notNull().unique())
    .addColumn("display_name", "text", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("active"))
    .addColumn("system_administrator", "boolean", (column) => column.notNull().defaultTo(false))
    .addColumn("security_version", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("current_credential_version", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("password_change_required", "boolean", (column) => column.notNull().defaultTo(true))
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("updated_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("disabled_at", timestamptz)
    .addCheckConstraint(
      "local_accounts_login_name_ck",
      sql`login_name ~ '^[a-z][a-z0-9._-]{2,63}$'`,
    )
    .addCheckConstraint("local_accounts_status_ck", sql`status IN ('active', 'disabled')`)
    .addCheckConstraint("local_accounts_security_version_ck", sql`security_version > 0`)
    .addCheckConstraint("local_accounts_credential_version_ck", sql`current_credential_version > 0`)
    .execute();

  await db.schema
    .createTable("business.local_credentials")
    .ifNotExists()
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("credential_version", "integer", (column) => column.notNull())
    .addColumn("algorithm", "text", (column) => column.notNull())
    .addColumn("policy_version", "text", (column) => column.notNull())
    .addColumn("cost", "integer", (column) => column.notNull())
    .addColumn("block_size", "integer", (column) => column.notNull())
    .addColumn("parallelization", "integer", (column) => column.notNull())
    .addColumn("key_length", "integer", (column) => column.notNull())
    .addColumn("salt", bytea, (column) => column.notNull())
    .addColumn("derived_key", bytea, (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addPrimaryKeyConstraint("local_credentials_pk", ["account_id", "credential_version"])
    .addForeignKeyConstraint(
      "local_credentials_account_fk",
      ["account_id"],
      "business.local_accounts",
      ["account_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("local_credentials_algorithm_ck", sql`algorithm = 'scrypt'`)
    .addCheckConstraint(
      "local_credentials_params_ck",
      sql`cost = 131072 AND block_size = 8 AND parallelization = 1 AND key_length = 32`,
    )
    .addCheckConstraint(
      "local_credentials_bytes_ck",
      sql`octet_length(salt) = 16 AND octet_length(derived_key) = 32`,
    )
    .execute();

  await db.schema
    .createTable("business.local_login_attempts")
    .ifNotExists()
    .addColumn("login_attempt_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("canonical_login_name", "text", (column) => column.notNull())
    .addColumn("login_name_fingerprint", "char(64)", (column) => column.notNull())
    .addColumn("account_id", "text")
    .addColumn("payload_sha256", "char(64)", (column) => column.notNull())
    .addColumn("attempt_count", "integer", (column) => column.notNull().defaultTo(0))
    .addColumn("window_started_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("locked_until", timestamptz)
    .addColumn("last_success_at", timestamptz)
    .addColumn("last_reset_at", timestamptz)
    .addColumn("last_result", "text", (column) => column.notNull())
    .addColumn("last_reason_code", "text", (column) => column.notNull().defaultTo("unknown"))
    .addColumn("last_attempt_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addForeignKeyConstraint(
      "local_login_attempts_account_fk",
      ["account_id"],
      "business.local_accounts",
      ["account_id"],
      (constraint) => constraint.onDelete("set null"),
    )
    .addCheckConstraint("local_login_attempts_count_ck", sql`attempt_count >= 0`)
    .addCheckConstraint(
      "local_login_attempts_result_ck",
      sql`last_result IN ('success', 'failure')`,
    )
    .execute();

  await db.schema
    .createTable("business.local_sessions")
    .ifNotExists()
    .addColumn("session_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("nonce", bytea, (column) => column.notNull())
    .addColumn("token_sha256", "char(64)", (column) => column.notNull().unique())
    .addColumn("key_version", "text", (column) => column.notNull())
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("login_attempt_id", "text", (column) => column.notNull().unique())
    .addColumn("canonical_login_name", "text", (column) => column.notNull())
    .addColumn("credential_version", "integer", (column) => column.notNull())
    .addColumn("account_security_version", "integer", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("last_seen_at", timestamptz, (column) => column.notNull())
    .addColumn("idle_expires_at", timestamptz, (column) => column.notNull())
    .addColumn("absolute_expires_at", timestamptz, (column) => column.notNull())
    .addColumn("revoked_at", timestamptz)
    .addColumn("revocation_reason", "text")
    .addForeignKeyConstraint(
      "local_sessions_account_fk",
      ["account_id"],
      "business.local_accounts",
      ["account_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "local_sessions_attempt_fk",
      ["login_attempt_id"],
      "business.local_login_attempts",
      ["login_attempt_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint("local_sessions_nonce_ck", sql`octet_length(nonce) = 16`)
    .addCheckConstraint(
      "local_sessions_time_ck",
      sql`idle_expires_at > last_seen_at AND absolute_expires_at >= created_at`,
    )
    .execute();

  await db.schema
    .createTable("business.access_projects")
    .ifNotExists()
    .addColumn("project_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("active"))
    .addColumn("access_version", "integer", (column) => column.notNull().defaultTo(1))
    .addColumn("root_scope_id", "text", (column) => column.notNull().unique())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("updated_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addCheckConstraint("access_projects_status_ck", sql`status IN ('active', 'suspended')`)
    .addCheckConstraint("access_projects_version_ck", sql`access_version > 0`)
    .execute();

  await db.schema
    .createTable("business.access_spatial_scopes")
    .ifNotExists()
    .addColumn("scope_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("current_revision_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("access_spatial_scopes_scope_project_unique", ["scope_id", "project_id"])
    .addForeignKeyConstraint(
      "access_spatial_scopes_project_fk",
      ["project_id"],
      "business.access_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("business.access_spatial_scope_revisions")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("scope_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("revision_no", "integer", (column) => column.notNull())
    .addColumn("parent_scope_id", "text")
    .addColumn("status", "text", (column) => column.notNull().defaultTo("active"))
    .addColumn("previous_revision_id", "text")
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("recorded_by", "text", (column) => column.notNull())
    .addUniqueConstraint("access_spatial_scope_revision_unique", ["scope_id", "revision_no"])
    .addForeignKeyConstraint(
      "access_spatial_scope_revisions_scope_fk",
      ["scope_id"],
      "business.access_spatial_scopes",
      ["scope_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "access_spatial_scope_revisions_scope_project_fk",
      ["scope_id", "project_id"],
      "business.access_spatial_scopes",
      ["scope_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "access_spatial_scope_revisions_parent_fk",
      ["parent_scope_id"],
      "business.access_spatial_scopes",
      ["scope_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "access_spatial_scope_revisions_parent_project_fk",
      ["parent_scope_id", "project_id"],
      "business.access_spatial_scopes",
      ["scope_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "access_spatial_scope_revision_status_ck",
      sql`status IN ('active', 'inactive')`,
    )
    .addCheckConstraint("access_spatial_scope_revision_no_ck", sql`revision_no > 0`)
    .addCheckConstraint(
      "access_spatial_scope_revision_parent_ck",
      sql`parent_scope_id IS NULL OR parent_scope_id <> scope_id`,
    )
    .execute();

  await db.schema
    .createTable("business.project_memberships")
    .ifNotExists()
    .addColumn("membership_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("current_revision_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("project_memberships_project_account_unique", ["project_id", "account_id"])
    .addUniqueConstraint("project_memberships_identity_project_account_unique", [
      "membership_id",
      "project_id",
      "account_id",
    ])
    .addForeignKeyConstraint(
      "project_memberships_project_fk",
      ["project_id"],
      "business.access_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "project_memberships_account_fk",
      ["account_id"],
      "business.local_accounts",
      ["account_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("business.project_membership_revisions")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("membership_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("account_id", "text", (column) => column.notNull())
    .addColumn("revision_no", "integer", (column) => column.notNull())
    .addColumn("status", "text", (column) => column.notNull().defaultTo("active"))
    .addColumn("previous_revision_id", "text")
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addColumn("recorded_by", "text", (column) => column.notNull())
    .addUniqueConstraint("project_membership_revision_unique", ["membership_id", "revision_no"])
    .addUniqueConstraint("project_membership_revisions_revision_project_unique", [
      "revision_id",
      "project_id",
    ])
    .addForeignKeyConstraint(
      "project_membership_revisions_membership_fk",
      ["membership_id"],
      "business.project_memberships",
      ["membership_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "project_membership_revisions_identity_fk",
      ["membership_id", "project_id", "account_id"],
      "business.project_memberships",
      ["membership_id", "project_id", "account_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "project_membership_revision_status_ck",
      sql`status IN ('active', 'removed')`,
    )
    .addCheckConstraint("project_membership_revision_no_ck", sql`revision_no > 0`)
    .execute();

  await db.schema
    .createTable("business.project_membership_revision_roles")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("role", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("project_membership_revision_roles_pk", ["revision_id", "role"])
    .addForeignKeyConstraint(
      "project_membership_revision_roles_revision_fk",
      ["revision_id"],
      "business.project_membership_revisions",
      ["revision_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "project_membership_revision_roles_role_ck",
      sql`role IN (${sql.join(accessRoles.map((role) => sql.lit(role)))})`,
    )
    .execute();

  await db.schema
    .createTable("business.project_membership_revision_scopes")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("scope_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("project_membership_revision_scopes_pk", ["revision_id", "scope_id"])
    .addForeignKeyConstraint(
      "project_membership_revision_scopes_revision_project_fk",
      ["revision_id", "project_id"],
      "business.project_membership_revisions",
      ["revision_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "project_membership_revision_scopes_scope_project_fk",
      ["scope_id", "project_id"],
      "business.access_spatial_scopes",
      ["scope_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("business.source_access_policies")
    .ifNotExists()
    .addColumn("source_access_grant_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_entity_id", "text", (column) => column.notNull())
    .addColumn("source_version_id", "text", (column) => column.notNull())
    .addColumn("current_revision_id", "text", (column) => column.notNull())
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("source_access_policies_source_unique", [
      "project_id",
      "source_entity_id",
      "source_version_id",
    ])
    .addUniqueConstraint("source_access_policies_identity_unique", [
      "source_access_grant_id",
      "project_id",
      "source_entity_id",
      "source_version_id",
    ])
    .addForeignKeyConstraint(
      "source_access_policies_project_fk",
      ["project_id"],
      "business.access_projects",
      ["project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("business.source_access_policy_revisions")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("source_access_grant_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("source_entity_id", "text", (column) => column.notNull())
    .addColumn("source_version_id", "text", (column) => column.notNull())
    .addColumn("revision_no", "integer", (column) => column.notNull())
    .addColumn("visibility", "text", (column) => column.notNull().defaultTo("restricted"))
    .addColumn("registered_by", "text", (column) => column.notNull())
    .addColumn("previous_revision_id", "text")
    .addColumn("created_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("source_access_policy_revision_unique", [
      "source_access_grant_id",
      "revision_no",
    ])
    .addUniqueConstraint("source_access_policy_revisions_revision_project_unique", [
      "revision_id",
      "project_id",
    ])
    .addForeignKeyConstraint(
      "source_access_policy_revisions_grant_fk",
      ["source_access_grant_id"],
      "business.source_access_policies",
      ["source_access_grant_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_access_policy_revisions_identity_fk",
      ["source_access_grant_id", "project_id", "source_entity_id", "source_version_id"],
      "business.source_access_policies",
      ["source_access_grant_id", "project_id", "source_entity_id", "source_version_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_access_policy_revisions_account_fk",
      ["registered_by"],
      "business.local_accounts",
      ["account_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addCheckConstraint(
      "source_access_policy_revisions_visibility_ck",
      sql`visibility IN ('project-shared', 'restricted')`,
    )
    .addCheckConstraint("source_access_policy_revisions_no_ck", sql`revision_no > 0`)
    .execute();

  await db.schema
    .createTable("business.source_access_policy_revision_accounts")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("account_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("source_access_policy_revision_accounts_pk", [
      "revision_id",
      "account_id",
    ])
    .addForeignKeyConstraint(
      "source_access_policy_revision_accounts_revision_fk",
      ["revision_id"],
      "business.source_access_policy_revisions",
      ["revision_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_access_policy_revision_accounts_account_fk",
      ["account_id"],
      "business.local_accounts",
      ["account_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("business.source_access_policy_revision_scopes")
    .ifNotExists()
    .addColumn("revision_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("scope_id", "text", (column) => column.notNull())
    .addPrimaryKeyConstraint("source_access_policy_revision_scopes_pk", ["revision_id", "scope_id"])
    .addForeignKeyConstraint(
      "source_access_policy_revision_scopes_revision_project_fk",
      ["revision_id", "project_id"],
      "business.source_access_policy_revisions",
      ["revision_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .addForeignKeyConstraint(
      "source_access_policy_revision_scopes_scope_project_fk",
      ["scope_id", "project_id"],
      "business.access_spatial_scopes",
      ["scope_id", "project_id"],
      (constraint) => constraint.onDelete("restrict"),
    )
    .execute();

  await db.schema
    .createTable("business.authorization_contexts")
    .ifNotExists()
    .addColumn("context_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("version_id", "text", (column) => column.notNull())
    .addColumn("invocation_id", "text", (column) => column.notNull())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("actor_id", "text", (column) => column.notNull())
    .addColumn("branch", "text", (column) => column.notNull())
    .addColumn("context_kind", "text", (column) => column.notNull().defaultTo("c02"))
    .addColumn("context_json", jsonb)
    .addColumn("parent_context_id", "text")
    .addColumn("causal_run_ref", jsonb)
    .addColumn("policy_ref", jsonb, (column) => column.notNull())
    .addColumn("revision_snapshot", jsonb, (column) => column.notNull())
    .addColumn("expires_at", timestamptz, (column) => column.notNull())
    .addColumn("decided_at", timestamptz, (column) => column.notNull())
    .addUniqueConstraint("authorization_context_invocation_unique", [
      "invocation_id",
      "project_id",
      "branch",
    ])
    .addCheckConstraint("authorization_context_version_ck", sql`version_id <> ''`)
    .addCheckConstraint(
      "authorization_context_kind_ck",
      sql`context_kind IN ('c02', 'system-administration')`,
    )
    .addCheckConstraint("authorization_context_time_ck", sql`expires_at > decided_at`)
    .execute();

  await db.schema
    .createTable("business.security_audit_events")
    .ifNotExists()
    .addColumn("event_id", "text", (column) => column.notNull().primaryKey())
    .addColumn("event_kind", "text", (column) => column.notNull())
    .addColumn("outcome", "text", (column) => column.notNull())
    .addColumn("reason_code", "text", (column) => column.notNull())
    .addColumn("subject_ref", "text")
    .addColumn("project_ref", "text")
    .addColumn("request_ref", "text")
    .addColumn("policy_ref", jsonb)
    .addColumn("context_ref", jsonb)
    .addColumn("diagnostic_ref", jsonb)
    .addColumn("occurred_at", timestamptz, (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addCheckConstraint(
      "security_audit_events_outcome_ck",
      sql`outcome IN ('success', 'rejected', 'failure')`,
    )
    .execute();

  await db.schema
    .createIndex("local_login_attempts_name_idx")
    .ifNotExists()
    .on("business.local_login_attempts")
    .columns(["canonical_login_name", "last_attempt_at"])
    .execute();
  await db.schema
    .createIndex("local_sessions_account_idx")
    .ifNotExists()
    .on("business.local_sessions")
    .columns(["account_id", "revoked_at"])
    .execute();
  await db.schema
    .createIndex("scope_revisions_project_current_idx")
    .ifNotExists()
    .on("business.access_spatial_scope_revisions")
    .columns(["project_id", "scope_id", "status"])
    .execute();
  await db.schema
    .createIndex("membership_revisions_project_account_idx")
    .ifNotExists()
    .on("business.project_membership_revisions")
    .columns(["project_id", "account_id", "status"])
    .execute();
  await db.schema
    .createIndex("source_access_policy_project_source_idx")
    .ifNotExists()
    .on("business.source_access_policy_revisions")
    .columns(["project_id", "source_entity_id", "source_version_id", "revision_no"])
    .execute();
  await db.schema
    .createIndex("authorization_context_lookup_idx")
    .ifNotExists()
    .on("business.authorization_contexts")
    .columns(["project_id", "invocation_id", "branch", "expires_at"])
    .execute();

  await grantApp(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex("authorization_context_lookup_idx").ifExists().execute();
  await db.schema.dropIndex("source_access_policy_project_source_idx").ifExists().execute();
  await db.schema.dropIndex("membership_revisions_project_account_idx").ifExists().execute();
  await db.schema.dropIndex("scope_revisions_project_current_idx").ifExists().execute();
  await db.schema.dropIndex("local_sessions_account_idx").ifExists().execute();
  await db.schema.dropIndex("local_login_attempts_name_idx").ifExists().execute();
  await db.schema.dropTable("business.security_audit_events").ifExists().execute();
  await db.schema.dropTable("business.authorization_contexts").ifExists().execute();
  await db.schema.dropTable("business.source_access_policy_revision_scopes").ifExists().execute();
  await db.schema.dropTable("business.source_access_policy_revision_accounts").ifExists().execute();
  await db.schema.dropTable("business.source_access_policy_revisions").ifExists().execute();
  await db.schema.dropTable("business.source_access_policies").ifExists().execute();
  await db.schema.dropTable("business.project_membership_revision_scopes").ifExists().execute();
  await db.schema.dropTable("business.project_membership_revision_roles").ifExists().execute();
  await db.schema.dropTable("business.project_membership_revisions").ifExists().execute();
  await db.schema.dropTable("business.project_memberships").ifExists().execute();
  await db.schema.dropTable("business.access_spatial_scope_revisions").ifExists().execute();
  await db.schema.dropTable("business.access_spatial_scopes").ifExists().execute();
  await db.schema.dropTable("business.access_projects").ifExists().execute();
  await db.schema.dropTable("business.local_sessions").ifExists().execute();
  await db.schema.dropTable("business.local_login_attempts").ifExists().execute();
  await db.schema.dropTable("business.local_credentials").ifExists().execute();
  await db.schema.dropTable("business.local_accounts").ifExists().execute();
}
