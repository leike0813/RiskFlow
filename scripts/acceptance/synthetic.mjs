#!/usr/bin/env node
/**
 * 合成材料功能预验收工具（IP-02）。
 *
 * 不变量：
 * - `check` 只做材料静态检查：文件、共享 Schema、覆盖、来源定位、集合隔离与输入/答案分离；
 * - `run` 先跑完整静态检查，再只调用 `HTTP_ROUTE_CATALOG_V1` 真实存在的正式 HTTP 操作，
 *   不发明路由、不直接写业务数据库、不把候选预期反填成运行结果；
 * - 引用只来自实际回执：`{$result:stepId,path:[...]}` 与 `{$binding:key}` 指向同一次运行的
 *   真实返回字段，`{$file}` 只允许材料包内安全目录，拒绝任何答案类文件；
 * - 命令身份由 run 身份 + step 身份固定：中断、歧义失败与继续执行复用同一把幂等键和同一
 *   `issuedAt`，材料包内容、工作区源码或配置任一变化都会改变 run 身份；
 * - HTTP 200 且 `kind="failed"` 同样算失败；异步命令一律记 `submitted`，配置不能改写成完成；
 * - 密码、Cookie 与原始响应正文不落盘；checkpoint 只保存安全引用、状态与时间戳，
 *   并且在每个 HTTP 步骤前后各写盘一次。
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL, URL } from "node:url";
import { TextDecoder } from "node:util";

// CLI 以生产形态运行：只依赖已构建产物，不经过源码入口。
import {
  HTTP_ROUTE_CATALOG_V1,
  SessionLoginRequestV1Schema,
  SessionMetadataV1Schema,
} from "../../apps/api/dist/index.js";
import { AssessmentConfigurationDocumentV1Schema } from "../../packages/core/dist/assessment-config/index.js";
import {
  ScoringRuleConfigurationPackageV1Schema,
  StructuredScoringRuleDocumentV1Schema,
} from "../../packages/core/dist/scoring-rules/index.js";
import {
  CaseLibraryPackageV1Schema,
  ProcessModelPackageV1Schema,
  RiskMechanismPackageV1Schema,
  StandardLibraryPackageV1Schema,
} from "../../packages/core/dist/identification-knowledge/index.js";
import {
  MonitoringBatchV1Schema,
  MonitoringSampleArtifactEnvelopeV1Schema,
  MonitoringSampleInputV1Schema,
  MonitoringSeriesRevisionV1Schema,
} from "../../packages/core/dist/engineering-data/monitoring/index.js";
import { HumanFeedbackInputSnapshotRowV1Schema } from "../../packages/core/dist/human-decision-feedback/index.js";
import { ContractReferenceV1Schema } from "../../packages/contracts/dist/ports/index.js";
import {
  MONITORING_INDICATOR_VALUES,
  PROCESS_NODE_VALUES,
  RISK_MECHANISM_TYPE_VALUES,
} from "../../packages/contracts/dist/vocabulary/index.js";

const USAGE = [
  "usage:",
  "  pnpm acceptance:synthetic check --pack <packDir>",
  "  pnpm acceptance:synthetic run --pack <packDir> --config <runConfig.json> --output <dir> [--resume]",
].join("\n");

export const SYNTHETIC_LABEL_V1 = "合成样本，待甲方复核";
export const PACK_SCHEMA_VERSION_V1 = "1";

const LOGIN_PATH_V1 = "/api/v1/session/login";
/** 工具自身读取并解析的输入上界：JSON 与文本投影都在此之下。 */
const MAX_READ_BYTES_V1 = 8 * 1024 * 1024;
const MAX_INPUT_FILE_COUNT_V1 = 512;
const MAX_RESPONSE_BYTES_V1 = 1024 * 1024;
const DEFAULT_TIMEOUT_MS_V1 = 30_000;
const REPO_ROOT_V1 = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** 答案类文件标记：只用于检查与报告，永不作为模型或请求载荷输入。 */
const ANSWER_FILE_TOKENS_V1 = Object.freeze([
  "expected",
  "scenario",
  "acceptance-case",
  "index",
  "report",
  "manifest",
]);
/** `$file` 允许的材料目录：模型输入、资料、配置、规则、知识与监测。 */
const FILE_INPUT_ROOTS_V1 = Object.freeze([
  "model-input",
  "documents",
  "configurations",
  "rules",
  "knowledge",
  "monitoring",
]);

/** 候选答案字段：出现在输入侧即为答案泄漏；caseId 是追踪标识，允许出现在输入。 */
const ANSWER_FIELD_NAMES_V1 = Object.freeze([
  "candidateLabel",
  "candidateMechanismType",
  "candidateRiskEvent",
  "candidateRiskLevel",
  "candidateLikelihoodScore",
  "candidateConsequenceScore",
  "candidateIndicatorScores",
  "candidateWarningThresholdIds",
  "candidateProcessNode",
  "polarity",
  "expectedOutcome",
  "riskEvent",
]);

const TEMPLATE_KEYS_V1 = Object.freeze(["$binding", "$file", "$result"]);
const DEVELOPMENT_SPLITS_V1 = Object.freeze(["development", "dev", "开发"]);
const TRIAL_SPLITS_V1 = Object.freeze(["trial", "trial-run", "pilot", "试运行"]);

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

export class SyntheticAcceptanceError extends Error {
  constructor(code, detail = "") {
    super(detail === "" ? code : `${code}: ${detail}`);
    this.name = "SyntheticAcceptanceError";
    this.code = code;
  }
}

/** 标量与数组统一成数组：材料里 mechanismType / processNode / sourceFamily 都是标量。 */
const asList = (value) =>
  value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];

const readJson = (path) => {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new SyntheticAcceptanceError("FILE_UNREADABLE", path);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SyntheticAcceptanceError("JSON_INVALID", path);
  }
};

const within = (parent, child) => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/** 解析包内相对路径；realpath 后再次确认不逃逸，符号链接不能绕过材料包边界。 */
const resolvePackFile = (packDir, relativePath) => {
  if (typeof relativePath !== "string" || relativePath === "") {
    throw new SyntheticAcceptanceError("PACK_PATH_INVALID", String(relativePath));
  }
  const resolved = resolve(packDir, relativePath);
  if (!within(packDir, resolved)) {
    throw new SyntheticAcceptanceError("PACK_PATH_ESCAPES", relativePath);
  }
  if (!existsSync(resolved)) {
    throw new SyntheticAcceptanceError("PACK_FILE_MISSING", relativePath);
  }
  const real = realpathSync(resolved);
  if (!within(realpathSync(packDir), real)) {
    throw new SyntheticAcceptanceError("PACK_PATH_SYMLINK_ESCAPES", relativePath);
  }
  // 扫描件可达数百 MB，存在性检查只确认是可定位的普通文件；读取另设上界。
  if (!statSync(real).isFile())
    throw new SyntheticAcceptanceError("PACK_PATH_NOT_FILE", relativePath);
  return real;
};

/** 读取包内 JSON 文件并施加读取上界。 */
const readPackJson = (packDir, relativePath) => {
  const path = resolvePackFile(packDir, relativePath);
  if (statSync(path).size > MAX_READ_BYTES_V1) {
    throw new SyntheticAcceptanceError("PACK_FILE_TOO_LARGE", relativePath);
  }
  return readJson(path);
};

const schemaIssue = (result) =>
  result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
    .join("；");

const splitOf = (value) => {
  if (typeof value !== "string") return undefined;
  if (DEVELOPMENT_SPLITS_V1.includes(value)) return "development";
  if (TRIAL_SPLITS_V1.includes(value)) return "trial";
  return value;
};

// ------------------------------------------------------------------ 静态检查

const checkManifestV1 = (manifest, packDir) => {
  const problems = [];
  if (manifest.schemaVersion !== PACK_SCHEMA_VERSION_V1) {
    problems.push(`manifest.schemaVersion 必须是 "${PACK_SCHEMA_VERSION_V1}"`);
  }
  for (const field of ["packId", "packVersion"]) {
    if (manifest[field] === undefined || manifest[field] === "")
      problems.push(`manifest.${field} 缺失`);
  }
  if (manifest.label !== SYNTHETIC_LABEL_V1)
    problems.push(`manifest.label 必须为“${SYNTHETIC_LABEL_V1}”`);
  if (manifest.labelStatus !== "candidate")
    problems.push("manifest.labelStatus 必须为 candidate（候选标签未经人工复核）");
  if (typeof manifest.project !== "object" || manifest.project === null)
    problems.push("manifest.project 必须是对象");

  for (const field of [
    "cases",
    "expected",
    "sources",
    "acceptanceCases",
    "monitoring",
    "feedback",
  ]) {
    if (typeof manifest[field] !== "string" || manifest[field] === "") {
      problems.push(`manifest.${field} 必须是包内相对文件路径`);
      continue;
    }
    try {
      resolvePackFile(packDir, manifest[field]);
    } catch (error) {
      problems.push(`manifest.${field} 无法解析：${error.code}`);
    }
  }

  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    problems.push("manifest.documents 必须是非空数组");
  } else {
    const bySplit = { development: new Set(), trial: new Set() };
    const families = { development: new Set(), trial: new Set() };
    for (const [index, document] of manifest.documents.entries()) {
      for (const field of ["documentId", "file", "mediaType", "sourceFamily", "split"]) {
        if (document?.[field] === undefined || document[field] === "") {
          problems.push(`manifest.documents[${index}].${field} 缺失`);
        }
      }
      const split = splitOf(document?.split);
      if (split === "development" || split === "trial") {
        bySplit[split].add(document?.documentId);
        families[split].add(document?.sourceFamily);
      }
      try {
        resolvePackFile(packDir, document?.file);
      } catch (error) {
        problems.push(`manifest.documents[${index}].file 无法解析：${error.code}`);
      }
    }
    // 资料文件与资料家族都不得跨集合：试运行必须真正 held out。
    const sharedDocuments = [...bySplit.development].filter((id) => bySplit.trial.has(id));
    if (sharedDocuments.length > 0)
      problems.push(`资料文件跨集合复用：${sharedDocuments.join("、")}`);
    const sharedFamilies = [...families.development].filter((family) => families.trial.has(family));
    if (sharedFamilies.length > 0)
      problems.push(`资料家族跨集合复用：${sharedFamilies.join("、")}`);
  }

  for (const field of ["configurations", "rules", "knowledge"]) {
    const entries = manifest[field];
    if (!Array.isArray(entries) || entries.length === 0) {
      problems.push(`manifest.${field} 必须是非空数组`);
      continue;
    }
    for (const [index, entry] of entries.entries()) {
      try {
        resolvePackFile(packDir, entry?.file);
      } catch (error) {
        problems.push(`manifest.${field}[${index}].file 无法解析：${error.code}`);
      }
    }
  }
  return problems;
};

const checkSourcesV1 = (packDir, manifest) => {
  const problems = [];
  const sources = asList(readPackJson(packDir, manifest.sources)?.sources);
  if (sources.length === 0) return ["sources 文件没有来源登记条目"];
  for (const source of sources) {
    for (const field of ["id", "path", "locator", "explicitFact", "applicability", "uncertainty"]) {
      if (source?.[field] === undefined || source[field] === null || source[field] === "") {
        problems.push(`来源 ${source?.id ?? "<无 id>"} 缺少 ${field}`);
      }
    }
  }
  return problems;
};

const KNOWLEDGE_SCHEMAS_V1 = new Map([
  ["process-model", ProcessModelPackageV1Schema],
  ["risk-mechanism", RiskMechanismPackageV1Schema],
  ["standard-library", StandardLibraryPackageV1Schema],
  ["case-library", CaseLibraryPackageV1Schema],
]);

const checkSchemasV1 = (packDir, manifest) => {
  const problems = [];
  const configurationTypes = new Set();
  for (const entry of manifest.configurations ?? []) {
    const document = readPackJson(packDir, entry.file);
    const definitionType = document?.definitionType;
    if (typeof definitionType !== "string") {
      problems.push(`${entry.file} 缺少 definitionType`);
      continue;
    }
    configurationTypes.add(definitionType);
    const result = AssessmentConfigurationDocumentV1Schema.safeParse(document);
    if (!result.success)
      problems.push(`${entry.file} 不符合评估配置 Schema：${schemaIssue(result)}`);
  }
  for (const type of AssessmentConfigurationDocumentV1Schema.options.map(
    (option) => option.shape.definitionType.value,
  )) {
    if (!configurationTypes.has(type)) problems.push(`缺少评估配置类型：${type}`);
  }

  for (const entry of manifest.rules ?? []) {
    const result = StructuredScoringRuleDocumentV1Schema.safeParse(
      readPackJson(packDir, entry.file),
    );
    if (!result.success)
      problems.push(`${entry.file} 不符合结构化评分规则 Schema：${schemaIssue(result)}`);
  }

  const configurationPackagePath = manifest.scoringConfigurationPackage;
  if (typeof configurationPackagePath !== "string") {
    problems.push("manifest.scoringConfigurationPackage 缺少配置包路径");
  } else {
    const configurationPackage = readPackJson(packDir, configurationPackagePath);
    const result = ScoringRuleConfigurationPackageV1Schema.safeParse(configurationPackage);
    if (!result.success) {
      problems.push(`${configurationPackagePath} 不符合评分配置包 Schema：${schemaIssue(result)}`);
    } else {
      const sources = new Map(
        result.data.sources.map((source) => [
          `${source.sourceVersionRef.kind}:${source.sourceVersionRef.reference.entityId}@${source.sourceVersionRef.reference.versionId}`,
          source,
        ]),
      );
      const usedSegments = new Set();
      for (const member of result.data.members) {
        const { rule } = member;
        const binding = member.binding;
        if (rule.ruleVersion.entityId !== rule.ruleId) {
          problems.push(
            `${configurationPackagePath} 规则 ${rule.ruleId} 的 ruleVersion.entityId 必须等于 ruleId`,
          );
        }
        const key = `${binding.sourceVersionRef.kind}:${binding.sourceVersionRef.reference.entityId}@${binding.sourceVersionRef.reference.versionId}`;
        const source = sources.get(key);
        if (source === undefined) {
          problems.push(`${configurationPackagePath} 规则 ${rule.ruleId} 未绑定包内来源`);
          continue;
        }
        const segmentIds = new Set(source.segments.map((segment) => segment.sourceSegmentId));
        for (const evidence of binding.evidenceReferences) {
          const segmentId = evidence.locator.sourceSegmentId;
          if (
            evidence.sourceVersion.entityId !== binding.sourceVersionRef.reference.entityId ||
            evidence.sourceVersion.versionId !== binding.sourceVersionRef.reference.versionId ||
            !segmentIds.has(segmentId)
          ) {
            problems.push(`${configurationPackagePath} 规则 ${rule.ruleId} 的来源证据未闭合`);
          }
          usedSegments.add(`${key}:${segmentId}`);
        }
        if (
          !binding.evidenceReferences.some(
            (evidence) => evidence.locator.sourceSegmentId === rule.evidenceLocator.sourceSegmentId,
          )
        ) {
          problems.push(
            `${configurationPackagePath} 规则 ${rule.ruleId} 的规则定位未被来源证据覆盖`,
          );
        }
      }
      for (const [key, source] of sources) {
        for (const segment of source.segments) {
          if (!usedSegments.has(`${key}:${segment.sourceSegmentId}`)) {
            problems.push(
              `${configurationPackagePath} 来源段 ${segment.sourceSegmentId} 未被规则证据引用`,
            );
          }
        }
      }
    }
  }

  const mechanismTypes = new Set();
  const processNodes = new Set();
  for (const entry of manifest.knowledge ?? []) {
    const document = readPackJson(packDir, entry.file);
    const schema = KNOWLEDGE_SCHEMAS_V1.get(document?.definitionType);
    if (schema === undefined) {
      problems.push(`${entry.file} 的 definitionType 未覆盖已知知识包契约`);
      continue;
    }
    const result = schema.safeParse(document);
    if (!result.success) {
      problems.push(
        `${entry.file} 不符合 ${document.definitionType} Schema：${schemaIssue(result)}`,
      );
      continue;
    }
    if (document.definitionType === "risk-mechanism") {
      for (const mechanism of document.mechanisms) mechanismTypes.add(mechanism.mechanismType);
    }
    if (document.definitionType === "process-model") {
      for (const node of document.nodes) processNodes.add(node.processKind);
    }
  }
  for (const type of RISK_MECHANISM_TYPE_VALUES) {
    if (!mechanismTypes.has(type)) problems.push(`知识包缺少机理类型：${type}`);
  }
  for (const node of PROCESS_NODE_VALUES) {
    if (!processNodes.has(node)) problems.push(`知识包缺少工序节点：${node}`);
  }
  return problems;
};

const checkMonitoringV1 = (packDir, manifest) => {
  const problems = [];
  const document = readPackJson(packDir, manifest.monitoring);
  const groups = [
    ["seriesRevisions", MonitoringSeriesRevisionV1Schema, "序列修订"],
    ["batches", MonitoringBatchV1Schema, "批次"],
    ["sampleArtifacts", MonitoringSampleArtifactEnvelopeV1Schema, "样本工件"],
    ["samples", MonitoringSampleInputV1Schema, "样本"],
  ];
  for (const [field, schema, label] of groups) {
    const items = asList(document?.[field]);
    if (items.length === 0) {
      problems.push(`monitoring 缺少${label}条目`);
      continue;
    }
    for (const [index, item] of items.entries()) {
      const result = schema.safeParse(item);
      if (!result.success)
        problems.push(`monitoring ${label}[${index}] 不符合 Schema：${schemaIssue(result)}`);
    }
  }
  const indicators = new Set(
    asList(document?.seriesRevisions)
      .map((item) => item?.monitoringIndicator)
      .filter(Boolean),
  );
  const unknown = [...indicators].filter((value) => !MONITORING_INDICATOR_VALUES.includes(value));
  if (unknown.length > 0) problems.push(`monitoring 引用了未知监测指标：${unknown.join("、")}`);
  if (indicators.size < 6) problems.push(`monitoring 覆盖 ${indicators.size} 项指标，应至少 6 项`);
  return problems;
};

/**
 * 跨文件一致性：单个文档 Schema 校验不到版本引用漂移、跨集合引用与单位/映射重复。
 * 11 类配置、评分规则与输入引用必须落在同一版本坐标上。
 */
const checkConsistencyV1 = (packDir, manifest) => {
  const problems = [];
  // 版本引用有带 kind 与裸 VersionReference 两种形状，比对时只取标识部分。
  const versionRef = (value) => JSON.stringify(value?.reference ?? value);

  // ---- 版本引用一致：配置、规则与工程修订必须同版本
  const revisions = new Map();
  const configurationSets = new Map();
  for (const entry of asList(manifest.configurations)) {
    const document = readPackJson(packDir, entry.file);
    revisions.set(entry.file, versionRef(document.projectRevisionRef));
    configurationSets.set(entry.file, versionRef(document.configurationSetRef));
  }
  for (const entry of asList(manifest.rules)) {
    const document = readPackJson(packDir, entry.file);
    revisions.set(entry.file, versionRef(document.projectRevisionRef));
    configurationSets.set(entry.file, versionRef(document.configurationSetRef));
  }
  if (new Set(revisions.values()).size > 1) {
    problems.push(`配置与规则引用了不同的工程修订：${[...new Set(revisions.values())].join("、")}`);
  }
  if (new Set(configurationSets.values()).size > 1) {
    problems.push(
      `配置与规则引用了不同的配置集：${[...new Set(configurationSets.values())].join("、")}`,
    );
  }

  // ---- 指标、映射、权重、规则必须指向同一组指标与单位
  const indicatorSystem = readPackJson(packDir, "configurations/indicator-system.json");
  const fieldMapping = readPackJson(packDir, "configurations/indicator-field-mapping.json");
  const weightSet = readPackJson(packDir, "configurations/weight-set.json");
  const indicators = new Map(
    asList(indicatorSystem.content?.indicators).map((item) => [item.indicatorId, item]),
  );

  const targets = new Map();
  for (const mapping of asList(fieldMapping.content?.mappings)) {
    if (!indicators.has(mapping.targetIndicatorId)) {
      problems.push(`字段映射 ${mapping.mappingId} 指向未知指标 ${mapping.targetIndicatorId}`);
      continue;
    }
    // 同一指标不得有多个生效来源：单一有效字段映射是 SSOT 要求。
    if (targets.has(mapping.targetIndicatorId)) {
      problems.push(
        `指标 ${mapping.targetIndicatorId} 存在多个字段映射来源：${targets.get(mapping.targetIndicatorId)}、${mapping.mappingId}`,
      );
    } else {
      targets.set(mapping.targetIndicatorId, mapping.mappingId);
    }
    const canonicalUnit = indicators.get(mapping.targetIndicatorId).canonicalUnit;
    if (canonicalUnit !== undefined && mapping.targetUnit !== canonicalUnit) {
      problems.push(
        `字段映射 ${mapping.mappingId} 的 targetUnit ${mapping.targetUnit} 与指标规范单位 ${canonicalUnit} 不一致`,
      );
    }
  }

  const weighted = [
    ...asList(weightSet.content?.possibilityWeights),
    ...asList(weightSet.content?.consequenceWeights),
  ];
  const seenWeighted = new Map();
  for (const weight of weighted) {
    if (!indicators.has(weight.indicatorId)) {
      problems.push(`权重引用了未知指标 ${weight.indicatorId}`);
      continue;
    }
    if (seenWeighted.has(weight.indicatorId)) {
      problems.push(`指标 ${weight.indicatorId} 在权重集中重复出现`);
    } else {
      seenWeighted.set(weight.indicatorId, weight.basisPoints);
    }
  }

  const rules = readPackJson(packDir, "rules/structured-scoring-rules.json");
  const seenRuleIndicators = new Set();
  for (const member of asList(rules.members)) {
    const indicatorItem = member.rule?.indicatorItem;
    if (!indicators.has(indicatorItem)) {
      problems.push(`评分规则 ${member.rule?.ruleId} 指向未知指标 ${indicatorItem}`);
      continue;
    }
    // 一个指标只能有一条生效评分规则，否则 P/C 无法由版本重放。
    if (seenRuleIndicators.has(indicatorItem)) {
      problems.push(`指标 ${indicatorItem} 存在多条评分规则`);
    } else {
      seenRuleIndicators.add(indicatorItem);
    }
    if (!seenWeighted.has(indicatorItem)) {
      problems.push(`指标 ${indicatorItem} 有评分规则但权重集中没有对应权重`);
    }
  }
  for (const indicatorId of seenWeighted.keys()) {
    if (!seenRuleIndicators.has(indicatorId)) {
      problems.push(`指标 ${indicatorId} 有权重但没有评分规则`);
    }
  }

  // ---- 输入引用必须落在 manifest 声明的资料上，且与用例同集合
  const documents = new Map(asList(manifest.documents).map((item) => [item.documentId, item]));
  const cases = asList(readPackJson(packDir, manifest.cases)?.cases);
  const caseIds = new Set();
  const segments = [];
  for (const item of cases) {
    if (caseIds.has(item.caseId)) problems.push(`用例标识重复：${item.caseId}`);
    caseIds.add(item.caseId);
    const split = splitOf(item.split);
    for (const reference of asList(item.inputs?.documentRefs)) {
      const document = documents.get(reference);
      if (document === undefined) {
        problems.push(`用例 ${item.caseId} 引用了 manifest 未声明的资料 ${reference}`);
        continue;
      }
      if (splitOf(document.split) !== split) {
        problems.push(`用例 ${item.caseId} 引用了其它集合的资料 ${reference}`);
      }
      if (document.sourceFamily !== item.sourceFamily) {
        problems.push(`用例 ${item.caseId} 引用的资料 ${reference} 资料家族不一致`);
      }
    }
    segments.push(...asList(item.inputs?.sourceSegmentIds));
  }
  if (new Set(segments).size !== segments.length) {
    problems.push("资料段标识存在重复，无法唯一定位证据");
  }
  return problems;
};

const checkFeedbackV1 = (packDir, manifest) => {
  const problems = [];
  const rows = asList(readPackJson(packDir, manifest.feedback)?.feedbackInputs);
  if (rows.length === 0) return ["feedback 文件没有反馈输入"];
  for (const [index, row] of rows.entries()) {
    const result = HumanFeedbackInputSnapshotRowV1Schema.safeParse(row);
    if (!result.success) problems.push(`feedback[${index}] 不符合 Schema：${schemaIssue(result)}`);
  }
  return problems;
};

/** 覆盖按 caseId 关联 scenarios 与 expected：scenarios 只提供输入，候选答案只在 expected。 */
const checkCoverageV1 = (packDir, manifest) => {
  const problems = [];
  const cases = asList(readPackJson(packDir, manifest.cases)?.cases);
  const expectations = asList(readPackJson(packDir, manifest.expected)?.cases);
  if (cases.length === 0) return { problems: ["cases 文件没有场景条目"], caseCount: 0 };

  const expectedByCase = new Map(expectations.map((item) => [item.caseId, item]));
  for (const item of cases) {
    if (!expectedByCase.has(item.caseId)) problems.push(`用例 ${item.caseId} 缺少候选预期`);
  }
  const development = cases.filter((item) => splitOf(item.split) === "development");
  const trial = cases.filter((item) => splitOf(item.split) === "trial");
  if (development.length !== 12) problems.push(`开发集合用例数为 ${development.length}，应为 12`);
  if (trial.length !== 60) problems.push(`试运行集合用例数为 ${trial.length}，应为 60`);

  for (const mechanism of RISK_MECHANISM_TYPE_VALUES) {
    const count = (items, label) =>
      items.filter(
        (item) =>
          expectedByCase.get(item.caseId)?.candidateMechanismType === mechanism &&
          expectedByCase.get(item.caseId)?.candidateLabel === label,
      ).length;
    const developmentPositive = count(development, "positive");
    const developmentNegative = count(development, "negative");
    const trialPositive = count(trial, "positive");
    const trialNegative = count(trial, "negative");
    if (developmentPositive < 1 || developmentNegative < 1) {
      problems.push(
        `机理“${mechanism}”开发集合需一正一负（正 ${developmentPositive} / 负 ${developmentNegative}）`,
      );
    }
    if (trialPositive < 5 || trialNegative < 5) {
      problems.push(
        `机理“${mechanism}”试运行需五正五负（正 ${trialPositive} / 负 ${trialNegative}）`,
      );
    }
  }

  const processesSeen = new Set(cases.flatMap((item) => asList(item.processNode)));
  const indicatorsSeen = new Set(cases.flatMap((item) => asList(item.monitoringIndicator)));
  const unknownProcesses = [...processesSeen].filter(
    (value) => !PROCESS_NODE_VALUES.includes(value),
  );
  if (unknownProcesses.length > 0)
    problems.push(`用例引用了未知工序节点：${unknownProcesses.join("、")}`);
  if (processesSeen.size < PROCESS_NODE_VALUES.length) {
    problems.push(
      `工序覆盖 ${processesSeen.size}/${PROCESS_NODE_VALUES.length}，未覆盖全部五个工序`,
    );
  }
  const unknownIndicators = [...indicatorsSeen].filter(
    (value) => !MONITORING_INDICATOR_VALUES.includes(value),
  );
  if (unknownIndicators.length > 0)
    problems.push(`用例引用了未知监测指标：${unknownIndicators.join("、")}`);
  if (indicatorsSeen.size < 6) problems.push(`监测指标覆盖 ${indicatorsSeen.size} 项，应至少 6 项`);

  const familiesOf = (items) =>
    new Set(items.flatMap((item) => asList(item.sourceFamily)).filter(Boolean));
  const developmentFamilies = familiesOf(development);
  const trialFamilies = familiesOf(trial);
  const shared = [...developmentFamilies].filter((family) => trialFamilies.has(family));
  if (shared.length > 0)
    problems.push(`开发与试运行共用资料家族，集合未隔离：${shared.join("、")}`);
  if (developmentFamilies.size === 0 || trialFamilies.size === 0) {
    problems.push("开发或试运行集合缺少 sourceFamily，无法证明集合隔离");
  }

  // 输入侧不得混入候选答案字段；caseId 是追踪标识，允许出现。
  for (const item of cases) {
    for (const field of ANSWER_FIELD_NAMES_V1) {
      if (field in item) problems.push(`用例 ${item.caseId} 的输入侧混入候选答案字段 ${field}`);
    }
    for (const field of ANSWER_FIELD_NAMES_V1) {
      if (field in (item.inputs ?? {})) {
        problems.push(`用例 ${item.caseId} 的 inputs 混入候选答案字段 ${field}`);
      }
    }
  }
  return { problems, caseCount: cases.length };
};

/** 输入投影不得携带候选答案字段；只扫描模型可读目录。 */
const checkSeparationV1 = (packDir) => {
  const problems = [];
  const inputFiles = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name);
      if (entry.isDirectory()) walk(child);
      else inputFiles.push(child);
      if (inputFiles.length > MAX_INPUT_FILE_COUNT_V1) return;
    }
  };
  for (const root of FILE_INPUT_ROOTS_V1) walk(resolve(packDir, root));
  for (const file of inputFiles) {
    if (!/\.(json|md|mdx|txt|csv)$/i.test(file)) continue;
    const text = readFileSync(file, "utf8");
    for (const field of ANSWER_FIELD_NAMES_V1) {
      if (text.includes(`"${field}"`)) {
        problems.push(`输入投影 ${relative(packDir, file)} 携带候选答案字段 ${field}`);
        break;
      }
    }
  }
  return problems;
};

/** 材料包静态检查：任何问题都不因文件数量或生成成功而放过。 */
export const checkPack = (packDirInput) => {
  const packDir = resolve(packDirInput);
  const problems = [];
  let manifest = null;
  try {
    if (!existsSync(packDir)) throw new SyntheticAcceptanceError("PACK_MISSING", packDir);
    manifest = readJson(join(packDir, "manifest.json"));
    problems.push(...checkManifestV1(manifest, packDir));
    problems.push(...checkSourcesV1(packDir, manifest));
    problems.push(...checkSchemasV1(packDir, manifest));
    problems.push(...checkMonitoringV1(packDir, manifest));
    problems.push(...checkFeedbackV1(packDir, manifest));
    problems.push(...checkConsistencyV1(packDir, manifest));
    problems.push(...checkCoverageV1(packDir, manifest).problems);
    problems.push(...checkSeparationV1(packDir));
  } catch (error) {
    problems.push(
      error instanceof SyntheticAcceptanceError ? `${error.code}: ${error.message}` : String(error),
    );
  }
  return {
    schemaVersion: PACK_SCHEMA_VERSION_V1,
    label: SYNTHETIC_LABEL_V1,
    labelStatus: manifest?.labelStatus ?? "candidate",
    packId: manifest?.packId ?? null,
    packVersion: manifest?.packVersion ?? null,
    ok: problems.length === 0,
    problems,
  };
};

// ------------------------------------------------------------------ 运行配置

/** operationId 由真实注册表派生：`riskflow_${mode}_${branch.replaceAll(".","_")}`。 */
export const operationIdFor = (mode, branch) => `riskflow_${mode}_${branch.replaceAll(".", "_")}`;

const routeForOperation = (operationId) => {
  const route = HTTP_ROUTE_CATALOG_V1.find(
    (entry) => operationIdFor(entry.mode, entry.branch) === operationId,
  );
  if (route === undefined)
    throw new SyntheticAcceptanceError("OPERATION_NOT_IN_CATALOG", String(operationId));
  return route;
};

export const isQueryOperationV1 = (operationId) => {
  try {
    return routeForOperation(operationId).mode === "query";
  } catch {
    return false;
  }
};

/** 异步命令：回执只代表提交，配置不能把它改写成完成。 */
const ASYNC_BRANCH_PREFIXES_V1 = Object.freeze([
  "workflow.",
  "agent-task.",
  "risk-identification.",
]);

const isAsyncCommand = (route) =>
  route.mode === "command" &&
  ASYNC_BRANCH_PREFIXES_V1.some((prefix) => route.branch.startsWith(prefix));

/** `$file` 只允许材料包内安全目录，且拒绝任何答案类文件名。 */
export const assertFileInputPathV1 = (relativePath) => {
  if (typeof relativePath !== "string" || relativePath === "") {
    throw new SyntheticAcceptanceError("FILE_INPUT_INVALID", String(relativePath));
  }
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.includes(".."))
    throw new SyntheticAcceptanceError("FILE_INPUT_ESCAPES", relativePath);
  if (!FILE_INPUT_ROOTS_V1.includes(normalized.split("/")[0])) {
    throw new SyntheticAcceptanceError("FILE_INPUT_ROOT_FORBIDDEN", relativePath);
  }
  const lowered = normalized.toLowerCase();
  for (const token of ANSWER_FILE_TOKENS_V1) {
    if (lowered.includes(token))
      throw new SyntheticAcceptanceError("FILE_INPUT_IS_ANSWER", relativePath);
  }
  return normalized;
};

/** 超时必须是有限正整数：Infinity 或 NaN 会让取消信号失效，运行就会挂死。 */
const isBoundedTimeoutMs = (value) =>
  typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 60_000;

const requestTimeoutMsOf = (config) =>
  isBoundedTimeoutMs(config?.timeoutMs) ? config.timeoutMs : DEFAULT_TIMEOUT_MS_V1;

const assertSafeBaseUrl = (baseUrl) => {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new SyntheticAcceptanceError("BASE_URL_INVALID", String(baseUrl));
  }
  const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new SyntheticAcceptanceError("BASE_URL_INSECURE", String(baseUrl));
  }
  // 凭据只来自配置字段；URL 里带用户名、口令、查询或片段一律拒绝，避免落进摘要与报告。
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    throw new SyntheticAcceptanceError(
      "BASE_URL_CREDENTIALS",
      "baseUrl 不得携带用户名、口令、查询或片段",
    );
  }
  return url;
};

const validateRunConfigV1 = (config) => {
  const problems = [];
  try {
    assertSafeBaseUrl(config?.baseUrl);
  } catch (error) {
    problems.push(`config.baseUrl 不合格：${error.message}`);
  }
  for (const field of ["projectId", "loginName", "password"]) {
    if (typeof config?.[field] !== "string" || config[field] === "")
      problems.push(`config.${field} 缺失`);
  }
  if (config?.schemaVersion !== PACK_SCHEMA_VERSION_V1) {
    problems.push(`config.schemaVersion 必须是 "${PACK_SCHEMA_VERSION_V1}"`);
  }
  if (
    config?.bindings !== undefined &&
    (typeof config.bindings !== "object" || config.bindings === null)
  ) {
    problems.push("config.bindings 必须是对象");
  }
  if (config?.timeoutMs !== undefined && !isBoundedTimeoutMs(config.timeoutMs)) {
    problems.push("config.timeoutMs 必须是 1 到 60000 之间的整数");
  }
  if (!Array.isArray(config?.commands) || config.commands.length === 0) {
    problems.push("config.commands 必须显式列出操作计划");
    return problems;
  }
  const ids = new Set();
  for (const [index, command] of config.commands.entries()) {
    const at = `config.commands[${index}]`;
    if (typeof command?.stepId !== "string" || command.stepId === "") {
      problems.push(`${at}.stepId 缺失`);
      continue;
    }
    if (ids.has(command.stepId)) problems.push(`${at}.stepId 重复：${command.stepId}`);
    ids.add(command.stepId);
    if (command.type === "manual") {
      // 人工步骤不批准任何对象，只核对外部正式前置是否已产生所需引用。
      if (typeof command.instruction !== "string" || command.instruction === "") {
        problems.push(`${at}.instruction 缺失`);
      }
      if (!Array.isArray(command.requiredBindings) || command.requiredBindings.length === 0) {
        problems.push(`${at}.requiredBindings 必须列出外部正式前置所需的引用键`);
      }
      continue;
    }
    if (command.type !== "http") {
      problems.push(`${at}.type 必须是 manual 或 http`);
      continue;
    }
    let route;
    try {
      route = routeForOperation(command.operationId);
    } catch {
      problems.push(`${at}.operationId 不在正式注册表：${command.operationId}`);
      continue;
    }
    if (command.payload === undefined) problems.push(`${at}.payload 缺失`);
    if (
      command.captures !== undefined &&
      (typeof command.captures !== "object" || command.captures === null)
    ) {
      problems.push(`${at}.captures 必须是对象`);
    }
    if (
      command.completion !== undefined &&
      !["submitted", "completed"].includes(command.completion)
    ) {
      problems.push(`${at}.completion 只能是 submitted 或 completed`);
    }
    if (isAsyncCommand(route) && command.completion === "completed") {
      problems.push(`${at} 是异步命令，只能记为 submitted；不能配置为 completed`);
    }
  }
  // 配置内的 `$file` 引用同样受安全目录限制，不能靠手写路径绕过。
  for (const match of JSON.stringify(config.commands).matchAll(/"\$file":"([^"]+)"/g)) {
    try {
      assertFileInputPathV1(match[1]);
    } catch (error) {
      problems.push(`config 引用了不允许的输入文件：${match[1]}（${error.code}）`);
    }
  }
  return problems;
};

// ------------------------------------------------------------------ 模板解析

const valueAtPath = (value, path) => {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== "object" || !(key in current)) {
      throw new SyntheticAcceptanceError("RESULT_PATH_MISSING", path.join("."));
    }
    current = current[key];
  }
  return current;
};

/**
 * 解析 `{$binding}` / `{$file}` / `{$result:stepId,path:[...]}` 模板。
 * `$binding` 与 `$file` 必须独占对象；`$result` 用同级 `path` 指定同次运行中该步骤
 * 已 captures 的字段路径，只消费真实回执，不读原始响应正文。
 */
export const resolveTemplates = (value, context) => {
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, context));
  if (value === null || typeof value !== "object") return value;
  const keys = Object.keys(value);
  const templateKeys = keys.filter((key) => TEMPLATE_KEYS_V1.includes(key));
  if (templateKeys.length > 0) {
    if (templateKeys.length !== 1) {
      throw new SyntheticAcceptanceError("TEMPLATE_AMBIGUOUS", keys.join(","));
    }
    const template = templateKeys[0];
    if (template === "$binding") {
      if (keys.length !== 1)
        throw new SyntheticAcceptanceError("TEMPLATE_AMBIGUOUS", keys.join(","));
      if (!(value.$binding in context.bindings)) {
        throw new SyntheticAcceptanceError("BINDING_MISSING", String(value.$binding));
      }
      return context.bindings[value.$binding];
    }
    if (template === "$file") {
      if (keys.length !== 1)
        throw new SyntheticAcceptanceError("TEMPLATE_AMBIGUOUS", keys.join(","));
      const path = assertFileInputPathV1(value.$file);
      return JSON.parse(readFileSync(resolvePackFile(context.packDir, path), "utf8"));
    }
    const unknownSibling = keys.filter((key) => key !== "$result" && key !== "path");
    if (unknownSibling.length > 0 || !Array.isArray(value.path)) {
      throw new SyntheticAcceptanceError("RESULT_TEMPLATE_INVALID", keys.join(","));
    }
    const step = context.steps.get(value.$result);
    if (step === undefined)
      throw new SyntheticAcceptanceError("RESULT_STEP_UNKNOWN", String(value.$result));
    if (step.resultRef === undefined) {
      throw new SyntheticAcceptanceError("RESULT_STEP_UNAVAILABLE", String(value.$result));
    }
    return valueAtPath(step.resultRef, value.path);
  }
  return Object.fromEntries(keys.map((key) => [key, resolveTemplates(value[key], context)]));
};

/** captures 只能取契约引用：整对象或正文一律拒绝，防止把回执正文写进 checkpoint。 */
const collectCaptures = (captures, resultRef) => {
  const collected = {};
  for (const [key, path] of Object.entries(captures ?? {})) {
    if (!Array.isArray(path)) throw new SyntheticAcceptanceError("CAPTURE_PATH_INVALID", key);
    const value = valueAtPath(resultRef, path);
    if (!ContractReferenceV1Schema.safeParse(value).success) {
      throw new SyntheticAcceptanceError("CAPTURE_NOT_REFERENCE", key);
    }
    collected[key] = value;
  }
  return collected;
};

// ------------------------------------------------------------------ HTTP

/**
 * 有界 JSON 读取：有限超时、禁止重定向、按字节上界读取并及时取消。
 * 超限或网络异常都不把结果当成成功；正文只在本进程内使用，不落盘。
 */
const requestJson = async (fetchImpl, url, init, timeoutMs, parentSignal) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal:
        parentSignal === undefined
          ? controller.signal
          : AbortSignal.any([controller.signal, parentSignal]),
    });
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES_V1) {
      await response.body?.cancel?.().catch(() => undefined);
      return { status: "oversized", statusCode: response.status, body: null, cookie: null };
    }
    const reader = response.body?.getReader();
    if (reader === undefined) {
      return {
        status: "http-error",
        statusCode: response.status,
        body: null,
        cookie: response.headers.get("set-cookie"),
      };
    }
    const decoder = new TextDecoder();
    let received = 0;
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_RESPONSE_BYTES_V1) {
        await reader.cancel().catch(() => undefined);
        return { status: "oversized", statusCode: response.status, body: null, cookie: null };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let body = null;
    try {
      body = text === "" ? null : JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      status: response.ok && body !== null ? "ok" : "http-error",
      statusCode: response.status,
      body,
      cookie: response.headers.get("set-cookie"),
    };
  } catch {
    return { status: "ambiguous", statusCode: null, body: null, cookie: null };
  } finally {
    clearTimeout(timer);
  }
};

const errorCodeOf = (body) => {
  if (body === null || typeof body !== "object") return "UNPARSEABLE_RESPONSE";
  // 错误码只取受限形态的稳定标识，正文与任意文本绝不进入报告或 checkpoint。
  const safeToken = /^[A-Z][A-Z0-9_]{0,63}$/;
  for (const value of [body.code, body.error?.code]) {
    if (typeof value === "string" && safeToken.test(value)) return value;
  }
  return "UNEXPECTED_RESPONSE";
};

const buildEnvelope = (route, request, identity, issuedAt) => ({
  schemaVersion: "1",
  requestedSpatialScopeRefs: request?.requestedSpatialScopeRefs ?? [],
  requestedSourceVersionRefs: request?.requestedSourceVersionRefs ?? [],
  ...(route.mode === "command"
    ? { commandId: identity, idempotencyKey: identity, issuedAt }
    : { queryId: identity, requestedAt: issuedAt }),
  payload: request?.payload ?? {},
});

/** 独立的只读会话：cookie 留在闭包内，且只能调用正式 query 路由。 */
export const createReadOnlyQuerySession = async ({
  config,
  runId,
  fetchImpl = globalThis.fetch,
  signal,
}) => {
  const timeoutMs = requestTimeoutMsOf(config);
  const login = await requestJson(
    fetchImpl,
    new URL(LOGIN_PATH_V1, config.baseUrl).toString(),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        SessionLoginRequestV1Schema.parse({
          schemaVersion: "1",
          loginAttemptId: `${runId}-observation-login`.slice(0, 200),
          loginName: config.loginName,
          password: config.password,
        }),
      ),
    },
    timeoutMs,
    signal,
  );
  if (login.status !== "ok") throw new SyntheticAcceptanceError("QUERY_LOGIN_FAILED");
  const session = SessionMetadataV1Schema.safeParse(login.body);
  if (!session.success || session.data.passwordChangeRequired || session.data.restricted) {
    throw new SyntheticAcceptanceError("QUERY_SESSION_UNAUTHORIZED");
  }
  const cookie = login.cookie?.split(";")[0];
  if (cookie === undefined || cookie === "") {
    throw new SyntheticAcceptanceError("QUERY_SESSION_COOKIE_MISSING");
  }

  return Object.freeze({
    async query({
      packDir,
      steps,
      bindings,
      operationId,
      payload,
      queryId,
      requestedSpatialScopeRefs = [],
      requestedSourceVersionRefs = [],
      issuedAt = new Date().toISOString(),
    }) {
      const route = routeForOperation(operationId);
      if (route.mode !== "query") throw new SyntheticAcceptanceError("QUERY_OPERATION_REQUIRED");
      const request = resolveTemplates(
        { payload, requestedSpatialScopeRefs, requestedSourceVersionRefs },
        { packDir, bindings, steps },
      );
      const envelope = buildEnvelope(route, request, queryId, issuedAt);
      route.requestSchema.parse(envelope);
      const path = route.path.replace(":projectId", encodeURIComponent(config.projectId));
      const response = await requestJson(
        fetchImpl,
        new URL(path, config.baseUrl).toString(),
        {
          method: route.method,
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify(envelope),
        },
        timeoutMs,
        signal,
      );
      if (response.status !== "ok") {
        throw new SyntheticAcceptanceError(
          response.status === "http-error" && response.statusCode === 403
            ? "QUERY_FORBIDDEN"
            : "QUERY_FAILED",
          `${response.statusCode ?? response.status}:${errorCodeOf(response.body)}`,
        );
      }
      const parsed = route.resultSchema.safeParse(response.body);
      if (!parsed.success) throw new SyntheticAcceptanceError("QUERY_RESULT_INVALID");
      if (parsed.data.kind !== "succeeded") {
        throw new SyntheticAcceptanceError(
          parsed.data.kind === "waiting" ? "QUERY_AWAITING_HUMAN" : "QUERY_NOT_SUCCEEDED",
        );
      }
      return parsed.data.result;
    },
  });
};

const codeHeadOf = () => {
  try {
    const head = execFileSync("git", ["-C", REPO_ROOT_V1, "rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
    const dirty = execFileSync("git", ["-C", REPO_ROOT_V1, "status", "--porcelain"], {
      encoding: "utf8",
    })
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => line.slice(3).trim());
    return { head, dirty };
  } catch {
    return { head: null, dirty: [] };
  }
};

/** 工作区源码摘要：未提交改动也必须改变运行身份，否则同键可能对应不同输入。 */
const workspaceDigestOf = () => {
  const roots = ["apps/api/dist", "packages/core/dist", "packages/contracts/dist"];
  const parts = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      // 声明产物与 sourcemap 变化不影响运行语义，跳过以免摘要抖动。
      else if (entry.name.endsWith(".js")) parts.push(`${path}:${sha256(readFileSync(path))}`);
    }
  };
  for (const root of roots) walk(join(REPO_ROOT_V1, root));
  parts.push(`tool:${sha256(readFileSync(fileURLToPath(import.meta.url)))}`);
  if (parts.length === 0) {
    throw new SyntheticAcceptanceError("WORKSPACE_DIST_MISSING", roots.join(","));
  }
  return sha256(parts.sort().join("|"));
};

/** 材料包输入内容摘要：任一输入文件变化都必须产生新的 run 身份。 */
const packDigestOf = (packDir, manifest) => {
  const files = [
    "manifest.json",
    manifest.cases,
    manifest.expected,
    manifest.sources,
    manifest.acceptanceCases,
    manifest.monitoring,
    manifest.feedback,
    ...asList(manifest.documents).map((item) => item.file),
    ...asList(manifest.configurations).map((item) => item.file),
    ...asList(manifest.rules).map((item) => item.file),
    ...asList(manifest.knowledge).map((item) => item.file),
  ].filter((file) => typeof file === "string");
  const parts = [];
  for (const file of files) {
    try {
      parts.push(`${file}:${sha256(readFileSync(resolvePackFile(packDir, file)))}`);
    } catch (error) {
      parts.push(`${file}:unreadable:${error.code}`);
    }
  }
  return sha256(parts.sort().join("|"));
};

/** 去秘密的运行配置摘要：密码与 Cookie 不进入摘要之外的任何持久化内容。 */
const configDigest = (config) =>
  sha256(
    JSON.stringify({
      baseUrl: config.baseUrl,
      projectId: config.projectId,
      loginName: config.loginName,
      bindings: config.bindings ?? {},
      commands: config.commands,
    }),
  );

const renderReport = (state) => {
  const lines = [
    "# 合成材料功能预验收内部试运行报告",
    "",
    `材料标签：${SYNTHETIC_LABEL_V1}（labelStatus=${state.labelStatus}，未经人工复核）`,
    `运行状态：${state.status}`,
    `材料包：${state.packId ?? "未知"}@${state.packVersion ?? "未知"}；运行标识：${state.runId ?? "-"}`,
    `代码基线：${state.codeHead ?? "未知"}；工作区摘要：${state.workspaceDigest ?? "-"}`,
    "",
    "本报告是内部探索性记录，不代表甲方验收通过，也不构成整体技术就绪声明。",
    "",
    "| 步骤 | 类型 | 操作 | 状态 | 说明 |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const step of state.steps) {
    lines.push(
      `| ${step.stepId} | ${step.type} | ${step.operationId ?? "-"} | ${step.status} | ${step.note ?? "-"} |`,
    );
  }
  if (state.blocked.length > 0) {
    lines.push("", "## 阻塞与缺口", "");
    for (const item of state.blocked) lines.push(`- ${item}`);
  }
  return `${lines.join("\n")}\n`;
};

/**
 * 按显式操作计划驱动正式 HTTP 入口。
 * 缺环境、缺前置引用或 HTTP/业务失败时保存 checkpoint 并非零退出；
 * 已收口步骤复用同一幂等键与同一 issuedAt 重试，不补造成功终态。
 */
export const runPack = async ({
  packDir: packDirInput,
  configPath,
  outputDir,
  resume = false,
  fetchImpl = globalThis.fetch,
  signal,
}) => {
  const packDir = resolve(packDirInput);
  const output = resolve(outputDir);
  const statePath = join(output, "run.json");
  const reportPath = join(output, "report.md");
  const nowIso = () => new Date().toISOString();
  const code = codeHeadOf();
  const workspaceDigest = workspaceDigestOf();

  // 拒绝只在“输出目录已被别的运行占用”时发生，且绝不写盘。
  const refuse = (reason) => {
    process.stderr.write(`${reason}\n`);
    return {
      ok: false,
      status: "REFUSED",
      exitCode: 1,
      state: {
        schemaVersion: PACK_SCHEMA_VERSION_V1,
        label: SYNTHETIC_LABEL_V1,
        labelStatus: "candidate",
        status: "REFUSED",
        blocked: [reason],
        steps: [],
      },
    };
  };

  // ---- 静态检查先行：材料不合格不进入运行
  const check = checkPack(packDir);
  if (!check.ok) {
    return refuse(
      `材料包静态检查未通过，共 ${check.problems.length} 项问题；请先修复：${check.problems.slice(0, 5).join("；")}`,
    );
  }

  const manifest = readJson(join(packDir, "manifest.json"));

  let config = null;
  let configProblems;
  try {
    config = readJson(resolve(configPath));
    configProblems = validateRunConfigV1(config);
  } catch (error) {
    configProblems = [`运行配置缺失或不可读：${error.code ?? error.message}`];
  }

  // ---- 计划与运行身份：配置不全时也冻结身份，让 BLOCKED 报告可追溯
  const commands = Array.isArray(config?.commands) ? config.commands : [];
  const digest = config === null ? null : configDigest(config);
  const packDigest = packDigestOf(packDir, manifest);
  const runId = `synthetic-${sha256(`${manifest.packId}|${packDigest}|${code.head}|${workspaceDigest}|${digest ?? "no-config"}`).slice(0, 24)}`;

  if (existsSync(statePath)) {
    const prior = readJson(statePath);
    if (!resume) {
      return refuse(
        `输出目录已有运行结果（run=${prior.runId ?? "未知"}）。恢复同一运行请加 --resume；本工具不覆盖其它结果。`,
      );
    }
    if (prior.runId !== runId || prior.configDigest !== digest) {
      return refuse(
        "输出目录的既有运行与当前材料包内容、配置或工作区源码不一致，拒绝恢复到别的运行；请改用新的输出目录。",
      );
    }
  } else if (existsSync(output)) {
    // 目录里已有其它内容说明它不是本工具的运行目录，不在其中混入结果文件。
    const foreign = readdirSync(output);
    if (foreign.length > 0) {
      return refuse(
        `输出目录非空且不含本工具的 run.json（存在 ${foreign.slice(0, 3).join("、")}）；请改用新的输出目录。`,
      );
    }
  } else if (resume) {
    return refuse("--resume 需要输出目录中已有同一运行的 checkpoint。");
  }

  // 继续执行时复用上次的命令身份、issuedAt 与安全引用；键与输入必须完全一致。
  const priorSteps = new Map(
    (existsSync(statePath) ? (readJson(statePath).steps ?? []) : []).map((step) => [
      step.stepId,
      step,
    ]),
  );
  const steps = commands.map((command, index) => {
    const stepId =
      typeof command?.stepId === "string" && command.stepId !== ""
        ? command.stepId
        : `step-${index + 1}`;
    return { ...command, ...(priorSteps.get(stepId) ?? {}), stepId };
  });
  const stepIndex = new Map(steps.map((step) => [step.stepId, step]));

  // bindings 只在内存与运行内使用；只把契约引用写进 checkpoint。
  const bindings = { ...(config?.bindings ?? {}) };
  const safeBindings = {};
  const timeoutMs = requestTimeoutMsOf(config);

  const state = {
    schemaVersion: PACK_SCHEMA_VERSION_V1,
    label: SYNTHETIC_LABEL_V1,
    labelStatus: manifest.labelStatus ?? "candidate",
    status: "RUNNING",
    runId,
    packId: manifest.packId ?? null,
    packVersion: manifest.packVersion ?? null,
    packDigest,
    configDigest: digest,
    codeHead: code.head,
    dirtyPaths: code.dirty,
    workspaceDigest,
    bindings: safeBindings,
    steps: [],
    blocked: [],
  };

  const persist = (status, blocked) => {
    state.status = status;
    state.blocked = blocked;
    state.bindings = safeBindings;
    state.steps = steps.map((step) => ({
      stepId: step.stepId,
      type: step.type ?? null,
      operationId: step.operationId ?? null,
      status: step.status ?? "pending",
      note: step.note ?? null,
      ...(step.commandId === undefined ? {} : { commandId: step.commandId }),
      ...(step.issuedAt === undefined ? {} : { issuedAt: step.issuedAt }),
      ...(step.requestedSpatialScopeRefs === undefined
        ? {}
        : { requestedSpatialScopeRefs: step.requestedSpatialScopeRefs }),
      ...(step.requestedSourceVersionRefs === undefined
        ? {}
        : { requestedSourceVersionRefs: step.requestedSourceVersionRefs }),
      ...(step.resultRef === undefined ? {} : { resultRef: step.resultRef }),
    }));
    state.writtenAt = nowIso();
    mkdirSync(output, { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    writeFileSync(reportPath, renderReport(state), "utf8");
    return {
      ok: status === "COMPLETED",
      status,
      exitCode: status === "COMPLETED" ? 0 : 1,
      state: JSON.parse(JSON.stringify(state)),
    };
  };

  // 配置不完整时给出可审阅的阻塞报告，而不是静默拒绝。
  if (config === null || configProblems.length > 0) {
    return persist("BLOCKED", [
      config === null
        ? "缺少可用运行配置：目标服务、凭据与显式操作计划齐备后才能运行。"
        : `运行配置不合格：${configProblems.join("；")}`,
    ]);
  }

  // ---- 登录：必须拿到受限会话元数据与 Cookie，两者缺一即阻塞
  try {
    assertSafeBaseUrl(config.baseUrl);
  } catch (error) {
    return persist("BLOCKED", [error.message]);
  }
  const login = await requestJson(
    fetchImpl,
    new URL(LOGIN_PATH_V1, config.baseUrl).toString(),
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        SessionLoginRequestV1Schema.parse({
          schemaVersion: "1",
          loginAttemptId: `${runId}-login`,
          loginName: config.loginName,
          password: config.password,
        }),
      ),
    },
    timeoutMs,
    signal,
  );
  if (login.status !== "ok") {
    return persist("BLOCKED", [
      `登录未成功（${login.status}）：环境未就绪或凭据无效，未执行任何业务步骤，不判定任何业务结果。`,
    ]);
  }
  const session = SessionMetadataV1Schema.safeParse(login.body);
  if (!session.success) {
    return persist("BLOCKED", [`登录返回不符合会话元数据契约：${schemaIssue(session)}`]);
  }
  if (session.data.passwordChangeRequired) {
    return persist("BLOCKED", ["账号需要先修改密码，未执行任何业务步骤。"]);
  }
  if (session.data.restricted) {
    return persist("BLOCKED", ["会话为受限身份，无权驱动预验收操作，未执行任何业务步骤。"]);
  }
  const cookie = login.cookie?.split(";")[0];
  if (cookie === undefined || cookie === "") {
    return persist("BLOCKED", ["登录未下发会话 Cookie，无法通过正式入口鉴权。"]);
  }

  const blocked = [];
  let waitingOnExternal = false;
  for (const step of steps) {
    if (signal?.aborted) {
      return persist("BLOCKED", [...blocked, "总运行期限已到，尚未执行的步骤保持未发送。"]);
    }
    if (step.status === "submitted" || step.status === "completed") continue;
    step.status = "pending";

    if (step.type === "manual") {
      // 人工步骤不批准任何对象，只核对外部正式前置是否已产生引用。
      const missing = asList(step.requiredBindings).filter((key) => !(key in bindings));
      if (missing.length > 0) {
        step.status = "waiting";
        step.note = `等待外部正式前置：${step.instruction}；缺少引用 ${missing.join("、")}`;
        waitingOnExternal = true;
        persist("RUNNING", [...blocked]);
        break;
      }
      step.status = "completed";
      step.note = "外部正式前置引用已具备（manual externally prepared）；本步骤不作任何审批结论。";
      persist("RUNNING", [...blocked]);
      continue;
    }

    const route = routeForOperation(step.operationId);
    const identity = `${runId}-${step.stepId}`.slice(0, 200);
    // issuedAt 首次尝试即固定：重试同键必须同输入，否则幂等语义失效。
    step.commandId = identity;
    step.issuedAt = step.issuedAt ?? nowIso();

    let envelope;
    try {
      envelope = buildEnvelope(
        route,
        resolveTemplates(step, { bindings, steps: stepIndex, packDir }),
        identity,
        step.issuedAt,
      );
      route.requestSchema.parse(envelope);
    } catch (error) {
      step.status = "failed";
      step.note = `载荷不符合正式契约：${error.code ?? error.message}`;
      persist("RUNNING", [...blocked, `步骤 ${step.stepId} 载荷不符合正式契约，未发送请求。`]);
      return persist("BLOCKED", [
        ...blocked,
        `步骤 ${step.stepId} 载荷不符合正式契约，未发送请求。`,
      ]);
    }

    step.requestedSpatialScopeRefs = envelope.requestedSpatialScopeRefs;
    step.requestedSourceVersionRefs = envelope.requestedSourceVersionRefs;

    step.status = "sending";
    step.note = "请求已发出，等待正式回执。";
    persist("RUNNING", [...blocked]);

    const path = route.path.replace(":projectId", encodeURIComponent(config.projectId));
    const response = await requestJson(
      fetchImpl,
      new URL(path, config.baseUrl).toString(),
      {
        method: route.method,
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify(envelope),
      },
      timeoutMs,
      signal,
    );

    if (response.status === "ambiguous") {
      step.status = "ambiguous";
      step.note =
        "请求结果未知（网络异常或超时）。继续执行将复用同一 commandId/idempotencyKey 与 issuedAt，由服务端幂等收口。";
      persist("RUNNING", [...blocked]);
      return persist("BLOCKED", [
        ...blocked,
        `步骤 ${step.stepId} 结果未知，未判定成功；继续时使用同一幂等键重试。`,
      ]);
    }
    if (response.status !== "ok") {
      step.status = "failed";
      step.note = `HTTP ${response.statusCode ?? "-"}（${errorCodeOf(response.body)}）`;
      persist("RUNNING", [...blocked]);
      return persist("BLOCKED", [
        ...blocked,
        `步骤 ${step.stepId} 未通过正式入口（${response.status}）。`,
      ]);
    }

    const parsed = route.resultSchema.safeParse(response.body);
    if (!parsed.success) {
      step.status = "failed";
      step.note = `正式返回不符合结果 Schema：${schemaIssue(parsed)}`;
      persist("RUNNING", [...blocked]);
      return persist("BLOCKED", [
        ...blocked,
        `步骤 ${step.stepId} 返回不符合正式结果契约，不作为成功。`,
      ]);
    }
    if (response.body.kind !== "succeeded") {
      step.status = "failed";
      step.note = `业务返回 kind=${String(response.body.kind)}（${errorCodeOf(response.body)}）`;
      persist("RUNNING", [...blocked]);
      return persist("BLOCKED", [
        ...blocked,
        `步骤 ${step.stepId} 未返回成功终态（HTTP 200 但 kind=${String(response.body.kind)}）。`,
      ]);
    }

    // 只保留契约引用：整对象或正文一律拒绝，原始响应不落盘。
    let resultRef;
    try {
      resultRef = collectCaptures(step.captures, response.body);
    } catch (error) {
      step.status = "failed";
      step.note = `captures 不合格：${error.message}`;
      persist("RUNNING", [...blocked]);
      return persist("BLOCKED", [
        ...blocked,
        `步骤 ${step.stepId} 的 captures 未取到契约引用，不补造引用。`,
      ]);
    }
    Object.assign(bindings, resultRef);
    Object.assign(safeBindings, resultRef);
    step.resultRef = resultRef;
    step.completedAt = nowIso();
    if (isAsyncCommand(route)) {
      step.status = "submitted";
      step.note = "回执已提交；异步业务终态须由后续精确查询或人工核验确认。";
    } else if (route.mode === "query") {
      step.status = "completed";
      step.note = "查询已返回精确结果。";
    } else {
      step.status = step.completion === "completed" ? "completed" : "submitted";
      step.note =
        step.status === "completed"
          ? "同步命令已返回完成回执。"
          : "回执已提交；业务终态须由后续精确查询或人工核验确认。";
    }
    persist("RUNNING", [...blocked]);
  }

  if (waitingOnExternal) {
    return persist("BLOCKED", [...blocked, "外部正式前置引用尚未齐备，本次运行在人工前置处暂停。"]);
  }
  const unresolved = steps.filter(
    (step) => step.status !== "completed" && step.status !== "submitted",
  );
  if (unresolved.length > 0) {
    return persist("BLOCKED", [...blocked, "存在未收口步骤，不判定本次运行完成。"]);
  }
  const anySubmitted = steps.some((step) => step.status === "submitted");
  if (anySubmitted) {
    // 只提交未完成：报告必须如实反映业务尚未收口。
    return persist("SUBMITTED", [
      ...blocked,
      "存在仅提交步骤，业务终态未收口；本报告不据此宣称业务通过。",
    ]);
  }
  return persist("COMPLETED", blocked);
};

// ------------------------------------------------------------------ CLI

const argumentValue = (argv, name) => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new SyntheticAcceptanceError("ARGUMENT_VALUE_MISSING", `--${name}\n${USAGE}`);
  }
  return value;
};

export const main = async (argv) => {
  const [command, ...rest] = argv;
  if (command === "check") {
    const packDir = argumentValue(rest, "pack");
    if (packDir === undefined) throw new SyntheticAcceptanceError("ARGUMENT_MISSING", USAGE);
    const result = checkPack(packDir);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 1;
  }
  if (command === "run") {
    const packDir = argumentValue(rest, "pack");
    const configPath = argumentValue(rest, "config");
    const outputDir = argumentValue(rest, "output");
    if (packDir === undefined || configPath === undefined || outputDir === undefined) {
      throw new SyntheticAcceptanceError("ARGUMENT_MISSING", USAGE);
    }
    const result = await runPack({
      packDir,
      configPath,
      outputDir,
      resume: rest.includes("--resume"),
    });
    process.stdout.write(
      `${JSON.stringify({ status: result.status, steps: result.state.steps, blocked: result.state.blocked }, null, 2)}\n`,
    );
    return result.exitCode;
  }
  throw new SyntheticAcceptanceError("COMMAND_UNKNOWN", USAGE);
};

// 相对路径、符号链接与 pnpm 包装都会改写 argv[1]，因此按规范化 URL 判断是否为直接调用。
const invokedDirectly =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `${error instanceof SyntheticAcceptanceError ? error.code : "UNEXPECTED"}: ${error.message}\n`,
      );
      process.exitCode = 1;
    },
  );
}
