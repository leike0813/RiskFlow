import type { ModuleErrorV1 } from "@riskflow/contracts/ports";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import { ArtifactPutCommandV1Schema } from "@riskflow/core/artifacts";
import {
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1,
  RiskCandidateModelOutputV1Schema,
  type RiskCandidateEmbeddingRequestV1,
  type RiskCandidateModelPortV1,
  type RiskCandidateModelRequestV1,
  type RiskCandidateModelUsageV1,
  type RiskCandidateRepairFeedbackV1,
} from "@riskflow/core/identification/candidate-finalization";
import {
  asModelGatewayError,
  mapModelGatewayErrorToModuleError,
  type EmbeddingRequestV1,
  type ModelGatewayPortV1,
  type ModelUsageV1,
  type StructuredCompletionRequestV1,
} from "@riskflow/core/model";
import type { VersionReference } from "@riskflow/contracts/common";

/**
 * RI-S57 专用模型节点（design D-04）：只使用 C10 结构化补全与嵌入，不注册 C08 任务类型，
 * 也不把原始模型响应或向量写进任何登记表——原始响应引用来自 C10，向量正文只经 C04。
 */

/** 生成指令固定为模块常量；请求只携带冻结五项上下文的结构化投影，不内联资料正文。 */
const RISK_CANDIDATE_MODEL_INSTRUCTION =
  "Generate risk candidates strictly from the frozen five-part identification context in the user message. Return only the structured output defined by the frozen output schema.";

/** 冻结能力：C05 只为本次运行签发该能力；不因授权顺序改用其它能力，也不扩大范围。 */
const RISK_CANDIDATE_REQUIRED_CAPABILITY_V1 = "risk-identification.run" as const;

/** 向量工件 purpose code：来自 C22 冻结常量，本模块不新增 purpose。 */
const RISK_CANDIDATE_VECTOR_PURPOSE_CODE_V1 =
  RISK_CANDIDATE_FINALIZATION_PURPOSE_CODES_V1.riskEventVector;

/** 嵌入请求上界：输入字节与批条目数的硬上限，实际值只按本次文本收窄。 */
const EMBEDDING_MAX_INPUT_BYTES_V1 = 1_048_576;
const EMBEDDING_MAX_BATCH_ITEMS_V1 = 4096;

const textEncoder = new TextEncoder();

const byteLengthOf = (value: unknown): number =>
  textEncoder.encode(JSON.stringify(value)).byteLength;

/** 五项上下文投影：只给模型真正需要的五组冻结依据，不带工程标识、引用与资料正文。 */
const projectModelContext = (
  context: RiskCandidateModelRequestV1["modelContext"],
): Record<string, unknown> => ({
  processNode: context.processNode,
  stateParameters: context.stateParameters,
  forceDependencies: context.forceDependencies,
  mechanisms: context.mechanisms,
  retrievalEvidence: context.retrievalEvidence,
});

/** 修正消息只有结构化失败码与父候选身份；没有自由正文，也没有上一轮候选内容。 */
const projectRepairFeedback = (repair: RiskCandidateRepairFeedbackV1): Record<string, unknown> => ({
  attempt: repair.attempt,
  failures: repair.failures,
  parentCandidates: repair.parentCandidates.map((candidate) => ({
    candidateId: candidate.candidateId,
    candidateVersion: candidate.candidateVersion,
  })),
});

const usageOf = (usage: ModelUsageV1, outputBytes: number): RiskCandidateModelUsageV1 => ({
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  totalTokens: usage.totalTokens ?? 0,
  outputBytes,
});

/** 由组合根注入的 RI-S57 运行依赖：C10 网关子集、C04 工件入口与时钟。 */
export interface RiskCandidateModelRuntimeOptionsV1 {
  readonly gateway: Pick<ModelGatewayPortV1, "completeStructured" | "embed">;
  readonly artifactStore: ArtifactStoreV1;
  readonly now?: () => Date;
}

/**
 * 组装 RI-S57 专用模型节点：任何网关错误经 C10 映射为结构化 C02 错误并**关闭失败**；
 * 非网关错误不在此吞掉，也不回退旧候选、部分上下文或默认值。
 */
export const createRiskCandidateModelRuntime = (
  options: RiskCandidateModelRuntimeOptionsV1,
): RiskCandidateModelPortV1 => {
  const now = options.now ?? (() => new Date());

  const mapGatewayFailure = (
    error: unknown,
    context: {
      readonly causalRunId: string;
      readonly authorizationPolicyRef: VersionReference;
    },
  ): { readonly kind: "failed"; readonly error: ModuleErrorV1 } => ({
    kind: "failed",
    error: mapModelGatewayErrorToModuleError(asModelGatewayError(error), {
      causalRunId: context.causalRunId,
      requiredCapability: RISK_CANDIDATE_REQUIRED_CAPABILITY_V1,
      authorizationPolicyRef: context.authorizationPolicyRef,
    }),
  });

  return {
    generateCandidates: async (input: RiskCandidateModelRequestV1) => {
      const startedAt = now().getTime();
      const request: StructuredCompletionRequestV1 = {
        schemaVersion: "1",
        invocationId: input.invocationId,
        idempotencyKey: `${input.invocationId}:generate`,
        issuedAt: input.requestedAt,
        projectId: input.projectId,
        actorId: input.actorId,
        authorization: input.authorization,
        requiredCapability: RISK_CANDIDATE_REQUIRED_CAPABILITY_V1,
        modelDeploymentRef: input.modelDeploymentRef,
        budgetPolicyRef: input.budgetPolicyRef,
        deadlineAt: input.deadlineAt,
        parentArtifactRefs: [],
        evidenceReferences: [],
        promptTemplateRef: input.promptTemplateRef,
        outputSchemaRef: input.outputSchemaRef,
        messages: [
          { role: "system", content: RISK_CANDIDATE_MODEL_INSTRUCTION },
          { role: "user", content: JSON.stringify(projectModelContext(input.modelContext)) },
          ...(input.repair === undefined
            ? []
            : [
                {
                  role: "user" as const,
                  content: JSON.stringify(projectRepairFeedback(input.repair)),
                },
              ]),
        ],
        maxOutputTokens: input.maxOutputTokens,
      };
      try {
        const result = await options.gateway.completeStructured(
          request,
          RiskCandidateModelOutputV1Schema,
        );
        return {
          kind: "succeeded",
          outputs: result.value.candidates,
          invocationId: result.invocationId,
          rawResponseRef: {
            kind: "diagnostic-artifact",
            reference: result.rawResponseRef.reference,
          },
          usage: usageOf(result.usage, byteLengthOf(result.value)),
          elapsedMs: Math.max(0, now().getTime() - startedAt),
        };
      } catch (error: unknown) {
        return mapGatewayFailure(error, {
          causalRunId: input.invocationId,
          authorizationPolicyRef: input.modelDeploymentRef,
        });
      }
    },

    embedRiskEvents: async (input: RiskCandidateEmbeddingRequestV1) => {
      let inputBytes = 0;
      for (const text of input.texts) inputBytes += textEncoder.encode(text).byteLength;
      const request: EmbeddingRequestV1 = {
        schemaVersion: "1",
        invocationId: input.invocationId,
        idempotencyKey: `${input.invocationId}:embed`,
        issuedAt: input.requestedAt,
        projectId: input.projectId,
        actorId: input.actorId,
        authorization: input.authorization,
        requiredCapability: RISK_CANDIDATE_REQUIRED_CAPABILITY_V1,
        modelDeploymentRef: input.embeddingDeploymentRef,
        budgetPolicyRef: input.budgetPolicyRef,
        deadlineAt: input.deadlineAt,
        parentArtifactRefs: [],
        evidenceReferences: [],
        texts: [...input.texts],
        maxInputBytes: Math.min(EMBEDDING_MAX_INPUT_BYTES_V1, Math.max(1, inputBytes)),
        maxBatchItems: Math.min(EMBEDDING_MAX_BATCH_ITEMS_V1, Math.max(1, input.texts.length)),
      };
      const artifactId = `${input.invocationId}:${RISK_CANDIDATE_VECTOR_PURPOSE_CODE_V1}`;
      try {
        const result = await options.gateway.embed(request);
        const persisted = await options.artifactStore.put(
          ArtifactPutCommandV1Schema.parse({
            schemaVersion: "1",
            commandId: artifactId,
            idempotencyKey: artifactId,
            projectId: input.projectId,
            actorId: input.actorId,
            issuedAt: input.requestedAt,
            authorization: input.authorization,
            requiredCapability: RISK_CANDIDATE_REQUIRED_CAPABILITY_V1,
            artifactId,
            artifactKind: "content",
            purposeCode: RISK_CANDIDATE_VECTOR_PURPOSE_CODE_V1,
            mediaType: "application/json",
            parentArtifactRefs: [],
            evidenceReferences: [],
            additionalSpatialScopeRefs: [],
            additionalSourceAccessGrantRefs: [],
          }),
          (async function* () {
            yield textEncoder.encode(
              JSON.stringify({
                vectors: result.vectors,
                dimensions: result.dimensions,
                modelDeploymentRef: result.modelDeploymentRef,
                serverBuildRef: result.serverBuildRef,
                modelVersionRef: result.modelVersionRef,
              }),
            );
          })(),
        );
        return {
          kind: "succeeded",
          vectors: result.vectors,
          dimensions: result.dimensions,
          embeddingArtifactRef: persisted.artifactRef,
          deploymentRef: input.embeddingDeploymentRef,
          rawResponseRef: {
            kind: "diagnostic-artifact",
            reference: result.rawResponseRef.reference,
          },
        };
      } catch (error: unknown) {
        return mapGatewayFailure(error, {
          causalRunId: input.invocationId,
          authorizationPolicyRef: input.embeddingDeploymentRef,
        });
      }
    },
  };
};
