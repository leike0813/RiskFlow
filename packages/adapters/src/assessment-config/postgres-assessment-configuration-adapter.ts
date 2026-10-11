import type { ColumnType, Kysely, Selectable, Transaction } from "kysely";

import {
  AssessmentConfigurationError,
  AssessmentConfigurationReleaseSetV1Schema,
  AssessmentConfigurationResolverV1,
  AssessmentConfigurationRevisionMetadataV1Schema,
  AssessmentConfigurationSetResultV1Schema,
  isAssessmentConfigurationDefinitionTypeV1,
  readPreparedAssessmentConfiguration,
  type AssessmentConfigurationDefinitionTypeV1,
  type AssessmentConfigurationGovernancePolicyV1,
  type GovernedConfigurationReleaseMemberV1,
  type AssessmentConfigurationMemberSourceV1,
  type AssessmentConfigurationMemberResolutionV1,
  type AssessmentConfigurationReleaseAppendV1,
  type AssessmentConfigurationRevisionAppendV1,
  type AssessmentConfigurationRevisionMetadataAssertionV1,
  type AssessmentConfigurationRevisionMetadataV1,
  type AssessmentConfigurationSetAppendV1,
  type AssessmentConfigurationSetResultV1,
  type PreparedAssessmentConfigurationV1,
  type ResolveAssessmentConfigurationSetV1,
  type SubmitAssessmentConfigurationRevisionV1,
  assessmentConfigurationFailureFrom,
} from "@riskflow/core/assessment-config";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  ArtifactReadRequestV1Schema,
  type ArtifactReadHandleV1,
} from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1,
  AssessmentConfigurationDocumentV1Schema,
  assessmentConfigurationDocumentDigest,
} from "@riskflow/core/assessment-config";
import {
  sha256CanonicalJson,
  type AtomicCommandV1,
  type TransactionContextV1,
  type TransactionUnitV1,
} from "@riskflow/core/persistence";
import { DomainEventV1Schema, type DomainEventV1 } from "@riskflow/contracts/events";
import {
  ContractReferenceV1Schema,
  ContentArtifactRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  type AuthorizationContextV1,
  type ContractReferenceV1,
  type KnowledgeReleaseRefV1,
  type KnowledgeRevisionRefV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema } from "@riskflow/contracts/common";

import { mapPostgresError } from "../postgres/pool.js";
import { getPostgresTransaction } from "../postgres/transaction-unit.js";
import type { PostgresDatabase } from "../postgres/types.js";

type JsonColumn = ColumnType<unknown, unknown, unknown>;
type TimestampColumn = ColumnType<Date, Date | string | undefined, Date | string>;

interface AssessmentConfigRevisionMetadataRow {
  revision_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
  artifact_entity_id: string;
  artifact_version_id: string;
  artifact_ref: JsonColumn;
  project_revision_ref: JsonColumn;
  configuration_set_ref: JsonColumn;
  content_digest: string;
  summary: JsonColumn;
  command_id: string;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface AssessmentConfigurationReleaseSetRow {
  set_id: string;
  version_id: string;
  project_id: string;
  project_revision_ref: JsonColumn;
  configuration_set_ref: JsonColumn;
  required_at: TimestampColumn;
  as_of_recorded_at: TimestampColumn;
  member_digest: string;
  identity_digest: string;
  command_id: string;
  actor_ref: string;
  authorization_context_ref: JsonColumn;
  audit_entry_id: string;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn;
}

interface AssessmentConfigurationReleaseSetMemberRow {
  set_id: string;
  version_id: string;
  ordinal: number;
  definition_type: string;
  release_id: string;
  release_version_id: string;
  release_ref: JsonColumn;
  revision_id: string;
  revision_version_id: string;
  revision_ref: JsonColumn;
  artifact_ref: JsonColumn;
  content_digest: string;
  persisted_at: TimestampColumn;
}

type AssessmentConfigurationDatabase = PostgresDatabase & {
  "business.assessment_config_revision_metadata": AssessmentConfigRevisionMetadataRow;
  "business.assessment_configuration_release_sets": AssessmentConfigurationReleaseSetRow;
  "business.assessment_configuration_release_set_members": AssessmentConfigurationReleaseSetMemberRow;
};

type AssessmentConfigurationTransaction = Transaction<AssessmentConfigurationDatabase>;

const readConfigurationBody = async (handle: ArtifactReadHandleV1): Promise<unknown> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of handle.content) {
    size += chunk.byteLength;
    if (size > ASSESSMENT_CONFIGURATION_MAX_ARTIFACT_BYTES_V1) {
      throw new RangeError("assessment configuration artifact exceeds its size limit");
    }
    chunks.push(chunk);
  }
  await handle.verified;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
};

const jsonbValue = (value: unknown): unknown => JSON.stringify(value) as unknown;

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const asAssessmentConfigurationTransaction = (
  context: TransactionContextV1,
): AssessmentConfigurationTransaction =>
  getPostgresTransaction(context) as unknown as AssessmentConfigurationTransaction;

const metadataFromRow = (row: Selectable<AssessmentConfigRevisionMetadataRow>) =>
  AssessmentConfigurationRevisionMetadataV1Schema.parse({
    revisionRef: {
      kind: "knowledge-revision",
      reference: { entityId: row.revision_id, versionId: row.version_id },
    },
    projectId: row.project_id,
    definitionType: row.definition_type,
    artifactRef: row.artifact_ref,
    projectRevisionRef: row.project_revision_ref,
    configurationSetRef: row.configuration_set_ref,
    contentDigest: row.content_digest,
    summary: row.summary,
    commandId: row.command_id,
    auditEntryId: row.audit_entry_id,
    occurredAt: asIso(row.occurred_at),
    recordedAt: asIso(row.recorded_at),
    persistedAt: asIso(row.persisted_at),
  });

const asContractReference = (value: unknown): ContractReferenceV1 =>
  ContractReferenceV1Schema.parse(value);

const moduleError = (
  value:
    | { code: "AUTHORIZATION_DENIED"; branch: ModuleBranchV1; causalRunId: string }
    | {
        code: "ENTITY_NOT_FOUND" | "STALE_VERSION";
        targetRef: ContractReferenceV1;
        causalRunId: string;
      }
    | {
        code: "BUSINESS_BLOCKED";
        blockerKind: string;
        blockerRef: ContractReferenceV1;
        causalRunId: string;
      }
    | {
        code: "IDEMPOTENCY_CONFLICT";
        idempotencyKey: string;
        priorCommandId: string;
        causalRunId: string;
      }
    | { code: "UNSUPPORTED_CONTRACT"; causalRunId: string }
    | { code: "TRANSIENT_FAILURE" | "TERMINAL_FAILURE"; causalRunId: string },
): ModuleErrorV1 => {
  const common = {
    stageCode: `assessment-configuration.${value.code.toLowerCase()}`,
    occurredAt: new Date().toISOString(),
    causalRunId: IdentifierSchema.parse(value.causalRunId),
  };
  switch (value.code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "authorization",
        retryable: false,
        requiredCapability: MODULE_BRANCH_CAPABILITY_V1[value.branch],
        authorizationPolicyRef: { entityId: "access-policy", versionId: "v1" },
      });
    case "ENTITY_NOT_FOUND":
    case "STALE_VERSION":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: value.code === "ENTITY_NOT_FOUND" ? "not-found" : "concurrency",
        retryable: false,
        targetRef: value.targetRef,
      });
    case "BUSINESS_BLOCKED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "business-blocked",
        retryable: false,
        blockerKind: IdentifierSchema.parse(value.blockerKind),
        blockerRef: value.blockerRef,
      });
    case "IDEMPOTENCY_CONFLICT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "idempotency",
        retryable: false,
        idempotencyKey: IdentifierSchema.parse(value.idempotencyKey),
        priorCommandId: IdentifierSchema.parse(value.priorCommandId),
      });
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: false,
        schemaVersion: "1",
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code: value.code,
        category: "technical",
        retryable: value.code === "TRANSIENT_FAILURE",
        ...(value.code === "TRANSIENT_FAILURE"
          ? {
              attempt: 1,
              retryPolicyRef: { entityId: "assessment-configuration-retry-policy", versionId: "1" },
            }
          : {}),
        diagnosticRef: {
          kind: "diagnostic-artifact",
          reference: {
            entityId: `assessment-configuration-${value.code.toLowerCase()}`,
            versionId: "1",
          },
        },
      });
  }
};

/** Narrow C16 seam owned by the knowledge-governance adapter. */
export interface AssessmentConfigurationGovernedReleaseResolverV1 {
  resolveGovernedReleases(input: {
    readonly projectId: string;
    readonly requiredDefinitionTypes: readonly string[];
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<
    | {
        readonly kind: "succeeded";
        readonly result: {
          readonly releaseRefs: readonly KnowledgeReleaseRefV1[];
          readonly members: readonly GovernedConfigurationReleaseMemberV1[];
        };
      }
    | { readonly kind: "failed"; readonly error: ModuleErrorV1 }
  >;
}

export interface PostgresAssessmentConfigurationAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly transactionUnit: TransactionUnitV1;
  readonly artifactStore: ArtifactStoreV1;
  /** C16 governed release resolver that owns release, revision and artifact refs. */
  readonly governedReleases: AssessmentConfigurationGovernedReleaseResolverV1;
  readonly now?: () => Date;
}

/**
 * C18 policy and resolver on PostgreSQL. Configuration bodies stay in C04; this
 * adapter only persists revision associations and immutable release sets.
 */
export class PostgresAssessmentConfigurationAdapter implements AssessmentConfigurationGovernancePolicyV1 {
  readonly #db: Kysely<AssessmentConfigurationDatabase>;
  readonly #transactionUnit: TransactionUnitV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #governedReleases: AssessmentConfigurationGovernedReleaseResolverV1;
  readonly #now: () => Date;
  readonly #resolver: AssessmentConfigurationResolverV1;

  constructor(options: PostgresAssessmentConfigurationAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<AssessmentConfigurationDatabase>;
    this.#transactionUnit = options.transactionUnit;
    this.#artifactStore = options.artifactStore;
    this.#governedReleases = options.governedReleases;
    this.#now = options.now ?? (() => new Date());
    this.#resolver = new AssessmentConfigurationResolverV1({
      artifactStore: this.#artifactStore,
      transactionUnit: this.#transactionUnit,
      now: this.#now,
      resolveConfigurationMembers: (request) => this.#resolveConfigurationMembers(request),
      appendConfigurationSet: (context, input) => this.#appendConfigurationSet(context, input),
    });
  }

  async prepareRevision(
    command: SubmitAssessmentConfigurationRevisionV1,
  ): Promise<PreparedAssessmentConfigurationV1> {
    return readPreparedAssessmentConfiguration({
      artifactStore: this.#artifactStore,
      artifactRef: command.candidateArtifactRef,
      definitionType: command.definitionType,
      projectId: command.projectId,
      actorId: command.authorization.actorId,
      requestId: `${command.projectId}:${command.definitionType}:${command.candidateArtifactRef.reference.versionId}`,
      idempotencyKey: `${command.projectId}:${command.definitionType}:${command.candidateArtifactRef.reference.versionId}`,
      requestedAt: command.authorization.decidedAt,
      requiredCapability: "knowledge-modeling.govern",
      authorization: command.authorization,
    });
  }

  /** 按精确已发布成员读取原配置正文；宿主须注入经 C06 复验的 C04 组合。 */
  async readPublishedConfigurationMember(input: {
    readonly projectId: string;
    readonly requestId: string;
    readonly releaseRef: KnowledgeReleaseRefV1["reference"];
    readonly authorization: AuthorizationContextV1;
  }): Promise<{ readonly body: unknown; readonly sha256: string } | undefined> {
    if (input.authorization === undefined || input.authorization.projectId !== input.projectId) {
      return undefined;
    }
    const members = await this.#db
      .selectFrom("business.assessment_configuration_release_set_members as member")
      .innerJoin("business.assessment_configuration_release_sets as release_set", (join) =>
        join
          .onRef("release_set.set_id", "=", "member.set_id")
          .onRef("release_set.version_id", "=", "member.version_id"),
      )
      .select([
        "member.definition_type as definition_type",
        "member.artifact_ref as artifact_ref",
        "member.content_digest as content_digest",
      ])
      .distinct()
      .where("release_set.project_id", "=", input.projectId)
      .where("member.release_id", "=", input.releaseRef.entityId)
      .where("member.release_version_id", "=", input.releaseRef.versionId)
      .limit(2)
      .execute();
    const member = members[0];
    if (member === undefined || !isAssessmentConfigurationDefinitionTypeV1(member.definition_type)) {
      return undefined;
    }
    if (
      members.some(
        (candidate) =>
          candidate.definition_type !== member.definition_type ||
          JSON.stringify(candidate.artifact_ref) !== JSON.stringify(member.artifact_ref) ||
          candidate.content_digest !== member.content_digest,
      )
    ) {
      return undefined;
    }
    try {
      const artifactRef = ContentArtifactRefV1Schema.parse(member.artifact_ref);
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId: input.requestId,
          idempotencyKey: `${input.requestId}:configuration-member`,
          artifactRef,
          projectId: input.projectId,
          actorId: input.authorization.actorId,
          requestedAt: input.authorization.decidedAt,
          purposeCode: ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
          requiredCapability: "knowledge-modeling.read",
          authorization: input.authorization,
        }),
      );
      const document = AssessmentConfigurationDocumentV1Schema.parse(
        await readConfigurationBody(handle),
      );
      const sha256 = assessmentConfigurationDocumentDigest(document);
      if (document.definitionType !== member.definition_type || sha256 !== member.content_digest) {
        return undefined;
      }
      return { body: document, sha256 };
    } catch {
      return undefined;
    }
  }

  async appendPreparedRevision(
    context: TransactionContextV1,
    input: AssessmentConfigurationRevisionAppendV1,
  ): Promise<void> {
    const { revision, prepared } = input;
    if (
      prepared.definitionType !== revision.definitionType ||
      prepared.projectRevisionRef.reference.entityId.length === 0
    ) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-type-mismatch",
        targetRef: asContractReference(revision.revisionRef),
      });
    }
    const transaction = asAssessmentConfigurationTransaction(context);
    await transaction
      .insertInto("business.assessment_config_revision_metadata")
      .values({
        revision_id: revision.revisionRef.reference.entityId,
        version_id: revision.revisionRef.reference.versionId,
        project_id: revision.projectId,
        definition_type: revision.definitionType,
        artifact_entity_id: revision.candidateArtifactRef.reference.entityId,
        artifact_version_id: revision.candidateArtifactRef.reference.versionId,
        artifact_ref: jsonbValue(revision.candidateArtifactRef),
        project_revision_ref: jsonbValue(prepared.projectRevisionRef),
        configuration_set_ref: jsonbValue(prepared.configurationSetRef),
        content_digest: prepared.contentDigest,
        summary: jsonbValue(prepared.summary),
        command_id: revision.commandId,
        audit_entry_id: input.auditEntryId,
        occurred_at: revision.occurredAt,
        recorded_at: revision.recordedAt,
        persisted_at: input.persistedAt,
      })
      .onConflict((conflict) => conflict.columns(["revision_id", "version_id"]).doNothing())
      .execute();
  }

  async assertRevisionMetadata(
    input: AssessmentConfigurationRevisionMetadataAssertionV1,
  ): Promise<void> {
    if (
      input.authorization.projectId !== input.projectId ||
      !input.authorization.grantedCapabilities.includes("knowledge-modeling.govern")
    ) {
      throw new AssessmentConfigurationError({
        code: "AUTHORIZATION_DENIED",
        reasonCode: "assessment-configuration-project-mismatch",
        targetRef: asContractReference(input.revisionRef),
      });
    }
    const metadata = await this.#findMetadata(input.projectId, input.revisionRef);
    if (metadata === undefined) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-revision-unverified",
        targetRef: asContractReference(input.revisionRef),
      });
    }
  }

  async appendRelease(
    context: TransactionContextV1,
    input: AssessmentConfigurationReleaseAppendV1,
  ): Promise<DomainEventV1[]> {
    const metadata = await this.#findMetadata(input.command.projectId, input.revision.revisionRef);
    if (metadata === undefined) {
      throw new AssessmentConfigurationError({
        code: "BUSINESS_BLOCKED",
        reasonCode: "assessment-configuration-revision-unverified",
        targetRef: asContractReference(input.revision.revisionRef),
      });
    }
    if (
      metadata.definitionType !== input.revision.definitionType ||
      metadata.artifactRef.reference.entityId !==
        input.revision.candidateArtifactRef.reference.entityId ||
      metadata.artifactRef.reference.versionId !==
        input.revision.candidateArtifactRef.reference.versionId
    ) {
      throw new AssessmentConfigurationError({
        code: "STALE_VERSION",
        reasonCode: "assessment-configuration-artifact-mismatch",
        targetRef: asContractReference(input.releaseRef),
      });
    }
    const event = DomainEventV1Schema.parse({
      schemaVersion: "1",
      eventId: `knowledge-assessment-basis-published-${sha256CanonicalJson({
        projectId: input.command.projectId,
        releaseRef: input.releaseRef,
      })}`,
      eventVersion: 1,
      projectId: input.command.projectId,
      aggregateRef: input.releaseRef,
      occurredAt: input.command.issuedAt,
      recordedAt: input.recordedAt,
      causationId: input.command.commandId,
      correlationId: input.command.idempotencyKey,
      producerCommandId: input.command.commandId,
      idempotencyKey: input.command.idempotencyKey,
      authorizationContextRef: input.command.authorizationContextRef,
      auditTrailRef: {
        kind: "audit-trail",
        reference: {
          entityId: input.audit.auditEntryId,
          versionId: input.audit.version.versionId,
        },
      },
      eventType: "knowledge.assessment-basis-published.v1",
      payload: {
        basisKind: "assessment-basis",
        newKnowledgeReleaseRef: input.releaseRef,
        affectedProjectRevisionRef: metadata.projectRevisionRef,
      },
    });
    return [event];
  }

  async resolveConfigurationSet(
    request: ResolveAssessmentConfigurationSetV1,
  ): Promise<AssessmentConfigurationSetResultV1> {
    try {
      const resolution = await this.#resolver.resolveConfigurationSet(request);
      if (resolution.kind === "failed") {
        return AssessmentConfigurationSetResultV1Schema.parse({
          kind: "failed",
          error: resolution.error,
        });
      }
      return AssessmentConfigurationSetResultV1Schema.parse({
        kind: "succeeded",
        configurationSet: resolution.configurationSet,
      });
    } catch (error) {
      return AssessmentConfigurationSetResultV1Schema.parse({
        kind: "failed",
        error: await this.#mapError(error, {
          branch: "knowledge-modeling.assessment-basis",
          causalRunId: request.requestId,
          command: {
            projectId: request.projectId,
            commandKind: "knowledge.resolve-assessment-configuration-set.v1",
            commandId: request.requestId,
            idempotencyKey: request.idempotencyKey,
            payload: {},
            actorRef: request.actorId,
            authorizationContextRef: request.authorization.authorizationContextRef,
          },
        }),
      });
    }
  }

  async #resolveConfigurationMembers(request: {
    readonly projectId: string;
    readonly requiredDefinitionTypes: readonly AssessmentConfigurationDefinitionTypeV1[];
    readonly requiredAt: string;
    readonly asOfRecordedAt: string;
    readonly authorization: AuthorizationContextV1;
  }): Promise<AssessmentConfigurationMemberResolutionV1> {
    const resolution = await this.#governedReleases.resolveGovernedReleases({
      projectId: request.projectId,
      requiredDefinitionTypes: request.requiredDefinitionTypes,
      requiredAt: request.requiredAt,
      asOfRecordedAt: request.asOfRecordedAt,
      authorization: request.authorization,
    });
    if (resolution.kind === "failed") return { kind: "failed", error: resolution.error };
    const members: AssessmentConfigurationMemberSourceV1[] = [];
    for (const member of resolution.result.members) {
      if (!isAssessmentConfigurationDefinitionTypeV1(member.definitionType)) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            blockerKind: "assessment-configuration-incompatible",
            blockerRef: asContractReference(member.releaseRef),
            causalRunId: request.projectId,
          }),
        };
      }
      const metadata = await this.#findMetadata(request.projectId, member.revisionRef);
      if (metadata === undefined) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            blockerKind: "assessment-configuration-revision-unverified",
            blockerRef: asContractReference(member.revisionRef),
            causalRunId: request.projectId,
          }),
        };
      }
      if (
        metadata.definitionType !== member.definitionType ||
        metadata.artifactRef.reference.entityId !==
          member.candidateArtifactRef.reference.entityId ||
        metadata.artifactRef.reference.versionId !== member.candidateArtifactRef.reference.versionId
      ) {
        return {
          kind: "failed",
          error: moduleError({
            code: "BUSINESS_BLOCKED",
            blockerKind: "assessment-configuration-incompatible",
            blockerRef: asContractReference(member.releaseRef),
            causalRunId: request.projectId,
          }),
        };
      }
      members.push({
        definitionType: member.definitionType,
        releaseRef: member.releaseRef,
        revisionRef: member.revisionRef,
        artifactRef: member.candidateArtifactRef,
        projectRevisionRef: metadata.projectRevisionRef,
        configurationSetRef: metadata.configurationSetRef,
        contentDigest: metadata.contentDigest,
        summary: metadata.summary,
      });
    }
    return { kind: "succeeded", members };
  }

  async #appendConfigurationSet(
    context: TransactionContextV1,
    input: AssessmentConfigurationSetAppendV1,
  ): Promise<void> {
    const configurationSet = AssessmentConfigurationReleaseSetV1Schema.parse(
      input.configurationSet,
    );
    const transaction = asAssessmentConfigurationTransaction(context);
    await transaction
      .insertInto("business.assessment_configuration_release_sets")
      .values({
        set_id: configurationSet.setRef.reference.entityId,
        version_id: configurationSet.setRef.reference.versionId,
        project_id: configurationSet.projectId,
        project_revision_ref: jsonbValue(configurationSet.projectRevisionRef),
        configuration_set_ref: jsonbValue(configurationSet.configurationSetRef),
        required_at: configurationSet.requiredAt,
        as_of_recorded_at: configurationSet.asOfRecordedAt,
        member_digest: configurationSet.memberDigest,
        identity_digest: configurationSet.identityDigest,
        command_id: input.command.commandId,
        actor_ref: input.command.actorRef,
        authorization_context_ref: jsonbValue(input.command.authorizationContextRef),
        audit_entry_id: input.auditEntryId,
        occurred_at: input.command.issuedAt,
        recorded_at: configurationSet.recordedAt,
        persisted_at: configurationSet.recordedAt,
      })
      .onConflict((conflict) => conflict.columns(["identity_digest"]).doNothing())
      .execute();
    await transaction
      .insertInto("business.assessment_configuration_release_set_members")
      .values(
        configurationSet.members.map((member, index) => ({
          set_id: configurationSet.setRef.reference.entityId,
          version_id: configurationSet.setRef.reference.versionId,
          ordinal: index,
          definition_type: member.definitionType,
          release_id: member.releaseRef.reference.entityId,
          release_version_id: member.releaseRef.reference.versionId,
          release_ref: jsonbValue(member.releaseRef),
          revision_id: member.revisionRef.reference.entityId,
          revision_version_id: member.revisionRef.reference.versionId,
          revision_ref: jsonbValue(member.revisionRef),
          artifact_ref: jsonbValue(member.artifactRef),
          content_digest: member.contentDigest,
          persisted_at: configurationSet.recordedAt,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(["set_id", "version_id", "definition_type"]).doNothing(),
      )
      .execute();
  }

  async #findMetadata(
    projectId: string,
    revisionRef: KnowledgeRevisionRefV1,
  ): Promise<AssessmentConfigurationRevisionMetadataV1 | undefined> {
    const row = await this.#db
      .selectFrom("business.assessment_config_revision_metadata")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("revision_id", "=", revisionRef.reference.entityId)
      .where("version_id", "=", revisionRef.reference.versionId)
      .executeTakeFirst();
    return row === undefined ? undefined : metadataFromRow(row);
  }

  async #lookupPriorCommand(command: AtomicCommandV1): Promise<string> {
    try {
      const row = await this.#db
        .selectFrom("business.command_receipts")
        .select("command_id")
        .where("project_id", "=", command.projectId)
        .where("command_kind", "=", command.commandKind)
        .where("idempotency_key", "=", command.idempotencyKey)
        .executeTakeFirst();
      return row?.command_id ?? "unknown-command";
    } catch {
      return "unknown-command";
    }
  }

  async #mapError(
    error: unknown,
    context: {
      readonly branch: ModuleBranchV1;
      readonly causalRunId: string;
      readonly command: AtomicCommandV1;
    },
  ): Promise<ModuleErrorV1> {
    const failure = assessmentConfigurationFailureFrom(error);
    if (failure !== undefined) {
      if (failure.code === "AUTHORIZATION_DENIED") {
        return moduleError({
          code: failure.code,
          branch: context.branch,
          causalRunId: context.causalRunId,
        });
      }
      if (failure.code === "BUSINESS_BLOCKED") {
        return moduleError({
          code: failure.code,
          blockerKind: failure.reasonCode,
          blockerRef: failure.targetRef,
          causalRunId: context.causalRunId,
        });
      }
      if (failure.code === "IDEMPOTENCY_CONFLICT") {
        return moduleError({
          code: failure.code,
          idempotencyKey: context.command.idempotencyKey,
          priorCommandId: await this.#lookupPriorCommand(context.command),
          causalRunId: context.causalRunId,
        });
      }
      if (failure.code === "TRANSIENT_FAILURE" || failure.code === "TERMINAL_FAILURE") {
        return moduleError({ code: failure.code, causalRunId: context.causalRunId });
      }
      return moduleError({
        code: failure.code,
        targetRef: failure.targetRef,
        causalRunId: context.causalRunId,
      });
    }
    const mapped = mapPostgresError(error, "assessment-configuration.adapter");
    if (mapped.code === "IDEMPOTENCY_CONFLICT") {
      return moduleError({
        code: "IDEMPOTENCY_CONFLICT",
        idempotencyKey: context.command.idempotencyKey,
        priorCommandId: await this.#lookupPriorCommand(context.command),
        causalRunId: context.causalRunId,
      });
    }
    return moduleError({
      code:
        mapped.retryable || mapped.code === "CONNECTION_FAILED"
          ? "TRANSIENT_FAILURE"
          : "TERMINAL_FAILURE",
      causalRunId: context.causalRunId,
    });
  }
}

export const createPostgresAssessmentConfigurationAdapter = (
  options: PostgresAssessmentConfigurationAdapterOptionsV1,
): PostgresAssessmentConfigurationAdapter => new PostgresAssessmentConfigurationAdapter(options);
