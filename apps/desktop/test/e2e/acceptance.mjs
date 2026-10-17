import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL, URL } from "node:url";

import {
  createDeploymentSecretFileLoaderV1,
  DeploymentConfigV1Schema,
  ReleaseManifestV1Schema,
} from "../../../../packages/adapters/dist/deployment/index.js";
import {
  AgentTaskRefV1Schema,
  QueryResultRefV1Schema,
  SourceVersionRefV1Schema,
  WorkflowRunRefV1Schema,
} from "../../../../packages/contracts/dist/ports/index.js";
import { ArtifactRefV1Schema } from "../../../../packages/core/dist/artifacts/schema.js";
import { readFunctionalAcceptanceReportV1 } from "../../../../scripts/acceptance/functional.mjs";
import { resolveTemplates } from "../../../../scripts/acceptance/synthetic.mjs";

/**
 * D-28（承接 C37 D-22）：桌面验收的受控测试输入与预检。
 *
 * 输入由安装者受控写入（RISKFLOW_DESKTOP_BUILD_CONFIG / RISKFLOW_DESKTOP_ACCEPTANCE_CONFIG）；
 * 缺项、错工程/发布、越界链接、非 HTTPS 或权限不合格的秘密文件都必须失败，
 * 不允许用默认 origin、跳过场景或就地伪造业务事实来「通过」。
 *
 * 预检只读本地文件与同次正式回执，不发起 HTTP、不写入业务状态：
 * - 批准 origin 来自产品 DesktopConfigV1，这里不复制第二份 origin 规则；
 * - 同次运行的任务/运行/资料引用只沿 functionalReportFile 对应正式回执读取；
 * - 秘密按宿主受限文件规则（绝对路径、同 uid、0600、有界读取）加载，只留在内存里，
 *   问题码与返回结构都不含宿主路径或秘密内容。
 */

/** zod 与产品 Schema 同源：从正式 contracts 构建产物解析，测试宿主不引入第二套校验语义。 */
const { z } = createRequire(import.meta.filename)("zod");

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const CONFIG_READ_LIMIT_BYTES_V1 = 1024 * 1024;
/** 口令文件只有一行；有界读取避免把任意大文件读进测试进程。 */
const SECRET_READ_LIMIT_BYTES_V1 = 4096;

export const DESKTOP_ACCEPTANCE_ENV_V1 = Object.freeze({
  buildConfig: "RISKFLOW_DESKTOP_BUILD_CONFIG",
  acceptanceConfig: "RISKFLOW_DESKTOP_ACCEPTANCE_CONFIG",
});

/** 预检问题码：稳定、可断言，不含宿主路径与任何秘密内容。 */
export const DESKTOP_ACCEPTANCE_PROBLEM_V1 = Object.freeze({
  missingBuild: "missing-desktop-build",
  missingBuildConfig: "missing-desktop-build-config",
  unreadableBuildConfig: "desktop-config-unreadable",
  originNotHttps: "desktop-origin-not-https",
  invalidBuildConfig: "desktop-config-invalid",
  missingAcceptanceConfig: "missing-desktop-acceptance-config",
  unreadableAcceptanceConfig: "desktop-acceptance-config-unreadable",
  invalidAcceptanceInput: "desktop-acceptance-input-invalid",
  missingApprovedOrigin: "desktop-approved-origin-unavailable",
  sharedObjectNotHttps: "desktop-shared-object-not-https",
  sharedObjectOutsideOrigin: "desktop-shared-object-outside-approved-origin",
  invalidCertificateOriginNotHttps: "desktop-invalid-certificate-origin-not-https",
  invalidCertificateOriginIsApproved: "desktop-invalid-certificate-origin-is-approved-origin",
  unapprovedOriginNotHttps: "desktop-unapproved-origin-not-https",
  unapprovedOriginIsApproved: "desktop-unapproved-origin-is-approved-origin",
  runProjectMismatch: "desktop-run-project-mismatch",
  runIdentityMismatch: "desktop-run-identity-mismatch",
  runBaseUrlMismatch: "desktop-run-base-url-mismatch",
  invalidRunBindings: "desktop-run-bindings-invalid",
  reportMismatch: "desktop-functional-report-mismatch",
  deploymentMismatch: "desktop-deployment-release-mismatch",
  unreadableOperatorSecret: "desktop-operator-password-secret-unreadable",
  unreadableAdministratorSecret: "desktop-administrator-password-secret-unreadable",
});

const boundedText = z.string().trim().min(1).max(512);

/**
 * D-28 桌面验收输入（测试宿主 Schema，不进入产品 DTO）。
 *
 * downloadArtifactRef 复用正式 ArtifactRefV1Schema；sharedObjectUrl 是共享业务对象的同源地址；
 * 两个拒绝目标必须与批准 origin 不同，且自身仍是 HTTPS。
 */
export const DesktopAcceptanceInputV1Schema = z.strictObject({
  schemaVersion: z.literal("1"),
  releaseId: boundedText,
  projectId: boundedText,
  loginName: boundedText,
  passwordSecretFile: boundedText,
  administratorLoginName: boundedText,
  administratorPasswordSecretFile: boundedText,
  functionalConfigFile: boundedText,
  functionalReportFile: boundedText,
  sharedObjectUrl: boundedText,
  downloadArtifactRef: ArtifactRefV1Schema,
  invalidCertificateOrigin: boundedText,
  unapprovedOrigin: boundedText,
});

const readJsonV1 = (path, limitBytes) => {
  try {
    if (statSync(path).size > limitBytes) return undefined;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

/**
 * HTTPS origin：与产品 DesktopConfigV1 的 publicOrigin 规则同形（无路径、无凭据）。
 * 其它协议、带 userinfo 或无法解析的值都不算批准或拒绝目标。
 */
const httpsOriginOfV1 = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === ""
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
};

/** 客户端配置 Schema 来自产品构建产物；未构建时返回 undefined，由调用方单独记问题。 */
const loadDesktopConfigSchemaV1 = async (root) => {
  try {
    const module = await import(
      pathToFileURL(join(root, "apps", "desktop", "dist", "config.js")).href
    );
    return module.DesktopConfigV1Schema;
  } catch {
    return undefined;
  }
};

/** 秘密只经宿主受限加载器读取；失败一律折叠成稳定问题码，不回报路径或内容。 */
const loadSecretV1 = (filePath, secretId) => {
  const loader = createDeploymentSecretFileLoaderV1({
    expectedUid: typeof process.getuid === "function" ? process.getuid() : undefined,
    maxMode: 0o600,
    readFile: (path) => {
      if (statSync(path).size > SECRET_READ_LIMIT_BYTES_V1) {
        throw new Error("secret file exceeds the bounded read limit");
      }
      return readFileSync(path, "utf8");
    },
  });
  try {
    return loader([{ secretId, filePath }])[secretId];
  } catch {
    return undefined;
  }
};

/** 批准 origin 与两个拒绝目标、发布身份的本地核对。 */
const checkApprovedTargetsV1 = (acceptance, publicOrigin, problems, desktopSchema) => {
  if (publicOrigin === undefined) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.missingApprovedOrigin);
    return;
  }
  const sharedOrigin = httpsOriginOfV1(acceptance.sharedObjectUrl);
  if (sharedOrigin === undefined) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.sharedObjectNotHttps);
  } else if (sharedOrigin !== httpsOriginOfV1(publicOrigin)) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.sharedObjectOutsideOrigin);
  }

  const rejectTargets = [
    [
      acceptance.invalidCertificateOrigin,
      DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidCertificateOriginNotHttps,
      DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidCertificateOriginIsApproved,
    ],
    [
      acceptance.unapprovedOrigin,
      DESKTOP_ACCEPTANCE_PROBLEM_V1.unapprovedOriginNotHttps,
      DESKTOP_ACCEPTANCE_PROBLEM_V1.unapprovedOriginIsApproved,
    ],
  ];
  for (const [target, notHttps, isApproved] of rejectTargets) {
    const origin = httpsOriginOfV1(target);
    if (origin === undefined || !desktopSchema.shape.publicOrigin.safeParse(target).success)
      problems.push(notHttps);
    else if (origin === httpsOriginOfV1(publicOrigin)) problems.push(isApproved);
  }
};

/** 同次正式回执：functionalConfigFile → runConfigFile → bindings，逐步核对工程与部署身份。 */
const readSameRunBindingsV1 = (acceptance, acceptanceConfigPath, publicOrigin, problems, env) => {
  const functionalPath = resolve(dirname(acceptanceConfigPath), acceptance.functionalConfigFile);
  let functionalConfig, runConfig, synthetic;
  try {
    ({
      config: functionalConfig,
      runConfig,
      synthetic,
    } = readFunctionalAcceptanceReportV1(
      functionalPath,
      resolve(dirname(acceptanceConfigPath), acceptance.functionalReportFile),
    ));
  } catch {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.reportMismatch);
    return undefined;
  }
  if (runConfig.projectId !== acceptance.projectId) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.runProjectMismatch);
    return undefined;
  }
  if (runConfig.loginName !== acceptance.loginName) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.runIdentityMismatch);
    return undefined;
  }
  if (httpsOriginOfV1(runConfig.baseUrl) !== httpsOriginOfV1(publicOrigin)) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.runBaseUrlMismatch);
    return undefined;
  }
  const deployment = DeploymentConfigV1Schema.safeParse(
    readJsonV1(env.RISKFLOW_DEPLOYMENT_CONFIG, CONFIG_READ_LIMIT_BYTES_V1),
  );
  const manifest = ReleaseManifestV1Schema.safeParse(
    readJsonV1(env.RISKFLOW_RELEASE_MANIFEST, CONFIG_READ_LIMIT_BYTES_V1),
  );
  if (
    !deployment.success ||
    !manifest.success ||
    deployment.data.purpose !== "synthetic-acceptance" ||
    deployment.data.releaseId !== acceptance.releaseId ||
    manifest.data.releaseId !== acceptance.releaseId ||
    manifest.data.codeCommit !== synthetic.codeHead ||
    httpsOriginOfV1(deployment.data.publicOrigin) !== httpsOriginOfV1(publicOrigin)
  ) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.deploymentMismatch);
    return undefined;
  }
  try {
    const sameRef = (left, right) =>
      left?.kind === right?.kind &&
      left?.reference?.entityId === right?.reference?.entityId &&
      left?.reference?.versionId === right?.reference?.versionId;
    const url = new URL(acceptance.sharedObjectUrl);
    if (
      url.pathname !== "/report/export" ||
      url.searchParams.get("sourceKind") !== "query-result" ||
      url.searchParams.get("project") !== acceptance.projectId
    )
      throw new Error("shared report target mismatch");
    const queryResultRef = QueryResultRefV1Schema.parse({
      kind: "query-result",
      reference: {
        entityId: url.searchParams.get("sourceId"),
        versionId: url.searchParams.get("sourceVersion"),
      },
    });
    const querySteps = synthetic.steps.filter(
      (step) =>
        step.operationId === "riskflow_query_projection_query" &&
        step.status === "completed" &&
        sameRef(step.resultRef?.queryResultRef, queryResultRef),
    );
    if (querySteps.length !== 1) throw new Error("query receipt not unique");
    const command = runConfig.commands.find((step) => step.stepId === querySteps[0].stepId);
    const steps = new Map(synthetic.steps.map((step) => [step.stepId, step]));
    const templateContext = { steps, bindings: synthetic.bindings };
    const queryPayload = resolveTemplates(command.payload, templateContext);
    if (
      queryPayload.queryType !== "risk-overview" ||
      queryPayload.projectRevisionRef?.reference?.entityId !== acceptance.projectId
    )
      throw new Error("shared source is not a project report query");
    const observedStepIds = new Set(functionalConfig.observations.map((item) => item.stepId));
    const startSteps = synthetic.steps.filter(
      (step) =>
        step.operationId === "riskflow_command_workflow_start-run" &&
        ["submitted", "completed"].includes(step.status) &&
        observedStepIds.has(step.stepId),
    );
    if (startSteps.length !== 1) throw new Error("start receipt not unique");
    const workflowRunRef = WorkflowRunRefV1Schema.parse(startSteps[0].resultRef?.workflowRunRef);
    const sourceVersionRef = SourceVersionRefV1Schema.parse(
      startSteps[0].requestedSourceVersionRefs?.[0],
    );
    if (
      !synthetic.steps.some(
        (step) =>
          step.operationId === "riskflow_command_engineering-data_register-source-delivery" &&
          step.status === "completed" &&
          sameRef(step.resultRef?.sourceVersionRef, sourceVersionRef),
      )
    )
      throw new Error("source receipt missing");
    if (
      acceptance.downloadArtifactRef.kind !== "content-artifact" ||
      !synthetic.steps.some(
        (step) =>
          step.operationId === "riskflow_query_projection_export" &&
          step.status === "completed" &&
          sameRef(step.resultRef?.exportArtifactRef, {
            kind: "export-artifact",
            reference: acceptance.downloadArtifactRef.reference,
          }) &&
          sameRef(
            resolveTemplates(
              runConfig.commands.find((command) => command.stepId === step.stepId)?.payload
                ?.sourceRef,
              templateContext,
            ),
            queryResultRef,
          ),
      )
    )
      throw new Error("download receipt missing");
    return {
      workflowRunRef,
      ...(startSteps[0].resultRef?.agentTaskRef === undefined
        ? {}
        : {
            pendingAgentTaskRef: AgentTaskRefV1Schema.parse(startSteps[0].resultRef.agentTaskRef),
          }),
      queryResultRef,
      reportSourceVersionRefs: querySteps[0].requestedSourceVersionRefs ?? [],
      sourceVersionRef,
      desktopCompatibility: manifest.data.desktopCompatibility,
      requestedSpatialScopeRefs: startSteps[0].requestedSpatialScopeRefs ?? [],
      requestedSourceVersionRefs: startSteps[0].requestedSourceVersionRefs ?? [],
    };
  } catch {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidRunBindings);
    return undefined;
  }
};

/**
 * 校验桌面配置、验收输入、同次回执与秘密文件是否齐备。
 *
 * 返回的 credentials 只供测试宿主登录使用，不得写入报告、日志或断言消息。
 */
export const preflightDesktopAcceptanceV1 = async (env = process.env, root = REPO_ROOT) => {
  const problems = [];
  const buildConfigPath = env[DESKTOP_ACCEPTANCE_ENV_V1.buildConfig];
  const acceptanceConfigPath = env[DESKTOP_ACCEPTANCE_ENV_V1.acceptanceConfig];

  const mainPath = join(root, "apps", "desktop", "dist", "main.js");
  const buildPresent = existsSync(mainPath);
  if (!buildPresent) problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.missingBuild);

  let desktopConfig;
  let desktopSchema;
  let publicOrigin;
  if (buildConfigPath === undefined || !existsSync(buildConfigPath)) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.missingBuildConfig);
  } else {
    const desktopRaw = readJsonV1(buildConfigPath, CONFIG_READ_LIMIT_BYTES_V1);
    if (desktopRaw === undefined) {
      problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.unreadableBuildConfig);
    } else if (
      typeof desktopRaw?.publicOrigin !== "string" ||
      !desktopRaw.publicOrigin.startsWith("https://")
    ) {
      problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.originNotHttps);
    } else {
      const schema = buildPresent ? await loadDesktopConfigSchemaV1(root) : undefined;
      desktopSchema = schema;
      const parsed = schema?.safeParse(desktopRaw);
      if (parsed === undefined) {
        // 客户端未构建：缺失构建已单独记录，这里不再猜配置结构。
      } else if (!parsed.success) {
        problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidBuildConfig);
      } else {
        desktopConfig = parsed.data;
        publicOrigin = desktopConfig.publicOrigin;
      }
    }
  }

  let acceptance;
  let bindings;
  let operatorPassword;
  let administratorPassword;
  if (acceptanceConfigPath === undefined || !existsSync(acceptanceConfigPath)) {
    problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.missingAcceptanceConfig);
  } else {
    const acceptanceRaw = readJsonV1(acceptanceConfigPath, CONFIG_READ_LIMIT_BYTES_V1);
    if (acceptanceRaw === undefined) {
      problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.unreadableAcceptanceConfig);
    } else {
      const parsed = DesktopAcceptanceInputV1Schema.safeParse(acceptanceRaw);
      if (!parsed.success) {
        problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.invalidAcceptanceInput);
      } else {
        acceptance = parsed.data;
        checkApprovedTargetsV1(acceptance, publicOrigin, problems, desktopSchema);
        bindings = readSameRunBindingsV1(
          acceptance,
          acceptanceConfigPath,
          publicOrigin,
          problems,
          env,
        );
        operatorPassword = loadSecretV1(acceptance.passwordSecretFile, "operator-password");
        if (operatorPassword === undefined) {
          problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.unreadableOperatorSecret);
        }
        administratorPassword = loadSecretV1(
          acceptance.administratorPasswordSecretFile,
          "administrator-password",
        );
        if (administratorPassword === undefined) {
          problems.push(DESKTOP_ACCEPTANCE_PROBLEM_V1.unreadableAdministratorSecret);
        }
      }
    }
  }

  return {
    ready: problems.length === 0,
    problems,
    publicOrigin,
    desktopConfig,
    acceptance,
    bindings,
    credentials:
      acceptance === undefined
        ? undefined
        : Object.freeze({
            operator: Object.freeze({
              loginName: acceptance.loginName,
              password: operatorPassword,
            }),
            administrator: Object.freeze({
              loginName: acceptance.administratorLoginName,
              password: administratorPassword,
            }),
          }),
  };
};
