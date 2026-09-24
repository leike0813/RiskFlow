/**
 * 合成样本说明：本文件全部线程标识、引用与版本都是本文件内构造的合成输入，不代表生产数据，
 * 也不得作为生产回退来源。
 *
 * C03 checkpointer 校验层回归：用真实 `@langchain/langgraph` StateGraph（普通边 + 条件边 +
 * 多父节点屏障）与真实 PostgreSQL checkpointer 走完整 `put`/`putWrites`/`getTuple` 往返，证明
 * 协议/调度控制通道（`__start__`、`branch:*`、`join:*`）被跳过，而未知业务键与非法写入仍然失败
 * 闭合、既有引用校验不变。
 *
 * 关于 `putWrites` 前的顺序恢复：LangGraph 不保证父检查点在任务写回时已经落库（input tick 没有
 * 同步屏障，默认 `durability: "async"` 下 `put` 与其后的 `putWrites` 并发执行），而 checkpointer
 * 的 `putWrites` 会先读目标检查点再校验，可能读到尚未落库的检查点并以 `CHECKPOINT_INCONSISTENT`
 * （stage `checkpointer.writes`）拒绝。用例在包装层把 `putWrites` 串行化到此前已发出的 `put`
 * 之后，只恢复真实语义要求的顺序，不放宽任何校验；该竞态本身属于持久化时序问题，另行报告。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { Annotation, END, START, StateGraph } from "@langchain/langgraph";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";
import {
  IdentificationGraphStateV1Schema,
  type IdentificationGraphStateV1,
} from "@riskflow/contracts/workflows";

import {
  setupPostgresCheckpointer,
  type PostgresCheckpointer,
} from "../../../../../packages/adapters/test/identification/graph/wiring.js";
import {
  startPostgresFixture,
  type PostgresTestFixture,
} from "../../../../../packages/adapters/test/postgres/fixture.js";

/** 协议通道：LangGraph 固定通道名，与业务状态无关。 */
const langGraphProtocolChannels: Record<string, true> = {
  __error__: true,
  __scheduled__: true,
  __interrupt__: true,
  __resume__: true,
  __pregel_tasks: true,
  __start__: true,
};

/** 调度控制通道：`branch:to:<node>` 与 `join:<a>+<b>:<node>` 由节点名派生，只承载调度信息。 */
const langGraphControlChannelPrefixes = ["branch:", "join:"] as const;

const isLangGraphRuntimeChannel = (channel: string): boolean =>
  langGraphProtocolChannels[channel] === true ||
  langGraphControlChannelPrefixes.some((prefix) => channel.startsWith(prefix));

const businessChannelsOf = (channelValues: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(channelValues).filter(([channel]) => !isLangGraphRuntimeChannel(channel)),
  );

const versionOf = (entityId: string) => ({ entityId, versionId: "v1" });

/** 合法起始状态：满足 `IdentificationGraphStateV1Schema` 的 `lifecycleStateRefine`（非终态无 resultRef）。 */
const legalIdentificationState = (threadId: string): IdentificationGraphStateV1 =>
  IdentificationGraphStateV1Schema.parse({
    schemaVersion: "1",
    graphVersion: versionOf("identification-graph"),
    parentRiskFlowRunRef: { kind: "workflow-run", reference: versionOf(`${threadId}-parent`) },
    runRef: { kind: "workflow-run", reference: versionOf(`${threadId}-run`) },
    threadId,
    triggerType: "manual",
    triggerReasonCode: "manual-trigger",
    authorizationContextRef: {
      kind: "authorization-context",
      reference: versionOf(`${threadId}-authorization`),
    },
    preparationSnapshotRef: {
      kind: "identification-preparation-snapshot",
      reference: versionOf(`${threadId}-preparation`),
    },
    status: "running",
    stage: "I0",
    agentTaskRefs: [],
    acceptedRiskRecordRefs: [],
    reviewTaskRefs: [],
    rejectedGroupRefs: [],
    failedWorkItemRefs: [],
  });

const graphChannels = Annotation.Root({
  schemaVersion: Annotation<IdentificationGraphStateV1["schemaVersion"]>(),
  graphVersion: Annotation<IdentificationGraphStateV1["graphVersion"]>(),
  parentRiskFlowRunRef: Annotation<IdentificationGraphStateV1["parentRiskFlowRunRef"]>(),
  runRef: Annotation<IdentificationGraphStateV1["runRef"]>(),
  threadId: Annotation<IdentificationGraphStateV1["threadId"]>(),
  triggerType: Annotation<IdentificationGraphStateV1["triggerType"]>(),
  triggerReasonCode: Annotation<IdentificationGraphStateV1["triggerReasonCode"]>(),
  authorizationContextRef: Annotation<IdentificationGraphStateV1["authorizationContextRef"]>(),
  preparationSnapshotRef: Annotation<IdentificationGraphStateV1["preparationSnapshotRef"]>(),
  status: Annotation<IdentificationGraphStateV1["status"]>(),
  stage: Annotation<IdentificationGraphStateV1["stage"]>(),
  workPlanRef: Annotation<IdentificationGraphStateV1["workPlanRef"]>(),
  candidateSetRef: Annotation<IdentificationGraphStateV1["candidateSetRef"]>(),
  agentTaskRefs: Annotation<IdentificationGraphStateV1["agentTaskRefs"]>(),
  acceptedRiskRecordRefs: Annotation<IdentificationGraphStateV1["acceptedRiskRecordRefs"]>(),
  reviewTaskRefs: Annotation<IdentificationGraphStateV1["reviewTaskRefs"]>(),
  rejectedGroupRefs: Annotation<IdentificationGraphStateV1["rejectedGroupRefs"]>(),
  failedWorkItemRefs: Annotation<IdentificationGraphStateV1["failedWorkItemRefs"]>(),
  resultRef: Annotation<IdentificationGraphStateV1["resultRef"]>(),
});

type GraphChannelsV1 = typeof graphChannels.State;

const stateChannelNames = new Set(Object.keys(graphChannels.spec));

/** 条件边：运行中状态同时进入 `beta` 与 `gamma`，两者汇入 `delta` 形成多父节点屏障。 */
const routeAfterAlpha = (state: GraphChannelsV1): string[] =>
  state.status === "running" ? ["beta", "gamma"] : ["gamma"];

/** START → alpha（普通边）→ 条件边分流 beta/gamma → 屏障汇合 delta → END。 */
const buildControlChannelGraph = (checkpointer: PostgresCheckpointer) =>
  new StateGraph(graphChannels)
    .addNode("alpha", (): Partial<GraphChannelsV1> => ({ stage: "I1" }))
    .addNode("beta", (): Partial<GraphChannelsV1> => ({
      workPlanRef: { kind: "identification-work-plan", reference: versionOf("work-plan") },
    }))
    .addNode("gamma", (): Partial<GraphChannelsV1> => ({
      candidateSetRef: {
        kind: "identification-candidate-set",
        reference: versionOf("candidate-set"),
      },
    }))
    .addNode("delta", (): Partial<GraphChannelsV1> => ({
      stage: "I9",
      status: "completed",
      resultRef: { kind: "identification-run-result", reference: versionOf("run-result") },
    }))
    .addEdge(START, "alpha")
    .addConditionalEdges("alpha", routeAfterAlpha, ["beta", "gamma"])
    .addEdge(["beta", "gamma"], "delta")
    .addEdge("delta", END)
    .compile({ checkpointer });

type PutArguments = Parameters<PostgresCheckpointer["put"]>;
type PutWritesArguments = Parameters<PostgresCheckpointer["putWrites"]>;

/**
 * 包装真实 checkpointer：记录每次 `put`/`putWrites` 的通道名，作为控制通道出现的证据。
 *
 * 同时把 `putWrites` 串行化到此前已发出的 `put` 之后：LangGraph 不保证父检查点在任务写回时已经
 * 落库（input tick 没有同步屏障，默认 `durability: "async"` 下 `put` 与其后的 `putWrites` 并发
 * 执行），而 checkpointer 的 `putWrites` 会先读目标检查点再校验，可能读到尚未落库的检查点并以
 * `CHECKPOINT_INCONSISTENT`（stage `checkpointer.writes`）拒绝。这里只按真实语义要求恢复顺序，
 * 不放宽任何校验；该竞态本身属于 checkpointer/持久化时序问题，不在本用例断言范围内。
 */
const recordCheckpointChannels = (checkpointer: PostgresCheckpointer) => {
  const putChannels: string[][] = [];
  const writeChannels: string[] = [];
  const startedPuts: Promise<unknown>[] = [];
  const put = checkpointer.put.bind(checkpointer);
  const putWrites = checkpointer.putWrites.bind(checkpointer);
  checkpointer.put = async (...args: PutArguments) => {
    putChannels.push(Object.keys(args[1].channel_values));
    const started = put(...args);
    startedPuts.push(started);
    return await started;
  };
  checkpointer.putWrites = async (...args: PutWritesArguments) => {
    writeChannels.push(...args[1].map(([channel]) => channel));
    // 只做顺序恢复：`putWrites` 自身的失败仍由真实实现抛出。
    await Promise.allSettled([...startedPuts]);
    return await putWrites(...args);
  };
  return {
    putChannels,
    writeChannels,
    restore: () => {
      checkpointer.put = put;
      checkpointer.putWrites = putWrites;
    },
  };
};

type CheckpointTupleV1 = NonNullable<Awaited<ReturnType<PostgresCheckpointer["getTuple"]>>>;

interface GraphRoundTripV1 {
  readonly config: {
    readonly configurable: { readonly thread_id: string; readonly checkpoint_ns: string };
  };
  readonly state: IdentificationGraphStateV1;
  readonly tuple: CheckpointTupleV1 & { metadata: NonNullable<CheckpointTupleV1["metadata"]> };
  readonly putChannels: readonly string[][];
  readonly writeChannels: readonly string[];
}

const runControlChannelRoundTrip = async (
  checkpointer: PostgresCheckpointer,
  threadId: string,
): Promise<GraphRoundTripV1> => {
  const recorder = recordCheckpointChannels(checkpointer);
  const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
  try {
    const result = await buildControlChannelGraph(checkpointer).invoke(
      legalIdentificationState(threadId),
      { ...config, durability: "sync" },
    );
    const tuple = await checkpointer.getTuple(config);
    const metadata = tuple?.metadata;
    if (tuple === undefined || metadata === undefined) {
      throw new Error("真实 StateGraph 往返未落库带元数据的检查点");
    }
    return {
      config,
      state: IdentificationGraphStateV1Schema.parse(result),
      tuple: { ...tuple, metadata },
      putChannels: [...recorder.putChannels],
      writeChannels: [...recorder.writeChannels],
    };
  } finally {
    recorder.restore();
  }
};

describe("C03 checkpointer 协议与调度控制通道", () => {
  let fixture: PostgresTestFixture | undefined;
  let checkpointer: PostgresCheckpointer | undefined;
  let roundTrip: GraphRoundTripV1 | undefined;
  const unavailableReferenceIds = new Set<string>();
  const validateReference = (reference: ContractReferenceV1): boolean =>
    !("reference" in reference) || !unavailableReferenceIds.has(reference.reference.entityId);
  const threadId = "identification-control-channel";

  beforeAll(async () => {
    fixture = await startPostgresFixture();
    checkpointer = await setupPostgresCheckpointer({ ...fixture.checkpointer, validateReference });
    roundTrip = await runControlChannelRoundTrip(checkpointer, threadId);
  }, 300_000);

  afterAll(async () => {
    await checkpointer?.end().catch(() => undefined);
    await fixture?.close().catch(() => undefined);
  }, 120_000);

  it("真实 StateGraph 走完整 put/putWrites/getTuple 往返后仍严格解析为识别状态", async () => {
    const run = roundTrip!;
    expect(run.state).toMatchObject({ status: "completed", stage: "I9", threadId });
    expect(run.putChannels.length).toBeGreaterThan(0);
    expect(run.writeChannels.length).toBeGreaterThan(0);

    const tuple = run.tuple;
    expect(typeof tuple.config.configurable?.checkpoint_id).toBe("string");
    const persistedChannels = tuple.checkpoint.channel_values;
    const persistedBusinessChannels = businessChannelsOf(persistedChannels);

    // 落库通道集合 = 状态字段通道 + 协议/调度控制通道，没有第三种通道。
    expect(
      Object.keys(persistedChannels).filter(
        (channel) => !stateChannelNames.has(channel) && !isLangGraphRuntimeChannel(channel),
      ),
    ).toEqual([]);
    // 严格解析（`strictObject`：未知业务键会解析失败）并等于图返回的终态。
    expect(IdentificationGraphStateV1Schema.parse(persistedBusinessChannels)).toEqual(run.state);
  }, 300_000);

  it("真实 StateGraph 确实产生 branch: 与 join: 调度控制通道", async () => {
    const run = roundTrip!;
    const observedChannels = [...run.putChannels.flat(), ...run.writeChannels];

    // 首个输入检查点把整份输入写入 START 通道（协议通道白名单的由来）。
    expect(run.putChannels.some((channels) => channels.includes("__start__"))).toBe(true);
    // 条件边按节点名派生 `branch:to:<node>`：alpha 经条件边分流到 beta 与 gamma。
    expect(observedChannels).toEqual(
      expect.arrayContaining(["branch:to:alpha", "branch:to:beta", "branch:to:gamma"]),
    );
    // 多父节点屏障（`addEdge([beta, gamma], delta)`）派生 `join:<a>+<b>:<node>`：屏障通道在编译期
    // 创建，beta 与 gamma 都向同一通道写入，因此该通道至少出现在两次 putWrites 中。
    const joinChannel = "join:beta+gamma:delta";
    expect(observedChannels).toEqual(expect.arrayContaining([joinChannel]));
    expect(
      run.writeChannels.filter((channel) => channel === joinChannel).length,
    ).toBeGreaterThanOrEqual(2);
  }, 300_000);

  it("未知业务键与非法写入仍以 CHECKPOINT_INCONSISTENT 失败闭合", async () => {
    const run = roundTrip!;
    const checkpoint = run.tuple.checkpoint;
    const savedConfig = run.tuple.config;

    // 正例对照：同一配置与同一检查点上的合法写入被接受，确保下面的拒绝来自校验而非检查点缺失。
    await expect(
      checkpointer!.putWrites(savedConfig, [["stage", "I1"]], "control-write"),
    ).resolves.toBeUndefined();

    await expect(
      checkpointer!.put(
        run.config,
        {
          ...checkpoint,
          channel_values: { ...checkpoint.channel_values, unexpectedBusinessField: true },
        },
        run.tuple.metadata,
        checkpoint.channel_versions,
      ),
    ).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.graph-state",
    });

    await expect(
      checkpointer!.putWrites(savedConfig, [["status", "not-a-run-status"]], "illegal-value-write"),
    ).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.writes",
    });

    await expect(
      checkpointer!.putWrites(
        savedConfig,
        [["unexpectedBusinessField", true]],
        "illegal-channel-write",
      ),
    ).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.writes",
    });
  }, 300_000);

  it("合法状态仍可读写，未授权引用仍被既有引用校验拒绝", async () => {
    const run = roundTrip!;
    const savedConfig = run.tuple.config;
    // 正例：合法状态上的合法写入与读取仍被接受。
    await expect(
      checkpointer!.putWrites(savedConfig, [["stage", "I1"]], "legal-write"),
    ).resolves.toBeUndefined();
    await expect(checkpointer!.getTuple(run.config)).resolves.toBeDefined();

    // 跨工程/未授权引用：注入的校验位对状态中的 runRef 返回不可用。
    unavailableReferenceIds.add(`${threadId}-run`);
    await expect(checkpointer!.getTuple(run.config)).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.reference",
    });
    await expect(
      checkpointer!.putWrites(
        savedConfig,
        [["resultRef", run.state.resultRef]],
        "unauthorized-ref",
      ),
    ).rejects.toMatchObject({
      code: "CHECKPOINT_INCONSISTENT",
      stage: "checkpointer.reference",
    });
    unavailableReferenceIds.delete(`${threadId}-run`);

    await expect(checkpointer!.getTuple(run.config)).resolves.toBeDefined();
  }, 300_000);
});
