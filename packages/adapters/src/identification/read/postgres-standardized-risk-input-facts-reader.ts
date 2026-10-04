import type { Kysely } from "kysely";

import {
  ACCESS_POLICY_REF_V1,
  AccessServiceError,
  type LocalIdentityAccessV1,
} from "@riskflow/core/access";
import type { JsonValue } from "@riskflow/core/persistence";
import { RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1 } from "@riskflow/core/risk-assessment/engine";
import {
  RiskInputFactsReadRequestV1Schema,
  RiskInputFactsV1Schema,
  type RiskInputFactsV1,
  type RiskInputFactsReadRequestV1,
  type RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import {
  EvidenceReferenceSchema,
  IdentifierSchema,
  type EvidenceReference,
} from "@riskflow/contracts/common";
import {
  MODULE_BRANCH_CAPABILITY_V1,
  ModuleErrorV1Schema,
  ReviewDecisionRefV1Schema,
  RouteDecisionRefV1Schema,
  SourceVersionRefV1Schema,
  SpatialScopeRefV1Schema,
  StandardizedRiskRecordRefV1Schema,
  type ModuleBranchV1,
  type ModuleErrorV1,
  type SpatialScopeRefV1,
  type SourceVersionRefV1,
} from "@riskflow/contracts/ports";
import { StandardizedRiskRecordEnvelopeSchema } from "@riskflow/contracts/records";

import { mapPostgresError } from "../../postgres/pool.js";
import type { PostgresDatabase } from "../../postgres/types.js";

/**
 * 标准化风险记录由识别验收域拥有（C22 写、C24 读）。评估只需要该记录已经成立的事实，
 * 因此本 reader 在 identification 所有权域内精确读取：只投影记录原有标量与原证据，
 * 不查询识别中间存储、不取「最新版本」、不补造历史行缺失的空间/来源/证据登记。
 */

const RECORDS_TABLE = "business.standardized_risk_records";
const STAGE_CODE_V1 = "risk-identification.read";
const DOCUMENT_TYPE_V1 = "standardized-risk-record";
const READ_BRANCH_V1 = RISK_ASSESSMENT_DOWNSTREAM_BRANCH_V1.riskInputFacts;

type TimestampColumn = Date | string;

interface StandardizedRiskRecordScopeRow {
  project_id: string;
  risk_record_id: string;
  version_id: string;
  risk_record_ref: JsonValue;
  payload: JsonValue;
  route_decision_ref: JsonValue | null;
  review_decision_ref: JsonValue | null;
  spatial_scope_refs: JsonValue | null;
  source_version_refs: JsonValue | null;
  evidence_references: JsonValue | null;
  created_at: TimestampColumn;
}

type StandardizedRiskInputFactsDatabaseV1 = PostgresDatabase & {
  "business.standardized_risk_records": StandardizedRiskRecordScopeRow;
};

const MAX_FIELD_EVIDENCE_V1 = 32;
const MAX_TOTAL_EVIDENCE_V1 = 256;

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
        // 只标识本接缝自身的边界，不指向任何受限记录。
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

export interface PostgresStandardizedRiskInputFactsReaderOptionsV1 {
  /** 传 `runtime.db` 即可；本 reader 只读 `business.standardized_risk_records`。 */
  readonly db: unknown;
  /** C06 当前授权复验：两阶段复验当前身份与记录已登记的空间/来源范围。 */
  readonly authorization: Pick<LocalIdentityAccessV1, "verify">;
  readonly now?: () => Date;
}

export const createPostgresStandardizedRiskInputFactsReader = (
  options: PostgresStandardizedRiskInputFactsReaderOptionsV1,
): RiskInputFactsReaderV1 => {
  const db = options.db as unknown as Kysely<StandardizedRiskInputFactsDatabaseV1>;
  const now = options.now ?? (() => new Date());

  const denied = (causalRunId: string, occurredAt: string): ModuleErrorV1 =>
    failure("AUTHORIZATION_DENIED", causalRunId, occurredAt);

  /**
   * 第一阶段只复验当前身份与工程，不携带目标范围；C06 收窄后的上下文必须仍覆盖原调用身份，
   * 否则不进入精确行查找，从而不通过存在性差异泄露记录。
   */
  const verifyIdentity = async (request: RiskInputFactsReadRequestV1): Promise<boolean> => {
    if (
      request.authorization.projectId === undefined ||
      request.authorization.actorId === undefined ||
      !request.authorization.grantedCapabilities.includes(
        MODULE_BRANCH_CAPABILITY_V1[READ_BRANCH_V1],
      )
    ) {
      return false;
    }
    const decision = await options.authorization.verify({
      authorizationContextRef: request.authorization.authorizationContextRef,
      invocationId: request.requestId,
      projectId: request.authorization.projectId,
      branch: READ_BRANCH_V1 as ModuleBranchV1,
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      requestedAt: request.requestedAt,
    });
    return decision.context.actorId === request.authorization.actorId;
  };

  /** 第二阶段按记录已登记的精确空间与来源范围复验；任何未覆盖项按授权失败关闭。 */
  const verifyScope = async (input: {
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
      if (!parsed.success) {
        return {
          kind: "failed",
          error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt),
        };
      }
      const request = parsed.data;
      if (request.riskInput.kind !== "standardized-risk-record") {
        return {
          kind: "failed",
          error: failure("UNSUPPORTED_CONTRACT", causalRunId, occurredAt),
        };
      }

      const identityVerified = await verifyCurrent(() => verifyIdentity(request));
      if (identityVerified !== true) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }

      const projectId = request.authorization.projectId;
      const recordRef = request.riskInput.reference;

      let row: StandardizedRiskRecordScopeRow | undefined;
      try {
        row = await db
          .selectFrom(RECORDS_TABLE)
          .selectAll()
          .where("project_id", "=", projectId)
          .where("risk_record_id", "=", recordRef.entityId)
          .executeTakeFirst();
      } catch (error) {
        throw mapPostgresError(error, `${STAGE_CODE_V1}.risk-input-facts`);
      }

      // 不存在、错版本、登记引用不符、验收事实缺席与缺历史作用域统一按授权失败收口，
      // 不披露记录存在性。
      if (row === undefined || row.version_id !== recordRef.versionId) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }
      const storedRef = StandardizedRiskRecordRefV1Schema.safeParse(row.risk_record_ref);
      if (
        !storedRef.success ||
        storedRef.data.reference.entityId !== recordRef.entityId ||
        storedRef.data.reference.versionId !== recordRef.versionId
      ) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }
      const envelope = StandardizedRiskRecordEnvelopeSchema.safeParse(row.payload);
      if (!envelope.success || envelope.data.riskRecordId !== row.risk_record_id) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }
      const accepted =
        (row.route_decision_ref !== null &&
          RouteDecisionRefV1Schema.safeParse(row.route_decision_ref).success) ||
        (row.review_decision_ref !== null &&
          ReviewDecisionRefV1Schema.safeParse(row.review_decision_ref).success);
      if (!accepted) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }
      const spatialScopeRefs =
        row.spatial_scope_refs === null
          ? undefined
          : SpatialScopeRefV1Schema.array().min(1).max(64).safeParse(row.spatial_scope_refs).data;
      const sourceVersionRefs =
        row.source_version_refs === null
          ? undefined
          : SourceVersionRefV1Schema.array().min(1).max(64).safeParse(row.source_version_refs).data;
      const evidenceReferences =
        row.evidence_references === null
          ? undefined
          : EvidenceReferenceSchema.array()
              .min(1)
              .max(MAX_TOTAL_EVIDENCE_V1)
              .safeParse(row.evidence_references).data;
      if (
        spatialScopeRefs === undefined ||
        sourceVersionRefs === undefined ||
        evidenceReferences === undefined
      ) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }
      const registeredSourceVersions = new Set(
        sourceVersionRefs.map((reference) =>
          JSON.stringify([reference.reference.entityId, reference.reference.versionId]),
        ),
      );
      if (
        evidenceReferences.some(
          (reference) =>
            !registeredSourceVersions.has(
              JSON.stringify([reference.sourceVersion.entityId, reference.sourceVersion.versionId]),
            ),
        )
      ) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }

      const scopeVerified = await verifyCurrent(() =>
        verifyScope({ request, spatialScopeRefs, sourceVersionRefs }),
      );
      if (scopeVerified !== true) {
        return { kind: "failed", error: denied(causalRunId, occurredAt) };
      }

      // 字段与证据整体预算：超界关闭失败，绝不截断出貌似完整的结果。
      if (
        evidenceReferences.length === 0 ||
        evidenceReferences.length > MAX_FIELD_EVIDENCE_V1 ||
        new Set(evidenceReferences.map(evidenceKey)).size !== evidenceReferences.length ||
        evidenceReferences.length > MAX_TOTAL_EVIDENCE_V1
      ) {
        return {
          kind: "failed",
          error: failure(
            "BUSINESS_BLOCKED",
            causalRunId,
            occurredAt,
            "risk-input-facts-evidence-overflow",
          ),
        };
      }

      const { record, compositeConfidence } = envelope.data;
      const fieldEvidence = [...evidenceReferences];
      const facts: RiskInputFactsV1 = RiskInputFactsV1Schema.parse({
        schemaVersion: "1",
        projectId,
        riskInput: request.riskInput,
        fields: [
          {
            documentType: DOCUMENT_TYPE_V1,
            fieldPath: ["record", "processNodeId"],
            value: record.processNodeId,
            evidenceReferences: fieldEvidence,
          },
          {
            documentType: DOCUMENT_TYPE_V1,
            fieldPath: ["record", "riskSource"],
            value: record.riskSource,
            evidenceReferences: fieldEvidence,
          },
          {
            documentType: DOCUMENT_TYPE_V1,
            fieldPath: ["record", "riskFactor"],
            value: record.riskFactor,
            evidenceReferences: fieldEvidence,
          },
          {
            documentType: DOCUMENT_TYPE_V1,
            fieldPath: ["record", "riskEvent"],
            value: record.riskEvent,
            evidenceReferences: fieldEvidence,
          },
          {
            documentType: DOCUMENT_TYPE_V1,
            fieldPath: ["record", "modelConfidence"],
            value: record.modelConfidence,
            evidenceReferences: fieldEvidence,
          },
          {
            documentType: DOCUMENT_TYPE_V1,
            fieldPath: ["compositeConfidence", "value"],
            value: compositeConfidence.value,
            evidenceReferences: fieldEvidence,
          },
        ],
        evidenceReferences: fieldEvidence,
      });
      return { kind: "succeeded", facts };
    },
  };
};
