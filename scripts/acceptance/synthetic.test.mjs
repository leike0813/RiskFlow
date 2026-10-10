import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  SyntheticAcceptanceError,
  assertFileInputPathV1,
  checkPack,
  operationIdFor,
  resolveTemplates,
  runPack,
} from "./synthetic.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK_DIR = join(REPO_ROOT, "references", "acceptance", "synthetic-v1");
const roots = [];

const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "riskflow-synthetic-"));
  roots.push(dir);
  return dir;
};

afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop(), { recursive: true, force: true });
});

/** 会话元数据：restricted 与 passwordChangeRequired 由用例切换。 */
const sessionMetadata = (overrides = {}) => ({
  schemaVersion: "1",
  sessionRef: { entityId: "session-1", versionId: "1" },
  accountRef: { entityId: "account-1", versionId: "1" },
  passwordChangeRequired: false,
  restricted: false,
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  ...overrides,
});

const reference = (kind, entityId) => ({ kind, reference: { entityId, versionId: "1" } });
/** 该分支的 sourceConnectionRef 是裸 VersionReference，不带 kind 包装。 */
const versionReference = (entityId) => ({ entityId, versionId: "1" });

/**
 * 脚本内 HTTP 替身：只用于验证工具行为，不构成软件验收。
 * 记录收到的信封，便于断言命令身份与请求载荷。
 */
const stubFetch = ({ login = sessionMetadata(), routes = {}, loginCookie = true } = {}) => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    const target = new URL(String(url));
    seen.push({
      path: target.pathname,
      body: init.body === undefined ? null : JSON.parse(init.body),
    });
    const reply = (status, body, headers = {}) =>
      new globalThis.Response(body === null ? "" : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json", ...headers },
      });
    if (target.pathname === "/api/v1/session/login") {
      return reply(
        200,
        login,
        loginCookie ? { "set-cookie": "__Host-riskflow_session=abc; Path=/" } : {},
      );
    }
    const handler = routes[target.pathname];
    if (handler === undefined) return reply(404, { code: "NOT_FOUND" });
    const result = typeof handler === "function" ? handler(seen.at(-1)) : handler;
    if (result === "throw") throw new TypeError("network failure");
    return reply(result.status, result.body, result.headers ?? {});
  };
  return { fetchImpl, seen };
};

const sourceDeliveryRef = reference("source-delivery", "delivery-1");
const sourceVersionRef = reference("source-version", "source-1");

const writeConfig = (commands, overrides = {}) => {
  const dir = tempDir();
  const path = join(dir, "run-config.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: "1",
      baseUrl: "https://synthetic.invalid",
      projectId: "project-1",
      loginName: "acceptance",
      password: "not-persisted",
      bindings: {},
      commands,
      ...overrides,
    }),
  );
  return path;
};

const succeeded = (result) => ({ status: 200, body: { kind: "succeeded", result } });
const businessFailed = () => ({
  status: 200,
  body: {
    kind: "failed",
    error: {
      code: "BUSINESS_BLOCKED",
      stageCode: "register-source-delivery",
      causalRunId: "run-1",
      category: "business-blocked",
      blockerKind: "policy",
      blockerRef: reference("source-version", "source-1"),
      occurredAt: new Date().toISOString(),
      retryable: false,
    },
  },
});

describe("材料静态检查", () => {
  it("完整合成包通过静态检查", () => {
    const result = checkPack(PACK_DIR);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.labelStatus).toBe("candidate");
  });

  it("缺少预期或机理覆盖不足时拒绝", () => {
    const dir = tempDir();
    const pack = join(dir, "pack");
    mkdirSync(pack, { recursive: true });
    writeFileSync(join(pack, "manifest.json"), JSON.stringify({ schemaVersion: "1", packId: "p" }));
    const result = checkPack(pack);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain("manifest.label");
  });
});

describe("输入引用边界", () => {
  it("只允许安全材料目录", () => {
    expect(assertFileInputPathV1("documents/log.json")).toBe("documents/log.json");
    expect(() => assertFileInputPathV1("../outside.json")).toThrow(SyntheticAcceptanceError);
    expect(() => assertFileInputPathV1("reviews/notes.json")).toThrow(SyntheticAcceptanceError);
  });

  it("答案类文件不得作为模型输入", () => {
    for (const path of [
      "model-input/expected.json",
      "documents/scenarios.json",
      "documents/acceptance-cases.json",
      "model-input/index.json",
      "documents/report.md",
      "documents/manifest.json",
    ]) {
      expect(() => assertFileInputPathV1(path)).toThrow(SyntheticAcceptanceError);
    }
  });
});

describe("模板引用绑定", () => {
  const context = () => ({
    packDir: PACK_DIR,
    bindings: { spatialScopeRef: reference("spatial-scope", "scope-1") },
    steps: new Map([
      ["register-source", { resultRef: { sourceVersionRef } }],
      ["no-receipt", {}],
    ]),
  });

  it("结果模板只读取同次运行的真实回执", () => {
    const value = resolveTemplates(
      { $result: "register-source", path: ["sourceVersionRef"] },
      context(),
    );
    expect(value).toEqual(sourceVersionRef);
  });

  it("缺少回执或步骤不存在时失败，不回落到本地值", () => {
    expect(() =>
      resolveTemplates({ $result: "no-receipt", path: ["sourceVersionRef"] }, context()),
    ).toThrow(SyntheticAcceptanceError);
    expect(() =>
      resolveTemplates({ $result: "missing", path: ["sourceVersionRef"] }, context()),
    ).toThrow(SyntheticAcceptanceError);
  });

  it("绑定缺失与模板混用都失败", () => {
    expect(() => resolveTemplates({ $binding: "absent" }, context())).toThrow(
      SyntheticAcceptanceError,
    );
    expect(() => resolveTemplates({ $binding: "spatialScopeRef", extra: 1 }, context())).toThrow(
      SyntheticAcceptanceError,
    );
  });
});

describe("正式入口运行", () => {
  const registerCommand = (completion) => ({
    stepId: "register-source",
    type: "http",
    operationId: operationIdFor("command", "engineering-data.register-source-delivery"),
    payload: {
      sourceConnectionRef: { $binding: "sourceConnectionRef" },
      deliveryKey: "synthetic-delivery-1",
      sourceArtifactRef: { $binding: "sourceArtifactRef" },
      metadataArtifactRef: { $binding: "metadataArtifactRef" },
      occurredAt: "2026-03-02T00:00:00Z",
    },
    requestedSpatialScopeRefs: [{ $binding: "spatialScopeRef" }],
    requestedSourceVersionRefs: [],
    captures: { sourceVersionRef: ["result", "sourceVersionRef"] },
    ...(completion === undefined ? {} : { completion }),
  });

  const registerRoutes = () => ({
    "/api/v1/projects/project-1/commands/engineering-data.register-source-delivery": succeeded({
      kind: "register-source-delivery",
      sourceVersionRef,
      sourceDeliveryRef,
    }),
  });

  const withBindings = (commands, bindings) =>
    writeConfig(commands, {
      bindings: {
        sourceConnectionRef: versionReference("connection-1"),
        sourceArtifactRef: reference("content-artifact", "artifact-1"),
        metadataArtifactRef: reference("content-artifact", "artifact-2"),
        spatialScopeRef: reference("spatial-scope", "scope-1"),
        ...bindings,
      },
    });

  it("成功回执绑定为安全引用并记为已提交", async () => {
    const { fetchImpl, seen } = stubFetch({ routes: registerRoutes() });
    const output = tempDir();
    const result = await runPack({
      packDir: PACK_DIR,
      configPath: withBindings([registerCommand()]),
      outputDir: output,
      fetchImpl,
    });
    expect(result.status).toBe("SUBMITTED");
    expect(result.exitCode).toBe(1);
    expect(result.state.steps[0].status).toBe("submitted");
    expect(result.state.steps[0].resultRef).toEqual({ sourceVersionRef });
    const body = seen.at(-1).body;
    expect(body.payload.sourceArtifactRef).toEqual(reference("content-artifact", "artifact-1"));
    expect(body.requestedSpatialScopeRefs).toEqual([reference("spatial-scope", "scope-1")]);
    expect(body.commandId).toBe(body.idempotencyKey);
  });

  it("HTTP 200 但 kind=failed 判为失败", async () => {
    const { fetchImpl } = stubFetch({
      routes: {
        "/api/v1/projects/project-1/commands/engineering-data.register-source-delivery":
          businessFailed(),
      },
    });
    const result = await runPack({
      packDir: PACK_DIR,
      configPath: withBindings([registerCommand("completed")]),
      outputDir: tempDir(),
      fetchImpl,
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.state.steps[0].status).toBe("failed");
    expect(result.state.blocked.join("\n")).toContain("kind=failed");
  });

  it("异步命令不能被配置成已完成", async () => {
    const { fetchImpl, seen } = stubFetch({
      routes: {
        "/api/v1/projects/project-1/commands/workflow.start-run": succeeded({
          kind: "start-run",
          workflowRunRef: reference("workflow-run", "run-1"),
        }),
      },
    });
    const output = tempDir();
    const configPath = withBindings(
      [
        {
          stepId: "start-run",
          type: "http",
          operationId: operationIdFor("command", "workflow.start-run"),
          payload: {
            graphVersion: { $binding: "graphVersion" },
            retryPolicyRef: { $binding: "retryPolicyRef" },
            entryMode: "identify-and-assess",
          },
          captures: { workflowRunRef: ["result", "workflowRunRef"] },
          completion: "completed",
        },
      ],
      { graphVersion: "graph-1", retryPolicyRef: reference("policy", "retry-1") },
    );
    const result = await runPack({ packDir: PACK_DIR, configPath, outputDir: output, fetchImpl });
    expect(result.status).toBe("BLOCKED");
    expect(result.state.blocked.join("\n")).toContain("submitted");
    expect(seen).toHaveLength(0);
  });

  it("人工前置缺引用时阻塞且不发出业务请求", async () => {
    const { fetchImpl, seen } = stubFetch({ routes: registerRoutes() });
    const result = await runPack({
      packDir: PACK_DIR,
      configPath: withBindings([
        {
          stepId: "environment-preparation",
          type: "manual",
          instruction: "由正式环境准备方完成资料导入",
          requiredBindings: ["projectRevisionRef"],
        },
        registerCommand(),
      ]),
      outputDir: tempDir(),
      fetchImpl,
    });
    expect(result.status).toBe("BLOCKED");
    expect(result.state.steps[0].status).toBe("waiting");
    expect(seen.map((item) => item.path)).toEqual(["/api/v1/session/login"]);
  });

  it("前置引用齐备时人工步骤只标注外部已准备", async () => {
    const { fetchImpl } = stubFetch({ routes: registerRoutes() });
    const result = await runPack({
      packDir: PACK_DIR,
      configPath: withBindings(
        [
          {
            stepId: "environment-preparation",
            type: "manual",
            instruction: "由正式环境准备方完成资料导入",
            requiredBindings: ["projectRevisionRef"],
          },
          registerCommand(),
        ],
        { projectRevisionRef: reference("project-revision", "revision-1") },
      ),
      outputDir: tempDir(),
      fetchImpl,
    });
    expect(result.state.steps[0].status).toBe("completed");
    expect(result.state.steps[0].note).toContain("externally prepared");
  });

  it("受限会话与缺失 Cookie 均阻塞", async () => {
    for (const stub of [
      stubFetch({ login: sessionMetadata({ restricted: true }), routes: registerRoutes() }),
      stubFetch({ loginCookie: false, routes: registerRoutes() }),
    ]) {
      const result = await runPack({
        packDir: PACK_DIR,
        configPath: withBindings([registerCommand()]),
        outputDir: tempDir(),
        fetchImpl: stub.fetchImpl,
      });
      expect(result.status).toBe("BLOCKED");
      // 计划已冻结但一步未执行：全部保持 pending，未产生任何业务回执。
      expect(result.state.steps.map((step) => step.status)).toEqual(["pending"]);
    }
  });

  it("checkpoint 不含密码、Cookie 与原始响应正文", async () => {
    const { fetchImpl } = stubFetch({ routes: registerRoutes() });
    const output = tempDir();
    await runPack({
      packDir: PACK_DIR,
      configPath: withBindings([registerCommand()]),
      outputDir: output,
      fetchImpl,
    });
    const written = readFileSync(join(output, "run.json"), "utf8");
    expect(written).not.toContain("not-persisted");
    expect(written).not.toContain("__Host-riskflow_session");
    expect(written).not.toContain("deliveryKey");
  });
});

/** 在材料包副本上做单点破坏，断言检查能定位到具体问题；材料 Agent 的产物本身不改。 */
const mutatedPack = (mutate) => {
  const dir = tempDir();
  const pack = join(dir, "pack");
  cpSync(PACK_DIR, pack, { recursive: true });
  mutate(pack);
  return pack;
};

const editJson = (pack, file, mutate) => {
  const path = join(pack, file);
  const value = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, `${JSON.stringify(mutate(value), null, 2)}\n`, "utf8");
};

describe("跨文件一致性拒绝", () => {
  const expectProblem = (pack, fragment) => {
    const result = checkPack(pack);
    expect(result.ok).toBe(false);
    expect(result.problems.join("\n")).toContain(fragment);
  };

  it("未破坏的副本仍然通过检查", () => {
    expect(checkPack(mutatedPack(() => undefined)).ok).toBe(true);
  });

  it("重复用例标识被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "scenarios.json", (value) => {
        value.cases[1].caseId = value.cases[0].caseId;
        return value;
      }),
    );
    expectProblem(pack, "用例标识重复");
  });

  it("重复资料段标识被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "scenarios.json", (value) => {
        value.cases[1].inputs.sourceSegmentIds[0] = value.cases[0].inputs.sourceSegmentIds[0];
        return value;
      }),
    );
    expectProblem(pack, "资料段标识存在重复");
  });

  it("引用其它集合的资料被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "scenarios.json", (value) => {
        value.cases[0].inputs.documentRefs = ["SYN-TRIAL-DOC-GEOLOGY"];
        return value;
      }),
    );
    expectProblem(pack, "引用了其它集合的资料");
  });

  it("引用 manifest 未声明的资料被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "scenarios.json", (value) => {
        value.cases[0].inputs.documentRefs = ["SYN-DEV-DOC-UNKNOWN"];
        return value;
      }),
    );
    expectProblem(pack, "引用了 manifest 未声明的资料");
  });

  it("工程修订版本漂移被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "configurations/weight-set.json", (value) => {
        value.projectRevisionRef.reference.versionId = "2";
        return value;
      }),
    );
    expectProblem(pack, "引用了不同的工程修订");
  });

  it("同一指标存在多个字段映射来源被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "configurations/indicator-field-mapping.json", (value) => {
        value.content.mappings.push({
          ...value.content.mappings[0],
          mappingId: "mapping-face-pressure-duplicate",
        });
        return value;
      }),
    );
    expectProblem(pack, "存在多个字段映射来源");
  });

  it("映射单位与指标规范单位不一致被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "configurations/indicator-field-mapping.json", (value) => {
        value.content.mappings.find((item) => item.targetUnit === "mm").targetUnit = "cm";
        return value;
      }),
    );
    expectProblem(pack, "与指标规范单位");
  });

  it("评分规则缺少权重时被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "configurations/weight-set.json", (value) => {
        value.content.possibilityWeights = value.content.possibilityWeights.slice(1);
        return value;
      }),
    );
    expectProblem(pack, "有评分规则但权重集中没有对应权重");
  });

  it("来源定位缺失被拒绝", () => {
    const pack = mutatedPack((target) =>
      editJson(target, "sources.json", (value) => {
        delete value.sources[0].locator;
        return value;
      }),
    );
    expectProblem(pack, "缺少 locator");
  });
});

describe("歧义失败与恢复", () => {
  const ambiguousCommand = () => ({
    stepId: "register-source",
    type: "http",
    operationId: operationIdFor("command", "engineering-data.register-source-delivery"),
    payload: {
      sourceConnectionRef: { $binding: "sourceConnectionRef" },
      deliveryKey: "synthetic-delivery-1",
      sourceArtifactRef: { $binding: "sourceArtifactRef" },
      metadataArtifactRef: { $binding: "metadataArtifactRef" },
      occurredAt: "2026-03-02T00:00:00Z",
    },
    captures: { sourceVersionRef: ["result", "sourceVersionRef"] },
  });

  const bindings = {
    sourceConnectionRef: versionReference("connection-1"),
    sourceArtifactRef: reference("content-artifact", "artifact-1"),
    metadataArtifactRef: reference("content-artifact", "artifact-2"),
    spatialScopeRef: reference("spatial-scope", "scope-1"),
  };

  it("网络异常判为未知结果，恢复时复用同一幂等身份与 issuedAt", async () => {
    const output = tempDir();
    const configPath = writeConfig([ambiguousCommand()], { bindings });
    const failing = stubFetch({
      routes: {
        "/api/v1/projects/project-1/commands/engineering-data.register-source-delivery": "throw",
      },
    });
    const first = await runPack({
      packDir: PACK_DIR,
      configPath,
      outputDir: output,
      fetchImpl: failing.fetchImpl,
    });
    expect(first.status).toBe("BLOCKED");
    expect(first.state.steps[0].status).toBe("ambiguous");

    const recovering = stubFetch({
      routes: {
        "/api/v1/projects/project-1/commands/engineering-data.register-source-delivery": succeeded({
          kind: "register-source-delivery",
          sourceVersionRef,
          sourceDeliveryRef,
        }),
      },
    });
    const second = await runPack({
      packDir: PACK_DIR,
      configPath,
      outputDir: output,
      resume: true,
      fetchImpl: recovering.fetchImpl,
    });
    expect(second.status).toBe("SUBMITTED");
    const firstBody = failing.seen.at(-1).body;
    const secondBody = recovering.seen.at(-1).body;
    expect(secondBody.commandId).toBe(firstBody.commandId);
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey);
    expect(secondBody.issuedAt).toBe(firstBody.issuedAt);
  });

  it("输出目录已有结果时拒绝覆盖，恢复到别的运行也被拒绝", async () => {
    const output = tempDir();
    const configPath = writeConfig([ambiguousCommand()], { bindings });
    const { fetchImpl } = stubFetch({
      routes: {
        "/api/v1/projects/project-1/commands/engineering-data.register-source-delivery": succeeded({
          kind: "register-source-delivery",
          sourceVersionRef,
          sourceDeliveryRef,
        }),
      },
    });
    const first = await runPack({ packDir: PACK_DIR, configPath, outputDir: output, fetchImpl });
    expect(first.status).toBe("SUBMITTED");
    const before = readFileSync(join(output, "run.json"), "utf8");

    const again = await runPack({ packDir: PACK_DIR, configPath, outputDir: output, fetchImpl });
    expect(again.status).toBe("REFUSED");
    expect(readFileSync(join(output, "run.json"), "utf8")).toBe(before);

    const other = writeConfig([ambiguousCommand()], {
      bindings: { ...bindings, spatialScopeRef: reference("spatial-scope", "scope-2") },
    });
    const mismatched = await runPack({
      packDir: PACK_DIR,
      configPath: other,
      outputDir: output,
      resume: true,
      fetchImpl,
    });
    expect(mismatched.status).toBe("REFUSED");
    expect(readFileSync(join(output, "run.json"), "utf8")).toBe(before);
  });
});
