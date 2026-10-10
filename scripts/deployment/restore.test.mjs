import { describe, expect, it, vi } from "vitest";

import {
  RESTORE_ERROR_V1,
  RestoreError,
  activateTargetV1,
  confirmActivationV1,
  createActivationPlanV1,
  planRollbackV1,
  rebuildIndexesV1,
  verifyIsolatedRestoreV1,
} from "./restore.mjs";

const projectId = "project-rail-01";
const backup = { backupId: "backup-1", revision: 4 };
const target = {
  instanceId: "app-vm-02",
  releaseId: "release-2030-01",
  artifactRoot: "/var/lib/riskflow/isolated/artifacts",
};

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
