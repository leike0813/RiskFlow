import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertPayloadHasNoOwnedFields,
  ProvisionConfigV1Schema,
  runProvisionV1,
} from "./provision.mjs";
import deploymentConfig from "../../deployment/config.example.json" with { type: "json" };

const directories = [];
const makeDirectory = async () => {
  const directory = await mkdtemp(join(tmpdir(), "riskflow-provision-"));
  directories.push(directory);
  return directory;
};

afterEach(async () => {
  while (directories.length > 0) await rm(directories.pop(), { recursive: true, force: true });
});

const config = (overrides = {}) => ({
  schemaVersion: "1",
  runId: "provision-run-1",
  loginName: "provision.admin",
  passwordSecretId: "db-app-password",
  projectId: "project-rail-01",
  steps: [
    {
      id: "seed-account",
      op: "system-administration",
      requestedSpatialScopeRefs: [],
      requestedSourceVersionRefs: [],
      payload: {
        kind: "create-account",
        expectedVersion: "none",
        loginName: "synthetic.user",
        displayName: "Synthetic User",
        password: "Synthetic-Pass-123",
      },
    },
  ],
  ...overrides,
});

const makeFoundation = (execute) => ({
  config: deploymentConfig,
  access: {
    login: vi.fn(async () => ({
      sessionRef: { entityId: "session-1", versionId: "1" },
      accountRef: { entityId: "account-admin", versionId: "1" },
      expiresAt: "2030-01-01T00:00:00.000Z",
      passwordChangeRequired: false,
      restricted: false,
      sessionToken: "secret-session-token",
    })),
    systemAdministration: { execute },
    executeDeploymentProjectAccess: vi.fn(),
  },
});

const versionRef = (kind, entityId) => ({
  kind,
  reference: { entityId, versionId: "1" },
});
const conversionAuthorization = () => ({
  schemaVersion: "1",
  authorizationContextRef: versionRef("authorization-context", "authorization-context-1"),
  actorId: "account-admin",
  projectId: "project-rail-01",
  grantedCapabilities: ["engineering-data.write"],
  spatialScopeRefs: [],
  sourceAccessGrantRefs: [],
  authorizationPolicyRef: { entityId: "authorization-policy", versionId: "1" },
  decidedAt: "2030-01-02T03:04:05.000Z",
  invocation: { kind: "human" },
});
const conversionStep = (payload = {}) => ({
  id: "convert-text",
  op: "document-convert",
  requestedSpatialScopeRefs: [],
  requestedSourceVersionRefs: [],
  payload: {
    sourceVersionRef: versionRef("source-version", "source-version-1"),
    sourceArtifactRef: versionRef("content-artifact", "artifact-1"),
    mediaType: "text/plain",
    input: { kind: "text-pdf" },
    conversionPolicyRef: deploymentConfig.documentConversion.resourcePolicy.policyRef,
    qualityPolicyRef: deploymentConfig.documentConversion.qualityPolicyRef,
    converterDeploymentRef: deploymentConfig.documentConversion.converterDeploymentRef,
    ...payload,
  },
});
const conversionSucceeded = {
  kind: "succeeded",
  result: {
    conversionRef: versionRef("structured-document-conversion", "conversion-1"),
    jsonLdArtifactRef: versionRef("content-artifact", "artifact-jsonld-1"),
    sourceSegmentSetRef: versionRef("source-segment-set", "segment-set-1"),
  },
};
const makeConversionFoundation = (convert) => {
  const foundation = makeFoundation(vi.fn());
  foundation.access.authorize = vi.fn(async () => ({ context: conversionAuthorization() }));
  foundation.documentConverter = { convert };
  return foundation;
};

describe("受控资料预置", () => {
  it("空间修订回执保留空间引用及关联工程引用", async () => {
    const projectRef = versionRef("project-revision", "project-rail-01");
    const spatialRef = versionRef("spatial-scope", "scope-1");
    const foundation = makeConversionFoundation(vi.fn());
    foundation.contextSource = {
      reviseContext: async () => ({
        kind: "succeeded",
        result: {
          kind: "spatial-revision",
          revision: { projectRevisionRef: projectRef, spatialScopeRef: spatialRef },
        },
      }),
    };
    const output = await runProvisionV1({
      config: config({
        steps: [
          {
            ...config().steps[0],
            op: "context-revise",
            payload: {
              kind: "spatial",
              spatialScopeRef: spatialRef,
              projectRevisionRef: projectRef,
              expectedVersion: "none",
              name: "合成验收段",
              worksiteLocation: "合成站",
              applicabilityOverrides: {},
              status: "active",
              effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
            },
          },
        ],
      }),
      outputFile: join(await makeDirectory(), "checkpoint.json"),
      foundation,
      secrets: { "db-app-password": "secret-login-password" },
    });
    expect(output.status).toBe("COMPLETED");
    expect(output.steps[0].resultRef).toEqual(spatialRef);
  });

  it("系统管理按原载荷接受目标工程，拒绝客户端授权字段", async () => {
    const execute = vi.fn(async () => ({
      kind: "succeeded",
      result: { resultRef: { entityId: "project-rail-01", versionId: "1" }, references: [] },
    }));
    const payload = {
      kind: "open-project",
      projectId: "project-rail-01",
      expectedVersion: "none",
      initialRiskManagerAccountId: "account-admin",
    };
    const input = config({ steps: [{ ...config().steps[0], payload }] });
    const output = await runProvisionV1({
      config: input,
      outputFile: join(await makeDirectory(), "checkpoint.json"),
      foundation: makeFoundation(execute),
      secrets: { "db-app-password": "secret-login-password" },
      bootstrap: true,
    });
    expect(output.status).toBe("COMPLETED");
    expect(execute.mock.calls[0][0].payload).toEqual(payload);
    expect(
      ProvisionConfigV1Schema.safeParse({
        ...input,
        steps: [{ ...input.steps[0], payload: { ...payload, authorization: {} } }],
      }).success,
    ).toBe(false);
  });

  it("沿用 D-19 项目绑定样本并拒绝缺失字段、未知字段和重复步骤身份", () => {
    expect(deploymentConfig.projectBindings[0].policyRefs).toHaveProperty("calibration");
    expect(Object.keys(deploymentConfig.projectBindings[0].policyRefs)).toHaveLength(16);
    expect(deploymentConfig.projectBindings[0]).toHaveProperty("graphVersions.assessment");
    expect(deploymentConfig.projectBindings[0]).toHaveProperty("retrievalBudgetPolicyRef");
    expect(ProvisionConfigV1Schema.safeParse(config()).success).toBe(true);
    expect(ProvisionConfigV1Schema.safeParse(config({ unexpected: true })).success).toBe(false);
    expect(
      ProvisionConfigV1Schema.safeParse(config({ steps: [config().steps[0], config().steps[0]] }))
        .success,
    ).toBe(false);
  });

  it("重试复用命令身份和 issuedAt，checkpoint 与结果不含口令或会话 token", async () => {
    const outputFile = join(await makeDirectory(), "checkpoint.json");
    const identities = [];
    const execute = vi.fn(async (command) => {
      identities.push({
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        issuedAt: command.issuedAt,
      });
      if (identities.length === 1) return { kind: "failed", error: { code: "TEMPORARY_FAILURE" } };
      return {
        kind: "succeeded",
        result: { resultRef: { entityId: "account-user", versionId: "1" }, references: [] },
      };
    });
    const foundation = makeFoundation(execute);
    const options = {
      config: config(),
      outputFile,
      foundation,
      secrets: { "db-app-password": "secret-login-password" },
      bootstrap: true,
      now: () => "2030-01-02T03:04:05.000Z",
    };

    const first = await runProvisionV1(options);
    const second = await runProvisionV1({ ...options, now: () => "2031-02-03T04:05:06.000Z" });
    const checkpoint = await readFile(outputFile, "utf8");

    expect(first.status).toBe("BLOCKED");
    expect(second.status).toBe("COMPLETED");
    expect(identities[0]).toEqual(identities[1]);
    expect(checkpoint).not.toContain("secret-login-password");
    expect(checkpoint).not.toContain("secret-session-token");
    expect(checkpoint).not.toContain("Synthetic-Pass-123");
  });

  it("项目授权步骤要求 bootstrap 并通过当前会话的 C06 窄口", async () => {
    const outputFile = join(await makeDirectory(), "checkpoint.json");
    const foundation = makeFoundation(vi.fn());
    foundation.access.authorize = vi.fn();
    foundation.access.administerProject = vi.fn();
    foundation.access.executeDeploymentProjectAccess.mockResolvedValue({
      kind: "project",
      resultRef: { entityId: "project-rail-01", versionId: "1" },
    });
    const projectConfig = config({
      steps: [
        {
          id: "grant-project",
          op: "project-access",
          requestedSpatialScopeRefs: [],
          requestedSourceVersionRefs: [],
          payload: {
            kind: "open-project",
            expectedVersion: "none",
            initialRiskManagerAccountId: "risk-manager",
          },
        },
      ],
    });
    const options = {
      config: projectConfig,
      outputFile,
      foundation,
      secrets: { "db-app-password": "secret-login-password" },
    };
    await expect(runProvisionV1(options)).rejects.toMatchObject({
      code: "BOOTSTRAP_FLAG_REQUIRED",
    });
    expect(foundation.access.executeDeploymentProjectAccess).not.toHaveBeenCalled();

    const result = await runProvisionV1({ ...options, bootstrap: true });

    expect(result.status).toBe("COMPLETED");
    expect(foundation.access.executeDeploymentProjectAccess).toHaveBeenCalledWith({
      sessionToken: "secret-session-token",
      command: {
        kind: "open-project",
        expectedVersion: "none",
        initialRiskManagerAccountId: "risk-manager",
        commandId: "provision-run-1-grant-project",
        idempotencyKey: "provision-run-1-grant-project",
        projectId: "project-rail-01",
      },
    });
    expect(foundation.access.authorize).not.toHaveBeenCalled();
    expect(foundation.access.administerProject).not.toHaveBeenCalled();
    expect(await readFile(outputFile, "utf8")).not.toContain("secret-session-token");
  });

  it("文本转换按原 DTO 进入正式转换器，重试复用同一身份且只留安全引用", async () => {
    const outputFile = join(await makeDirectory(), "checkpoint.json");
    const convert = vi
      .fn()
      .mockResolvedValueOnce({ kind: "failed", error: { code: "TRANSIENT_FAILURE" } })
      .mockResolvedValue(conversionSucceeded);
    const foundation = makeConversionFoundation(convert);
    const options = {
      foundation: {
        ...foundation,
        config: {
          ...foundation.config,
          documentConversion: { ...foundation.config.documentConversion, mineru: {} },
        },
      },
      config: config({ steps: [conversionStep()] }),
      outputFile,
      secrets: { "db-app-password": "secret-login-password" },
      now: () => "2030-01-02T03:04:05.000Z",
    };

    const first = await runProvisionV1(options);
    const second = await runProvisionV1({ ...options, now: () => "2031-02-03T04:05:06.000Z" });
    const checkpoint = await readFile(outputFile, "utf8");

    expect(first.steps[0]).toMatchObject({ status: "BLOCKED", code: "TRANSIENT_FAILURE" });
    expect(second.status).toBe("COMPLETED");
    expect(second.steps[0].resultRef).toEqual(conversionSucceeded.result.conversionRef);
    const [sent] = convert.mock.calls.map(([command]) => command);
    expect(sent).not.toHaveProperty("commandId");
    expect(sent).toMatchObject({
      schemaVersion: "1",
      runId: "provision-run-1",
      threadId: "provision-run-1-convert-text",
      conversionId: "provision-run-1-convert-text",
      idempotencyKey: "provision-run-1-convert-text",
      issuedAt: "2030-01-02T03:04:05.000Z",
      projectId: "project-rail-01",
      actorId: "account-admin",
      input: { kind: "text-pdf" },
      authorization: conversionAuthorization(),
    });
    expect(Date.parse(sent.deadlineAt)).toBeGreaterThan(Date.parse(sent.issuedAt));
    // 原身份续接：第二次尝试的命令与首次完全一致。
    expect(convert.mock.calls[1][0]).toEqual(sent);
    expect(checkpoint).not.toContain("secret-session-token");
    expect(checkpoint).not.toContain("secret-login-password");
  });

  it.each(["docx", "text-pdf", "ocr-layout"])(
    "资料 %s 缺少 MinerU 时阻塞且不进入转换器",
    async (kind) => {
      const convert = vi.fn();
      const foundation = makeConversionFoundation(convert);
      const result = await runProvisionV1({
        config: config({ steps: [conversionStep({ input: { kind } })] }),
        outputFile: join(await makeDirectory(), "checkpoint.json"),
        foundation,
        secrets: { "db-app-password": "secret-login-password" },
      });

      expect(result.steps[0]).toMatchObject({ status: "BLOCKED", code: "MINERU_NOT_CONFIGURED" });
      expect(convert).not.toHaveBeenCalled();
    },
  );

  it("配置伪造宿主命令字段时阻塞且不产生任何副作用", async () => {
    const convert = vi.fn();
    const foundation = makeConversionFoundation(convert);
    const result = await runProvisionV1({
      config: config({ steps: [conversionStep({ commandId: "spoofed-command-id" })] }),
      outputFile: join(await makeDirectory(), "checkpoint.json"),
      foundation,
      secrets: { "db-app-password": "secret-login-password" },
    });

    expect(result.steps[0]).toMatchObject({
      status: "BLOCKED",
      code: "PAYLOAD_OWNS_COMMAND_FIELD",
    });
    expect(foundation.access.authorize).not.toHaveBeenCalled();
    expect(convert).not.toHaveBeenCalled();
  });

  it("只拒宿主拥有的顶层字段，嵌套领域字段交由领域 Schema 判定", () => {
    expect(() =>
      assertPayloadHasNoOwnedFields({
        sourceId: "source-1",
        segments: [{ audit: { actorId: "account-admin" }, locator: { projectId: "p-1" } }],
      }),
    ).not.toThrow();
    expect(() => assertPayloadHasNoOwnedFields({ projectId: "spoofed-project" })).toThrow(
      "PAYLOAD_OWNS_COMMAND_FIELD",
    );
  });
});
