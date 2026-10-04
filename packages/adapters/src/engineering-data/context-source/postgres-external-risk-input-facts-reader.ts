import { TextDecoder } from "node:util";

import type { Kysely } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import {
  ArtifactReadRequestV1Schema,
  ArtifactStoreError,
  type ArtifactStoreV1,
} from "@riskflow/core/artifacts";
import { ExternalRiskEventFactsArtifactV1Schema } from "@riskflow/core/engineering-data/context-source";
import type { JsonValue } from "@riskflow/core/persistence";
import { RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1 } from "@riskflow/core/risk-assessment/engine";
import {
  RiskInputFactsReadRequestV1Schema,
  RiskInputFactsV1Schema,
  type RiskInputFactsReadRequestV1,
  type RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  type EvidenceReference,
} from "@riskflow/contracts/common";
import {
  ContentArtifactRefV1Schema,
  ExternalRiskEventRefV1Schema,
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type SourceVersionRefV1,
  type SpatialScopeRefV1,
} from "@riskflow/contracts/ports";

import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

/**
 * 外部风险事件由工程数据源登记域拥有（C11）。历史登记允许任意 JSON 正文，本 reader 只在
 * 该正文满足 `ExternalRiskEventFactsArtifactV1Schema` 时把它投影成风险事实：身份逐项等于
 * 精确登记行，字段证据必须属于登记证据，源资料段资格再按 C11 自有来源事实核对。
 * 登记成功不等于可评估，非法正文按契约失败闭合，绝不从登记键、自由文案或最新资料补字段。
 */

const EVENTS_TABLE = "business.external_risk_events";
const SOURCE_VERSIONS_TABLE = "business.source_versions";
const SOURCE_SEGMENTS_TABLE = "business.source_segments";
const STAGE_CODE_V1 = "engineering-data.evidence-access";
const READ_BRANCH_V1 = RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.riskInputFacts;
const ARTIFACT_PURPOSE_CODE_V1 = "engineering-data.register-external-risk-event";
const MAX_ARTIFACT_BYTES_V1 = 1024 * 1024;
const MAX_TOTAL_EVIDENCE_V1 = 256;
const MAX_SCOPE_REFS_V1 = 64;

type TimestampColumn = Date | string;

interface ExternalRiskEventScopeRow {
  project_id: string;
  external_risk_event_id: string;
  version_id: string;
  external_risk_event_ref: JsonValue;
  external_source_entity_id: string;
  external_source_version_id: string;
  external_source_ref: JsonValue;
  external_event_key: string;
  event_artifact_ref: JsonValue;
  evidence_references: JsonValue;
  source_version_refs: JsonValue;
  spatial_scope_refs: JsonValue;
  occurred_at: TimestampColumn;
}

interface SourceVersionAccessRow {
  project_id: string;
  source_version_id: string;
  version_id: string;
  access_status: string;
}

interface SourceSegmentScopeRow {
  project_id: string;
  source_version_id: string;
  source_segment_id: string;
  spatial_scope_refs: JsonValue;
}

type ExternalRiskInputFactsDatabaseV1 = PostgresDatabase & {
  "business.external_risk_events": ExternalRiskEventScopeRow;
  "business.source_versions": SourceVersionAccessRow;
  "business.source_segments": SourceSegmentScopeRow;
};

const failure = (
  code: "AUTHORIZATION_DENIED" | "UNSUPPORTED_CONTRACT" | "BUSINESS_BLOCKED",
  causalRunId: string,
  occurredAt: string,
  blockerKind?: string,
): ModuleErrorV1 => {
  const common = { stageCode: STAGE_CODE_V1, occurredAt, causalRunId };
  switch (code) {
    case "AUTHORIZATION_DENIED":
      return ModuleErrorV1Schema.parse({
        ...common,
        code,
        category: "authorization",
        retryable: false,
        requiredCapability: MODULE_BRANCH_CAPABILITY_V1[READ_BRANCH_V1],
        authorizationPolicyRef: ACCESS_POLICY_REF_V1,
      });
    case "UNSUPPORTED_CONTRACT":
      return ModuleErrorV1Schema.parse({
        ...common,
        code,
        category: "technical",
        retryable: false,
        schemaVersion: "1",
      });
    default:
      return ModuleErrorV1Schema.parse({
        ...common,
        code,
        category: "business-blocked",
        retryable: false,
        blockerKind: blockerKind ?? "risk-input-facts-over-budget",
        // 只标识本接缝自身的边界，不指向任何受限事件。
        blockerRef: {
          kind: "content-artifact",
          reference: { entityId: "risk-input-facts-read-bound", versionId: "v1" },
        },
      });
  }
};

const evidenceKey = (reference: EvidenceReference): string =>
  JSON.stringify([
    reference.locator.sourceSegmentId,
    reference.sourceVersion.entityId,
    reference.sourceVersion.versionId,
  ]);

const refKey = (reference: { readonly entityId: string; readonly versionId: string }): string =>
  JSON.stringify([reference.entityId, reference.versionId]);

const boundedContent = async (content: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of content) {
    size += chunk.byteLength;
    if (size > MAX_ARTIFACT_BYTES_V1) throw new RangeError("event artifact exceeds read bound");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export interface PostgresExternalRiskInputFactsReaderOptionsV1 {
  /** 传 `runtime.db` 即可；只读 C11 自有登记表与来源事实表。 */
  readonly db: unknown;
  /** C06 当前授权复验端口：两阶段复验当前身份与事件已登记的空间/来源范围。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  /** C04 工件存储：事件正文只经 verified 有界读取，不使用最新来源或重算摘要。 */
  readonly artifactStore: ArtifactStoreV1;
  readonly now?: () => Date;
}

export const createPostgresExternalRiskInputFactsReader = (
  options: PostgresExternalRiskInputFactsReaderOptionsV1,
): RiskInputFactsReaderV1 => {
  const db = options.db as unknown as Kysely<ExternalRiskInputFactsDatabaseV1>;
  const now = options.now ?? (() => new Date());

  const verify = async (input: {
    readonly request: RiskInputFactsReadRequestV1;
    readonly spatialScopeRefs: readonly SpatialScopeRefV1[];
    readonly sourceVersionRefs: readonly SourceVersionRefV1[];
  }): Promise<boolean> => {
    const decision = await options.authorization.verify({
      authorizationContextRef: input.request.authorization.authorizationContextRef,
      invocationId: input.request.requestId,
      projectId: input.request.authorization.projectId,
      branch: READ_BRANCH_V1 as ModuleBranchV1,
      requestedSpatialScopeRefs: [...input.spatialScopeRefs],
      requestedSourceVersionRefs: [...input.sourceVersionRefs],
      requestedAt: input.request.requestedAt,
    });
    return decision.context.actorId === input.request.authorization.actorId;
  };

  /**
   * C06 拒绝或失效一律收敛为授权失败关闭，不落成存储错误：授权边界不是基础设施故障，
   * 也不允许把「已失效」与「读不到」混成同一种可重试信号。
   */
  const verifyCurrent = async (verify: () => Promise<boolean>): Promise<boolean | undefined> => {
    try {
      return await verify();
    } catch (error) {
      if (error instanceof AccessServiceError) return undefined;
      throw mapPostgresError(error, `${STAGE_CODE_V1}.risk-input-facts`);
    }
  };

  /** 源资料段证据按 C11 自有来源事实核对：工程、来源版本、可用资格与空间范围。 */
  const sourcesEligible = async (input: {
    readonly projectId: string;
    readonly evidence: readonly EvidenceReference[];
    readonly authorizedScopeIds: ReadonlySet<string>;
  }): Promise<boolean> => {
    for (const reference of input.evidence) {
      const sourceVersion = await db
        .selectFrom(SOURCE_VERSIONS_TABLE)
        .select(["access_status"])
        .where("project_id", "=", input.projectId)
        .where("source_version_id", "=", reference.sourceVersion.entityId)
        .where("version_id", "=", reference.sourceVersion.versionId)
        .executeTakeFirst();
      if (sourceVersion === undefined || sourceVersion.access_status !== "ready") return false;
      const segment = await db
        .selectFrom(SOURCE_SEGMENTS_TABLE)
        .select(["spatial_scope_refs"])
        .where("project_id", "=", input.projectId)
        .where("source_version_id", "=", reference.sourceVersion.entityId)
        .where("source_segment_id", "=", reference.locator.sourceSegmentId)
        .executeTakeFirst();
      const scopes =
        segment === undefined
          ? undefined
          : SpatialScopeRefV1Schema.array()
              .min(1)
              .max(MAX_SCOPE_REFS_V1)
              .safeParse(segment.spatial_scope_refs).data;
      if (scopes === undefined || scopes.length === 0) return false;
      if (scopes.some((scope) => !input.authorizedScopeIds.has(scope.reference.entityId))) {
        return false;
      }
    }
    return true;
  };

  return {
    async readRiskInputFacts(input) {
      const occurredAt = now().toISOString();
      const rawRequestId =
        typeof input === "object" && input !== null
          ? (input as { readonly requestId?: unknown }).requestId
          : undefined;
      const requestId = IdentifierSchema.safeParse(rawRequestId);
      const causalRunId = requestId.success ? requestId.data : STAGE_CODE_V1;
      const parsed = RiskInputFactsReadRequestV1Schema.safeParse(input);
      if (!parsed.success || parsed.data.riskInput.kind !== "external-risk-event") {
        return { kind: "failed", error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt) };
      }
      const request = parsed.data;
      const projectId = request.authorization.projectId;
      if (
        !request.authorization.grantedCapabilities.includes(
          MODULE_BRANCH_CAPABILITY_V1[READ_BRANCH_V1],
        )
      ) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }

      // 第一阶段只复验当前身份，不携带目标范围，避免通过存在性差异泄露事件。
      const identityVerified = await verifyCurrent(() =>
        verify({ request, spatialScopeRefs: [], sourceVersionRefs: [] }),
      );
      if (identityVerified !== true) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }

      const eventRef = request.riskInput.reference;
      let row: ExternalRiskEventScopeRow | undefined;
      try {
        row = await db
          .selectFrom(EVENTS_TABLE)
          .selectAll()
          .where("project_id", "=", projectId)
          .where("external_risk_event_id", "=", eventRef.entityId)
          .executeTakeFirst();
      } catch (error) {
        throw mapPostgresError(error, `${STAGE_CODE_V1}.risk-input-facts`);
      }
      // 不存在、错版本与登记引用不符统一按授权失败收口，不披露正文或存在性。
      if (row === undefined || row.version_id !== eventRef.versionId) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }
      const storedRef = ExternalRiskEventRefV1Schema.safeParse(row.external_risk_event_ref);
      if (
        !storedRef.success ||
        refKey(storedRef.data.reference) !== refKey(eventRef) ||
        storedRef.data.kind !== "external-risk-event"
      ) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }
      const artifactRef = ContentArtifactRefV1Schema.safeParse(row.event_artifact_ref);
      const evidenceReferences = EvidenceReferenceSchema.array()
        .min(1)
        .max(MAX_TOTAL_EVIDENCE_V1)
        .safeParse(row.evidence_references).data;
      const spatialScopeRefs = SpatialScopeRefV1Schema.array()
        .min(1)
        .max(MAX_SCOPE_REFS_V1)
        .safeParse(row.spatial_scope_refs).data;
      const sourceVersionRefs = SourceVersionRefV1Schema.array()
        .min(1)
        .max(MAX_SCOPE_REFS_V1)
        .safeParse(row.source_version_refs).data;
      if (
        !artifactRef.success ||
        evidenceReferences === undefined ||
        spatialScopeRefs === undefined ||
        sourceVersionRefs === undefined
      ) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }
      const registeredSourceVersions = new Set(
        sourceVersionRefs.map((reference) => refKey(reference.reference)),
      );
      if (
        evidenceReferences.some(
          (reference) => !registeredSourceVersions.has(refKey(reference.sourceVersion)),
        )
      ) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }

      // 第二阶段按事件已登记的精确空间与来源范围复验。
      const scopeVerified = await verifyCurrent(() =>
        verify({ request, spatialScopeRefs, sourceVersionRefs }),
      );
      if (scopeVerified !== true) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }

      let body: unknown;
      try {
        const handle = await options.artifactStore.open(
          ArtifactReadRequestV1Schema.parse({
            schemaVersion: "1",
            requestId: `${causalRunId}:event-artifact`,
            idempotencyKey: `${causalRunId}:event-artifact`,
            artifactRef: artifactRef.data,
            projectId,
            actorId: request.authorization.actorId,
            requestedAt: request.requestedAt,
            purposeCode: ARTIFACT_PURPOSE_CODE_V1,
            requiredCapability: MODULE_BRANCH_CAPABILITY_V1[READ_BRANCH_V1],
            authorization: request.authorization,
          }),
        );
        const bytes = await boundedContent(handle.content);
        const receipt = await handle.verified;
        if (
          refKey(receipt.artifactRef.reference) !== refKey(artifactRef.data.reference) ||
          receipt.content.hash.value !== handle.manifest.content.hash.value ||
          receipt.content.byteLength !== handle.manifest.content.byteLength
        ) {
          return {
            kind: "failed",
            error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt),
          };
        }
        try {
          body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        } catch {
          return {
            kind: "failed",
            error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt),
          };
        }
      } catch (error) {
        if (error instanceof ArtifactStoreError) {
          if (error.code === "ARTIFACT_ACCESS_DENIED") {
            return {
              kind: "failed",
              error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt),
            };
          }
          throw mapPostgresError(error, `${STAGE_CODE_V1}.risk-input-facts`);
        }
        // 读取预算越界是业务阻断，不截断出貌似完整的结果。
        if (error instanceof RangeError) {
          return {
            kind: "failed",
            error: failure(
              "BUSINESS_BLOCKED",
              causalRunId,
              occurredAt,
              "risk-input-facts-read-overflow",
            ),
          };
        }
        throw mapPostgresError(error, `${STAGE_CODE_V1}.risk-input-facts`);
      }

      // 登记成功不等于可评估：正文不满足结构化契约时闭合失败，不从登记事实推导字段。
      const artifact = ExternalRiskEventFactsArtifactV1Schema.safeParse(body);
      if (!artifact.success) {
        return { kind: "failed", error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt) };
      }
      if (
        artifact.data.projectId !== projectId ||
        artifact.data.externalEventKey !== row.external_event_key ||
        refKey(artifact.data.externalSourceRef) !==
          JSON.stringify([row.external_source_entity_id, row.external_source_version_id])
      ) {
        return { kind: "failed", error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt) };
      }

      const registeredEvidence = new Map(
        evidenceReferences.map((reference) => [evidenceKey(reference), reference]),
      );
      if (registeredEvidence.size !== evidenceReferences.length) {
        return { kind: "failed", error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt) };
      }
      for (const field of artifact.data.fields) {
        for (const reference of field.evidenceReferences) {
          if (!registeredEvidence.has(evidenceKey(reference))) {
            return {
              kind: "failed",
              error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt),
            };
          }
        }
      }

      const authorizedScopeIds = new Set(spatialScopeRefs.map((scope) => scope.reference.entityId));
      let eligible: boolean;
      try {
        eligible = await sourcesEligible({
          projectId,
          evidence: evidenceReferences,
          authorizedScopeIds,
        });
      } catch (error) {
        throw mapPostgresError(error, `${STAGE_CODE_V1}.risk-input-facts`);
      }
      if (!eligible) {
        return { kind: "failed", error: failure("AUTHORIZATION_DENIED", causalRunId, occurredAt) };
      }

      return {
        kind: "succeeded",
        facts: RiskInputFactsV1Schema.parse({
          schemaVersion: "1",
          projectId,
          riskInput: request.riskInput,
          fields: artifact.data.fields,
          evidenceReferences,
        }),
      };
    },
  };
};
