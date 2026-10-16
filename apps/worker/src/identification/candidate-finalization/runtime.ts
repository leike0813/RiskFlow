import type { ModuleCapabilityV1, ModuleErrorV1 } from "@riskflow/contracts/ports";
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
  type ModelGatewayErrorV1,
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

/** 能力由操作固定，生成与合并分别使用对应分支授权。 */
const RISK_CANDIDATE_REQUIRED_CAPABILITY_V1 = "risk-identification.run" as const;
const RISK_CANDIDATE_EMBEDDING_CAPABILITY_V1 = "risk-identification.finalize" as const;

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

/** 只替换失败候选，顺序与领域服务的父候选映射一致。 */
const projectRepairFeedback = (repair: RiskCandidateRepairFeedbackV1) => {
  const parentCandidates = repair.parentCandidates
    .filter((candidate) =>
      repair.failures.some(
        (failure) =>
          failure.candidateId === candidate.candidateId &&
          failure.candidateVersion === candidate.candidateVersion,
      ),
    )
    .map(({ candidateId, candidateVersion, output }) => ({
      candidateId,
      candidateVersion,
      output,
    }));
  return {
    attempt: repair.attempt,
    failures: repair.failures,
    parentCandidates,
    // 响应级格式错误没有待替换父候选：不约束替换数量，只反馈稳定原因码。
    requiredCandidateCount: parentCandidates.length === 0 ? undefined : parentCandidates.length,
    ...(repair.outputError === undefined ? {} : { outputError: repair.outputError }),
  };
};

const usageOf = (usage: ModelUsageV1, outputBytes: number): RiskCandidateModelUsageV1 => ({
  inputTokens: usage.inputTokens ?? 0,
  outputTokens: usage.outputTokens ?? 0,
  totalTokens: usage.totalTokens ?? 0,
  outputBytes,
});

/** D-10：输出错误的真实用量来自网关对已保存响应的实际计量，缺失计量时如实记 0。 */
const errorUsageOf = (counts: ModelGatewayErrorV1["counts"]): RiskCandidateModelUsageV1 => {
  const inputTokens = counts?.inputTokens ?? 0;
  const outputTokens = counts?.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    outputBytes: counts?.responseBytes ?? 0,
  };
};

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
      readonly requiredCapability: ModuleCapabilityV1;
    },
  ): { readonly kind: "failed"; readonly error: ModuleErrorV1 } => ({
    kind: "failed",
    error: mapModelGatewayErrorToModuleError(asModelGatewayError(error), {
      causalRunId: context.causalRunId,
      requiredCapability: context.requiredCapability,
      authorizationPolicyRef: context.authorizationPolicyRef,
    }),
  });

  return {
    generateCandidates: async (input: RiskCandidateModelRequestV1) => {
      const startedAt = now().getTime();
      const repair = input.repair === undefined ? undefined : projectRepairFeedback(input.repair);
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
          {
            role: "user",
            content: JSON.stringify({
              ...projectModelContext(input.modelContext),
              maxCandidates: input.budget.maxCandidates,
            }),
          },
          ...(repair === undefined
            ? []
            : [
                {
                  role: "user" as const,
                  content: JSON.stringify(repair),
                },
              ]),
        ],
        maxOutputTokens: input.maxOutputTokens,
      };
      try {
        const candidates = RiskCandidateModelOutputV1Schema.shape.candidates.max(
          input.budget.maxCandidates,
        );
        const requiredCandidateCount = repair?.requiredCandidateCount;
        const result = await options.gateway.completeStructured(
          request,
          RiskCandidateModelOutputV1Schema.extend({
            candidates:
              requiredCandidateCount === undefined
                ? candidates
                : candidates.length(requiredCandidateCount),
          }),
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
        const failure = asModelGatewayError(error);
        // D-10：JSON/Schema 输出错误是可修正结构错误，携带原响应引用与真实用量交回原有
        // 修正循环；传输、授权、来源资格等失败仍按原分类关闭。
        if (
          failure.code === "MODEL_OUTPUT_SCHEMA_INVALID" &&
          failure.rawResponseRef !== undefined
        ) {
          return {
            kind: "output-schema-invalid",
            invocationId: failure.invocationId,
            rawResponseRef: {
              kind: "diagnostic-artifact" as const,
              reference: failure.rawResponseRef.reference,
            },
            usage: errorUsageOf(failure.counts),
            elapsedMs: Math.max(0, now().getTime() - startedAt),
          };
        }
        return mapGatewayFailure(failure, {
          causalRunId: input.invocationId,
          authorizationPolicyRef: input.modelDeploymentRef,
          requiredCapability: RISK_CANDIDATE_REQUIRED_CAPABILITY_V1,
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
        requiredCapability: RISK_CANDIDATE_EMBEDDING_CAPABILITY_V1,
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
            requiredCapability: RISK_CANDIDATE_EMBEDDING_CAPABILITY_V1,
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
          requiredCapability: RISK_CANDIDATE_EMBEDDING_CAPABILITY_V1,
        });
      }
    },
  };
};
