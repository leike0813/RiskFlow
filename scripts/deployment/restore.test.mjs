import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import deploymentConfig from "../../deployment/config.example.json" with { type: "json" };

import {
  RESTORE_ERROR_V1,
  RestoreError,
  activateTargetV1,
  confirmActivationV1,
  createActivationPlanV1,
  planRollbackV1,
  rebuildIndexesV1,
  rebuildRestoredGenerationV1,
  verifyIsolatedRestoreV1,
  assertIsolatedRestoreTargetV1,
} from "./restore.mjs";

const projectId = "project-rail-01";
const backup = { backupId: "backup-1", revision: 4 };
const target = {
  instanceId: "app-vm-02",
  releaseId: "release-2030-01",
  artifactRoot: "/var/lib/riskflow/isolated/artifacts",
};

it("恢复目标必须分别隔离数据库、工件根、实例和Qdrant", async () => {
  const directory = await mkdtemp(join(tmpdir(), "riskflow-restore-target-"));
  await mkdir(join(directory, "source"));
  await mkdir(join(directory, "target"));
  const source = {
    instanceId: "source",
    database: { host: "localhost", port: 5432, name: "original" },
    localRoots: { artifactRoot: join(directory, "source") },
    qdrant: { baseUrl: "http://localhost:6333" },
  };
  const target = {
    instanceId: "restored",
    purpose: "synthetic-acceptance",
    database: { ...source.database, name: "restored" },
    localRoots: { artifactRoot: join(directory, "target") },
    qdrant: { baseUrl: "http://localhost:6334" },
  };
  await expect(assertIsolatedRestoreTargetV1({ source, target })).resolves.toBeUndefined();
  for (const key of ["instanceId", "database", "localRoots", "qdrant"]) {
    await expect(
      assertIsolatedRestoreTargetV1({ source, target: { ...target, [key]: source[key] } }),
    ).rejects.toMatchObject({ code: RESTORE_ERROR_V1.identityMismatch });
  }
  await expect(
    assertIsolatedRestoreTargetV1({ source, target: { ...target, purpose: "production" } }),
  ).rejects.toMatchObject({ code: RESTORE_ERROR_V1.identityMismatch });
});

const reconcileOk = (id, yielded = 2, declared = yielded) => ({
  findings: (async function* () {
    for (let i = 0; i < yielded; i += 1) yield { kind: "consistent", ref: `${id}-f${i}` };
  })(),
  summary: Promise.resolve({ projectId: id, findingCount: declared, consistent: true }),
});

describe("隔离恢复核验", () => {
  it("全部工程核对通过才返回 passed", async () => {
    const result = await verifyIsolatedRestoreV1({
      expectedProjects: [projectId],
      reconcile: async () => reconcileOk(projectId),
    });
    expect(result.passed).toBe(true);
    expect(result.projects[0].consumed).toBe(2);
  });

  it("缺失字节、快照冲突或未完整消费都阻止通过", async () => {
    const missing = async () => ({
      findings: (async function* () {
        yield { kind: "missing", ref: "f0" };
      })(),
      summary: Promise.resolve({ projectId, findingCount: 1, consistent: true }),
    });
    await expect(
      verifyIsolatedRestoreV1({ expectedProjects: [projectId], reconcile: missing }),
    ).rejects.toMatchObject({ code: RESTORE_ERROR_V1.reconcileFailed });

    await expect(
      verifyIsolatedRestoreV1({
        expectedProjects: [projectId],
        reconcile: async () => reconcileOk(projectId, 2, 5),
      }),
    ).rejects.toMatchObject({ code: RESTORE_ERROR_V1.reconcileFailed });
  });
});

describe("索引重建", () => {
  it("从正式事实重建并通过原就绪门才算成功", async () => {
    const rebuild = vi.fn(async () => ({ memberCount: 42, generation: "gen-2" }));
    const result = await rebuildIndexesV1({
      rebuild,
      readinessGate: async () => ({ ready: true }),
    });
    expect(result.memberCount).toBe(42);
    expect(rebuild).toHaveBeenCalledWith({ fromFormalFacts: true, policy: "original" });
  });

  it("空索引或门禁未过不得当作恢复成功", async () => {
    await expect(
      rebuildIndexesV1({
        rebuild: async () => ({ memberCount: 0, generation: "gen-1" }),
        readinessGate: async () => ({ ready: true }),
      }),
    ).rejects.toMatchObject({ code: RESTORE_ERROR_V1.indexNotRebuilt });

    await expect(
      rebuildIndexesV1({
        rebuild: async () => ({ memberCount: 10, generation: "gen-1" }),
        readinessGate: async () => ({ ready: false, reasonCode: "DENSE_MISMATCH" }),
      }),
    ).rejects.toMatchObject({ code: RESTORE_ERROR_V1.indexNotRebuilt });
  });
});

describe("人工切换与回退", () => {
  const plan = () => createActivationPlanV1({ backup, target });

  it("未确认不切换；确认后按精确目标切换", async () => {
    const p = plan();
    const switchTo = vi.fn(async () => ({ ok: true, instanceId: target.instanceId }));
    await expect(
      activateTargetV1({ plan: p, confirmation: undefined, switchTo }),
    ).rejects.toMatchObject({
      code: RESTORE_ERROR_V1.confirmationMissing,
    });
    expect(switchTo).not.toHaveBeenCalled();

    const confirmation = confirmActivationV1(p, target);
    const result = await activateTargetV1({ plan: p, confirmation, switchTo });
    expect(result.activated).toBe(true);
  });

  it("目标漂移令确认失效，必须重新确认", async () => {
    const p = plan();
    expect(() => confirmActivationV1(p, { ...target, instanceId: "app-vm-03" })).toThrow(
      RestoreError,
    );
    try {
      confirmActivationV1(p, { ...target, instanceId: "app-vm-03" });
    } catch (error) {
      expect(error.code).toBe(RESTORE_ERROR_V1.confirmationStale);
    }
  });

  it("切换失败保留双根并给出回退目标，不自动删除", async () => {
    const p = plan();
    const confirmation = confirmActivationV1(p, target);
    const result = await activateTargetV1({
      plan: p,
      confirmation,
      switchTo: async () => ({ ok: false, rollbackTarget: "app-vm-01" }),
    });
    expect(result.activated).toBe(false);
    expect(result.bothRootsRetained).toBe(true);
    expect(result.rollbackTarget).toBe("app-vm-01");
  });

  it("旧发布无法解析当前数据时，回退必须先构造匹配副本", () => {
    const compatible = planRollbackV1({
      fromRelease: "release-2030-02",
      toRelease: "release-2030-01",
      currentArtifactsCompatible: true,
    });
    expect(compatible.requiresIsolatedInstance).toBe(false);

    const incompatible = planRollbackV1({
      fromRelease: "release-2030-02",
      toRelease: "release-2030-01",
      currentArtifactsCompatible: false,
    });
    expect(incompatible.requiresIsolatedInstance).toBe(true);
    expect(incompatible.reasonCode).toBe("ROLLBACK_REQUIRES_MATCHED_COPY");
  });
});

/**
 * D-184：`rebuildRestoredGenerationV1` 的运维台账结算与清理边界。
 *
 * 部署加载、PG 运行时、检索适配器与部署操作工厂只在边界上 mock，
 * 受理、推进、结算与清理的业务逻辑仍真实执行；实例配置取自只读的
 * `deployment/config.example.json`，只把工件根换成真实存在的临时目录。
 */
const restoreMocks = vi.hoisted(() => ({
  loadInput: vi.fn(),
  createGraphs: vi.fn(),
  connection: vi.fn(() => ({})),
  createRuntime: vi.fn(),
  readGeneration: vi.fn(),
  createOperationStore: vi.fn(),
  createSecretLoader: vi.fn(),
}));

vi.mock("./start.mjs", () => ({
  createDeploymentGraphsV1: restoreMocks.createGraphs,
  loadDeploymentFoundationInputV1: restoreMocks.loadInput,
  deploymentConnectionV1: restoreMocks.connection,
}));

vi.mock("../../packages/adapters/dist/postgres/index.js", () => ({
  createPostgresRuntime: restoreMocks.createRuntime,
}));

vi.mock("../../packages/adapters/dist/retrieval/index.js", () => ({
  PostgresRetrievalAdapter: class {
    readGeneration(generationRef) {
      return restoreMocks.readGeneration(generationRef);
    }
  },
}));

// 只替换工厂与秘密加载器：`DeploymentConfigV1Schema` 仍用真实 Schema 校验源配置。
vi.mock("../../packages/adapters/dist/deployment/index.js", async (importOriginal) => ({
  ...(await importOriginal()),
  createPostgresDeploymentOperationStoreV1: restoreMocks.createOperationStore,
  createDeploymentSecretFileLoaderV1: restoreMocks.createSecretLoader,
}));

const restoreProjectId = "project-rail-01";
const restoreTimestamp = "2030-01-01T00:00:00.000Z";
const release = (entityId) => ({
  kind: "knowledge-release",
  reference: { entityId, versionId: "1" },
});
const evidenceBaseRelease = release("retrieval-evidence-base-release");

/** 触发检索投影的真实事件；恢复只按 sourceEventId 读回它，不解释正文。 */
const restoreEvent = {
  schemaVersion: "1",
  eventId: "event-restore-1",
  eventVersion: 1,
  projectId: restoreProjectId,
  aggregateRef: evidenceBaseRelease,
  occurredAt: restoreTimestamp,
  recordedAt: restoreTimestamp,
  causationId: "causation-restore",
  correlationId: "correlation-restore",
  producerCommandId: "command-restore",
  idempotencyKey: "idempotency-restore",
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: "authorization-restore", versionId: "1" },
  },
  auditTrailRef: {
    kind: "audit-trail",
    reference: { entityId: "audit-trail-restore", versionId: "1" },
  },
  eventType: "knowledge.identification-basis-published.v1",
  payload: {
    basisKind: "identification-basis",
    publishedReleases: [
      { definitionType: "process-model", releaseRef: release("process-model-release") },
      { definitionType: "risk-mechanism", releaseRef: release("risk-mechanism-release") },
      { definitionType: "standard-library", releaseRef: release("standard-library-release") },
      { definitionType: "case-library", releaseRef: release("case-library-release") },
      { definitionType: "retrieval-evidence-base", releaseRef: evidenceBaseRelease },
    ],
    retrievalEvidenceBaseReleaseRef: {
      kind: "retrieval-evidence-base-release",
      reference: evidenceBaseRelease.reference,
    },
  },
};

const restoreAuthorizationContext = {
  actorId: "actor-restore",
  projectId: restoreProjectId,
  authorizationContextRef: {
    kind: "authorization-context",
    reference: { entityId: "authorization-restore", versionId: "1" },
  },
};

const acceptedOperation = {
  operationId: "restore-operation-1",
  instanceId: "app-vm-restored",
  revision: 0,
  stage: "accepted",
  status: "accepted",
  resultRefs: { releaseId: "release-2030-01", perProjectAuditRefs: [], stageCounters: {} },
};

const restoreTemporaryRoots = [];

/** 只满足恢复读取事件行的查询链；不连数据库、不投递事件。 */
const outboxReader = () => {
  const chain = {
    select: () => chain,
    where: () => chain,
    executeTakeFirst: async () => ({ event_json: restoreEvent }),
  };
  return { selectFrom: () => chain };
};

const operationStore = (accept) => ({
  accept: vi.fn(accept),
  // 修订按真实存储语义递增，后续结算才用得上与受理一致的 revision。
  advance: vi.fn(async (input) => ({ ...input, revision: input.expectedRevision + 1 })),
  readAuditRefs: vi.fn(async () => ["deployment-audit-1", "deployment-audit-2"]),
});

const restoreHarness = async ({
  accept,
  rebuildGeneration,
  logout = async () => {},
  closeRuntime = async () => {},
  closeHost = async () => {},
}) => {
  const root = await mkdtemp(join(tmpdir(), "riskflow-restore-rebuild-"));
  restoreTemporaryRoots.push(root);
  const sourceArtifacts = join(root, "source-artifacts");
  const targetArtifacts = join(root, "target-artifacts");
  await mkdir(sourceArtifacts);
  await mkdir(targetArtifacts);
  const sourceConfigFile = join(root, "source-config.json");
  await writeFile(
    sourceConfigFile,
    JSON.stringify({
      ...deploymentConfig,
      localRoots: { ...deploymentConfig.localRoots, artifactRoot: sourceArtifacts },
    }),
  );
  const targetConfig = {
    ...structuredClone(deploymentConfig),
    instanceId: "app-vm-restored",
    database: { ...structuredClone(deploymentConfig.database), name: "riskflow-restored" },
    localRoots: { ...deploymentConfig.localRoots, artifactRoot: targetArtifacts },
    qdrant: { ...structuredClone(deploymentConfig.qdrant), baseUrl: "http://10.0.0.13:6334" },
  };
  const job = {
    operationId: "restore-operation-1",
    sourceConfigFile,
    // 以下路径只被 mock 的部署加载边界消费：不落真实配置、清单或秘密。
    configFile: join(root, "target-config.json"),
    manifestFile: join(root, "target-manifest.json"),
    projectId: restoreProjectId,
    generationRef: {
      kind: "retrieval-generation",
      reference: { entityId: "generation-restore-1", versionId: "1" },
    },
    loginName: "restore-operator",
    passwordSecretFile: join(root, "restore-login-secret"),
    requestedSpatialScopeRefs: [],
    requestedSourceVersionRefs: [],
  };
  const runtimes = [];
  restoreMocks.createRuntime.mockImplementation(() => {
    const runtime = { db: outboxReader(), close: vi.fn(closeRuntime) };
    runtimes.push(runtime);
    return runtime;
  });
  restoreMocks.readGeneration.mockResolvedValue({
    generationRef: job.generationRef,
    identity: { projectId: job.projectId, sourceEventId: restoreEvent.eventId },
  });
  restoreMocks.loadInput.mockResolvedValue({ config: targetConfig, secrets: {} });
  restoreMocks.createSecretLoader.mockReturnValue((refs) =>
    Object.fromEntries(refs.map((ref) => [ref.secretId, "fixture-password"])),
  );
  const store = operationStore(accept);
  restoreMocks.createOperationStore.mockReturnValue(store);
  const host = {
    foundation: {
      access: {
        login: vi.fn(async () => ({ sessionToken: "session-restore" })),
        authorize: vi.fn(async () => ({ context: restoreAuthorizationContext })),
        logout: vi.fn(logout),
      },
      runtime: { db: {} },
      transactionUnit: {},
      authorizationScope: { run: vi.fn(async (_input, operation) => operation()) },
    },
    identification: { compositions: { retrieval: { projectionHandler: { rebuildGeneration } } } },
    close: vi.fn(closeHost),
  };
  restoreMocks.createGraphs.mockResolvedValue(host);
  return { job, host, runtimes, store };
};

describe("已受理代际重建的结算与清理", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (restoreTemporaryRoots.length > 0)
      await rm(restoreTemporaryRoots.pop(), { recursive: true, force: true });
  });

  it("accept 返回既有 running 操作时不重建，也不把它结算为 failed", async () => {
    const rebuildGeneration = vi.fn();
    const { job, host, runtimes, store } = await restoreHarness({
      accept: async () => ({
        ...acceptedOperation,
        revision: 4,
        stage: "running",
        status: "running",
      }),
      rebuildGeneration,
    });

    await expect(rebuildRestoredGenerationV1(job)).rejects.toMatchObject({
      code: RESTORE_ERROR_V1.identityMismatch,
    });

    expect(rebuildGeneration).not.toHaveBeenCalled();
    expect(store.advance).not.toHaveBeenCalled();
    expect(host.foundation.access.logout).toHaveBeenCalledTimes(1);
    expect(runtimes).toHaveLength(2);
    for (const runtime of runtimes) expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(host.close).toHaveBeenCalledTimes(1);
  });

  it("重建完成后 logout 与关闭失败不改变 REBUILT，且每个关闭都被尝试", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const rebuildGeneration = vi.fn(async () => ({ kind: "rebuilt", memberCount: 7 }));
    const { job, host, runtimes, store } = await restoreHarness({
      accept: async () => acceptedOperation,
      rebuildGeneration,
      logout: async () => {
        throw new Error("logout-rejected");
      },
      closeRuntime: async () => {
        throw new Error("runtime-close-rejected");
      },
      // 同步抛出：finally 仍必须逐个尝试关闭，不能跳过其余运行时。
      closeHost: () => {
        throw new Error("host-close-threw");
      },
    });

    const result = await rebuildRestoredGenerationV1(job);

    expect(result).toMatchObject({ status: "REBUILT", memberCount: 7 });
    expect(store.advance).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "completed", status: "completed" }),
    );
    expect(host.foundation.access.logout).toHaveBeenCalledTimes(1);
    expect(runtimes).toHaveLength(2);
    for (const runtime of runtimes) expect(runtime.close).toHaveBeenCalledTimes(1);
    expect(host.close).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stderr.mock.calls.at(-1)[0])).toMatchObject({
      stage: "restore-cleanup",
      status: "warning",
      // logout + 两个运行时 + 宿主，四个清理失败都计入。
      count: 4,
    });
  });

  it("受理前失败注销后，同一操作重试使用独立会话", async () => {
    const { job, host, store } = await restoreHarness({
      accept: async () => acceptedOperation,
      rebuildGeneration: vi.fn(async () => ({ kind: "rebuilt", memberCount: 7 })),
    });
    const revoked = new Set();
    host.foundation.access.login.mockImplementation(async ({ loginAttemptId }) => {
      const sessionToken = `session-${loginAttemptId}`;
      if (revoked.has(sessionToken)) throw Object.assign(new Error(), { code: "SESSION_REVOKED" });
      return { sessionToken };
    });
    host.foundation.access.logout.mockImplementation(async ({ sessionToken }) => {
      revoked.add(sessionToken);
    });
    store.accept.mockRejectedValueOnce(new Error("operation-store-unavailable"));

    await expect(rebuildRestoredGenerationV1(job)).rejects.toThrow("operation-store-unavailable");
    await expect(rebuildRestoredGenerationV1(job)).resolves.toMatchObject({ status: "REBUILT" });
    expect(store.accept).toHaveBeenLastCalledWith(
      expect.objectContaining({ operationId: job.operationId, idempotencyKey: job.operationId }),
    );
  });

  it("本调用推进后的重建失败把 running 操作结算为 failed 并上抛", async () => {
    const rebuildGeneration = vi.fn(async () => ({
      kind: "rejected",
      failure: { detailCode: "restore-generation-binding" },
    }));
    const { job, store } = await restoreHarness({
      accept: async () => acceptedOperation,
      rebuildGeneration,
    });

    await expect(rebuildRestoredGenerationV1(job)).rejects.toMatchObject({
      code: RESTORE_ERROR_V1.indexNotRebuilt,
    });

    expect(store.advance).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "failed",
        status: "failed",
        reasonCode: "RESTORED_GENERATION_REBUILD_FAILED",
      }),
    );
  });
});
