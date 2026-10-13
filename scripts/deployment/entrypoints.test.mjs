/**
 * C37 D-22：交付取证的 CLI 入口必须指向真实存在的脚本。
 *
 * 入口脚本名曾指向不存在的文件（`smoke.mjs`/`benchmark.mjs`）或把子命令当作清单路径
 * （`release.mjs verify`），结果是取证命令在任何机器上都以 ENOENT 失败，无法区分
 * 「命令坏了」与「交付输入缺件」。这里锁住「package.json 里每个交付 CLI 都解析到真实文件」。
 */
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdtemp, mkdir, rm, writeFile, symlink, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

import { describe, expect, it, vi } from "vitest";
import deploymentConfig from "../../deployment/config.example.json" with { type: "json" };
import {
  createDeploymentAuthorizedArtifactStoreV1,
  createDeploymentAuthorizedModelGatewayV1,
  createDeploymentAuthorizationScopeV1,
  createDeploymentRuntimeAuthorizationV1,
  createDeploymentCheckpointValidatorV1,
  createDeploymentScoringGovernanceV1,
  resolveDeploymentPoliciesV1,
  loadDeploymentRetrievalDatasetsV1,
  createDeploymentRetrievalReportWriterV1,
  loadDeploymentFoundationInputV1,
  createDeploymentFoundationV1,
  createDeploymentGraphsV1,
  createDeploymentApiV1,
  createDeploymentSystemOperationsV1,
  createDeploymentAgentRunnerV1,
  createDeploymentWorkerRuntimeV1,
  createDeploymentWorkerV1,
  mainDeploymentV1,
  deploymentConnectionV1,
} from "./start.mjs";
import { OutboxDispatchRegistryV1, OUTBOX_CONSUMER_NAMES_V1 } from "./events.mjs";
import { HybridRetrievalAcceptanceReportV1Schema } from "../../packages/core/dist/retrieval/index.js";
import { AccessServiceError } from "../../packages/core/dist/access/index.js";
import { identificationRunIdentityFor } from "../../apps/worker/dist/index.js";
import { structuredRequest, testRequestBase } from "../../packages/adapters/test/model/fixture.ts";
import { HTTP_COOKIE_NAME_V1 } from "../../apps/api/dist/index.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

describe("真实 Worker 生命周期接线", () => {
  it("启动 CLI 在连库前拒绝维护角色与未知参数", async () => {
    await expect(mainDeploymentV1(["--role", "provision", "--config", "unused"])).rejects.toThrow();
    await expect(mainDeploymentV1(["--unknown"])).rejects.toThrow();
  });
  const setup = (events = []) => {
    const registry = new OutboxDispatchRegistryV1();
    const receipt = {
      resultRef: { kind: "workflow-run", reference: { entityId: "run", versionId: "v1" } },
      replayed: false,
    };
    for (const [type, name] of Object.entries(OUTBOX_CONSUMER_NAMES_V1))
      if (name !== "no-background-consumer") registry.register(type, name, async () => receipt);
    const outbox = {
      claimBatch: vi.fn(async () => ({ events })),
      acknowledge: vi.fn(async () => ({ status: "published" })),
      recordFailure: vi.fn(async () => ({ status: "pending" })),
      close: vi.fn(async () => {}),
    };
    const host = {
      foundation: {
        config: {
          ...deploymentConfig,
          worker: { ...deploymentConfig.worker, pollMs: 1, drainTimeoutMs: 10, maxConcurrency: 2 },
        },
      },
      close: vi.fn(async () => {}),
    };
    const runner = { runOnce: vi.fn(async () => ({ processedTasks: 0 })) };
    const worker = createDeploymentWorkerRuntimeV1({ host, outbox, runner, registry });
    return { worker, outbox, runner, host, registry };
  };
  const claim = (type, id = "event") => ({
    eventId: id,
    event: { eventType: type, eventId: id },
    leaseOwner: "worker",
    leaseToken: `lease-${id}`,
    leaseUntil: new Date(Date.now() + 30_000).toISOString(),
  });
  it("沿冻结投递策略 claim，后台及显式无消费者事件均在回执后 ack", async () => {
    const test = setup([
      claim("engineering.inputs-ready.v1"),
      claim("assessment.recorded.v1", "read-only"),
    ]);
    expect((await test.worker.runOnce())[1]).toBe(2);
    expect(test.outbox.claimBatch).toHaveBeenCalledWith({
      policy: deploymentConfig.outbox,
      leaseOwner: deploymentConfig.instanceId,
    });
    expect(test.outbox.acknowledge).toHaveBeenCalledTimes(2);
    expect(test.outbox.recordFailure).not.toHaveBeenCalled();
    expect(await test.worker.close()).toMatchObject({ settled: true });
    await test.worker.close();
    expect(test.outbox.close).toHaveBeenCalledTimes(1);
  });
  it("未知事件记录失败且拒绝本轮，过期或失效租约不确认", async () => {
    const unknown = setup([claim("unknown.v1")]);
    await expect(unknown.worker.runOnce()).rejects.toThrow();
    expect(unknown.outbox.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: "UNKNOWN_OUTBOX_EVENT" }),
    );
    expect(unknown.outbox.acknowledge).not.toHaveBeenCalled();
    await unknown.worker.close();
    const expired = claim("assessment.recorded.v1");
    expired.leaseUntil = new Date(0).toISOString();
    const test = setup([expired, claim("assessment.recorded.v1", "lost")]);
    test.outbox.acknowledge.mockRejectedValueOnce({ code: "OUTBOX_LEASE_LOST" });
    expect((await test.worker.runOnce())[1]).toBe(0);
    expect(test.outbox.acknowledge).toHaveBeenCalledTimes(1);
    expect(test.outbox.recordFailure).not.toHaveBeenCalled();
    await test.worker.close();
  });
  it("消费者技术失败保留原失败/重投身份", async () => {
    const test = setup([claim("engineering.inputs-ready.v1")]);
    test.registry.dispatch = async () => {
      throw new Error("technical failure");
    };
    expect((await test.worker.runOnce())[1]).toBe(0);
    expect(test.outbox.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "event",
        leaseToken: "lease-event",
        policy: deploymentConfig.outbox,
      }),
    );
    expect(test.outbox.acknowledge).not.toHaveBeenCalled();
    await test.worker.close();
  });
  it("模型未结束仍处理事件，限时 drain 不释放仍在用的基础资源", async () => {
    const test = setup([claim("assessment.recorded.v1")]);
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    test.runner.runOnce.mockImplementation(() => pending);
    const run = test.worker.runOnce();
    await vi.waitFor(() => expect(test.outbox.acknowledge).toHaveBeenCalledTimes(1));
    expect(await test.worker.close()).toMatchObject({ settled: false });
    expect(test.outbox.close).not.toHaveBeenCalled();
    expect(test.host.close).not.toHaveBeenCalled();
    release({ processedTasks: 0 });
    await run;
    expect(await test.worker.close()).toMatchObject({ settled: true });
    await expect(test.worker.runOnce()).rejects.toThrow();
  });
});

describe("生产 checkpointer 基础连接", () => {
  it("三图装配拒绝维护角色并在连接前核对独立凭据", async () => {
    await expect(createDeploymentGraphsV1({ role: "provision" })).rejects.toThrow(
      "DEPLOYMENT_GRAPH_ROLE_INVALID",
    );
    await expect(
      createDeploymentGraphsV1({
        role: "api",
        config: deploymentConfig,
        secrets: {},
        policies: { downstreamAuthorization: {} },
        finalMigrationVersion: "000058",
      }),
    ).rejects.toThrow("DEPLOYMENT_DATABASE_SECRET_MISSING");
  });
  it.each(["api", "worker"])("%s 缺引用校验或独立密码时在连接前拒绝", async (role) => {
    const input = {
      config: deploymentConfig,
      secrets: {},
      role,
      finalMigrationVersion: "000058",
    };
    await expect(createDeploymentFoundationV1(input)).rejects.toThrow(
      "DEPLOYMENT_CHECKPOINT_VALIDATOR_REQUIRED",
    );
    await expect(
      createDeploymentFoundationV1({ ...input, validateCheckpointReference: async () => false }),
    ).rejects.toThrow("DEPLOYMENT_DATABASE_SECRET_MISSING");
  });

  it("业务与检查点角色各自读取自己的密码", () => {
    const config = deploymentConfig;
    const secrets = Object.fromEntries(
      ["appRoleName", "workerRoleName", "checkpointerRoleName"].map((key) => [
        config.database.rolePasswordSecretIds[key],
        `synthetic-${key}`,
      ]),
    );
    for (const [role, key] of [
      ["api", "appRoleName"],
      ["worker", "workerRoleName"],
      ["checkpointer", "checkpointerRoleName"],
    ]) {
      expect(deploymentConnectionV1(config, secrets, role)).toMatchObject({
        user: config.database[key],
        password: secrets[config.database.rolePasswordSecretIds[key]],
        database: config.database.name,
      });
    }
    delete secrets[config.database.rolePasswordSecretIds.checkpointerRoleName];
    expect(() => deploymentConnectionV1(config, secrets, "checkpointer")).toThrow(
      "DEPLOYMENT_DATABASE_SECRET_MISSING",
    );
  });
});

describe("生产检查点引用校验", () => {
  const setup = (kind = "identification") => {
    const authorization = structuredClone(testRequestBase.authorization);
    authorization.grantedCapabilities = [
      kind === "identification" ? "risk-identification.run" : "workflow.start",
    ];
    const version = (kind, entityId) => ({ kind, reference: { entityId, versionId: "v1" } });
    const graphVersion = { entityId: "graph", versionId: "v1" };
    const parentRiskFlowRunRef = version("workflow-run", "parent");
    const preparationSnapshotRef = version("identification-preparation-snapshot", "preparation");
    const identity =
      kind === "identification"
        ? identificationRunIdentityFor({
            projectId: authorization.projectId,
            parentRiskFlowRunRef,
            preparationSnapshotRef,
            graphVersion,
          })
        : { runRef: version("workflow-run", "assessment"), threadId: "assessment-thread" };
    const state = {
      schemaVersion: "1",
      graphVersion,
      ...identity,
      ...(kind === "riskFlow" ? {} : { parentRiskFlowRunRef }),
      authorizationContextRef: authorization.authorizationContextRef,
      status: "running",
      stage: kind === "riskFlow" ? "assessment" : kind === "identification" ? "I0" : "A0",
      ...(kind === "riskFlow" ? {} : { agentTaskRefs: [], reviewTaskRefs: [] }),
      ...(kind === "identification"
        ? {
            triggerType: "manual",
            triggerReasonCode: "manual",
            preparationSnapshotRef,
            acceptedRiskRecordRefs: [],
            rejectedGroupRefs: [],
            failedWorkItemRefs: [],
          }
        : kind === "riskFlow"
          ? { entryMode: "assess", assessmentRunRefs: [], waitingRefs: [] }
          : { entryMode: "assess", warningRecordRefs: [], warningResponseTaskRefs: [] }),
    };
    const runtimeContext = {
      schemaVersion: "1",
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      ...identity,
      authorization,
      invocationId: "issued-invocation",
    };
    const world = {
      state,
      runtimeContext,
      version,
      now: new Date("2030-01-01T00:00:00.000Z"),
      authorized: true,
      accepted: true,
      moduleAccepted: true,
      moduleReads: 0,
      source: {
        context: authorization,
        invocationId: runtimeContext.invocationId,
        branch: kind === "identification" ? "risk-identification.plan" : "workflow.start-run",
        sourceVersionRefs: [],
      },
      entry: {
        kind: "assessment-preparation",
        assessmentPreparationSnapshotRef: version("assessment-preparation-snapshot", "entry"),
      },
    };
    const moduleProof = async () => {
      world.moduleReads += 1;
      return world.moduleAccepted;
    };
    const providers = {
      access: {
        readDeploymentAuthorizationSource: async ({
          authorizationContextRef,
          projectId,
          actorId,
        }) =>
          projectId === authorization.projectId &&
          actorId === authorization.actorId &&
          JSON.stringify(authorizationContextRef) ===
            JSON.stringify(authorization.authorizationContextRef)
            ? world.source
            : undefined,
        verify: async () => {
          if (!world.authorized) throw new Error("revoked");
          return { context: authorization };
        },
      },
      transactionUnit: { readWorkflowRunBinding: async () => world.accepted },
      policies: {
        resolveProject: () => ({
          binding: {
            graphVersions: {
              identification: graphVersion,
              assessment: graphVersion,
              riskFlow: graphVersion,
            },
          },
        }),
      },
      deploymentAuthorization: {
        readDownstreamContext: async ({ branch }) => ({
          context: authorization,
          invocationId: "original-downstream",
          branch,
        }),
      },
      identificationGraph: {
        verifyCheckpointReference: moduleProof,
        verifyCheckpointWaitingReference: moduleProof,
      },
      dataCleaningStore: { verifyPreparationReference: moduleProof },
      recommendation: {
        verifyRecommendationCandidateReference: moduleProof,
        verifyCheckpointReference: moduleProof,
      },
      riskAssessment: { verifyCheckpointReference: moduleProof },
      warning: { verifyCheckpointReference: moduleProof },
      responseLifecycle: { verifyCheckpointReference: moduleProof },
      calibration: { verifyCheckpointReference: moduleProof },
      agentTasks: { verifyCheckpointReference: moduleProof },
      reviewTasks: { verifyCheckpointReference: moduleProof },
      candidateProof: { verifyCheckpointReference: moduleProof },
      workflow: {
        verifyCheckpointDomainReference: moduleProof,
        verifyCheckpointWaitingReference: moduleProof,
        verifyCheckpointReference: moduleProof,
        registrationStore: { readAssessmentEntrySnapshot: async () => world.entry },
      },
      now: () => world.now,
    };
    world.validate = createDeploymentCheckpointValidatorV1(providers);
    world.context = (operation = "put") => ({ operation, state, runtimeContext });
    world.providers = providers;
    return world;
  };

  it.each(["put", "put-writes", "get", "list"])(
    "%s 核对原运行、授权和领域证明",
    async (operation) => {
      const world = setup();
      const context = world.context(operation);
      for (const reference of [
        world.state.runRef,
        world.state.parentRiskFlowRunRef,
        world.state.authorizationContextRef,
        world.state.preparationSnapshotRef,
        world.version("identification-work-plan", "plan"),
      ]) {
        expect(await world.validate(reference, context)).toBe(true);
      }
      world.moduleAccepted = false;
      expect(await world.validate(world.version("identification-work-plan", "plan"), context)).toBe(
        false,
      );
    },
  );

  it.each([
    "missing",
    "actor",
    "project",
    "thread",
    "run",
    "graph",
    "invocation",
    "source",
    "receipt",
    "revoked",
    "preparation",
  ])("%s 不一致时不能进行领域读取", async (cause) => {
    const world = setup();
    const context = world.context();
    if (cause === "missing") delete context.runtimeContext;
    if (cause === "actor") world.runtimeContext.actorId = "another-actor";
    if (cause === "project") world.runtimeContext.projectId = "another-project";
    if (cause === "thread") world.runtimeContext.threadId = "another-thread";
    if (cause === "run") world.runtimeContext.runRef = world.version("workflow-run", "another-run");
    if (cause === "graph") world.state.graphVersion = { entityId: "graph", versionId: "another" };
    if (cause === "invocation") world.runtimeContext.invocationId = "unissued";
    if (cause === "source")
      world.source = {
        ...world.source,
        context: {
          ...world.source.context,
          decidedAt: "2030-01-02T00:00:00.000Z",
        },
      };
    if (cause === "receipt") world.accepted = false;
    if (cause === "revoked") world.authorized = false;
    if (cause === "preparation")
      world.state.preparationSnapshotRef = world.version(
        "identification-preparation-snapshot",
        "another-preparation",
      );
    expect(await world.validate(world.version("identification-work-plan", "plan"), context)).toBe(
      false,
    );
    expect(world.moduleReads).toBe(0);
  });

  it("工作项须由图状态冻结计划交所属 adapter 证明", async () => {
    const world = setup();
    const reference = world.version("identification-work-item", "item");
    expect(await world.validate(reference, world.context())).toBe(false);
    expect(world.moduleReads).toBe(0);
    world.state.workPlanRef = world.version("identification-work-plan", "plan");
    let proofInput;
    world.providers.identificationGraph.verifyCheckpointReference = async (input) => {
      proofInput = input;
      return true;
    };
    expect(await world.validate(reference, world.context())).toBe(true);
    expect(proofInput).toMatchObject({ reference, workPlanRef: world.state.workPlanRef });
    delete world.providers.identificationGraph.verifyCheckpointReference;
    expect(await world.validate(reference, world.context())).toBe(false);
  });

  it("评估输入须绑定本运行已登记的 A0 准备，再由 C25 证明正文", async () => {
    const world = setup("assessment");
    const reference = world.version("assessment-input-snapshot", "assessment-input");
    world.state.stage = "A3";
    world.state.entrySnapshotRef = world.entry;
    world.state.assessmentInputSnapshotRef = reference;
    const calls = [];
    world.providers.riskAssessment.verifyCheckpointReference = async (input) => {
      calls.push(input);
      return world.moduleAccepted;
    };
    expect(await world.validate(reference, world.context())).toBe(true);
    expect(calls[0]).toMatchObject({
      reference,
      preparationSnapshotRef: world.entry.assessmentPreparationSnapshotRef,
      invocationId: "original-downstream",
    });
    delete world.state.assessmentInputSnapshotRef;
    expect(await world.validate(reference, world.context("put-writes"))).toBe(true);
    expect(await world.validate(reference, world.context("get"))).toBe(false);
    world.state.assessmentInputSnapshotRef = reference;
    world.entry = {
      ...world.entry,
      assessmentPreparationSnapshotRef: world.version(
        "assessment-preparation-snapshot",
        "different",
      ),
    };
    expect(await world.validate(reference, world.context())).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it.each(
    ["assessment", "riskFlow"].flatMap((kind) =>
      [
        "risk-assessment-record",
        "warning-record",
        "warning-response-task",
        "response-recommendation",
        "effect-forecast",
        "execution-record",
        "feedback",
        "deviation-record",
        "calibration-suggestion",
      ].map((referenceKind) => [kind, referenceKind]),
    ),
  )("%s %s 须同时证明领域正文及本运行链边", async (kind, referenceKind) => {
    const world = setup(kind);
    const reference = world.version(referenceKind, "record");
    const child = world.version("workflow-run", "child");
    if (kind === "riskFlow") world.state.assessmentRunRefs = [child];
    world.providers.workflow.verifyCheckpointDomainReference = async (input) =>
      JSON.stringify(input.runRef) ===
      JSON.stringify(kind === "riskFlow" ? child : world.state.runRef);
    expect(await world.validate(reference, world.context())).toBe(true);
    world.moduleAccepted = false;
    expect(await world.validate(reference, world.context())).toBe(false);
    world.moduleAccepted = true;
    world.providers.transactionUnit.readWorkflowRunBinding = async (input) =>
      input.parentRunRef === undefined;
    if (kind === "riskFlow") expect(await world.validate(reference, world.context())).toBe(false);
    world.providers.workflow.verifyCheckpointDomainReference = async () => false;
    expect(await world.validate(reference, world.context())).toBe(false);
  });

  it("A6 任务无建议链边时只接受已证明评估正文与所属任务关系", async () => {
    const world = setup("assessment");
    const reference = world.version("warning-response-task", "task");
    const assessmentRecordRef = world.version("risk-assessment-record", "assessment");
    world.state.assessmentRecordRef = assessmentRecordRef;
    world.providers.workflow.verifyCheckpointDomainReference = async (input) =>
      input.reference.kind === "risk-assessment-record";
    world.providers.warning.verifyCheckpointReference = async (input) =>
      JSON.stringify(input.assessmentRecordRef) === JSON.stringify(assessmentRecordRef);
    expect(await world.validate(reference, world.context())).toBe(true);
    world.moduleAccepted = false;
    expect(await world.validate(reference, world.context())).toBe(false);
    world.moduleAccepted = true;
    delete world.state.assessmentRecordRef;
    expect(await world.validate(reference, world.context())).toBe(false);
  });

  it.each(
    ["identification", "assessment", "riskFlow"].flatMap((kind) =>
      ["agent-task", "review-task"].map((taskKind) => [kind, taskKind]),
    ),
  )("%s %s 须证明精确父运行，转发子任务须先证明子入口", async (kind, taskKind) => {
    const world = setup(kind);
    const agentTaskRef = {
      ...world.version("agent-task", "task"),
      taskType: "response-recommendation",
      triggerMode: "embedded",
      modelDeploymentRef: { entityId: "model", versionId: "1" },
      promptTemplateRef: { entityId: "prompt", versionId: "1" },
      toolPolicyRef: { entityId: "tools", versionId: "1" },
      budgetPolicyRef: { entityId: "budget", versionId: "1" },
      incrementSchemaRef: { entityId: "increment", versionId: "1" },
      validationPolicyRef: { entityId: "validation", versionId: "1" },
    };
    const child = world.version("workflow-run", "child");
    const targetParent = kind === "riskFlow" ? child : world.state.runRef;
    const taskRef =
      taskKind === "agent-task"
        ? agentTaskRef
        : {
            ...world.version("review-task", "review"),
            reviewType: "calibration-suggestion",
            waitingRunRef: targetParent,
            targetRef: world.version("calibration-suggestion", "suggestion"),
          };
    const owner =
      taskKind === "agent-task" ? world.providers.agentTasks : world.providers.reviewTasks;
    if (kind === "riskFlow") world.state.assessmentRunRefs = [child];
    const reads = [];
    owner.verifyCheckpointReference = async (input) => {
      reads.push(input);
      return JSON.stringify(input.parentRunRef) === JSON.stringify(targetParent);
    };
    expect(await world.validate(taskRef, world.context())).toBe(true);
    expect(reads.at(-1)).toMatchObject({ taskRef, parentRunRef: targetParent });
    if (kind === "riskFlow") {
      world.providers.transactionUnit.readWorkflowRunBinding = async (input) =>
        input.runRef.reference.entityId !== "child";
      reads.length = 0;
      expect(await world.validate(taskRef, world.context())).toBe(false);
      expect(reads).toHaveLength(1);
      expect(reads[0].parentRunRef).toEqual(world.state.runRef);
    }
    delete owner.verifyCheckpointReference;
    expect(await world.validate(taskRef, world.context())).toBe(false);
  });

  it("标准化风险记录必须来自当前精确识别运行及未脱敏授权", async () => {
    const world = setup();
    const reference = world.version("standardized-risk-record", "risk");
    const result = {
      kind: "record-read",
      riskRecordRef: reference,
      identificationRunRef: world.state.runRef,
    };
    world.providers.riskIdentificationRead = {
      read: async (input) => {
        expect(input).toMatchObject({
          queryId: "original-downstream",
          kind: "record-read",
          payload: { riskRecordRef: reference },
        });
        return { kind: "succeeded", result };
      },
    };
    // validator 持有的是构造时端口，重建以注入真实形状的窄读。
    world.validate = createDeploymentCheckpointValidatorV1(world.providers);
    expect(await world.validate(reference, world.context())).toBe(true);
    result.identificationRunRef = world.version("workflow-run", "another-run");
    expect(await world.validate(reference, world.context())).toBe(false);
    result.identificationRunRef = world.state.runRef;
    result.riskRecordRef = world.version("standardized-risk-record", "another-record");
    expect(await world.validate(reference, world.context())).toBe(false);
    result.riskRecordRef = reference;
    world.providers.access.verify = async (input) => ({
      context: world.source.context,
      redacted: input.invocationId === "original-downstream",
    });
    expect(await world.validate(reference, world.context())).toBe(false);
  });

  it.each(["identification-candidate-set", "merge-plan", "identification-group"])(
    "%s 须先证明本运行冻结输入及必要工作计划",
    async (kind) => {
      const world = setup();
      const reference = world.version(kind, "candidate-result");
      expect(await world.validate(reference, world.context())).toBe(false);
      world.state.inputSnapshotRef = world.version("identification-input-snapshot", "input");
      if (kind !== "identification-candidate-set") {
        expect(await world.validate(reference, world.context())).toBe(false);
        world.state.workPlanRef = world.version("identification-work-plan", "plan");
      }
      const verified = [];
      world.providers.identificationGraph.verifyCheckpointReference = async (input) => {
        verified.push(input.reference);
        return world.moduleAccepted;
      };
      let proof;
      world.providers.candidateProof.verifyCheckpointReference = async (input) => {
        proof = input;
        return true;
      };
      expect(await world.validate(reference, world.context())).toBe(true);
      expect(verified).toEqual([
        world.state.inputSnapshotRef,
        ...(kind === "identification-candidate-set" ? [] : [world.state.workPlanRef]),
      ]);
      expect(proof).toMatchObject({
        reference,
        inputSnapshotRef: world.state.inputSnapshotRef,
        runRef: world.state.runRef,
        invocationId: "original-downstream",
      });
      proof = undefined;
      world.moduleAccepted = false;
      expect(await world.validate(reference, world.context())).toBe(false);
      expect(proof).toBeUndefined();
    },
  );

  it.each(["identification", "assessment", "riskFlow"])(
    "%s 只以完整已登记等待证明知识准备及用户确认",
    async (kind) => {
      for (const [waitingKind, field, refKind] of [
        ["knowledge-preparation", "knowledgePreparationTaskRef", "knowledge-preparation-task"],
        ["user-confirmation", "userConfirmationRef", "user-confirmation"],
      ]) {
        const world = setup(kind);
        const reference = world.version(refKind, "waiting-target");
        const waitingRef = { kind: waitingKind, [field]: reference };
        const owner =
          kind === "identification"
            ? world.providers.identificationGraph
            : world.providers.workflow;
        expect(await world.validate(reference, world.context())).toBe(false);
        expect(world.moduleReads).toBe(0);
        expect(await world.validate(reference, world.context("put-writes"))).toBe(true);
        world.moduleAccepted = false;
        expect(await world.validate(reference, world.context("put-writes"))).toBe(false);
        world.moduleAccepted = true;
        if (kind === "riskFlow") world.state.waitingRefs = [waitingRef];
        else world.state.waitingRef = waitingRef;
        world.state.status = "waiting";
        owner.verifyCheckpointWaitingReference = async (input) => {
          expect(input.waitingRef).toEqual(waitingRef);
          expect(input.runRef).toEqual(world.runtimeContext.runRef);
          expect(input.invocationId).toBe(world.runtimeContext.invocationId);
          return world.moduleAccepted;
        };
        expect(await world.validate(reference, world.context())).toBe(true);
        world.moduleAccepted = false;
        expect(await world.validate(reference, world.context())).toBe(false);
        delete owner.verifyCheckpointWaitingReference;
        expect(await world.validate(reference, world.context())).toBe(false);
      }
    },
  );

  it("拒绝未支持引用和未登记准备，不以其它运行存在性补位", async () => {
    const world = setup();
    for (const reference of [
      world.version("content-artifact", "unsupported-artifact"),
      world.version("workflow-run", "unrelated"),
      world.version("identification-preparation-snapshot", "unrelated"),
    ])
      expect(await world.validate(reference, world.context())).toBe(false);
  });

  it("评估阶段、候选与三种 A0 入口按精确登记证明", async () => {
    const world = setup("assessment");
    for (const kind of [
      "stage-result",
      "workflow-error",
      "route-decision",
      "assessment-run-result",
      "recommendation-candidate",
    ])
      expect(await world.validate(world.version(kind, kind), world.context())).toBe(true);
    for (const [kind, field, referenceKind] of [
      [
        "assessment-preparation",
        "assessmentPreparationSnapshotRef",
        "assessment-preparation-snapshot",
      ],
      ["forecast-input", "responseForecastInputSnapshotRef", "response-forecast-input-snapshot"],
      ["feedback-input", "responseFeedbackInputSnapshotRef", "response-feedback-input-snapshot"],
    ]) {
      const reference = world.version(referenceKind, "entry");
      world.entry = { kind, [field]: reference };
      expect(await world.validate(reference, world.context())).toBe(true);
      expect(
        await world.validate(world.version(referenceKind, "other-entry"), world.context()),
      ).toBe(false);
    }
  });

  it("所属模块技术异常和缺少证明能力均拒绝", async () => {
    const world = setup();
    world.providers.identificationGraph.verifyCheckpointReference = async () => {
      throw new Error("database failure");
    };
    const reference = world.version("identification-work-plan", "plan");
    expect(await world.validate(reference, world.context())).toBe(false);
    delete world.providers.identificationGraph.verifyCheckpointReference;
    expect(await world.validate(reference, world.context())).toBe(false);
  });
});

describe("检索数据集加载与耐久报告", () => {
  const setup = async () => {
    const root = await mkdtemp(join(tmpdir(), "riskflow-retrieval-input-"));
    const config = structuredClone(deploymentConfig);
    config.purpose = "synthetic-acceptance";
    config.localRoots.dataRoot = join(root, "data");
    config.localRoots.logRoot = join(root, "logs");
    await mkdir(config.localRoots.dataRoot);
    await mkdir(config.localRoots.logRoot);
    const dataset = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "references/acceptance/synthetic-v1/retrieval-dataset.json"),
        "utf8",
      ),
    );
    dataset.projectId = config.projectBindings[0].projectId;
    const filePath = join(config.localRoots.dataRoot, "dataset.json");
    await writeFile(filePath, JSON.stringify(dataset));
    config.retrievalQuality = {
      datasets: [{ projectId: dataset.projectId, datasetRef: dataset.datasetRef, filePath }],
      containerRuntime: "docker-27.1.1",
      timeoutMs: 30_000,
    };
    const policies = {
      resolveProject: () => ({
        policies: {
          "retrieval-acceptance": { datasetRef: dataset.datasetRef },
        },
      }),
    };
    return { config, dataset, filePath, policies };
  };

  it("精确加载原 Schema 数据集，不使用其它版本", async () => {
    const { config, dataset, policies } = await setup();
    expect(await loadDeploymentRetrievalDatasetsV1(config, policies)).toEqual([dataset]);
    policies.resolveProject = () => ({
      policies: {
        "retrieval-acceptance": { datasetRef: { ...dataset.datasetRef, versionId: "other" } },
      },
    });
    await expect(loadDeploymentRetrievalDatasetsV1(config, policies)).rejects.toThrow(TypeError);
  });

  it.each(["project", "version", "production", "missing", "symlink"])(
    "数据集 %s 不合格时拒绝装配",
    async (cause) => {
      const { config, dataset, filePath, policies } = await setup();
      if (cause === "project") dataset.projectId = "other-project";
      if (cause === "version") dataset.datasetRef = { ...dataset.datasetRef, versionId: "other" };
      if (cause === "production") config.purpose = "production";
      if (cause === "project" || cause === "version")
        await writeFile(filePath, JSON.stringify(dataset));
      if (cause === "missing") config.retrievalQuality.datasets[0].filePath += ".missing";
      if (cause === "symlink") {
        const linked = join(config.localRoots.dataRoot, "linked.json");
        await symlink(filePath, linked);
        config.retrievalQuality.datasets[0].filePath = linked;
      }
      await expect(loadDeploymentRetrievalDatasetsV1(config, policies)).rejects.toThrow();
    },
  );

  const report = {
    schemaVersion: "1",
    acceptancePolicyRef: { entityId: "acceptance-policy", versionId: "1" },
    datasetRef: { entityId: "dataset", versionId: "1" },
    syntheticSample: false,
    environment: {
      nodeVersion: "v24.12.0",
      containerRuntime: "docker-27.1.1",
      qdrantServiceRef: "qdrant-v1",
      cpuModel: "test-cpu",
      platform: "linux-x64",
    },
    gates: [
      {
        gateId: "authorization-leakage",
        threshold: 0,
        observed: 0,
        passed: true,
        sampleCount: 1,
        boundaryNote: "synthetic-test",
      },
    ],
    overall: "passed",
    measuredAt: "2030-01-01T00:00:00.000Z",
  };

  it("报告保留原 Schema 和部署身份，多次保存不覆盖", async () => {
    const { config } = await setup();
    const save = createDeploymentRetrievalReportWriterV1(config);
    await save(report);
    await save(report);
    const directory = join(config.localRoots.logRoot, "retrieval-quality");
    const files = await readdir(directory);
    expect(files).toHaveLength(2);
    for (const filename of files) {
      const stored = JSON.parse(await readFile(join(directory, filename), "utf8"));
      expect(stored).toMatchObject({
        instanceId: config.instanceId,
        releaseId: config.releaseId,
        configRef: config.configRef,
      });
      expect(HybridRetrievalAcceptanceReportV1Schema.parse(stored.report)).toEqual(report);
    }
  });

  it.each(["file", "symlink"])("报告目录为 %s 时拒绝写入", async (kind) => {
    const { config } = await setup();
    const directory = join(config.localRoots.logRoot, "retrieval-quality");
    if (kind === "file") await writeFile(directory, "occupied");
    else await symlink(config.localRoots.dataRoot, directory);
    await expect(createDeploymentRetrievalReportWriterV1(config)(report)).rejects.toThrow();
    expect(await readdir(config.localRoots.dataRoot)).toEqual(["dataset.json"]);
  });
});

describe("评分治理生产装配", () => {
  it("共享治理尚未绑定和重复绑定均拒绝启动", () => {
    const scoring = createDeploymentScoringGovernanceV1({
      foundation: {
        runtime: { db: {} },
        transactionUnit: {},
        artifactStore: {},
        access: {},
        referenceGuard: {},
        contextSource: {},
        config: { projectBindings: [{ projectId: "p-1" }] },
      },
      resolveDeploymentPolicies: {
        resolveProject: () => ({ policies: { "scoring-rules": {} } }),
      },
      authorizeDownstream: async () => {
        throw new Error("must not authorize on construction");
      },
      review: {},
    });
    expect(() => scoring.assertReady()).toThrow(TypeError);
    const composition = {
      compositions: {
        knowledge: { governedReleases: { resolveGovernedReleases: async () => undefined } },
        cleaning: {
          agentTaskAdapter: { getTask: async () => undefined },
          store: { readBoundResult: async () => undefined, loadFrozenInput: async () => undefined },
        },
      },
    };
    scoring.bind(composition);
    expect(() => scoring.assertReady()).not.toThrow();
    expect(() => scoring.bind(composition)).toThrow(TypeError);
    expect(() => scoring.basis.resolve({ projectId: "other-project" })).toThrow(TypeError);
  });
});

describe("本地工件的当前权限复验", () => {
  const authorization = testRequestBase.authorization;
  const common = {
    schemaVersion: "1",
    projectId: authorization.projectId,
    actorId: authorization.actorId,
    requiredCapability: authorization.grantedCapabilities[0],
    authorization,
    idempotencyKey: "artifact-boundary",
    purposeCode: "model-raw-response",
  };
  const put = {
    ...common,
    commandId: "artifact-put-boundary",
    issuedAt: authorization.decidedAt,
    artifactId: "artifact-boundary",
    artifactKind: "content",
    mediaType: "application/json",
    parentArtifactRefs: [],
    evidenceReferences: [],
    additionalSpatialScopeRefs: [],
    additionalSourceAccessGrantRefs: [],
  };
  const open = {
    ...common,
    requestId: "artifact-open-boundary",
    requestedAt: authorization.decidedAt,
    artifactRef: {
      kind: "content-artifact",
      reference: {
        entityId: "artifact-boundary",
        versionId: `sha256:${"a".repeat(64)}`,
      },
    },
  };
  it.each(["put", "open"])("%s 复验失败时不产生工件副作用", async (method) => {
    let called = false;
    const store = createDeploymentAuthorizedArtifactStoreV1({
      store: {
        [method]: async () => {
          called = true;
        },
      },
      access: {
        verifyDeploymentContext: async () => {
          throw { details: { code: "AUTHORIZATION_DENIED" } };
        },
      },
    });
    await expect(store[method](method === "put" ? put : open, [])).rejects.toMatchObject({
      code: "ARTIFACT_ACCESS_DENIED",
    });
    expect(called).toBe(false);
  });
  it("put/open 使用复验的持久上下文，保留命令身份与流句柄", async () => {
    const verified = structuredClone(authorization);
    const seen = [];
    const handle = { content: [], verified: Promise.resolve({}) };
    const store = createDeploymentAuthorizedArtifactStoreV1({
      access: {
        verifyDeploymentContext: async (input) => {
          expect(input.authorizationContextRef).toEqual(authorization.authorizationContextRef);
          return { context: verified };
        },
      },
      store: {
        put: async (command, content) => {
          seen.push(command);
          return content;
        },
        open: async (request) => {
          seen.push(request);
          return handle;
        },
      },
    });
    const content = [];
    expect(await store.put(put, content)).toBe(content);
    expect(await store.open(open)).toBe(handle);
    expect(seen[0].authorization).toBe(verified);
    expect(seen[0].commandId).toBe(put.commandId);
    expect(seen[1].authorization).toBe(verified);
    expect(seen[1].requestId).toBe(open.requestId);
  });
});

describe("模型宿主的当前权限复验", () => {
  const requests = {
    completeStructured: structuredRequest(),
    embed: {
      ...testRequestBase,
      texts: ["工程文本"],
      maxInputBytes: 1024,
      maxBatchItems: 1,
    },
    streamConversation: {
      ...testRequestBase,
      conversationRef: { entityId: "conversation", versionId: "v1" },
      promptTemplateRef: { entityId: "prompt", versionId: "v1" },
      messages: [{ role: "user", content: "工程文本" }],
      maxOutputTokens: 128,
    },
  };
  it.each(Object.keys(requests))("%s 无父工件也必须复验，拒权不调用模型", async (method) => {
    let called = false;
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: {
        verifyDeploymentContext: async () => {
          throw { details: { code: "AUTHORIZATION_DENIED" } };
        },
      },
      gateway: {
        [method]: () => {
          called = true;
        },
      },
    });
    if (method === "streamConversation") {
      const handle = gateway[method](requests[method]);
      await expect(handle.deltas.next()).rejects.toMatchObject({
        code: "MODEL_AUTHORIZATION_DENIED",
      });
      await expect(handle.completed).rejects.toMatchObject({
        code: "MODEL_AUTHORIZATION_DENIED",
      });
    } else {
      await expect(gateway[method](requests[method])).rejects.toMatchObject({
        code: "MODEL_AUTHORIZATION_DENIED",
      });
    }
    expect(called).toBe(false);
  });
  it("权限服务故障保持可重试技术错误", async () => {
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: {
        verifyDeploymentContext: async () => {
          throw { details: { code: "ACCESS_TRANSIENT_FAILURE" } };
        },
      },
      gateway: {},
    });
    await expect(gateway.completeStructured(requests.completeStructured)).rejects.toMatchObject({
      code: "MODEL_SERVICE_UNAVAILABLE",
      retryable: true,
    });
  });
  it("流在复验后创建并保留增量与终态", async () => {
    const verified = structuredClone(testRequestBase.authorization);
    const receipt = { invocationId: testRequestBase.invocationId };
    const delta = { text: "工程文本" };
    let seen;
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: { verifyDeploymentContext: async () => ({ context: verified }) },
      gateway: {
        streamConversation: (request) => {
          seen = request;
          return {
            deltas: (async function* () {
              yield delta;
            })(),
            completed: Promise.resolve(receipt),
          };
        },
      },
    });
    const handle = gateway.streamConversation(requests.streamConversation);
    expect(seen).toBeUndefined();
    expect((await handle.deltas.next()).value).toBe(delta);
    expect(await handle.completed).toBe(receipt);
    expect(seen.authorization).toBe(verified);
  });
});

const DELIVERY_CLI_PREFIXES = ["deployment:", "desktop:", "acceptance:"];

const scripts = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")).scripts ?? {};

const deliveryCliEntries = Object.entries(scripts).filter(([name]) =>
  DELIVERY_CLI_PREFIXES.some((prefix) => name.startsWith(prefix)),
);

const ref = (entityId) => ({ entityId, versionId: "v1" });
const policyTypes = [
  "cleaning",
  "knowledge-validation",
  "hybrid-retrieval",
  "retrieval-acceptance",
  "retrieval-review",
  "risk-candidate",
  "identification-graph",
  "retry",
  "assessment-runtime",
  "warning-runtime",
  "response-generation",
  "response-validation",
  "response-agent",
  "calibration",
  "scoring-rules",
  "report-export",
];
const policyRefs = Object.fromEntries(
  policyTypes.map((type) => [
    type,
    type === "identification-graph" ? ref("identification-policy-set") : ref(`${type}-policy`),
  ]),
);
const chatModelRef = deploymentConfig.models[0].config.deploymentRef;
const embeddingModelRef = ref("embedding-model");
const policySetRef = policyRefs["identification-graph"];
const approval = {
  approvedBy: "operator-01",
  approvedAt: "2030-01-01T00:00:00.000Z",
  releaseId: deploymentConfig.releaseId,
};

const agentBudget = (name, modelDeploymentRef = chatModelRef) => ({
  schemaVersion: "1",
  policyRef: ref(`${name}-budget`),
  modelDeploymentRef,
  promptTemplateRef: ref(`${name}-prompt`),
  toolPolicyRef: ref(`${name}-tools`),
  maxModelInvocations: 2,
  maxToolInvocations: 4,
  maxContextTokens: 4096,
  maxInputBytes: 4096,
  maxOutputBytes: 4096,
  maxCandidates: 2,
  maxObjects: 16,
  maxSupplementarySearches: 0,
  maxCorrections: 1,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 60_000,
});

const agentFields = (name, budget = agentBudget(name)) => ({
  definitionRef: ref(`${name}-definition`),
  modelDeploymentRef: budget.modelDeploymentRef,
  promptTemplateRef: budget.promptTemplateRef,
  toolPolicyRef: budget.toolPolicyRef,
  budgetPolicyRef: budget.policyRef,
  incrementSchemaRef: ref(`${name}-increment`),
  validationPolicyRef: ref(`${name}-validation`),
  budgetPolicy: budget,
});

const sharedAgentFields = (name) => {
  const budgetPolicy = agentBudget(name);
  return {
    definitionRef: ref(`${name}-definition`),
    toolPolicyRef: budgetPolicy.toolPolicyRef,
    incrementSchemaRef: ref(`${name}-increment`),
    validationPolicyRef: ref(`${name}-validation`),
    budgetPolicy,
  };
};

const retry = {
  schemaVersion: "1",
  policyRef: policyRefs.retry,
  maxAttempts: 3,
  backoffMs: 250,
};
const riskCandidate = {
  generation: {
    schemaVersion: "1",
    policyRef: ref("candidate-generation"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    outputSchemaRef: ref("candidate-output-schema"),
    budgetPolicyRef: ref("candidate-generation-budget"),
    budget: {
      maxCandidates: 4,
      maxOutputBytes: 4096,
      maxTotalTokens: 1000,
      maxWallClockMs: 5000,
      maxRepairRounds: 1,
    },
  },
  validation: {
    schemaVersion: "1",
    policyRef: ref("candidate-validation"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    ruleValidationPolicyRef: ref("candidate-rule-validation"),
    allowedMechanismTypes: [],
    requiredMechanismTypes: [],
    requiredRelationTypes: [],
    repairableReasonCodes: [
      "candidate-schema-invalid",
      "candidate-node-mismatch",
      "candidate-relation-endpoint-missing",
      "candidate-evidence-not-frozen",
      "candidate-mechanism-not-applicable",
    ],
  },
  merge: {
    schemaVersion: "1",
    policyRef: ref("candidate-merge"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    embeddingDeploymentRef: embeddingModelRef,
    embeddingBudgetPolicyRef: ref("candidate-embedding-budget"),
    relatedNodeIds: [],
    riskEventCosineThreshold: 0.9,
    evidenceSetSimilarityThreshold: 0.8,
    weights: { processNode: 0.4, riskEvent: 0.35, evidence: 0.25 },
    groupThreshold: 0.8,
    maxGroupMembers: 4,
    memberOrder: "candidate-ref-ascending",
    tieBreak: "lexicographically-smallest-candidate-ref",
  },
  confidence: {
    schemaVersion: "1",
    policyRef: ref("candidate-confidence"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    weights: {
      modelConfidence: 0.4,
      ruleConsistency: 0.3,
      simulationConstraint: 0.1,
      multiSourceMerge: 0.2,
    },
    requiredBasis: ["model-confidence"],
    missingBasisBehavior: "block",
    roundingDecimals: 2,
  },
  forcedReview: {
    schemaVersion: "1",
    policyRef: ref("candidate-forced-review"),
    policySetRef: {
      kind: "identification-policy-set",
      reference: policySetRef,
    },
    autoAcceptanceThreshold: 0.9,
    forcedReviewReasonCodes: [],
    reviewPolicyRef: ref("candidate-review"),
  },
};

const bodiesForProject = (projectId) => {
  const cleaningAgent = agentFields("cleaning");
  const knowledgeAgent = agentFields("knowledge-validation");
  const retryPolicyRef = policyRefs.retry;
  const warningAggregationPolicy = {
    schemaVersion: "1",
    policyRef: ref("warning-aggregation"),
    projectId,
    responseDirectionByTriggerType: {
      风险等级超过风险可接受阈值: "direction-risk",
      监测指标越限: "direction-monitoring",
      "趋势/加速度/异常评分越限": "direction-trend",
      多指标联合规则命中: "direction-joint",
    },
  };
  const notificationPolicy = {
    schemaVersion: "1",
    policyRef: ref("notification"),
    projectId,
    channel: "in-app",
    recipientActorIds: ["operator-01"],
  };
  const hybridRetrieval = {
    schemaVersion: "1",
    policyRef: policyRefs["hybrid-retrieval"],
    evidenceBaseDefinitionType: "retrieval-evidence-base",
    modelDeploymentRef: embeddingModelRef,
    dense: { vectorName: "dense", dimensions: 8, distance: "cosine" },
    bm25: {
      vectorName: "bm25",
      model: "qdrant/bm25",
      tokenizer: "multilingual",
      language: "zh-CN",
      stemmer: "none",
      stopwords: [],
    },
    densePrefetchLimit: 5,
    bm25PrefetchLimit: 5,
    topK: 5,
    rrf: { k: 60, denseWeight: 1, bm25Weight: 1 },
    memberBatchLimit: 10,
    memberByteLimit: 1024,
    memberLimit: 10,
    embeddingTimeoutMs: 1000,
    projectionTimeoutMs: 1000,
    acceptancePolicyRef: policyRefs["retrieval-acceptance"],
    projectionCompatibilityRef: ref("projection-compatibility"),
  };
  const assessmentRuntime = {
    schemaVersion: "1",
    projectId,
    warningAggregationPolicyRef: warningAggregationPolicy.policyRef,
    notificationPolicyRef: notificationPolicy.policyRef,
    responseGenerationPolicyRef: policyRefs["response-generation"],
    responseValidationPolicyRef: policyRefs["response-validation"],
    responseAgentPolicyRef: policyRefs["response-agent"],
    calibrationAgentPolicyRef: policyRefs.calibration,
    retryPolicyRef,
    reviewPolicyRef: ref("assessment-review"),
    modelDeploymentRef: chatModelRef,
    promptTemplateRef: ref("assessment-prompt"),
  };
  return {
    cleaning: {
      schemaVersion: "1",
      policyRef: policyRefs.cleaning,
      allowedConversionPolicyRefs: [ref("conversion-policy")],
      allowedQualityPolicyRefs: [ref("quality-policy")],
      allowedConverterDeploymentRefs: [ref("converter-deployment")],
      allowedExclusionReasonCodes: ["duplicate-content"],
      protectedSegmentKinds: ["monitoring-window"],
      requiredSegmentKinds: ["chapter"],
      protectedMonitoringSelectionReasons: ["latest-valid"],
      minimumRetainedSegmentRatio: 0.5,
      minimumRetainedSampleRatio: 0.5,
      minimumDocumentCoverageRatio: 0.5,
      tools: {
        documentSegmentToolRef: ref("document-segment-tool"),
        monitoringSnapshotToolRef: ref("monitoring-snapshot-tool"),
        maxSegmentsPerRead: 10,
        maxMonitoringItemsPerRead: 10,
      },
      agent: cleaningAgent,
    },
    "knowledge-validation": {
      schemaVersion: "1",
      policyRef: policyRefs["knowledge-validation"],
      criticalProcessKinds: ["扩径准备"],
      coverage: [{ processKind: "扩径准备", minimumMechanisms: 1, minimumEvidence: 1 }],
      allowedStandardLevels: ["national"],
      allowedCaseConstructionMethods: ["盾构"],
      maxEntriesPerPackage: 128,
      tools: {
        segmentSliceToolRef: ref("knowledge-segment-slice"),
        baselineKnowledgeToolRef: ref("knowledge-baseline-read"),
      },
      agent: {
        ...agentFields("knowledge-validation", knowledgeAgent.budgetPolicy),
        budgetPolicyRef: knowledgeAgent.budgetPolicyRef,
      },
    },
    "hybrid-retrieval": hybridRetrieval,
    "retrieval-acceptance": {
      schemaVersion: "1",
      acceptancePolicyRef: policyRefs["retrieval-acceptance"],
      datasetRef: ref("retrieval-dataset"),
      syntheticSample: true,
      topK: 5,
      denseRecallAt5Min: 0.8,
      bm25RecallAt5Min: 0.8,
      rrfRecallAt5Min: 0.85,
      rrfNdcgAt5Min: 0.75,
      reconciliationRatioMin: 1,
      authorizationLeakageMax: 0,
      qdrantQueryP95MsMax: 120,
      warmupRuns: 1,
      measuredRuns: 3,
    },
    "retrieval-review": {
      schemaVersion: "1",
      policyRef: policyRefs["retrieval-review"],
      definitionRef: ref("retrieval-review-definition"),
      toolPolicyRef: ref("retrieval-review-tools"),
      incrementSchemaRef: ref("retrieval-review-increment"),
      validationPolicyRef: ref("retrieval-review-validation"),
      readFrozenResultToolRef: ref("read-frozen-result"),
      resupplementToolRef: ref("resupplement"),
      budgetPolicyRef: ref("retrieval-review-budget"),
      modelDeploymentRef: chatModelRef,
      promptTemplateRef: ref("retrieval-review-prompt"),
      maxCandidateMembers: 8,
      maxResupplements: 2,
      allowedSupplementIntentCodes: ["settlement"],
      modelMaxOutputTokens: 1024,
    },
    "risk-candidate": riskCandidate,
    "identification-graph": {
      schemaVersion: "1",
      policySetRef: {
        kind: "identification-policy-set",
        reference: policySetRef,
      },
      retrievalPolicyRef: hybridRetrieval.policyRef,
      retrievalReviewAgentPolicyRef: policyRefs["retrieval-review"],
      repairPolicyRef: riskCandidate.validation.policyRef,
      confidencePolicyRef: riskCandidate.confidence.policyRef,
      forcedReviewPolicyRef: riskCandidate.forcedReview.policyRef,
      mergePolicyRef: riskCandidate.merge.policyRef,
      ruleValidationPolicyRef: riskCandidate.validation.ruleValidationPolicyRef,
      retryPolicyRef,
      modelDeploymentRef: chatModelRef,
      promptTemplateRef: ref("identification-graph-prompt"),
      retryPolicy: retry,
    },
    retry,
    "assessment-runtime": assessmentRuntime,
    "warning-runtime": {
      schemaVersion: "1",
      projectId,
      warningAggregationPolicy,
      notificationPolicy,
    },
    "response-generation": {
      schemaVersion: "1",
      policyRef: policyRefs["response-generation"],
      projectId,
      bindings: [],
    },
    "response-validation": {
      schemaVersion: "1",
      policyRef: policyRefs["response-validation"],
      projectId,
      targetIndicators: [{ indicatorItem: "indicator-1", targetValue: 5 }],
      reviewedStandardEvidence: [],
      contraindicationRules: [],
      executableProcessStatuses: ["掘进"],
    },
    "response-agent": {
      schemaVersion: "1",
      policyRef: policyRefs["response-agent"],
      projectId,
      ...sharedAgentFields("response-agent"),
    },
    calibration: {
      schemaVersion: "1",
      policyRef: policyRefs.calibration,
      projectId,
      ...sharedAgentFields("calibration"),
      evidenceRequirementCount: 1,
      maxOperations: 1,
    },
    "scoring-rules": {
      schemaVersion: "1",
      policyRef: policyRefs["scoring-rules"],
      compatibilityRef: ref("scoring-compatibility"),
      assemblyPolicyRef: ref("scoring-assembly"),
      conflictPriorityPolicyRef: ref("scoring-conflict-priority"),
      allowedSourceStandardKinds: ["national"],
      tools: {
        standardSegmentToolRef: ref("scoring-standard-segment"),
        indicatorCatalogToolRef: ref("scoring-indicator-catalog"),
        maxSegmentsPerRead: 16,
        maxIndicatorsPerRead: 16,
      },
      agent: agentFields("scoring"),
    },
    "report-export": {
      schemaVersion: "1",
      policyRef: policyRefs["report-export"],
      format: "json",
      queryTypes: ["risk-overview"],
      sections: ["run-summary", "report-fact", "report-absence"],
      maxPages: 2,
      maxItems: 20,
      maxBytes: 65_536,
    },
  };
};

const bindingFor = (projectId) => ({
  ...structuredClone(deploymentConfig.projectBindings[0]),
  projectId,
  policyCatalogRef: structuredClone(deploymentConfig.policyCatalog.catalogRef),
  policyRefs: structuredClone(policyRefs),
});

const deploymentPolicies = (projectIds = ["project-rail-01", "project-rail-02"]) => {
  const config = structuredClone(deploymentConfig);
  config.projectBindings = projectIds.map(bindingFor);
  config.models.push({
    backend: "network-api",
    config: {
      schemaVersion: "1",
      protocol: "ollama-embed",
      deploymentRef: embeddingModelRef,
      serviceContractRef: ref("embedding-service"),
      modelVersionRef: ref("embedding-model-version"),
      baseUrl: "http://192.168.13.11:11434",
      modelId: "embedding-model",
      capabilities: ["embed"],
      embeddingDimensions: 8,
      contextWindowTokens: 4096,
      requestTimeoutMs: 30_000,
      streamIdleTimeoutMs: 10_000,
      maxResponseBytes: 1_048_576,
      maxInputBytes: 65_536,
      maxBatchItems: 1,
      inputTokenUpperBoundPolicy: {
        maxTokensPerInputByte: 1,
        requestOverheadTokens: 64,
      },
      expectedServerVersion: "0.5.0",
      expectedModelDigest: "a".repeat(64),
    },
  });
  const entries = projectIds.flatMap((projectId) =>
    Object.entries(bodiesForProject(projectId)).map(([policyType, body]) => ({
      schemaVersion: 1,
      projectId,
      policyType,
      policyRef: policyRefs[policyType],
      approval: structuredClone(approval),
      body: structuredClone(body),
    })),
  );
  return {
    config,
    catalog: {
      schemaVersion: 1,
      catalogRef: structuredClone(config.policyCatalog.catalogRef),
      downstreamAuthorization: {
        policyRef: ref("downstream-authorization"),
        bindings: [
          { rootBranch: "workflow.start-run", downstreamBranches: ["agent-task.start-task"] },
        ],
      },
      purpose: config.purpose,
      entries,
    },
  };
};

const expectPolicyCode = (run, code) => {
  let error;
  try {
    run();
  } catch (caught) {
    error = caught;
  }
  expect(error?.code ?? error?.message).toBe(code);
};

describe("部署策略绑定解析", () => {
  it("解析完整的 16 类目录，并允许不同工程仅在 Agent 正文 projectId 上不同", () => {
    const { config, catalog } = deploymentPolicies();
    const resolved = resolveDeploymentPoliciesV1({ config, catalog });

    for (const projectId of ["project-rail-01", "project-rail-02"]) {
      const project = resolved.resolveProject(projectId);
      expect(Object.keys(project.policies)).toHaveLength(16);
      expect(project.policies["response-agent"].projectId).toBe(projectId);
      expect(project.policies.calibration.projectId).toBe(projectId);
    }
  });

  it("catalog 完整版本引用不一致时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    config.policyCatalog.catalogRef.versionId = "2";

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_CATALOG_IDENTITY_MISMATCH",
    );
  });

  it("目录中任一策略的批准 release 与部署 release 不一致时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    catalog.entries[0].approval.releaseId = "release-other";

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_RELEASE_MISMATCH",
    );
  });

  it("工程绑定引用缺失策略版本时不回退到目录中的其他版本", () => {
    const { config, catalog } = deploymentPolicies();
    config.projectBindings[0].policyRefs.calibration = ref("calibration-other");

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_NOT_FOUND",
    );
  });

  it("graph 与候选策略的 retry 成员引用漂移时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    const retryEntry = catalog.entries.find(
      (entry) => entry.projectId === "project-rail-01" && entry.policyType === "retry",
    );
    const changedRetryRef = ref("retry-v2");
    config.projectBindings[0].policyRefs.retry = changedRetryRef;
    retryEntry.policyRef = changedRetryRef;
    retryEntry.body.policyRef = changedRetryRef;

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_MEMBER_MISMATCH",
    );
  });

  it("多工程共享 Agent 策略的预算不同则拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    const policy = catalog.entries.find(
      (entry) => entry.projectId === "project-rail-02" && entry.policyType === "response-agent",
    );
    policy.body.budgetPolicy.maxModelInvocations = 3;

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_SHARED_AGENT_POLICY_MISMATCH",
    );
  });

  it("embedding 模型维度与 hybrid 策略不符时拒绝解析", () => {
    const { config, catalog } = deploymentPolicies();
    config.models.find(
      ({ config: model }) => model.deploymentRef.entityId === embeddingModelRef.entityId,
    ).config.embeddingDimensions = 16;

    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_MODEL_MISMATCH",
    );
  });
});

describe("运行授权精确复验", () => {
  const authorization = testRequestBase.authorization;
  const setup = () => {
    const calls = [];
    const source = {
      context: authorization,
      branch: "workflow.start-run",
      invocationId: "original-command",
      sourceVersionRefs: [],
    };
    const access = {
      readDeploymentAuthorizationSource: async () => source,
      verify: async (input) => {
        calls.push(input);
        return { context: authorization };
      },
    };
    const downstream = [];
    const derivedContext = { ...authorization, grantedCapabilities: ["risk-identification.read"] };
    const port = createDeploymentRuntimeAuthorizationV1({
      access,
      authorizationScope: {
        authorizeDownstream: async (input) => {
          downstream.push(input);
          return derivedContext;
        },
      },
    });
    return { port, source, calls, downstream, derivedContext, access };
  };
  it("原身份复验使用登记调用；派生身份签发批准的精确分支", async () => {
    const { port, calls, downstream, derivedContext } = setup();
    const request = {
      authorization,
      invocationId: "original-command",
      branch: "workflow.start-run",
    };
    await expect(port.verifyCurrent(request)).resolves.toEqual(authorization);
    expect(downstream).toHaveLength(0);
    await expect(
      port.verifyCurrent({
        ...request,
        invocationId: "derived-action",
        branch: "risk-identification.run-read",
        requestedSourceVersionRefs: [],
      }),
    ).resolves.toEqual(derivedContext);
    expect(calls[1]).toMatchObject({
      invocationId: "original-command",
      branch: "workflow.start-run",
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
    });
    expect(downstream[0]).toMatchObject({
      projectId: authorization.projectId,
      actorId: authorization.actorId,
      invocationId: "derived-action",
      branch: "risk-identification.run-read",
      requestedSpatialScopeRefs: authorization.spatialScopeRefs,
      requestedSourceVersionRefs: [],
    });
  });
  it("错主体、未登记正文与过期授权不签发，数据库故障继续抛出", async () => {
    const { port, source, calls, downstream, access } = setup();
    const request = {
      authorization,
      invocationId: "derived-action",
      branch: "risk-identification.run-read",
    };
    await expect(port.verifyCurrent({ ...request, actorId: "other" })).resolves.toBeUndefined();
    source.context = { ...authorization, decidedAt: "2030-01-02T00:00:00.000Z" };
    await expect(port.verifyCurrent(request)).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
    source.context = authorization;
    access.verify = async () => {
      throw new AccessServiceError({
        code: "SESSION_EXPIRED",
        retryable: false,
        stage: "runtime-verify",
        occurredAt: authorization.decidedAt,
        diagnosticRef: { kind: "diagnostic-artifact", reference: ref("authorization-diagnostic") },
        contextRefs: [],
      });
    };
    await expect(port.verifyCurrent(request)).resolves.toBeUndefined();
    expect(downstream).toHaveLength(0);
    const databaseError = new Error("database-unavailable");
    access.verify = async () => {
      throw databaseError;
    };
    await expect(port.verifyCurrent(request)).rejects.toBe(databaseError);
  });
});

describe("生产调用的授权作用域", () => {
  const authorization = testRequestBase.authorization;
  const runRef = (entityId) => ({ kind: "workflow-run", reference: { entityId, versionId: "1" } });
  const setup = (sourceOverrides = {}) => {
    const calls = [];
    const access = {
      readDeploymentAuthorizationSource: async () => ({
        context: authorization,
        branch: "workflow.start-run",
        ...sourceOverrides,
      }),
      authorize: async () => ({ context: authorization }),
      verify: vi.fn(async () => ({ context: authorization, redacted: false })),
    };
    const boundary = createDeploymentAuthorizationScopeV1({
      access,
      deploymentAuthorization: {
        issueDownstreamContexts: async (input) => calls.push(input),
        resolveDownstreamContext: async (input) => {
          calls.push(input);
          return input.root;
        },
      },
      policy: {
        bindings: [
          { rootBranch: "workflow.start-run", downstreamBranches: ["agent-task.start-task"] },
        ],
      },
    });
    return { boundary, calls, access };
  };
  it("独立知识发布事件使用原发布命令因果，错命令拒绝", async () => {
    const { identificationBasisPublishedEvent } =
      await import("../../packages/core/dist/identification-knowledge/index.js");
    const source = {
      branch: "knowledge-modeling.publish-approved-release",
      invocationId: "publish-command",
    };
    const { boundary, calls } = setup(source);
    const knowledgeRef = (id) => ({ kind: "knowledge-release", reference: ref(id) });
    const event = identificationBasisPublishedEvent({
      releaseRef: knowledgeRef("evidence-base"),
      compositeMemberReleaseRefs: ["process", "mechanism", "standard", "case"].map(knowledgeRef),
      command: {
        projectId: authorization.projectId,
        commandId: source.invocationId,
        idempotencyKey: "publish-idem",
        issuedAt: "2030-01-01T00:00:00.000Z",
        authorizationContextRef: authorization.authorizationContextRef,
      },
      recordedAt: "2030-01-01T00:00:00.000Z",
      auditEntryId: "publish-audit",
    });
    await boundary.runEvent(event, () =>
      boundary.authorizeDownstream({
        ...request,
        branch: "knowledge-modeling.identification-basis",
      }),
    );
    expect(calls[0].causalRunRef).toBeUndefined();
    expect(calls[0].causalCommandRef).toEqual({
      kind: "command",
      commandId: source.invocationId,
      authorizationContextRef: authorization.authorizationContextRef,
    });
    await expect(
      boundary.runEvent({ ...event, producerCommandId: "other" }, () =>
        boundary.authorizeDownstream(request),
      ),
    ).rejects.toThrow(TypeError);
  });
  it("准备事件区分正式运行来源、独立命令和暂缺因果，并复验当前权限", async () => {
    const eventFor = (kind) => {
      const preparationRef = {
        kind: `${kind}-preparation-snapshot`,
        reference: ref(`prepared-${kind}`),
      };
      return {
        schemaVersion: "1",
        eventId: `prepared-${kind}`,
        eventVersion: 1,
        eventType: "engineering.inputs-ready.v1",
        projectId: authorization.projectId,
        aggregateRef: preparationRef,
        occurredAt: "2030-01-01T00:00:00.000Z",
        recordedAt: "2030-01-01T00:00:00.000Z",
        causationId: "prepare-command",
        producerCommandId: "prepare-command",
        correlationId: "prepare",
        idempotencyKey: "prepare-command",
        authorizationContextRef: authorization.authorizationContextRef,
        auditTrailRef: { kind: "audit-trail", reference: ref("prepared-audit") },
        payload: {
          preparation: {
            kind,
            [kind === "assessment"
              ? "assessmentPreparationSnapshotRef"
              : "identificationPreparationSnapshotRef"]: preparationRef,
          },
        },
      };
    };
    const source = {
      branch: "engineering-data.identification-preparation",
      invocationId: "prepare-command",
      sourceVersionRefs: [],
    };
    const identified = setup(source);
    const operation = vi.fn(async (value) => value);
    expect(await identified.boundary.runEvent(eventFor("identification"), operation)).toMatchObject(
      { independent: true },
    );
    const related = setup({ ...source, causalRunRef: runRef("parent") });
    expect(await related.boundary.runEvent(eventFor("identification"), operation)).toMatchObject({
      independent: false,
      source: { causalRunRef: runRef("parent") },
    });
    const missing = setup({ ...source, parentContextRef: authorization.authorizationContextRef });
    await expect(
      missing.boundary.runEvent(eventFor("identification"), operation),
    ).rejects.toThrow();
    const assessment = setup({ ...source, branch: "engineering-data.assessment-preparation" });
    expect(await assessment.boundary.runEvent(eventFor("assessment"), operation)).toMatchObject({
      independent: true,
    });
    assessment.access.verify.mockResolvedValueOnce({ context: authorization, redacted: true });
    const before = operation.mock.calls.length;
    await expect(assessment.boundary.runEvent(eventFor("assessment"), operation)).rejects.toThrow();
    expect(operation).toHaveBeenCalledTimes(before);
  });
  const request = {
    projectId: authorization.projectId,
    actorId: authorization.actorId,
    branch: "agent-task.start-task",
    invocationId: "downstream-action",
  };
  it("并发调用分别保留原运行身份，作用域结束后拒绝下游签发", async () => {
    const { boundary, calls } = setup();
    await Promise.all(
      ["run-a", "run-b"].map((id) =>
        boundary.run({ authorization, causalRunRef: runRef(id) }, async () => {
          await Promise.resolve();
          await boundary.authorizeDownstream(request);
        }),
      ),
    );
    expect(calls.map((call) => call.causalRunRef.reference.entityId).sort()).toEqual([
      "run-a",
      "run-b",
    ]);
    await expect(boundary.authorizeDownstream(request)).rejects.toThrow(TypeError);
    await expect(
      boundary.run({ authorization, causalRunRef: runRef("run-a") }, () =>
        boundary.authorizeDownstream({ ...request, actorId: "other-actor" }),
      ),
    ).rejects.toThrow(TypeError);
  });
  it("即时下游使用当前请求会话签发精确身份，不创建后台因果", async () => {
    const calls = [];
    const source = {
      context: authorization,
      branch: "knowledge-modeling.submit-revision",
      invocationId: "package-submit",
    };
    const boundary = createDeploymentAuthorizationScopeV1({
      access: {
        readDeploymentAuthorizationSource: async () => source,
        verify: async (input) => calls.push({ verify: input }),
        authorize: async (input) => {
          calls.push({ authorize: input });
          return { context: authorization };
        },
      },
      deploymentAuthorization: {
        issueDownstreamContexts: async () => [],
        resolveDownstreamContext: async () => {
          throw new Error("background not allowed");
        },
      },
      policy: {
        bindings: [
          {
            rootBranch: source.branch,
            downstreamBranches: ["knowledge-modeling.assessment-basis"],
          },
        ],
      },
    });
    await boundary.runRequest(async () => {
      await boundary.access.authorize({
        projectId: authorization.projectId,
        branch: source.branch,
        invocationId: source.invocationId,
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
        invocation: { kind: "human-session", sessionToken: "request-only-token" },
      });
      const input = { ...request, branch: "knowledge-modeling.assessment-basis" };
      await expect(boundary.authorizeDownstream(input)).resolves.toEqual(authorization);
      await expect(
        boundary.authorizeDownstream({ ...input, branch: "workflow.start-run" }),
      ).rejects.toThrow(TypeError);
    });
    expect(calls[2].authorize).toMatchObject({
      invocationId: request.invocationId,
      invocation: { kind: "human-session", sessionToken: "request-only-token" },
    });
    expect(calls[2].authorize.causalRunRef).toBeUndefined();
    expect(calls[2].authorize.causalCommandRef).toBeUndefined();
    await expect(boundary.authorizeDownstream(request)).rejects.toThrow(TypeError);
  });
  it("人类入口返回前签发批准的完整下游集合，普通同能力调用沿原授权口", async () => {
    const { boundary, calls } = setup();
    await boundary.access.authorize({
      ...request,
      branch: "workflow.start-run",
      invocation: { kind: "human-session", sessionToken: "test-session" },
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].branches).toEqual(["agent-task.start-task"]);
    await boundary.access.authorize({ ...request, invocation: { kind: "system" } });
    expect(calls).toHaveLength(1);
  });
  it("内部再次签发保留请求根，后台来源使用批准的真实父上下文", async () => {
    const root = { context: authorization, branch: "workflow.start-run", invocationId: "root" };
    const nestedAuthorization = {
      ...authorization,
      authorizationContextRef: {
        kind: "authorization-context",
        reference: ref("nested-authorization"),
      },
    };
    const calls = [];
    const boundary = createDeploymentAuthorizationScopeV1({
      access: {
        readDeploymentAuthorizationSource: async ({ authorizationContextRef }) =>
          authorizationContextRef.reference.entityId === "nested-authorization"
            ? { ...root, context: nestedAuthorization, branch: "agent-task.start-task" }
            : root,
        authorize: async ({ invocationId }) => ({
          context: invocationId === "nested" ? nestedAuthorization : authorization,
        }),
        verify: async () => ({ context: authorization }),
      },
      deploymentAuthorization: {
        issueDownstreamContexts: async () => [],
        resolveDownstreamContext: async (input) => {
          calls.push(input);
          return nestedAuthorization;
        },
      },
      policy: {
        bindings: [{ rootBranch: root.branch, downstreamBranches: ["agent-task.start-task"] }],
      },
    });
    const human = {
      ...request,
      invocationId: root.invocationId,
      branch: root.branch,
      invocation: { kind: "human-session", sessionToken: "request-token" },
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    };
    await boundary.runRequest(async () => {
      await boundary.access.authorize(human);
      await boundary.access.authorize({
        ...human,
        invocationId: "nested",
        branch: "agent-task.start-task",
      });
      await expect(boundary.resolveInvocationSource(request)).resolves.toEqual({
        kind: "human-session",
        sessionToken: "request-token",
      });
      await expect(boundary.authorizeDownstream(request)).resolves.toEqual(authorization);
    });
    await boundary.run({ authorization, causalRunRef: runRef("actual-run") }, async () => {
      await expect(boundary.resolveInvocationSource(request)).resolves.toMatchObject({
        kind: "system",
        parentContext: nestedAuthorization,
        causalRunRef: runRef("actual-run"),
      });
    });
    expect(calls[0]).toMatchObject({ root: authorization, invocationId: request.invocationId });
    await expect(boundary.resolveInvocationSource(request)).rejects.toThrow(TypeError);
  });
});

describe("交付取证 CLI 入口", () => {
  it("package.json 至少登记了验证、smoke 与基准三类交付命令", () => {
    expect(deliveryCliEntries.length).toBeGreaterThanOrEqual(3);
  });

  it.each(deliveryCliEntries)("%s 指向真实存在的脚本", (_name, command) => {
    const scriptPath = /node\s+(\S+)/.exec(command)?.[1];
    expect(scriptPath, `${_name} 未按 node <脚本> 形式登记`).toBeDefined();
    expect(existsSync(join(REPO_ROOT, scriptPath)), `${_name} 指向不存在的 ${scriptPath}`).toBe(
      true,
    );
  });

  it.each(deliveryCliEntries)("%s 不把子命令塞进脚本路径参数", (_name, command) => {
    // `release.mjs verify` 会让 verify 变成清单文件路径；子命令必须走脚本自己的契约。
    const afterScript = command.split(/\.mjs/)[1]?.trim() ?? "";
    expect(afterScript).toBe("");
  });
});

describe("部署基础输入装配", () => {
  it("真实初始化库装配完整 API、三图、五类任务和所属检查点证明后可关闭", async () => {
    const { startPostgresFixture } =
      await import("../../packages/adapters/test/postgres/fixture.ts");
    const { initializeDeploymentV1 } =
      await import("../../packages/adapters/dist/deployment/index.js");
    const postgres = await startPostgresFixture();
    const root = await mkdtemp(join(tmpdir(), "riskflow-host-graphs-"));
    let host;
    let workerHost;
    try {
      const { config, catalog } = deploymentPolicies(["project-rail-01"]);
      Object.assign(config.database, {
        host: postgres.app.host,
        port: postgres.app.port,
        name: postgres.app.database,
        migratorRoleName: postgres.migrator.user,
        appRoleName: postgres.app.user,
        workerRoleName: postgres.worker.user,
        checkpointerRoleName: postgres.checkpointer.user,
      });
      config.localRoots.dataRoot = root;
      config.localRoots.artifactRoot = join(root, "artifacts");
      config.retrievalQuality.datasets = config.retrievalQuality.datasets.filter(
        ({ projectId }) => projectId === "project-rail-01",
      );
      for (const dataset of config.retrievalQuality.datasets) {
        dataset.filePath = join(root, "retrieval-dataset.json");
        dataset.datasetRef = ref("retrieval-dataset");
      }
      await initializeDeploymentV1({
        config,
        migrationConnection: postgres.admin,
        migrationRoot: postgres.productionMigrationRoot,
        finalMigrationVersion: "000058",
        loginPasswords: {
          migratorRoleName: postgres.migrator.password,
          appRoleName: postgres.app.password,
          workerRoleName: postgres.worker.password,
          checkpointerRoleName: postgres.checkpointer.password,
          deploymentOperatorRoleName: "synthetic-operator-password",
        },
        checkpointerConnection: postgres.checkpointer,
        initialAdministrator: {
          loginName: "synthetic-host-admin",
          displayName: "合成宿主验收管理员",
          password: "synthetic-host-password-initial",
        },
      });
      const dataset = JSON.parse(
        readFileSync(
          join(REPO_ROOT, "references/acceptance/synthetic-v1/retrieval-dataset.json"),
          "utf8",
        ),
      );
      dataset.projectId = "project-rail-01";
      dataset.datasetRef = config.retrievalQuality.datasets[0].datasetRef;
      await writeFile(config.retrievalQuality.datasets[0].filePath, JSON.stringify(dataset));
      const secrets = {
        [config.database.rolePasswordSecretIds.appRoleName]: postgres.app.password,
        [config.database.rolePasswordSecretIds.workerRoleName]: postgres.worker.password,
        [config.database.rolePasswordSecretIds.checkpointerRoleName]:
          postgres.checkpointer.password,
        [config.auth.hmacSecretId]: Buffer.alloc(32, 1).toString("base64"),
      };
      for (const { backend, config: model } of config.models)
        if (backend === "network-api" && model.protocol === "openai-chat")
          secrets[model.credentialRef] = "synthetic-unused-credential";
      const policies = resolveDeploymentPoliciesV1({ config, catalog });
      host = await createDeploymentApiV1({
        config,
        secrets,
        policies,
        role: "api",
        finalMigrationVersion: "000058",
      });
      expect(
        host.registry
          .values()
          .map(({ metadata }) => metadata.taskType)
          .sort(),
      ).toEqual([
        "calibration-suggestion",
        "data-cleaning",
        "knowledge-authoring",
        "response-recommendation",
        "retrieval-review",
      ]);
      expect(host.riskFlow.compositions.size).toBe(1);
      expect(host.assessment.readers.responseContext.readRecommendationContext).toBeTypeOf(
        "function",
      );
      expect(host.ports.riskAssessmentRead).toBe(host.assessment.readers.riskAssessment);
      expect(await createDeploymentAgentRunnerV1(host).runOnce()).toMatchObject({
        processedTasks: 0,
        settledFailures: 0,
        unsettledFailures: [],
      });
      const schema = await host.app.inject({ method: "GET", url: "/api/v1/openapi.json" });
      expect(schema.statusCode).toBe(200);
      expect(host.app.server.listening).toBe(false);
      const login = await host.foundation.access.login({
        kind: "login",
        loginAttemptId: "host-admin-login",
        loginName: "synthetic-host-admin",
        password: "synthetic-host-password-initial",
      });
      const session = await host.foundation.access.changePassword({
        kind: "change-password",
        sessionToken: login.sessionToken,
        newPassword: "synthetic-host-password-changed",
      });
      await host.foundation.access.executeDeploymentProjectAccess({
        sessionToken: session.sessionToken,
        command: {
          kind: "open-project",
          projectId: "project-rail-01",
          commandId: "host-open-project",
          idempotencyKey: "host-open-project",
          expectedVersion: "none",
          initialRiskManagerAccountId: session.accountRef.entityId,
          includeAdministrator: true,
        },
      });
      const request = {
        method: "POST",
        url: "/api/v1/projects/project-rail-01/commands/risk-identification.plan",
        headers: {
          origin: config.publicOrigin,
          "content-type": "application/json",
          cookie: `${HTTP_COOKIE_NAME_V1}=${session.sessionToken}`,
        },
        payload: {
          schemaVersion: "1",
          commandId: "host-api-plan",
          idempotencyKey: "host-api-plan",
          issuedAt: new Date().toISOString(),
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          payload: {
            inputSnapshotRef: {
              kind: "identification-input-snapshot",
              reference: { entityId: "missing-input", versionId: "v1" },
            },
          },
        },
      };
      const blockedPlan = await host.app.inject(request);
      expect(blockedPlan.statusCode).toBe(422);
      expect(blockedPlan.json()).toMatchObject({ code: "BUSINESS_BLOCKED" });
      await host.foundation.access.logout({ kind: "logout", sessionToken: session.sessionToken });
      expect((await host.app.inject(request)).statusCode).toBe(401);
      const versions = await host.ports.systemOperationsRead.read({
        schemaVersion: "1",
        queryId: "models",
        requestedAt: new Date().toISOString(),
        payload: { kind: "model-versions" },
      });
      expect(versions.result.items).toHaveLength(5);
      for (const item of versions.result.items) {
        expect(
          config.models.some(
            ({ config: model }) =>
              JSON.stringify(model.deploymentRef) === JSON.stringify(item.deploymentRef),
          ),
        ).toBe(true);
        expect(item).not.toHaveProperty("baseUrl");
      }
      const system = createDeploymentSystemOperationsV1({
        foundation: host.foundation,
        registry: host.registry,
        app: host.app,
        secrets,
      });
      const signal = new AbortController().signal;
      expect(await system.probe("api", signal)).toMatchObject({ status: "unavailable" });
      expect(await system.probe("postgresql", signal)).toMatchObject({ status: "available" });
      expect(await system.probe("artifact-store", signal)).toMatchObject({ status: "available" });
      await host.listen({ host: "127.0.0.1", port: 0 });
      expect(await system.probe("api", signal)).toMatchObject({ status: "available" });
      expect(await host.close()).toMatchObject({ settled: true });
      expect(host.app.server.listening).toBe(false);
      expect(await host.close()).toMatchObject({ settled: true });
      workerHost = await createDeploymentWorkerV1({
        config,
        secrets,
        policies,
        finalMigrationVersion: "000058",
      });
      expect(workerHost.registry.missingConsumers()).toEqual([]);
      expect(await workerHost.runOnce()).toMatchObject([
        { processedTasks: 0, settledFailures: 0 },
        0,
      ]);
      expect(await workerHost.close()).toMatchObject({ settled: true });
      expect(await workerHost.close()).toMatchObject({ settled: true });
    } finally {
      await workerHost?.close();
      await host?.close();
      await postgres.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("模型健康探针使用真实有限端点、拒绝重定向并响应取消", async () => {
    let status = 200;
    let hold = false;
    const paths = [];
    const server = createServer((request, response) => {
      paths.push(request.url);
      if (hold) return;
      response.writeHead(status, status === 302 ? { location: "http://127.0.0.1:1/secret" } : {});
      response.end("synthetic-health");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const system = createDeploymentSystemOperationsV1({
      foundation: {
        config: {
          models: [
            {
              backend: "llamacpp",
              config: { baseUrl: `http://127.0.0.1:${server.address().port}` },
            },
          ],
        },
      },
      registry: { values: () => [] },
      secrets: {},
    });
    try {
      expect(await system.probe("model-gateway", new AbortController().signal)).toMatchObject({
        status: "available",
      });
      status = 503;
      expect(await system.probe("model-gateway", new AbortController().signal)).toMatchObject({
        status: "unavailable",
      });
      status = 302;
      await expect(system.probe("model-gateway", new AbortController().signal)).rejects.toThrow();
      hold = true;
      await expect(system.probe("model-gateway", AbortSignal.timeout(50))).rejects.toThrow();
      expect(paths.every((path) => path === "/health")).toBe(true);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  const SECRET_MARKER = "secret-material-";

  /** 全量真实文件：严格配置、发布清单、策略目录、数据集与逐角色秘密文件。 */
  const foundationFixture = async () => {
    const root = await mkdtemp(join(tmpdir(), "riskflow-foundation-input-"));
    await chmod(root, 0o700);
    const { config, catalog } = deploymentPolicies();
    config.localRoots.dataRoot = join(root, "data");
    config.policyCatalog.filePath = join(config.localRoots.dataRoot, "catalog.json");
    await mkdir(config.localRoots.dataRoot, { mode: 0o700 });
    const template = JSON.parse(
      readFileSync(
        join(REPO_ROOT, "references/acceptance/synthetic-v1/retrieval-dataset.json"),
        "utf8",
      ),
    );
    config.retrievalQuality.datasets = [];
    for (const binding of config.projectBindings) {
      const dataset = structuredClone(template);
      dataset.projectId = binding.projectId;
      dataset.datasetRef = ref("retrieval-dataset");
      const filePath = join(config.localRoots.dataRoot, `${binding.projectId}.json`);
      await writeFile(filePath, JSON.stringify(dataset));
      config.retrievalQuality.datasets.push({
        projectId: dataset.projectId,
        datasetRef: dataset.datasetRef,
        filePath,
      });
    }
    const secretFiles = {};
    for (const ref of config.database.secretFileRefs) {
      const filePath = join(root, `${ref.secretId}.secret`);
      await writeFile(filePath, `${SECRET_MARKER}${ref.secretId}\n`, { mode: 0o600 });
      ref.filePath = filePath;
      secretFiles[ref.secretId] = filePath;
    }
    const configFile = join(root, "config.json");
    const manifestFile = join(root, "manifest.json");
    const manifest = JSON.parse(
      readFileSync(join(REPO_ROOT, "deployment/release-manifest.example.json"), "utf8"),
    );
    await writeFile(config.policyCatalog.filePath, JSON.stringify(catalog));
    await writeFile(configFile, JSON.stringify(config));
    await writeFile(manifestFile, JSON.stringify(manifest));
    return {
      root,
      config,
      manifest,
      configFile,
      manifestFile,
      secretFiles,
      rewriteConfig: async () => writeFile(configFile, JSON.stringify(config)),
      rewriteManifest: async () => writeFile(manifestFile, JSON.stringify(manifest)),
    };
  };

  const failureCodes = (error) =>
    Array.isArray(error?.issues) && error.issues.length > 0
      ? error.issues.flatMap((issue) => [issue.message, issue.path.join(".")])
      : [error?.code ?? error?.message];

  it("api 角色在严格配置与发布一致后只加载职责秘密", async () => {
    const { configFile, manifestFile, config } = await foundationFixture();
    const input = await loadDeploymentFoundationInputV1({ configFile, manifestFile, role: "api" });
    expect(input.role).toBe("api");
    expect(input.finalMigrationVersion).toBe("000058");
    // api 职责 = 应用库 + checkpointer + 模型凭据 + 鉴权；worker/迁移/运维密码不进入本机。
    expect(Object.keys(input.secrets).sort()).toEqual([
      "auth-hmac-key",
      "db-app-password",
      "db-checkpointer-password",
      "minimax-api-key",
    ]);
    expect(input.secrets["auth-hmac-key"]).toContain(SECRET_MARKER);
    expect(
      input.policies.resolveProject("project-rail-01").policies["hybrid-retrieval"].policyRef,
    ).toEqual(policyRefs["hybrid-retrieval"]);
    expect(input.retrievalDatasets.map((dataset) => dataset.projectId).sort()).toEqual(
      config.projectBindings.map((binding) => binding.projectId).sort(),
    );
  });

  it("provision 角色不加载策略与数据集，只加载管理员库与鉴权秘密", async () => {
    const { configFile, manifestFile, config } = await foundationFixture();
    await rm(config.policyCatalog.filePath);
    const input = await loadDeploymentFoundationInputV1({
      configFile,
      manifestFile,
      role: "provision",
    });
    expect(input.policies).toBeUndefined();
    expect(input.retrievalDatasets).toBeUndefined();
    expect(Object.keys(input.secrets).sort()).toEqual(["auth-hmac-key", "db-app-password"]);
  });

  it.each([
    ["运行角色不在职责集合内", () => ({ role: "migrator" }), "DEPLOYMENT_ROLE_INVALID"],
    [
      "配置违反严格契约",
      async (fixture) => {
        delete fixture.config.auth.hmacSecretId;
        await fixture.rewriteConfig();
      },
      "auth.hmacSecretId",
    ],
    [
      "发布清单与配置不属于同一 release",
      async (fixture) => {
        fixture.manifest.releaseId = "release-other";
        await fixture.rewriteManifest();
      },
      "DEPLOYMENT_RELEASE_MISMATCH",
    ],
    [
      "策略目录超出受控根",
      async (fixture) => {
        fixture.config.policyCatalog.filePath = join(fixture.root, "catalog.json");
        await fixture.rewriteConfig();
      },
      "DEPLOYMENT_CONTROLLED_PATH_INVALID",
    ],
    [
      "策略目录是符号链接",
      async (fixture) => {
        const linked = join(fixture.config.localRoots.dataRoot, "catalog-link.json");
        await symlink(fixture.config.policyCatalog.filePath, linked);
        fixture.config.policyCatalog.filePath = linked;
        await fixture.rewriteConfig();
      },
      "DEPLOYMENT_CONTROLLED_PATH_SYMLINK",
    ],
    [
      "策略目录超过读取上限",
      async (fixture) => writeFile(fixture.config.policyCatalog.filePath, Buffer.alloc(1_048_577)),
      "DEPLOYMENT_POLICY_CATALOG_FILE_INVALID",
    ],
    [
      "配置未绑定本角色必需秘密",
      async (fixture) => {
        fixture.config.database.secretFileRefs = fixture.config.database.secretFileRefs.filter(
          (ref) => ref.secretId !== "auth-hmac-key",
        );
        await fixture.rewriteConfig();
      },
      "database.secretFileRefs",
    ],
    [
      "秘密文件缺失",
      async (fixture) => rm(fixture.secretFiles["auth-hmac-key"]),
      "SECRET_FILE_MISSING",
    ],
    [
      "秘密文件权限过宽",
      async (fixture) => chmod(fixture.secretFiles["auth-hmac-key"], 0o644),
      "SECRET_FILE_TOO_PERMISSIVE",
    ],
  ])("%s 时失败闭合，且错误不含秘密", async (_name, mutate, code) => {
    const fixture = await foundationFixture();
    const overrides = (await mutate(fixture)) ?? {};
    let error;
    await loadDeploymentFoundationInputV1({
      configFile: fixture.configFile,
      manifestFile: fixture.manifestFile,
      role: "api",
      ...overrides,
    }).catch((caught) => {
      error = caught;
    });
    expect(failureCodes(error)).toContain(code);
    const rendered = `${error.message} ${JSON.stringify(error.issues ?? [])}`;
    expect(rendered).not.toContain(SECRET_MARKER);
    for (const filePath of Object.values(fixture.secretFiles))
      expect(rendered).not.toContain(filePath);
  });
});
