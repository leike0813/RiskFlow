import type { JsonValue } from "@riskflow/core/persistence";
import type { ColumnType, Kysely } from "kysely";

import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = JsonValue;
type TimestampColumn = Date;
type BytesColumn = Buffer;

export interface LocalAccountRow {
  account_id: string;
  login_name: string;
  display_name: string;
  status: "active" | "disabled";
  system_administrator: ColumnType<boolean, boolean | undefined, boolean | undefined>;
  security_version: number;
  current_credential_version: number;
  password_change_required: boolean;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
  disabled_at: TimestampColumn | null;
}

export interface LocalCredentialRow {
  account_id: string;
  credential_version: number;
  algorithm: "scrypt";
  policy_version: string;
  cost: number;
  block_size: number;
  parallelization: number;
  key_length: number;
  salt: BytesColumn;
  derived_key: BytesColumn;
  created_at: TimestampColumn;
}

export interface LocalLoginAttemptRow {
  login_attempt_id: string;
  canonical_login_name: string;
  login_name_fingerprint: string;
  account_id: string | null;
  payload_sha256: string;
  attempt_count: number;
  window_started_at: TimestampColumn;
  locked_until: TimestampColumn | null;
  last_success_at: TimestampColumn | null;
  last_reset_at: TimestampColumn | null;
  last_result: string;
  last_reason_code: string;
  last_attempt_at: TimestampColumn;
}

export interface LocalSessionRow {
  session_id: string;
  nonce: BytesColumn;
  token_sha256: string;
  key_version: string;
  account_id: string;
  login_attempt_id: string;
  canonical_login_name: string;
  credential_version: number;
  account_security_version: number;
  created_at: TimestampColumn;
  last_seen_at: TimestampColumn;
  idle_expires_at: TimestampColumn;
  absolute_expires_at: TimestampColumn;
  revoked_at: TimestampColumn | null;
  revocation_reason: string | null;
}

export interface AccessProjectRow {
  project_id: string;
  status: "active" | "suspended";
  access_version: number;
  root_scope_id: string;
  created_at: TimestampColumn;
  updated_at: TimestampColumn;
}

export interface AccessSpatialScopeRow {
  scope_id: string;
  project_id: string;
  current_revision_id: string;
  created_at: TimestampColumn;
}

export interface AccessSpatialScopeRevisionRow {
  revision_id: string;
  scope_id: string;
  project_id: string;
  revision_no: number;
  parent_scope_id: string | null;
  status: "active" | "inactive";
  previous_revision_id: string | null;
  created_at: TimestampColumn;
  recorded_by: string;
}

export interface ProjectMembershipRow {
  membership_id: string;
  project_id: string;
  account_id: string;
  current_revision_id: string;
  created_at: TimestampColumn;
}

export interface ProjectMembershipRevisionRow {
  revision_id: string;
  membership_id: string;
  project_id: string;
  account_id: string;
  revision_no: number;
  status: "active" | "removed";
  previous_revision_id: string | null;
  created_at: TimestampColumn;
  recorded_by: string;
}

export interface ProjectMembershipRevisionRoleRow {
  revision_id: string;
  role: string;
}

export interface ProjectMembershipRevisionScopeRow {
  revision_id: string;
  project_id: string;
  scope_id: string;
}

export interface SourceAccessPolicyRow {
  source_access_grant_id: string;
  project_id: string;
  source_entity_id: string;
  source_version_id: string;
  current_revision_id: string;
  created_at: TimestampColumn;
}

export interface SourceAccessPolicyRevisionRow {
  revision_id: string;
  source_access_grant_id: string;
  project_id: string;
  source_entity_id: string;
  source_version_id: string;
  revision_no: number;
  visibility: "project-shared" | "restricted";
  registered_by: string;
  previous_revision_id: string | null;
  created_at: TimestampColumn;
}

export interface SourceAccessPolicyRevisionAccountRow {
  revision_id: string;
  account_id: string;
}

export interface SourceAccessPolicyRevisionScopeRow {
  revision_id: string;
  project_id: string;
  scope_id: string;
}

export interface AuthorizationContextRow {
  context_id: string;
  version_id: string;
  invocation_id: string;
  project_id: string;
  actor_id: string;
  branch: string;
  context_kind: "c02" | "system-administration";
  context_json: JsonColumn | null;
  parent_context_id: string | null;
  causal_run_ref: JsonColumn | null;
  policy_ref: JsonColumn;
  revision_snapshot: JsonColumn;
  expires_at: TimestampColumn;
  decided_at: TimestampColumn;
}

export interface SecurityAuditEventRow {
  event_id: string;
  event_kind: string;
  outcome: string;
  reason_code: string;
  subject_ref: string | null;
  project_ref: string | null;
  request_ref: string | null;
  policy_ref: JsonColumn | null;
  context_ref: JsonColumn | null;
  diagnostic_ref: JsonColumn | null;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
}

export interface AccessPostgresDatabase extends PostgresDatabase {
  "business.local_accounts": LocalAccountRow;
  "business.local_credentials": LocalCredentialRow;
  "business.local_login_attempts": LocalLoginAttemptRow;
  "business.local_sessions": LocalSessionRow;
  "business.access_projects": AccessProjectRow;
  "business.access_spatial_scopes": AccessSpatialScopeRow;
  "business.access_spatial_scope_revisions": AccessSpatialScopeRevisionRow;
  "business.project_memberships": ProjectMembershipRow;
  "business.project_membership_revisions": ProjectMembershipRevisionRow;
  "business.project_membership_revision_roles": ProjectMembershipRevisionRoleRow;
  "business.project_membership_revision_scopes": ProjectMembershipRevisionScopeRow;
  "business.source_access_policies": SourceAccessPolicyRow;
  "business.source_access_policy_revisions": SourceAccessPolicyRevisionRow;
  "business.source_access_policy_revision_accounts": SourceAccessPolicyRevisionAccountRow;
  "business.source_access_policy_revision_scopes": SourceAccessPolicyRevisionScopeRow;
  "business.authorization_contexts": AuthorizationContextRow;
  "business.security_audit_events": SecurityAuditEventRow;
}

export type AccessDb = Kysely<AccessPostgresDatabase>;
