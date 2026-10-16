import { TextDecoder } from "node:util";

import type { Kysely } from "kysely";

import {
  KnowledgeGovernanceReadQueryV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  type KnowledgeDefinitionTypeV1,
  type KnowledgeGovernanceLifecycleFilterV1,
  type KnowledgeGovernanceListItemV1,
  type KnowledgeGovernanceReadBodyV1,
  type KnowledgeGovernanceReadPortV1,
  type KnowledgeGovernanceReadQueryV1,
  type KnowledgeGovernanceReadResultV1,
  type AuthorizationContextV1,
  type KnowledgeRevisionLifecycleStatusV1,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";
import {
  ACCESS_POLICY_REF_V1,
  type AuthorizationDecisionV1,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import { ArtifactReadRequestV1Schema, type ArtifactStoreV1 } from "@riskflow/core/artifacts";
import {
  ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1,
  RiskMatrixDocumentV1Schema,
  MeasureLibraryDocumentV1Schema,
} from "@riskflow/core/assessment-config";
import { IdentificationKnowledgePackageV1Schema } from "@riskflow/core/identification-knowledge";
import {
  deriveKnowledgeRevisionStatus,
  KnowledgeReviewLinkV1Schema,
  parseKnowledgeRevision,
} from "@riskflow/core/knowledge-governance";
import {
  APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1,
  ApplicableRuleSetDocumentV1Schema,
  STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1,
  StructuredScoringRuleDocumentV1Schema,
} from "@riskflow/core/scoring-rules";
import { StructuredScoringRuleSchema } from "@riskflow/contracts/records";
import type { PostgresDatabase } from "../postgres/types.js";

/** 识别知识包（工序模型、风险机理）工件的用途码，与 `identification-knowledge` 域一致。 */
const IDENTIFICATION_KNOWLEDGE_PACKAGE_PURPOSE_CODE_V1 = "identification-knowledge-package";

/**
 * 定义类型 → 该类正文工件的用途码。
 *
 * C04 判定读取时 `purposeCode` 必须与工件 manifest 逐字相等，因此治理读按类型取各自
 * 领域已登记的用途码，不使用治理读分支的统一码。未登记用途码的类型不在此读取，
 * 继续按既有语义返回不可用。
 */
const governanceArtifactPurposeCodeV1 = (definitionType: string): string | undefined => {
  switch (definitionType) {
    case "process-model":
    case "risk-mechanism":
      return IDENTIFICATION_KNOWLEDGE_PACKAGE_PURPOSE_CODE_V1;
    case "structured-scoring-rule":
      return STRUCTURED_SCORING_RULE_ARTIFACT_PURPOSE_CODE_V1;
    case "applicable-rule-set":
      return APPLICABLE_RULE_SET_ARTIFACT_PURPOSE_CODE_V1;
    case "risk-matrix":
    case "measure-library":
      return ASSESSMENT_CONFIGURATION_ARTIFACT_PURPOSE_CODE_V1;
    default:
      return undefined;
  }
};

type TimestampColumn = Date | string;

interface KnowledgeDefinitionRow {
  definition_id: string;
  version_id: string;
  project_id: string;
  definition_type: string;
}

interface KnowledgeRevisionRow {
  revision_id: string;
  version_id: string;
  definition_id: string;
  definition_version_id: string;
  project_id: string;
  definition_type: string;
  candidate_artifact_ref: unknown;
  evidence_references: unknown;
  base_release_ref: unknown;
  base_revision_ref: unknown;
  artifact_identity_digest: string;
  command_id: string;
  actor_ref: string;
  authorization_context_ref: unknown;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn | null;
}

interface KnowledgeReviewLinkRow {
  review_attempt_id: string;
  project_id: string;
  revision_id: string;
  revision_version_id: string;
  revision_ref: unknown;
  review_policy_ref: unknown;
  validation_snapshot_ref: unknown;
  evidence_snapshot_ref: unknown;
  waiting_run_ref: unknown;
  review_task_ref: unknown;
  review_decision_ref: unknown;
  state: "waiting" | "linked";
  requested_by: string;
  authorization_context_ref: unknown;
  requested_at: TimestampColumn;
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
  persisted_at: TimestampColumn | null;
}

interface KnowledgeReleaseRow {
  release_id: string;
  version_id: string;
  definition_id: string;
  definition_version_id: string;
  project_id: string;
  definition_type: string;
  revision_id: string;
  revision_version_id: string;
  revision_ref: unknown;
  effective_from: TimestampColumn;
  recorded_at: TimestampColumn;
}

interface KnowledgeReleaseDecisionRow {
  release_id: string;
  project_id: string;
  decision: "deactivated";
  occurred_at: TimestampColumn;
  recorded_at: TimestampColumn;
}

type GovernanceReadDatabase = PostgresDatabase & {
  "business.knowledge_definitions": KnowledgeDefinitionRow;
  "business.knowledge_revisions": KnowledgeRevisionRow;
  "business.knowledge_review_links": KnowledgeReviewLinkRow;
  "business.knowledge_releases": KnowledgeReleaseRow;
  "business.knowledge_release_decisions": KnowledgeReleaseDecisionRow;
};

const asIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const governanceError = (
  code: "AUTHORIZATION_DENIED" | "UNSUPPORTED_CONTRACT" | "TRANSIENT_FAILURE",
  causalRunId: string,
): ModuleErrorV1 => {
  if (code === "AUTHORIZATION_DENIED") {
    return {
      code,
      category: "authorization",
      retryable: false,
      requiredCapability: "knowledge-modeling.read",
      authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      stageCode: "knowledge-modeling.governance-read",
      occurredAt: new Date().toISOString(),
      causalRunId,
    } as ModuleErrorV1;
  }
  if (code === "UNSUPPORTED_CONTRACT") {
    return {
      code,
      category: "technical",
      retryable: false,
      schemaVersion: "1",
      stageCode: "knowledge-modeling.governance-read",
      occurredAt: new Date().toISOString(),
      causalRunId,
    } as ModuleErrorV1;
  }
  return {
    code,
    category: "technical",
    retryable: true,
    attempt: 1,
    retryPolicyRef: { entityId: "knowledge-governance-retry-policy", versionId: "1" },
    diagnosticRef: {
      kind: "diagnostic-artifact",
      reference: { entityId: "knowledge-governance-read-failure", versionId: "1" },
    },
    stageCode: "knowledge-modeling.governance-read",
    occurredAt: new Date().toISOString(),
    causalRunId,
  } as ModuleErrorV1;
};

const failed = (error: ModuleErrorV1): KnowledgeGovernanceReadResultV1 => ({
  kind: "failed",
  error,
});

const denied = (queryId: string): KnowledgeGovernanceReadResultV1 =>
  failed(governanceError("AUTHORIZATION_DENIED", queryId));

const decodeCursor = (cursor: string | undefined): number | "invalid" => {
  if (cursor === undefined) return 0;
  if (!/^offset-\d+$/u.test(cursor)) return "invalid";
  return Number.parseInt(cursor.slice("offset-".length), 10);
};

const encodeCursor = (offset: number): string => `offset-${offset}`;

const revisionRefOf = (row: KnowledgeRevisionRow) => ({
  kind: "knowledge-revision" as const,
  reference: { entityId: row.revision_id, versionId: row.version_id },
});

const definitionRefOf = (row: {
  definition_id: string;
  version_id?: string;
  definition_version_id?: string;
}) => ({
  kind: "knowledge-definition" as const,
  reference: {
    entityId: row.definition_id,
    versionId: row.definition_version_id ?? row.version_id ?? "1",
  },
});

const releaseRefOf = (row: KnowledgeReleaseRow) => ({
  kind: "knowledge-release" as const,
  reference: { entityId: row.release_id, versionId: row.version_id },
});

export interface PostgresKnowledgeGovernanceReadAdapterOptionsV1 {
  readonly db: Kysely<PostgresDatabase>;
  readonly access: LocalIdentityAccessV1;
  readonly artifactStore: ArtifactStoreV1;
  /**
   * 正文读取的用途签发接缝（design D-06）：与 C17/C25 组合根同形的内部接缝。
   *
   * 页面为「列出定义/读一页目录」申请的上下文不带任何来源授权，而定义正文来自 C19 编制、
   * 其访问快照带来源授权——沿用列表上下文会让每一页正文都在 C04 关闭失败。正文因此按
   * 自身用途另签：同一主体与工程、同一个读分支、独立请求身份；签不出来就沿用调用方
   * 上下文由 C04 裁决，绝不在这里放宽访问快照检查。
   */
  readonly authorizeDownstream?: KnowledgeGovernanceDownstreamAuthorizerV1;
}

export type KnowledgeGovernanceDownstreamAuthorizerV1 = (request: {
  readonly branch: ModuleBranchV1;
  readonly invocationId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly requestedAt: string;
  readonly requestedSpatialScopeRefs?: readonly SpatialScopeRefV1[];
  readonly requestedSourceVersionRefs?: readonly SourceVersionRefV1[];
}) => Promise<AuthorizationContextV1>;

/**
 * C32 知识治理只读适配器（IP-04）。只读组合治理模块既有定义/修订/发布/决定行与 C04 候选
 * 工件，不写治理事实；列表不返回正文；精确读取按写路径 Schema 解析正文并映射为 C32 读取
 * DTO；无权、跨工程与不存在同形失败。
 */
/** 指向其它工程、其它操作者或未持读能力的请求先按授权失败收口（与 registry 同形）。 */
const governanceRequestDenied = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return false;
  const request = value as Record<string, unknown>;
  const authorization = request.authorization;
  if (typeof authorization !== "object" || authorization === null) return false;
  const context = authorization as Record<string, unknown>;
  if (
    typeof request.projectId === "string" &&
    typeof context.projectId === "string" &&
    request.projectId !== context.projectId
  ) {
    return true;
  }
  if (
    typeof request.actorId === "string" &&
    typeof context.actorId === "string" &&
    request.actorId !== context.actorId
  ) {
    return true;
  }
  const capabilities = context.grantedCapabilities;
  return Array.isArray(capabilities) && !capabilities.includes("knowledge-modeling.read");
};

export class PostgresKnowledgeGovernanceReadAdapter implements KnowledgeGovernanceReadPortV1 {
  readonly #db: Kysely<GovernanceReadDatabase>;
  readonly #access: LocalIdentityAccessV1;
  readonly #artifactStore: ArtifactStoreV1;
  readonly #authorizeDownstream: KnowledgeGovernanceDownstreamAuthorizerV1 | undefined;

  constructor(options: PostgresKnowledgeGovernanceReadAdapterOptionsV1) {
    this.#db = options.db as unknown as Kysely<GovernanceReadDatabase>;
    this.#access = options.access;
    this.#artifactStore = options.artifactStore;
    this.#authorizeDownstream = options.authorizeDownstream;
  }

  async read(query: KnowledgeGovernanceReadQueryV1): Promise<KnowledgeGovernanceReadResultV1> {
    const parsed = KnowledgeGovernanceReadQueryV1Schema.safeParse(query);
    if (!parsed.success) {
      if (governanceRequestDenied(query)) {
        return failed(governanceError("AUTHORIZATION_DENIED", "knowledge-governance-read"));
      }
      return failed(governanceError("UNSUPPORTED_CONTRACT", "knowledge-governance-read"));
    }
    const valid = parsed.data;
    try {
      await this.#verify(valid);
      switch (valid.payload.operation) {
        case "list-definitions":
          return await this.#listDefinitions(valid);
        case "read-definition-revision":
          return await this.#readRevision(valid);
        case "read-definition-release":
          return await this.#readRelease(valid);
        case "current-release-set":
          return await this.#currentReleaseSet(valid);
      }
    } catch {
      return denied(valid.queryId);
    }
  }

  async #verify(query: KnowledgeGovernanceReadQueryV1): Promise<AuthorizationDecisionV1> {
    if (
      query.projectId !== query.authorization.projectId ||
      query.actorId !== query.authorization.actorId ||
      !query.authorization.grantedCapabilities.includes(
        MODULE_BRANCH_CAPABILITY_V1["knowledge-modeling.governance-read"],
      )
    ) {
      throw new Error("governance read authorization denied");
    }
    const decision = await this.#access.verify({
      authorizationContextRef: query.authorization.authorizationContextRef,
      invocationId: query.queryId,
      projectId: query.projectId,
      branch: "knowledge-modeling.governance-read",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: query.authorization.decidedAt,
    });
    if (decision.context.actorId !== query.actorId) {
      throw new Error("governance read authorization denied");
    }
    return decision;
  }

  async #listDefinitions(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
  ): Promise<KnowledgeGovernanceReadResultV1> {
    const payload = query.payload;
    if (payload.operation !== "list-definitions") return denied(query.queryId);
    const cursor = decodeCursor(payload.cursor);
    if (cursor === "invalid") return denied(query.queryId);
    const pageSize = payload.pageSize ?? 50;
    const definitions = await this.#db
      .selectFrom("business.knowledge_definitions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("definition_type", "=", payload.definitionType)
      .execute();
    const revisions = await this.#db
      .selectFrom("business.knowledge_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("definition_type", "=", payload.definitionType)
      .execute();
    const releases = await this.#db
      .selectFrom("business.knowledge_releases")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("definition_type", "=", payload.definitionType)
      .execute();
    const decisions = await this.#db
      .selectFrom("business.knowledge_release_decisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .execute();
    const links = await this.#db
      .selectFrom("business.knowledge_review_links")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .execute();
    const keyword = payload.keyword?.toLowerCase();
    const items: KnowledgeGovernanceListItemV1[] = [];
    for (const definition of definitions) {
      if (keyword !== undefined && !definition.definition_id.toLowerCase().includes(keyword)) {
        continue;
      }
      const definitionRevisions = revisions
        .filter((row) => row.definition_id === definition.definition_id)
        .sort((left, right) => asIso(right.recorded_at).localeCompare(asIso(left.recorded_at)));
      const definitionReleases = releases
        .filter((row) => row.definition_id === definition.definition_id)
        .sort((left, right) => asIso(right.recorded_at).localeCompare(asIso(left.recorded_at)));
      const latestRevision = definitionRevisions[0];
      const activeRelease = definitionReleases.find(
        (release) =>
          !decisions.some(
            (decision) =>
              decision.release_id === release.release_id && decision.decision === "deactivated",
          ),
      );
      const anyDeactivated = definitionReleases.some((release) =>
        decisions.some(
          (decision) =>
            decision.release_id === release.release_id && decision.decision === "deactivated",
        ),
      );
      const openLink =
        latestRevision === undefined
          ? undefined
          : links.find(
              (link) =>
                link.revision_id === latestRevision.revision_id &&
                link.review_decision_ref === null,
            );
      const lifecycleStatus: KnowledgeGovernanceLifecycleFilterV1 =
        activeRelease !== undefined
          ? "published"
          : anyDeactivated
            ? "deactivated"
            : openLink !== undefined
              ? "in-review"
              : "draft";
      if (payload.lifecycleStatus !== undefined && lifecycleStatus !== payload.lifecycleStatus) {
        continue;
      }
      const updatedAt = [
        ...definitionRevisions.map((row) => asIso(row.recorded_at)),
        ...definitionReleases.map((row) => asIso(row.recorded_at)),
        asIso(definitionRevisions[0]?.recorded_at ?? new Date(0)),
      ]
        .sort()
        .at(-1)!;
      items.push({
        definitionRef: definitionRefOf(definition),
        definitionType: definition.definition_type as KnowledgeDefinitionTypeV1,
        lifecycleStatus,
        ...(latestRevision === undefined
          ? {}
          : { currentRevisionRef: revisionRefOf(latestRevision) }),
        ...(activeRelease === undefined ? {} : { currentReleaseRef: releaseRefOf(activeRelease) }),
        updatedAt,
      });
    }
    const page = items.slice(cursor, cursor + pageSize);
    const next = cursor + pageSize < items.length ? encodeCursor(cursor + pageSize) : undefined;
    return {
      kind: "succeeded",
      result: {
        kind: "list-definitions",
        items: page,
        totalCount: items.length,
        ...(next === undefined ? {} : { nextCursor: next }),
      },
    };
  }

  async #readRevision(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
  ): Promise<KnowledgeGovernanceReadResultV1> {
    const payload = query.payload;
    if (payload.operation !== "read-definition-revision") return denied(query.queryId);
    const target = payload.knowledgeRevisionRef.reference;
    const revision = await this.#db
      .selectFrom("business.knowledge_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("revision_id", "=", target.entityId)
      .where("version_id", "=", target.versionId)
      .executeTakeFirst();
    if (revision === undefined) return denied(query.queryId);
    const linkRow = await this.#db
      .selectFrom("business.knowledge_review_links")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("revision_id", "=", revision.revision_id)
      .where("revision_version_id", "=", revision.version_id)
      .executeTakeFirst();
    const releaseRows = await this.#db
      .selectFrom("business.knowledge_releases")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("revision_id", "=", revision.revision_id)
      .where("revision_version_id", "=", revision.version_id)
      .execute();
    const revisionValue = parseKnowledgeRevision(revisionFromRow(revision));
    const linkValue =
      linkRow === undefined ? undefined : KnowledgeReviewLinkV1Schema.parse(linkFromRow(linkRow));
    const projection = deriveKnowledgeRevisionStatus({
      revision: revisionValue,
      ...(linkValue === undefined ? {} : { reviewLink: linkValue }),
      releaseRefs: releaseRows.map(releaseRefOf),
    });
    const body = await this.#readBody(
      query,
      revision.definition_type,
      revision.candidate_artifact_ref,
    );
    if (body === undefined) return denied(query.queryId);
    return {
      kind: "succeeded",
      result: {
        kind: "read-definition-revision",
        revisionRef: revisionRefOf(revision),
        definitionRef: definitionRefOf(revision),
        definitionType: revision.definition_type as KnowledgeDefinitionTypeV1,
        revisionStatus: projection.status as KnowledgeRevisionLifecycleStatusV1,
        evidenceReferences: revisionValue.evidenceReferences,
        body,
      },
    };
  }

  async #readRelease(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
  ): Promise<KnowledgeGovernanceReadResultV1> {
    const payload = query.payload;
    if (payload.operation !== "read-definition-release") return denied(query.queryId);
    const target = payload.knowledgeReleaseRef.reference;
    const release = await this.#db
      .selectFrom("business.knowledge_releases")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("release_id", "=", target.entityId)
      .where("version_id", "=", target.versionId)
      .executeTakeFirst();
    if (release === undefined) return denied(query.queryId);
    const revision = await this.#db
      .selectFrom("business.knowledge_revisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("revision_id", "=", release.revision_id)
      .where("version_id", "=", release.revision_version_id)
      .executeTakeFirst();
    if (revision === undefined) return denied(query.queryId);
    const decision = await this.#db
      .selectFrom("business.knowledge_release_decisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .where("release_id", "=", release.release_id)
      .executeTakeFirst();
    const revisionValue = parseKnowledgeRevision(revisionFromRow(revision));
    const body = await this.#readBody(
      query,
      revision.definition_type,
      revision.candidate_artifact_ref,
    );
    if (body === undefined) return denied(query.queryId);
    return {
      kind: "succeeded",
      result: {
        kind: "read-definition-release",
        releaseRef: releaseRefOf(release),
        definitionRef: definitionRefOf(release),
        definitionType: release.definition_type as KnowledgeDefinitionTypeV1,
        revisionRef: revisionRefOf(revision),
        effectiveFrom: asIso(release.effective_from),
        ...(decision === undefined ? {} : { deactivatedAt: asIso(decision.occurred_at) }),
        evidenceReferences: revisionValue.evidenceReferences,
        body,
      },
    };
  }

  async #currentReleaseSet(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
  ): Promise<KnowledgeGovernanceReadResultV1> {
    const payload = query.payload;
    if (payload.operation !== "current-release-set") return denied(query.queryId);
    const releases = await this.#db
      .selectFrom("business.knowledge_releases")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .execute();
    const decisions = await this.#db
      .selectFrom("business.knowledge_release_decisions")
      .selectAll()
      .where("project_id", "=", query.projectId)
      .execute();
    const required = payload.requiredDefinitionTypes;
    const latestByType = new Map<string, KnowledgeReleaseRow>();
    for (const release of [...releases].sort((left, right) =>
      asIso(left.recorded_at).localeCompare(asIso(right.recorded_at)),
    )) {
      if (required !== undefined && !required.includes(release.definition_type as never)) {
        continue;
      }
      latestByType.set(release.definition_type, release);
    }
    const members = [...latestByType.values()]
      .filter(
        (release) =>
          !decisions.some(
            (decision) =>
              decision.release_id === release.release_id && decision.decision === "deactivated",
          ),
      )
      .map((release) => ({
        definitionType: release.definition_type as KnowledgeDefinitionTypeV1,
        releaseRef: releaseRefOf(release),
      }));
    return {
      kind: "succeeded",
      result: { kind: "current-release-set", releases: members },
    };
  }

  async #readBody(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
    definitionType: string,
    candidateArtifactRef: unknown,
  ): Promise<KnowledgeGovernanceReadBodyV1 | undefined> {
    const purposeCode = governanceArtifactPurposeCodeV1(definitionType);
    if (purposeCode === undefined) return undefined;
    const artifactText = await this.#readArtifactText(query, candidateArtifactRef, purposeCode);
    if (artifactText === undefined) return undefined;
    let value: unknown;
    try {
      value = JSON.parse(artifactText);
    } catch {
      return undefined;
    }
    try {
      switch (definitionType) {
        case "process-model": {
          const parsed = IdentificationKnowledgePackageV1Schema.parse(value);
          if (parsed.definitionType !== "process-model") return undefined;
          return {
            definitionType: "process-model",
            nodes: parsed.nodes,
            dependencyEdges: parsed.dependencyEdges,
          };
        }
        case "risk-mechanism": {
          const parsed = IdentificationKnowledgePackageV1Schema.parse(value);
          if (parsed.definitionType !== "risk-mechanism") return undefined;
          return {
            definitionType: "risk-mechanism",
            processModelReleaseRef: parsed.processModelReleaseRef,
            mechanisms: parsed.mechanisms,
          };
        }
        case "structured-scoring-rule": {
          const parsed = StructuredScoringRuleDocumentV1Schema.parse(value);
          return {
            definitionType: "structured-scoring-rule",
            members: parsed.members.map((member) => ({
              rule: StructuredScoringRuleSchema.parse(member.rule),
              binding: {
                sourceVersionRef: member.binding.sourceVersionRef,
                evidenceReferences: member.binding.evidenceReferences,
              },
            })),
          };
        }
        case "applicable-rule-set": {
          const parsed = ApplicableRuleSetDocumentV1Schema.parse(value);
          return {
            definitionType: "applicable-rule-set",
            applicabilitySnapshotRef: parsed.applicabilitySnapshotRef,
            applicability: parsed.applicability,
            requiredAt: parsed.requiredAt,
            includedMembers: parsed.includedMembers.map((member) => ({
              ruleId: member.ruleId,
              ruleVersion: member.ruleVersion,
              releaseRef: member.releaseRef,
              revisionRef: member.revisionRef,
            })),
            decisions: parsed.decisions.map((decision) => ({
              ruleId: decision.ruleId,
              ruleVersion: decision.ruleVersion,
              decision: decision.decision,
              reasonCode: decision.reasonCode,
              matchedDimensions: decision.matchedDimensions,
              ...(decision.ruleReleaseRef === undefined
                ? {}
                : { ruleReleaseRef: decision.ruleReleaseRef }),
              ...(decision.ruleRevisionRef === undefined
                ? {}
                : { ruleRevisionRef: decision.ruleRevisionRef }),
            })),
          };
        }
        case "risk-matrix": {
          const parsed = RiskMatrixDocumentV1Schema.parse(value);
          return {
            definitionType: "risk-matrix",
            matrixId: parsed.content.matrixId,
            matrixVersion: parsed.content.matrixVersion,
            possibilityAxis: parsed.content.possibilityAxis,
            consequenceAxis: parsed.content.consequenceAxis,
            riskLevels: parsed.content.riskLevels,
            cells: parsed.content.cells,
          };
        }
        case "measure-library": {
          const parsed = MeasureLibraryDocumentV1Schema.parse(value);
          return {
            definitionType: "measure-library",
            measures: parsed.content.measures,
          };
        }
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  }

  /**
   * 定义正文的读取身份：按 `knowledge-modeling.governance-read` 单独签发，签不出就沿用
   * 调用方上下文。签发失败绝不降级成「当作有权限」——返回的上下文仍要过 C04 全部检查。
   */
  async #bodyReadAuthorization(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
    artifactRefValue: unknown,
  ): Promise<AuthorizationContextV1> {
    const authorize = this.#authorizeDownstream;
    if (authorize === undefined) return query.authorization;
    const reference =
      typeof artifactRefValue === "object" && artifactRefValue !== null
        ? (artifactRefValue as { readonly reference?: { readonly entityId?: unknown } }).reference
        : undefined;
    const entityId = typeof reference?.entityId === "string" ? reference.entityId : "unknown";
    return await authorize({
      branch: "knowledge-modeling.governance-read",
      invocationId: `${query.queryId}:body:${entityId}`,
      projectId: query.projectId,
      actorId: query.actorId,
      requestedAt: query.requestedAt,
    }).catch(() => query.authorization);
  }

  async #readArtifactText(
    query: Extract<KnowledgeGovernanceReadQueryV1, { kind: "governance-read" }>,
    artifactRefValue: unknown,
    purposeCode: string,
  ): Promise<string | undefined> {
    try {
      const handle = await this.#artifactStore.open(
        ArtifactReadRequestV1Schema.parse({
          schemaVersion: "1",
          requestId: `${query.queryId}:governance-body`,
          idempotencyKey: `${query.queryId}:governance-body`,
          artifactRef: artifactRefValue,
          projectId: query.projectId,
          actorId: query.actorId,
          requestedAt: query.requestedAt,
          // C04 判定读取的 `purposeCode` 必须与工件 manifest 完全相等，因此这里用该定义
          // 类型自己的用途码，而不是治理读分支的统一码；后者会让除播种类型外的全部正文
          // 关闭失败。用途码取自各类型既有常量，不读 manifest 再照抄。
          purposeCode,
          requiredCapability: "knowledge-modeling.read",
          authorization: await this.#bodyReadAuthorization(query, artifactRefValue),
        }),
      );
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of handle.content) {
        size += chunk.byteLength;
        if (size > 4 * 1024 * 1024) throw new RangeError("governance artifact exceeds read bound");
        chunks.push(chunk);
      }
      await handle.completed;
      const buffer = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(buffer);
    } catch {
      return undefined;
    }
  }
}

const revisionFromRow = (row: KnowledgeRevisionRow): unknown => ({
  revisionRef: revisionRefOf(row),
  definitionRef: definitionRefOf(row),
  projectId: row.project_id,
  definitionType: row.definition_type,
  candidateArtifactRef: row.candidate_artifact_ref,
  evidenceReferences: row.evidence_references,
  ...(row.base_release_ref === null ? {} : { baseReleaseRef: row.base_release_ref }),
  ...(row.base_revision_ref === null ? {} : { baseRevisionRef: row.base_revision_ref }),
  artifactIdentityDigest: row.artifact_identity_digest,
  commandId: row.command_id,
  actorId: row.actor_ref,
  authorizationContextRef: row.authorization_context_ref,
  occurredAt: asIso(row.occurred_at),
  recordedAt: asIso(row.recorded_at),
  ...(row.persisted_at === null ? {} : { persistedAt: asIso(row.persisted_at) }),
});

const linkFromRow = (row: KnowledgeReviewLinkRow): unknown => ({
  reviewAttemptId: row.review_attempt_id,
  projectId: row.project_id,
  revisionRef: row.revision_ref,
  reviewPolicyRef: row.review_policy_ref,
  validationSnapshotRef: row.validation_snapshot_ref,
  evidenceSnapshotRef: row.evidence_snapshot_ref,
  waitingRunRef: row.waiting_run_ref,
  ...(row.review_task_ref === null ? {} : { reviewTaskRef: row.review_task_ref }),
  ...(row.review_decision_ref === null ? {} : { reviewDecisionRef: row.review_decision_ref }),
  state: row.state,
  requestedBy: row.requested_by,
  authorizationContextRef: row.authorization_context_ref,
  requestedAt: asIso(row.requested_at),
  occurredAt: asIso(row.occurred_at),
  recordedAt: asIso(row.recorded_at),
  ...(row.persisted_at === null ? {} : { persistedAt: asIso(row.persisted_at) }),
});

export const createPostgresKnowledgeGovernanceReadAdapter = (
  options: PostgresKnowledgeGovernanceReadAdapterOptionsV1,
): KnowledgeGovernanceReadPortV1 => new PostgresKnowledgeGovernanceReadAdapter(options);
