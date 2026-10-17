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
import networkModels from "../../deployment/model-gateway-config.example.json" with { type: "json" };
import { authorizationScopeDigest } from "../../packages/core/dist/retrieval/index.js";
import {
  createDeploymentAuthorizedArtifactStoreV1,
  createDeploymentAuthorizedModelGatewayV1,
  createDeploymentModelGatewayV1,
  createDeploymentAuthorizationScopeV1,
  createDeploymentRuntimeAuthorizationV1,
  createDeploymentCheckpointValidatorV1,
  createDeploymentScoringGovernanceV1,
  createDeploymentScoringConflictReviewV1,
  createDeploymentIdentificationAuthorizationV1,
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

describe("knowledge failure settlement source", () => {
  it.each(["valid", "missing", "wrong-project", "wrong-actor", "wrong-task"])(
    "uses a separate control scope with an exact task envelope: %s",
    async (scenario) => {
      const taskRef = {
        kind: "agent-task",
        reference: { entityId: "failure-task", versionId: "1" },
        taskType: "knowledge-authoring",
      };
      const input = { projectId: "project", actorId: "actor", taskRef };
      const envelope = {
        agentTaskRef: structuredClone(taskRef),
        projectId: "project",
        actorId: "actor",
        authorization: { projectId: "project", actorId: "actor" },
        parentRunRef: { kind: "workflow-run", reference: { entityId: "parent", versionId: "1" } },
      };
      if (scenario === "wrong-project") envelope.projectId = "other";
      if (scenario === "wrong-actor") envelope.actorId = "other";
      if (scenario === "wrong-task") envelope.agentTaskRef.reference.versionId = "other";
      const operation = vi.fn(async () => undefined);
      const run = vi.fn(async (_input, op) => op());
      const tasks = {
        claim: async () => undefined,
        getTask: vi.fn(async () => (scenario === "missing" ? undefined : { envelope })),
      };
      const settleAuthoringFailures = vi.fn(async (runAttempt) => {
        await runAttempt(input, operation);
        return { settled: 1, failures: [] };
      });
      const runner = createDeploymentAgentRunnerV1({
        foundation: {
          config: { instanceId: "worker", worker: { leaseTimeoutMs: 30000, maxConcurrency: 1 } },
          authorizationScope: { run, runTask: vi.fn(), setTaskAction: vi.fn() },
        },
        tasks,
        registry: {},
        assessment: { modelStep: {} },
        identification: { compositions: { knowledge: { adapter: { settleAuthoringFailures } } } },
      });
      if (scenario === "valid") {
        expect(await runner.runOnce()).toMatchObject({ settledFailures: 1 });
        expect(run).toHaveBeenCalledWith(
          { authorization: envelope.authorization, causalRunRef: envelope.parentRunRef },
          expect.any(Function),
        );
        expect(operation).toHaveBeenCalledOnce();
      } else {
        await expect(runner.runOnce()).rejects.toBeInstanceOf(TypeError);
        expect(run).not.toHaveBeenCalled();
        expect(operation).not.toHaveBeenCalled();
      }
      expect(tasks.getTask).toHaveBeenCalledWith(taskRef);
    },
  );
});
import { identificationRunIdentityFor } from "../../apps/worker/dist/index.js";
import { structuredRequest, testRequestBase } from "../../packages/adapters/test/model/fixture.ts";
import { HTTP_COOKIE_NAME_V1 } from "../../apps/api/dist/index.js";
import { z } from "../../packages/core/dist/model/index.js";

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "..", "..", "..");

describe("评分冲突复核的当前授权接线", () => {
  it("创建与决定读取按各自分支和调用身份受权，失败不形成链接", async () => {
    const authorization = { actorId: "actor", projectId: "project" };
    const authorizeDownstream = vi.fn(async () => authorization);
    const task = { kind: "review-task", reference: { entityId: "review", versionId: "1" } };
    const review = {
      requestReview: vi.fn(async () => ({ kind: "succeeded", result: { reviewTaskRef: task } })),
      readRuleConflictDecision: vi.fn(async () => ({
        kind: "decided",
        decision: "approve-publication",
      })),
    };
    const policy = { conflictPriorityPolicyRef: { entityId: "priority", versionId: "1" } };
    const seam = createDeploymentScoringConflictReviewV1({ authorizeDownstream, review, policy });
    const input = {
      projectId: "project",
      authorization,
      commandId: "create",
      idempotencyKey: "create",
      issuedAt: "2030-01-01T00:00:00Z",
      relation: { relationId: "relation" },
    };
    expect(await seam.ensureConflictReviewTask(input)).toEqual({
      kind: "succeeded",
      reviewTaskRef: task,
      reviewAttemptId: "create",
    });
    expect(review.requestReview).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization,
        commandId: "create",
        payload: expect.objectContaining({
          reviewType: "rule-conflict",
          targetRef: {
            kind: "rule-conflict",
            reference: { entityId: "rule-relation:relation", versionId: "1" },
          },
          reviewPolicyRef: policy.conflictPriorityPolicyRef,
        }),
      }),
    );
    await seam.readRuleConflictDecision({
      projectId: "project",
      authorization,
      invocationId: "read",
      requestedAt: input.issuedAt,
      relationRef: { kind: "rule-conflict" },
      reviewTaskRef: task,
    });
    expect(
      authorizeDownstream.mock.calls.map(([request]) => [request.branch, request.invocationId]),
    ).toEqual([
      ["review-audit.request-review", "create"],
      ["review-audit.trace", "read"],
    ]);
    const failed = { kind: "failed", error: { code: "AUTHORIZATION_DENIED" } };
    review.requestReview.mockResolvedValueOnce(failed);
    expect(await seam.ensureConflictReviewTask(input)).toEqual(failed);
    authorizeDownstream.mockResolvedValueOnce({ ...authorization, actorId: "other" });
    await expect(seam.ensureConflictReviewTask(input)).rejects.toThrow(TypeError);
    expect(review.requestReview).toHaveBeenCalledTimes(2);
  });
});

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
        finalMigrationVersion: "000059",
      }),
    ).rejects.toThrow("DEPLOYMENT_DATABASE_SECRET_MISSING");
  });
  it.each(["api", "worker"])("%s 缺引用校验或独立密码时在连接前拒绝", async (role) => {
    const input = {
      config: deploymentConfig,
      secrets: {},
      role,
      finalMigrationVersion: "000059",
    };
    await expect(createDeploymentFoundationV1(input)).rejects.toThrow(
      "DEPLOYMENT_CHECKPOINT_VALIDATOR_REQUIRED",
    );
    await expect(
      createDeploymentFoundationV1({ ...input, validateCheckpointState: async () => false }),
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

describe("生产检查点运行归属", () => {
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
    return {
      state,
      runtimeContext,
      validate: createDeploymentCheckpointValidatorV1({
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
      }),
    };
  };
  it.each(["identification", "assessment", "riskFlow"])(
    "%s 进度保存只核对所属运行和图版本",
    async (kind) => {
      const world = setup(kind);
      for (const operation of ["put", "put-writes", "get", "list"])
        expect(
          await world.validate({
            operation,
            state: world.state,
            runtimeContext: world.runtimeContext,
          }),
        ).toBe(true);
      for (const state of [
        { ...world.state, threadId: "other-thread" },
        {
          ...world.state,
          runRef: { kind: "workflow-run", reference: { entityId: "other-run", versionId: "v1" } },
        },
        { ...world.state, graphVersion: { entityId: "graph", versionId: "v2" } },
      ])
        expect(
          await world.validate({ operation: "put", state, runtimeContext: world.runtimeContext }),
        ).toBe(false);
    },
  );
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
  it("检索投影与知识正文读取分别请求所属能力", async () => {
    const authorizeCurrent = vi.fn(async (request) => request);
    const authorization = createDeploymentIdentificationAuthorizationV1({
      access: {},
      authorizationScope: { authorizeCurrent },
    });
    await authorization.authorizeHybridRetrievalProjection({
      projectId: "p-1",
      eventId: "event-1",
    });
    await authorization.authorizeIdentificationReleaseRead({
      projectId: "p-1",
      actorId: "actor-1",
      invocationId: "read-1",
    });
    expect(authorizeCurrent.mock.calls.map(([request]) => request.branch)).toEqual([
      "knowledge-modeling.hybrid-evidence",
      "knowledge-modeling.identification-basis",
    ]);
  });
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
        knowledge: {
          governedReleases: {
            resolveGovernedReleases: async () => undefined,
            publishDerivedRelease: async () => undefined,
          },
          adapter: { govern: async () => undefined },
        },
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
    expect(() => scoring.assembly.assemble({ projectId: "other-project" })).toThrow(TypeError);
  });

  it("评分修订元数据按直接projectId路由到所属异步适配器", async () => {
    const { PostgresScoringRulesAdapter } =
      await import("../../packages/adapters/dist/scoring-rules/index.js");
    const append = vi
      .spyOn(PostgresScoringRulesAdapter.prototype, "appendPreparedRevision")
      .mockResolvedValueOnce(undefined);
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
      resolveDeploymentPolicies: { resolveProject: () => ({ policies: { "scoring-rules": {} } }) },
      authorizeDownstream: async () => undefined,
      review: {},
    });
    const context = {},
      input = { projectId: "p-1" };
    try {
      await scoring.policy.appendPreparedRevision(context, input);
      expect(append).toHaveBeenCalledWith(context, input);
    } finally {
      append.mockRestore();
    }
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
  const manifest = {
    artifactRef: open.artifactRef,
    purposeCode: common.purposeCode,
    access: {
      projectId: authorization.projectId,
      spatialScopeRefs: authorization.spatialScopeRefs,
      sourceAccessGrantRefs: authorization.sourceAccessGrantRefs,
    },
    evidenceReferences: [
      { sourceVersion: ref("source-original"), locator: { sourceSegmentId: "segment-1" } },
    ],
  };
  it.each(["put", "open"])("%s 复验失败时不产生工件副作用", async (method) => {
    let called = false;
    const store = createDeploymentAuthorizedArtifactStoreV1({
      store: {
        readManifest: async () => manifest,
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
    const handle = { content: [], completed: Promise.resolve({}) };
    const store = createDeploymentAuthorizedArtifactStoreV1({
      access: {
        verifyDeploymentContext: async (input) => {
          expect(input.authorizationContextRef).toEqual(authorization.authorizationContextRef);
          if (input.requestedSourceVersionRefs.length > 0)
            expect(input.requestedSourceVersionRefs).toEqual([
              { kind: "source-version", reference: ref("source-original") },
            ]);
          return { context: verified };
        },
      },
      store: {
        readManifest: async () => manifest,
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
  it("同空间多父工件以唯一空间并集完成当前权限复验", async () => {
    const scope = { kind: "spatial-scope", reference: ref("shared-scope") };
    const current = { ...authorization, spatialScopeRefs: [scope] };
    const store = createDeploymentAuthorizedArtifactStoreV1({
      access: {
        verifyDeploymentContext: async (request) => {
          expect(request.requestedSpatialScopeRefs).toEqual([scope]);
          return { context: current };
        },
      },
      store: {
        readManifest: async () => ({
          ...manifest,
          access: { ...manifest.access, spatialScopeRefs: [scope] },
        }),
        put: async () => ({ stored: true }),
      },
    });
    await expect(
      store.put(
        {
          ...put,
          authorization: current,
          parentArtifactRefs: [
            {
              ...open.artifactRef,
              reference: { ...open.artifactRef.reference, entityId: "parent-a" },
            },
            {
              ...open.artifactRef,
              reference: { ...open.artifactRef.reference, entityId: "parent-b" },
            },
          ],
        },
        [],
      ),
    ).resolves.toEqual({ stored: true });
  });
  it.each(["put", "open"])("%s 无逐段证据时仍按登记资料限制复验", async (method) => {
    const grant = { kind: "source-access-grant", reference: ref("frozen-source-grant") };
    const current = { ...authorization, sourceAccessGrantRefs: [grant] };
    const handle = { content: [], completed: Promise.resolve({}) };
    const store = createDeploymentAuthorizedArtifactStoreV1({
      access: {
        verifyDeploymentContext: async (input) => ({
          context: {
            ...current,
            sourceAccessGrantRefs: input.requestedSourceAccessGrantRefs ?? [],
          },
        }),
      },
      store: {
        readManifest: async () => ({
          ...manifest,
          evidenceReferences: [],
          access: { ...manifest.access, sourceAccessGrantRefs: [grant] },
        }),
        open: async (input) => {
          expect(input.authorization.sourceAccessGrantRefs).toContainEqual(grant);
          return handle;
        },
        put: async (input) => {
          expect(input.authorization.sourceAccessGrantRefs).toContainEqual(grant);
          return handle;
        },
      },
    });
    expect(
      await store[method]({ ...(method === "put" ? put : open), authorization: current }, []),
    ).toBe(handle);
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
  it("模型复验保留输入资料限制而不要求重复逐段证据", async () => {
    const sourceAccessGrantRefs = [{ kind: "source-access-grant", reference: ref("model-source") }];
    const request = structuredRequest();
    request.authorization = { ...request.authorization, sourceAccessGrantRefs };
    const result = {};
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: {
        verifyDeploymentContext: async (input) => {
          expect(input.requestedSourceAccessGrantRefs).toEqual(sourceAccessGrantRefs);
          return { context: request.authorization };
        },
      },
      gateway: { completeStructured: async () => result },
    });
    expect(await gateway.completeStructured(request, {})).toBe(result);
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

describe("模型父工件来源预检", () => {
  const parentRef = {
    kind: "content-artifact",
    reference: { entityId: "model-input", versionId: `sha256:${"a".repeat(64)}` },
  };
  it.each(["allowed", "missing", "denied", "revoked"])(
    "%s 按来源权限检查，无需预读全文",
    async (outcome) => {
      const request = {
        ...structuredRequest(),
        modelDeploymentRef: networkModels[0].config.deploymentRef,
        parentArtifactRefs: [parentRef],
      };
      const open = vi.fn();
      const readArtifactManifest = vi.fn(async () =>
        outcome === "missing"
          ? undefined
          : {
              artifactRef: parentRef,
              purposeCode: "agent-model-input",
              access: {
                projectId: request.projectId,
                spatialScopeRefs: request.authorization.spatialScopeRefs,
                sourceAccessGrantRefs:
                  outcome === "denied"
                    ? [{ kind: "source-access-grant", reference: ref("unavailable-grant") }]
                    : request.authorization.sourceAccessGrantRefs,
                authorizationPolicyRefs: [request.authorization.authorizationPolicyRef],
              },
            },
      );
      const fetcher = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("test-stop"));
      try {
        const gateway = createDeploymentModelGatewayV1({
          config: { ...deploymentConfig, models: networkModels },
          secrets: { [networkModels[0].config.credentialRef]: "test-credential" },
          access: {
            verifyDeploymentContext: async () => {
              if (outcome === "revoked") throw { details: { code: "AUTHORIZATION_DENIED" } };
              return { context: request.authorization };
            },
          },
          artifactStore: { open },
          readArtifactManifest,
        });
        await expect(
          gateway.completeStructured(request, z.object({ ok: z.boolean() })),
        ).rejects.toMatchObject({
          code: outcome === "allowed" ? "MODEL_SERVICE_UNAVAILABLE" : "MODEL_AUTHORIZATION_DENIED",
        });
        expect(open).not.toHaveBeenCalled();
        expect(fetcher).toHaveBeenCalledTimes(outcome === "allowed" ? 1 : 0);
      } finally {
        fetcher.mockRestore();
      }
    },
  );
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
      schemaVersion: "2",
      policyRef: policyRefs.cleaning,
      allowedExclusionReasonCodes: ["duplicate-content"],
      protectedSegmentKinds: ["monitoring-window"],
      documentRules: [
        { inputKind: "csv", requiredSegmentKinds: ["table"] },
        { inputKind: "xlsx", requiredSegmentKinds: ["table"] },
        { inputKind: "docx", requiredSegmentKinds: ["chapter", "table"] },
        { inputKind: "text-pdf", requiredSegmentKinds: ["chapter", "table"] },
        { inputKind: "ocr-layout", requiredSegmentKinds: ["chapter", "table"] },
      ],
      protectedMonitoringSelectionReasons: ["latest-valid"],
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
      budgetPolicy: { ...agentBudget("retrieval-review"), maxSupplementarySearches: 2 },
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
  it("候选和评分编制只引用目录预算，成员归属由清单确定", () => {
    const { config, catalog } = deploymentPolicies(["project-rail-01"]);
    const candidate = catalog.entries.find((entry) => entry.policyType === "risk-candidate");
    const scoring = catalog.entries.find((entry) => entry.policyType === "scoring-rules");
    const candidateBudget = candidate.body.generation.budget;
    const scoringAgent = scoring.body.agent;
    const expectedScoring = structuredClone(scoring.body);
    for (const policy of Object.values(candidate.body)) delete policy.policySetRef;
    delete candidate.body.generation.budget;
    candidate.body.generation.schemaVersion = "2";
    scoring.body.schemaVersion = "2";
    scoring.body.agent = {
      definitionRef: scoringAgent.definitionRef,
      incrementSchemaRef: scoringAgent.incrementSchemaRef,
      validationPolicyRef: scoringAgent.validationPolicyRef,
      budgetPolicyRef: scoringAgent.budgetPolicyRef,
    };
    catalog.budgetPolicies = [
      {
        schemaVersion: 1,
        projectId: candidate.projectId,
        policyType: "risk-candidate-budget",
        policyRef: candidate.body.generation.budgetPolicyRef,
        approval,
        body: candidateBudget,
      },
      {
        schemaVersion: 1,
        projectId: scoring.projectId,
        policyType: "agent-task-budget",
        policyRef: scoringAgent.budgetPolicyRef,
        approval,
        body: scoringAgent.budgetPolicy,
      },
    ];
    const project = resolveDeploymentPoliciesV1({ config, catalog }).resolveProject(
      candidate.projectId,
    );
    expect(project.policies["risk-candidate"].generation.budget).toEqual(candidateBudget);
    expect(project.policies["scoring-rules"]).toEqual(expectedScoring);
    catalog.budgetPolicies = [];
    expectPolicyCode(
      () => resolveDeploymentPoliciesV1({ config, catalog }),
      "DEPLOYMENT_POLICY_NOT_FOUND",
    );
  });
  it("缺少处置及校准配置时仍解析已经具备的识别和评分配置", () => {
    const { config, catalog } = deploymentPolicies();
    for (const binding of config.projectBindings) {
      for (const kind of [
        "response-generation",
        "response-validation",
        "response-agent",
        "calibration",
      ])
        delete binding.policyRefs[kind];
    }
    catalog.entries = catalog.entries.filter(
      (entry) =>
        !["response-generation", "response-validation", "response-agent", "calibration"].includes(
          entry.policyType,
        ),
    );
    const project = resolveDeploymentPoliciesV1({ config, catalog }).resolveProject(
      "project-rail-01",
    );
    expect(project.policies["assessment-runtime"]).toBeDefined();
    expect(project.policies["identification-graph"]).toBeDefined();
    expect(project.policies.calibration).toBeUndefined();
  });
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

  it("软件release变化后复用原批准的策略版本", () => {
    const { config, catalog } = deploymentPolicies();
    catalog.entries[0].approval.releaseId = "release-other";

    expect(
      resolveDeploymentPoliciesV1({ config, catalog }).resolveProject("project-rail-01"),
    ).toBeDefined();
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
  it("D-52 当前父恢复身份直接复验，不派生另一启动分支", async () => {
    const { port, source, calls, downstream } = setup();
    source.branch = "workflow.resume-run";
    source.invocationId = "actual-parent-resume";
    expect(
      await port.verifyCurrent({
        authorization,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        invocationId: source.invocationId,
        branch: source.branch,
      }),
    ).toEqual(authorization);
    expect(downstream).toHaveLength(0);
    expect(calls).toEqual([
      expect.objectContaining({
        invocationId: source.invocationId,
        branch: "workflow.resume-run",
      }),
    ]);
  });

  it("历史快照变化不阻断当前权限，错主体与真实撤权仍拒绝，数据库故障继续抛出", async () => {
    const { port, source, calls, downstream, access } = setup();
    const request = {
      authorization,
      invocationId: "derived-action",
      branch: "risk-identification.run-read",
    };
    await expect(port.verifyCurrent({ ...request, actorId: "other" })).resolves.toBeUndefined();
    source.context = { ...authorization, decidedAt: "2030-01-02T00:00:00.000Z" };
    await expect(port.verifyCurrent(request)).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
    downstream.length = 0;
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
        sourceVersionRefs: [],
        ...sourceOverrides,
      }),
      authorize: async () => ({ context: authorization }),
      readSession: vi.fn(async () => ({
        accountRef: { entityId: authorization.actorId, versionId: "1" },
      })),
      authorizeBusinessAction: async (input) => {
        calls.push(input);
        return { context: authorization, redacted: false };
      },
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
  it.each(["verify", "verifyDeploymentContext"])(
    "%s 按原上下文范围复验，保留明确请求并拒绝撤权及未知引用",
    async (method) => {
      const ownScope = { kind: "spatial-scope", reference: ref("scope:own") };
      const otherScope = { kind: "spatial-scope", reference: ref("scope:other") };
      const ownSource = { kind: "source-version", reference: ref("source:own") };
      const otherSource = { kind: "source-version", reference: ref("source:other") };
      const ambient = {
        ...authorization,
        authorizationContextRef: {
          kind: "authorization-context",
          reference: ref("ambient-context"),
        },
        grantedCapabilities: ["workflow.start"],
        spatialScopeRefs: [ownScope, otherScope],
      };
      const original = {
        ...ambient,
        authorizationContextRef: {
          kind: "authorization-context",
          reference: ref("original-context"),
        },
        spatialScopeRefs: [ownScope],
      };
      const sources = new Map([
        ["ambient-context", { context: ambient, sourceVersionRefs: [ownSource, otherSource] }],
        ["original-context", { context: original, sourceVersionRefs: [ownSource] }],
      ]);
      let allowed = true;
      const reauthorize = vi.fn(async (input) => {
        if (!allowed) throw Error("CURRENT_AUTHORIZATION_DENIED");
        return {
          context: {
            ...original,
            sourceAccessGrantRefs: input.requestedSourceVersionRefs.map((source) => ({
              kind: "source-access-grant",
              reference: ref(source.reference.entityId, "current"),
            })),
          },
          redacted: false,
        };
      });
      const boundary = createDeploymentAuthorizationScopeV1({
        access: {
          readDeploymentAuthorizationSource: async (input) =>
            sources.get(input.authorizationContextRef.reference.entityId),
          authorizeBusinessAction: reauthorize,
        },
      });
      const request = {
        authorizationContextRef: original.authorizationContextRef,
        projectId: original.projectId,
        actorId: original.actorId,
        invocationId: "verify-own",
        ...(method === "verify"
          ? { branch: "workflow.start-run" }
          : { requiredCapability: "workflow.start" }),
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      };
      const run = (operation) =>
        boundary.run({ authorization: ambient, causalRunRef: runRef("scope-parent") }, operation);
      await run(async () => {
        const current = await boundary.access[method](request);
        expect(reauthorize.mock.calls.at(-1)[0]).toMatchObject({
          requestedSpatialScopeRefs: [ownScope],
          requestedSourceVersionRefs: [ownSource],
          authorizationContextRef: original.authorizationContextRef,
        });
        expect(current.context.sourceAccessGrantRefs).toEqual([
          { kind: "source-access-grant", reference: ref(ownSource.reference.entityId, "current") },
        ]);
        await boundary.access[method]({
          ...request,
          invocationId: "verify-explicit",
          requestedSpatialScopeRefs: [otherScope],
          requestedSourceVersionRefs: [otherSource],
        });
        expect(reauthorize.mock.calls.at(-1)[0]).toMatchObject({
          requestedSpatialScopeRefs: [otherScope],
          requestedSourceVersionRefs: [otherSource],
        });
        await boundary.authorizeDownstream({
          projectId: ambient.projectId,
          actorId: ambient.actorId,
          branch: "workflow.start-run",
          invocationId: "new-empty",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        expect(reauthorize.mock.calls.at(-1)[0]).toMatchObject({
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        const calls = reauthorize.mock.calls.length;
        await expect(
          boundary.access[method]({
            ...request,
            authorizationContextRef: { kind: "authorization-context", reference: ref("unknown") },
          }),
        ).rejects.toThrow();
        expect(reauthorize).toHaveBeenCalledTimes(calls);
      });
      allowed = false;
      await expect(run(() => boundary.access[method](request))).rejects.toThrow();
    },
  );
  it("任务租约作用域统一复验模型、工件与领域访问，并保留原幂等身份", async () => {
    const branch = "agent-task.start-task";
    const admission = { ...authorization, grantedCapabilities: ["agent-task.start"] };
    const source = {
      context: admission,
      invocationId: "control:c24-action:task-admission",
      branch,
      sourceVersionRefs: [],
    };
    let allowed = true;
    let taskFailure;
    const reauthorize = vi.fn(async () => {
      if (taskFailure !== undefined) throw taskFailure;
      if (!allowed) throw { details: { code: "AUTHORIZATION_DENIED" } };
      return {
        context: admission,
        admissionContext: admission,
        contextRef: admission.authorizationContextRef,
        redacted: false,
      };
    });
    const access = {
      readDeploymentAuthorizationSource: async () => source,
      authorizeBusinessAction: reauthorize,
      verify: async () => {
        throw Error("ordinary context expired");
      },
    };
    const boundary = createDeploymentAuthorizationScopeV1({
      access,
      deploymentAuthorization: {},
      policy: { bindings: [] },
    });
    const task = {
      envelope: {
        commandId: "task-admission",
        authorization: admission,
        parentRunRef: runRef("task-parent"),
        agentTaskRef: { reference: ref("task") },
      },
    };
    const execution = { workerId: "worker", leaseToken: "private-lease" };
    const model = vi.fn(async () => ({ kind: "model-result" }));
    const gateway = createDeploymentAuthorizedModelGatewayV1({
      access: boundary.access,
      gateway: { completeStructured: model },
    });
    const put = vi.fn(async () => ({ kind: "artifact-result" }));
    const store = createDeploymentAuthorizedArtifactStoreV1({
      access: boundary.access,
      store: { put },
    });
    const artifact = {
      schemaVersion: "1",
      commandId: "task-artifact",
      idempotencyKey: "task-artifact",
      projectId: admission.projectId,
      actorId: admission.actorId,
      issuedAt: admission.decidedAt,
      authorization: admission,
      requiredCapability: "agent-task.start",
      artifactId: "task-artifact",
      artifactKind: "content",
      purposeCode: "agent-model-input",
      mediaType: "application/json",
      parentArtifactRefs: [],
      evidenceReferences: [],
      additionalSpatialScopeRefs: [],
      additionalSourceAccessGrantRefs: [],
    };
    await boundary.runTask(
      task,
      async () => {
        boundary.setTaskAction("task-action-1");
        await boundary.access.verify({
          authorizationContextRef: admission.authorizationContextRef,
          projectId: admission.projectId,
          branch,
          invocationId: task.envelope.commandId,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        await gateway.completeStructured(
          {
            ...structuredRequest(),
            authorization: admission,
            requiredCapability: "agent-task.start",
          },
          {},
        );
        await store.put(artifact, []);
        expect(put.mock.calls[0][0]).toEqual(artifact);
        expect(model.mock.calls[0][0].authorization).toEqual(admission);
        await boundary.authorizeDownstream({
          projectId: admission.projectId,
          actorId: admission.actorId,
          branch,
          invocationId: "tool-action",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        await boundary.access.verify({
          authorizationContextRef: admission.authorizationContextRef,
          projectId: admission.projectId,
          branch,
          invocationId: "tool-action",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        });
        const contextAuthority = createDeploymentIdentificationAuthorizationV1({
          access: boundary.access,
          authorizationScope: boundary,
        }).identificationContext;
        const contextVerify = {
          authorization: admission,
          invocationId: "tool-action",
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
        };
        expect(await contextAuthority.verifyCurrent(contextVerify)).toEqual(admission);
        expect(
          await contextAuthority.verifyCurrent({ ...contextVerify, invocationId: "another-read" }),
        ).toEqual(admission);
        expect(
          reauthorize.mock.calls.every(
            ([request]) =>
              request.taskRef.reference.entityId ===
                task.envelope.agentTaskRef.reference.entityId &&
              request.actorId === admission.actorId,
          ),
        ).toBe(true);
        boundary.setTaskAction("task-action-2");
        allowed = false;
        await expect(store.put(artifact, [])).rejects.toMatchObject({
          code: "ARTIFACT_ACCESS_DENIED",
        });
        await expect(
          gateway.completeStructured(
            {
              ...structuredRequest(),
              authorization: admission,
              requiredCapability: "agent-task.start",
            },
            {},
          ),
        ).rejects.toMatchObject({ code: "MODEL_AUTHORIZATION_DENIED" });
        const { AgentRuntimeError, makeAgentError } =
          await import("../../packages/core/dist/agent-runtime/index.js");
        taskFailure = new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_BUDGET_EXHAUSTED",
            category: "budget",
            stage: "authority.budget",
          }),
        );
        boundary.setTaskAction("task-action-3");
        await expect(store.put(artifact, [])).rejects.toBe(taskFailure);
        await expect(
          gateway.completeStructured(
            {
              ...structuredRequest(),
              authorization: admission,
              requiredCapability: "agent-task.start",
            },
            {},
          ),
        ).rejects.toBe(taskFailure);
        expect(put).toHaveBeenCalledTimes(1);
        expect(model).toHaveBeenCalledTimes(1);
        await expect(
          boundary.runTask(
            { ...task, envelope: { ...task.envelope, agentTaskRef: { reference: ref("wrong") } } },
            async () => {},
          ),
        ).rejects.toThrow();
      },
      execution,
    );
    await expect(boundary.runTask(task, async () => {})).rejects.toThrow();
  });
  it("已提交知识发布事件按自身命令保留因果", async () => {
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
    expect(calls[0]).toMatchObject({
      actorId: authorization.actorId,
      projectId: authorization.projectId,
      branch: "knowledge-modeling.identification-basis",
    });
    await expect(
      boundary.runEvent({ ...event, producerCommandId: "other" }, () =>
        boundary.authorizeDownstream(request),
      ),
    ).resolves.toBeDefined();
  });
  it("完成准备事件按原准备区分独立与父图，并复验当前权限", async () => {
    const context = (id, capability, invocation = { kind: "human" }) => ({
      ...authorization,
      authorizationContextRef: { kind: "authorization-context", reference: ref(id) },
      grantedCapabilities: [capability],
      invocation,
    });
    const current = context("completion-current", "engineering-data.freeze");
    const original = context("completion-original", "engineering-data.freeze");
    const task = context("completion-task", "agent-task.start");
    const prep = {
      kind: "identification-preparation-snapshot",
      reference: ref("completion-preparation"),
    };
    const event = {
      schemaVersion: "1",
      eventId: "completion-event",
      eventVersion: 1,
      eventType: "engineering.inputs-ready.v1",
      projectId: current.projectId,
      aggregateRef: prep,
      occurredAt: current.decidedAt,
      recordedAt: current.decidedAt,
      causationId: "complete",
      producerCommandId: "complete",
      correlationId: "completion",
      idempotencyKey: "complete",
      authorizationContextRef: current.authorizationContextRef,
      auditTrailRef: { kind: "audit-trail", reference: ref("complete-audit") },
      payload: {
        preparation: { kind: "identification", identificationPreparationSnapshotRef: prep },
      },
    };
    const sources = new Map([
      [
        "completion-current",
        {
          context: current,
          invocationId: "complete",
          branch: "engineering-data.complete-identification-preparation",
          sourceVersionRefs: [],
        },
      ],
      [
        "completion-original",
        {
          context: original,
          invocationId: "original",
          branch: "engineering-data.identification-preparation",
          sourceVersionRefs: [],
        },
      ],
      [
        "completion-task",
        {
          context: task,
          invocationId: "task-start",
          branch: "agent-task.start-task",
          sourceVersionRefs: [],
        },
      ],
    ]);
    const verify = vi.fn(async () => ({ context: current, redacted: false }));
    const boundary = createDeploymentAuthorizationScopeV1({
      access: {
        readDeploymentAuthorizationSource: async (r) =>
          sources.get(r.authorizationContextRef.reference.entityId),
        verify,
      },
      deploymentAuthorization: {},
      policy: { bindings: [] },
      readPreparationCompletionOrigin: async () => ({
        originalCommandId: "original",
        taskAuthorization: task,
        preparationAuthorization: original,
      }),
    });
    expect(await boundary.runEvent(event, async (r) => r)).toMatchObject({ independent: true });
    sources.set("completion-original", {
      ...sources.get("completion-original"),
      context: {
        ...original,
        causalRunRef: runRef("original-parent"),
        invocation: {
          kind: "system",
          systemActorId: original.actorId,
          reasonCode: "original-prepare",
        },
      },
      causalRunRef: runRef("original-parent"),
    });
    // 来源窄读返回的上下文必须与持久来源完全一致。
    const changed = sources.get("completion-original").context;
    Object.assign(original, changed);
    sources.set("completion-task-parent", {
      context: {
        ...task,
        authorizationContextRef: {
          kind: "authorization-context",
          reference: ref("completion-task-parent"),
        },
      },
      branch: "agent-task.start-task",
    });
    sources.set("completion-task", {
      ...sources.get("completion-task"),
      causalRunRef: runRef("original-parent"),
      parentContextRef: { kind: "authorization-context", reference: ref("completion-task-parent") },
    });
    expect(await boundary.runEvent(event, async (r) => r)).toMatchObject({
      independent: false,
      source: { causalRunRef: runRef("original-parent") },
    });
    expect(
      verify.mock.calls.every(
        ([r]) => r.authorizationContextRef.reference.entityId === "completion-current",
      ),
    ).toBe(true);
    sources.set("completion-task", {
      ...sources.get("completion-task"),
      causalRunRef: runRef("other-parent"),
    });
    await expect(boundary.runEvent(event, async (r) => r)).resolves.toMatchObject({
      independent: false,
      source: { causalRunRef: runRef("original-parent") },
    });
    sources.set("completion-task", {
      ...sources.get("completion-task"),
      causalRunRef: runRef("original-parent"),
    });
    await expect(
      boundary.runEvent({ ...event, producerCommandId: "other" }, async (r) => r),
    ).resolves.toMatchObject({ source: { causalRunRef: runRef("original-parent") } });
    verify.mockResolvedValueOnce({ context: current, redacted: true });
    await expect(boundary.runEvent(event, async (r) => r)).rejects.toThrow(TypeError);
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
    ).resolves.toMatchObject({ independent: true });
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
  it("同一请求不预签发下游集合，内部动作保留请求主体", async () => {
    const { boundary, calls, access } = setup();
    access.authorize = async () => {
      throw new Error("historical authorization expired");
    };
    await boundary.runRequest(async () => {
      await boundary.access.authorize({
        ...request,
        branch: "workflow.start-run",
        invocation: { kind: "human-session", sessionToken: "request-token" },
        requestedSpatialScopeRefs: [],
        requestedSourceVersionRefs: [],
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        actorId: authorization.actorId,
        branch: "workflow.start-run",
        capability: "workflow.start",
      });
      await boundary.authorizeDownstream(request);
      expect(calls).toHaveLength(2);
      expect(calls[1]).toMatchObject({
        actorId: authorization.actorId,
        projectId: authorization.projectId,
        branch: request.branch,
      });
      await expect(
        boundary.authorizeDownstream({ ...request, actorId: "other" }),
      ).rejects.toThrow();
    });
    await expect(boundary.authorizeDownstream(request)).rejects.toThrow();
  });
  it("同一人员调用重放检查当前会话和权限，真实拒权不进入下游", async () => {
    const { boundary, calls, access } = setup();
    access.authorize = async () => {
      throw new Error("historical authorization expired");
    };
    const input = {
      ...request,
      branch: "workflow.start-run",
      invocation: { kind: "human-session", sessionToken: "current-session" },
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
    };
    for (let i = 0; i < 2; i += 1) {
      await expect(
        boundary.runRequest(() => boundary.access.authorize(input)),
      ).resolves.toMatchObject({ context: { actorId: authorization.actorId } });
    }
    expect(access.readSession).toHaveBeenCalledWith({
      kind: "introspect-session",
      sessionToken: "current-session",
    });
    expect(calls).toHaveLength(2);
    access.readSession.mockRejectedValueOnce(new Error("session revoked"));
    await expect(boundary.runRequest(() => boundary.access.authorize(input))).rejects.toThrow(
      "session revoked",
    );
    expect(calls).toHaveLength(2);
    access.authorizeBusinessAction = async () => {
      throw new Error("access denied");
    };
    await boundary.runRequest(async () => {
      await expect(boundary.access.authorize(input)).rejects.toThrow("access denied");
      await expect(boundary.authorizeDownstream(request)).rejects.toThrow();
    });
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
      catalog.downstreamAuthorization.bindings.push({
        rootBranch: "workflow.resume-run",
        downstreamBranches: [
          "risk-identification.plan",
          "engineering-data.evidence-access",
          "knowledge-modeling.identification-basis",
          "knowledge-modeling.relationship-context",
          "knowledge-modeling.hybrid-evidence",
          "agent-task.read",
          "review-audit.read",
        ],
      });
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
        finalMigrationVersion: "000059",
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
        finalMigrationVersion: "000059",
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
      const graph = host.identification.compositions.graph;
      const graphAuthority = createDeploymentIdentificationAuthorizationV1({
        access: host.foundation.access,
        authorizationScope: host.foundation.authorizationScope,
      }).identificationGraph;
      const contextAuthority = createDeploymentIdentificationAuthorizationV1({
        access: host.foundation.access,
        authorizationScope: host.foundation.authorizationScope,
      }).identificationContext;
      const parent = { kind: "workflow-run", reference: ref("real-authorization-parent") };
      const projectId = "project-rail-01";
      let execution;
      let write;
      await host.foundation.authorizationScope.runRequest(async () => {
        const invocationId = "real-c24-control";
        const { context: control } = await host.foundation.access.authorize({
          projectId,
          invocationId,
          branch: "workflow.resume-run",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          invocation: { kind: "human-session", sessionToken: session.sessionToken },
        });
        const command = {
          projectId,
          actorId: control.actorId,
          commandId: "real-c24-start",
          idempotencyKey: "real-c24-start",
          issuedAt: new Date().toISOString(),
          validAt: new Date().toISOString(),
          requestedAt: new Date().toISOString(),
          authorization: control,
          issuedInvocationId: invocationId,
          authorizationBranch: "workflow.resume-run",
          graphVersion: config.projectBindings[0].graphVersions.identification,
          parentRiskFlowRunRef: parent,
          preparationSnapshotRef: {
            kind: "identification-preparation-snapshot",
            reference: ref("unavailable-preparation"),
          },
          triggerReasonCode: "synthetic-authorization-test",
        };
        const execute = host.foundation.transactionUnit.execute.bind(
          host.foundation.transactionUnit,
        );
        const stop = vi
          .spyOn(host.foundation.transactionUnit, "execute")
          .mockImplementation(async (input, ...args) => {
            if (input.commandKind !== "identification-graph.start") return execute(input, ...args);
            execution = await host.foundation.access.readDeploymentAuthorizationSource({
              authorizationContextRef: input.authorizationContextRef,
              projectId: input.projectId,
              actorId: input.actorRef,
            });
            throw Object.assign(new Error("stop-before-business-commit"), {
              code: "PREFLIGHT_STOP",
            });
          });
        try {
          await expect(graph.runtime.start(command)).rejects.toMatchObject({
            error: { code: "CONTRACT_INVALID" },
          });
        } finally {
          stop.mockRestore();
        }
        expect(execution.branch).toBe("risk-identification.plan");
        expect(execution.invocationId).toBeTruthy();
        expect(execution.context.grantedCapabilities).toEqual(["risk-identification.run"]);
        expect(execution.causalRunRef).toEqual(parent);
        expect(authorizationScopeDigest(execution.context)).toBe(authorizationScopeDigest(control));
        expect(
          await host.identification.compositions.context.modelContextReader.readExact({
            projectId,
            actorId: control.actorId,
            requestedAt: command.issuedAt,
            authorization: control,
            workItemRef: {
              kind: "identification-work-item",
              reference: ref("missing-model-context-work"),
            },
            retrievalArtifactSetRef: {
              kind: "retrieval-artifact-set",
              reference: ref("missing-model-context-retrieval"),
            },
          }),
        ).toMatchObject({ kind: "failed", code: "ENTITY_NOT_FOUND" });
        for (const branch of [
          "knowledge-modeling.identification-basis",
          "knowledge-modeling.relationship-context",
          "knowledge-modeling.hybrid-evidence",
        ]) {
          const read = {
            projectId,
            actorId: control.actorId,
            authorization: control,
            branch,
            invocationId: `${invocationId}:c21:${branch}`,
            requestedAt: command.issuedAt,
          };
          const authorization = await contextAuthority.issueReadContext(read);
          expect(authorizationScopeDigest(authorization)).toBe(authorizationScopeDigest(control));
          const verify = {
            ...read,
            authorization,
            requestedSpatialScopeRefs: [],
            requestedSourceVersionRefs: [],
          };
          expect(await contextAuthority.verifyCurrent(verify)).toEqual(authorization);
          expect(
            await contextAuthority.verifyCurrent({ ...verify, invocationId: "wrong-c21-call" }),
          ).toEqual(authorization);
          expect(
            await contextAuthority.verifyCurrent({
              ...verify,
              authorization: { ...authorization, actorId: "another-actor" },
            }),
          ).toBeUndefined();
        }
        expect(
          await host.foundation.deploymentAuthorization.readDownstreamContext({
            root: execution.context,
            branch: "engineering-data.evidence-access",
            requestedSpatialScopeRefs: [],
            requestedSourceVersionRefs: [],
          }),
        ).toMatchObject({ branch: "engineering-data.evidence-access" });
        for (const branch of ["agent-task.read", "review-audit.read"]) {
          expect(
            await host.foundation.deploymentAuthorization.readDownstreamContext({
              root: execution.context,
              branch,
              requestedSpatialScopeRefs: [],
              requestedSourceVersionRefs: [],
            }),
          ).toMatchObject({ branch });
        }
        const { createPostgresIdentificationGraphAdapter } =
          await import("../../packages/adapters/dist/identification/graph/index.js");
        const strict = createPostgresIdentificationGraphAdapter({
          db: host.foundation.runtime.db,
          transactionUnit: host.foundation.transactionUnit,
          artifactStore: host.foundation.artifactStore,
          authorization: host.foundation.access,
        });
        write = {
          projectId,
          actorId: control.actorId,
          commandId: "real-c24-body",
          artifactId: "real-c24-body",
          issuedAt: command.issuedAt,
          authorization: execution.context,
          body: {
            bodyKind: "cancellation",
            cancellation: {
              schemaVersion: "1",
              runRef: parent,
              reasonCode: "synthetic-authorization-test",
              cancelledAt: command.issuedAt,
            },
          },
        };
        expect((await strict.putBody(write)).kind).toBe("content-artifact");
        const bodyAuthorization = await graphAuthority.issueReadContext({
          authorization: execution.context,
          projectId,
          actorId: control.actorId,
          invocationId: "real-c24-body-preflight",
          branch: "risk-identification.plan",
          requestedAt: command.issuedAt,
        });
        expect(authorizationScopeDigest(bodyAuthorization.authorization)).toBe(
          authorizationScopeDigest(execution.context),
        );
        const artifact = await graph.adapter.putBody(write);
        expect(artifact.kind).toBe("content-artifact");
        for (const authorization of [
          { ...execution.context, actorId: "another-actor" },
          { ...execution.context, projectId: "another-project" },
          { ...execution.context, grantedCapabilities: ["workflow.resume"] },
        ])
          await expect(graph.adapter.putBody({ ...write, authorization })).rejects.toMatchObject({
            detailCode: "body-write-denied",
          });
        // 内部传入的空间快照不扩大已登记入口的实际权限。
        await expect(
          graph.adapter.putBody({
            ...write,
            authorization: {
              ...execution.context,
              spatialScopeRefs: [{ kind: "spatial-scope", reference: ref("another-scope") }],
            },
          }),
        ).resolves.toEqual(artifact);
        await expect(
          host.foundation.access.verify({
            projectId,
            authorizationContextRef: execution.context.authorizationContextRef,
            invocationId: "wrong-invocation",
            branch: execution.branch,
            requestedSpatialScopeRefs: [],
            requestedSourceVersionRefs: [],
          }),
        ).resolves.toMatchObject({ redacted: false });
        await expect(
          graphAuthority.runtime.verifyCurrent({
            authorization: execution.context,
            projectId,
            actorId: control.actorId,
            invocationId: execution.invocationId,
            branch: execution.branch,
          }),
        ).resolves.toEqual(execution.context);
      });
      const branch = "knowledge-modeling.relationship-context";
      const logicalReadId = "same-task-context-read";
      await host.foundation.authorizationScope.runRequest(async () => {
        const { context: control } = await host.foundation.access.authorize({
          projectId,
          invocationId: "same-branch-read-control",
          branch,
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          invocation: { kind: "human-session", sessionToken: session.sessionToken },
        });
        const read = await contextAuthority.issueReadContext({
          projectId,
          actorId: control.actorId,
          authorization: control,
          branch,
          invocationId: logicalReadId,
          requestedAt: new Date().toISOString(),
        });
        expect(
          await contextAuthority.verifyCurrent({
            authorization: read,
            branch,
            invocationId: logicalReadId,
            requestedSpatialScopeRefs: [],
            requestedSourceVersionRefs: [],
          }),
        ).toEqual(read);
      });
      await host.foundation.access.logout({ kind: "logout", sessionToken: session.sessionToken });
      expect(
        (
          await graph.adapter.putBody({
            ...write,
            commandId: "after-logout-body",
            artifactId: "after-logout-body",
          })
        ).kind,
      ).toBe("content-artifact");
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
        finalMigrationVersion: "000059",
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
    expect(input.finalMigrationVersion).toBe("000059");
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
