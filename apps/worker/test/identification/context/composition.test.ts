import { describe, expect, it, vi } from "vitest";

import { AgentTaskDefinitionRegistry } from "@riskflow/core/agent-runtime";
import { RETRIEVAL_REVIEW_TASK_TYPE } from "@riskflow/core/identification/context";
import type { KnowledgeRetrievalQueryV1 } from "@riskflow/contracts/ports";

import { createIdentificationContextComposition } from "../../../src/identification/context/index.js";
import { AgentRuntimeRunner } from "../../../src/agent-runtime/index.js";
import type { AgentTaskExecutionStoreV1 } from "@riskflow/adapters/agent-runtime";

import {
  ACTOR,
  NODE_ID,
  PROJECT,
  TIMESTAMP,
  SYNTHETIC_SAMPLE_NOTICE,
  authorization,
  inputSnapshotRef,
  makeServiceHarness,
  reviewPolicy,
  taskRef,
  versionRef,
  workItemRef,
} from "./fixture.js";

const hybridQuery = () =>
  ({
    queryId: `${NODE_ID}:retrieval-baseline`,
    projectId: PROJECT,
    actorId: ACTOR,
    requestedAt: TIMESTAMP,
    authorization: authorization(),
    kind: "hybrid-evidence",
    payload: {
      inputSnapshotRef,
      workItemRef,
      retrievalPolicyRef: versionRef("retrieval-policy"),
    },
  }) as unknown as KnowledgeRetrievalQueryV1;

const relationshipQuery = () =>
  ({
    queryId: `${NODE_ID}:relationship-context`,
    projectId: PROJECT,
    actorId: ACTOR,
    requestedAt: TIMESTAMP,
    authorization: authorization(),
    kind: "relationship-context",
    payload: { inputSnapshotRef, workItemRef },
  }) as unknown as KnowledgeRetrievalQueryV1;

describe("C21 identification context composition", () => {
  it("registers retrieval-review into the shared registry and routes both branches through one delegate", async () => {
    const harness = makeServiceHarness();
    const registry = new AgentTaskDefinitionRegistry();
    const c20Calls: unknown[] = [];
    const c20 = {
      retrieve: vi.fn(async (query: KnowledgeRetrievalQueryV1) => {
        c20Calls.push(query);
        return {
          kind: "succeeded" as const,
          result: { knowledgeQueryResultRef: harness.payload.knowledgeQueryResultRef },
        };
      }),
    };
    const composition = createIdentificationContextComposition({
      db: {},
      transactionUnit: harness.ports.transactionUnit as never,
      artifactStore: harness.ports.artifactStore as never,
      inputReader: harness.ports.inputReader as never,
      authorization: harness.ports.authorization as never,
      knowledgeReader: harness.ports.knowledgeReader as never,
      hybridPolicy: harness.ports.hybridPolicy as never,
      hybridStore: harness.ports.hybridStore,
      retrievalService: c20 as never,
      taskReader: harness.ports.taskReader,
      reviewPolicy: reviewPolicy(),
      registry,
      now: () => new Date(TIMESTAMP),
    });

    // 共享 C08 registry 里只注册一个 `retrieval-review` 定义，且工具白名单固定两项。
    const definition = registry.get(RETRIEVAL_REVIEW_TASK_TYPE);
    expect(composition.modelContextReader.readExact).toBeTypeOf("function");
    expect(definition.metadata.taskType).toBe(RETRIEVAL_REVIEW_TASK_TYPE);
    expect(definition.metadata.allowedToolRefs).toEqual([
      versionRef("tool-read-frozen"),
      versionRef("tool-resupplement"),
    ]);
    expect(definition.metadata.resultFamilies).toEqual(["retrieval-artifact-set"]);

    // hybrid 分支原样交给 C20；relationship 分支由 C21 处理，不重复委派。
    const hybrid = hybridQuery();
    const hybridResult = await composition.retrievalDelegate.retrieve(hybrid);
    expect(hybridResult.kind).toBe("succeeded");
    expect(c20Calls).toEqual([hybrid]);
    expect(c20Calls[0]).toBe(hybrid);
    // relationship 分支由 C21 处理：查询在 C21 端口上被观测到，且失败码来自 C21 收口而非 C20 的 UNSUPPORTED_CONTRACT。
    const relationship = relationshipQuery();
    const relationshipResult = await composition.retrievalDelegate.retrieve(relationship);
    expect(harness.ports.inputReaderCalls).toContain(relationship.queryId);
    expect(relationshipResult.kind).toBe("failed");
    if (relationshipResult.kind === "failed") {
      expect(relationshipResult.error.stageCode.startsWith("identification-context.")).toBe(true);
    }
    expect(c20Calls).toHaveLength(1);

    // 冻结查询输入窄读使用工作项冻结文本与同一策略，不换工程/版本。
    const read = await composition.queryInputReader.readExact({
      refs: {
        inputSnapshotRef,
        workItemRef,
        retrievalPolicyRef: versionRef("retrieval-policy"),
      },
      projectId: PROJECT,
      queryId: NODE_ID,
      actorId: ACTOR,
      requestedAt: TIMESTAMP,
      authorization: authorization(),
    });
    expect(read.kind).toBe("succeeded");
    if (read.kind !== "succeeded") throw new Error("frozen input read must succeed");
    expect(read.input.queryText).toBe("变径空间扩挖 受力依赖");
    expect(read.input.projectId).toBe(PROJECT);
    expect(read.input.refs.workItemRef).toEqual(workItemRef);

    // 共享 runner 复用同一个 registry/工件存储与 C21 模型步，不产生第二 claim 循环。
    const store = {} as unknown as AgentTaskExecutionStoreV1;
    const shared = composition.createSharedRunner({
      store,
      workerId: "worker-1",
      leaseDurationMs: 30_000,
      maxConcurrentTasks: 1,
      now: () => TIMESTAMP,
    });
    expect(shared).toBeInstanceOf(AgentRuntimeRunner);
    expect(typeof shared.runOnce).toBe("function");
    expect(composition.modelStep.renderModelStep).toBeTypeOf("function");
    expect(composition.modelStep.interpretModelStep).toBeTypeOf("function");
    expect(SYNTHETIC_SAMPLE_NOTICE).toBe("合成样本、待甲方复核");
    void taskRef();
  });

  it("fails closed when a required dependency is missing", () => {
    const harness = makeServiceHarness();
    expect(() =>
      createIdentificationContextComposition({
        db: {},
        transactionUnit: harness.ports.transactionUnit as never,
        artifactStore: harness.ports.artifactStore as never,
        inputReader: undefined as never,
        authorization: harness.ports.authorization as never,
        knowledgeReader: harness.ports.knowledgeReader as never,
        hybridPolicy: harness.ports.hybridPolicy as never,
        hybridStore: harness.ports.hybridStore,
        retrievalService: harness.ports.retrievalService as never,
        taskReader: harness.ports.taskReader,
        reviewPolicy: reviewPolicy(),
        registry: new AgentTaskDefinitionRegistry(),
      }),
    ).toThrow(TypeError);
  });
});
