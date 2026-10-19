import {
  MODULE_BRANCH_CAPABILITY_V1,
  type ModuleBranchV1,
  type ModuleCapabilityV1,
} from "@riskflow/contracts/ports";

import { ModuleBranchV1Schema, PresetRoleV1Schema, type PresetRoleV1 } from "./schema.js";

// CH-2（design D-06）升 v2 只追加入口资格与原件读取分支；旧 v1 行与授权快照不重写，
// 历史来源解析只用于恢复已登记主体/范围，当前动作一律按当前策略判权。
// CH-3（design D-03）升 v3 只追加仪表盘入口分支；旧 v1／v2 行与授权快照同样不重写。
export const ACCESS_POLICY_VERSION = "access-policy/v3" as const;
export const ACCESS_POLICY_REF_V1 = Object.freeze({
  entityId: "access-policy",
  versionId: "v3",
});

/** 已登记的历史策略身份：只用于解析旧授权快照的主体与范围，不是放行凭据。 */
export const ACCESS_POLICY_HISTORY_VERSIONS = Object.freeze(["v1", "v2", "v3"] as const);
export type AccessPolicyHistoryVersion = (typeof ACCESS_POLICY_HISTORY_VERSIONS)[number];
export const isRegisteredAccessPolicyVersion = (
  versionId: string,
): versionId is AccessPolicyHistoryVersion =>
  (ACCESS_POLICY_HISTORY_VERSIONS as readonly string[]).includes(versionId);

const allBranches = Object.freeze(Object.keys(MODULE_BRANCH_CAPABILITY_V1) as ModuleBranchV1[]);
const branchSet = (...branches: ModuleBranchV1[]): readonly ModuleBranchV1[] =>
  Object.freeze(branches);

const roleBranches: Readonly<Record<PresetRoleV1, readonly ModuleBranchV1[]>> = Object.freeze({
  "system-administrator": branchSet(),
  "project-risk-manager": allBranches,
  reviewer: branchSet(
    "review-audit.decide-review",
    "review-audit.trace",
    "projection.query",
    "projection.subscribe",
    "projection.result-read",
    "engineering-data.evidence-access",
    "engineering-data.context-read",
    "engineering-data.source-catalog",
    // CH-2（design D-05）：复核人已有资料目录读能力，补齐同一读面下的原件读取分支。
    // 来源可见性仍逐次检查空间与 source grant，目录可见不等于来源可见。
    "engineering-data.source-original-read",
    "engineering-data.monitoring-catalog",
    "engineering-data.read-result",
    "knowledge-modeling.governance-read",
    "knowledge-modeling.retrieval-result",
    "risk-identification.run-list",
    "risk-identification.run-read",
    "risk-identification.record-catalog",
    "risk-identification.record-read",
    "review-audit.queue-read",
    "risk-assessment.read",
    "warning-response.read",
    // C35：复核人加入统一复核/活动窄读（design D-02），沿原 review-audit.read 能力
    // 读取获准主题；不因此获得 Agent 读面或任何写权。
    "review-audit.read",
    // CH-2（design D-05）：聚合入口资格，不是查询能力；不因此获得任何 Agent 分支。
    "review-todo.read",
    // CH-3（design D-03）：仪表盘入口资格；六个来源的读权由各来源分支单独判权。
    "projection.dashboard-read",
  ),
  "field-responder": branchSet(
    "warning-response.record-execution",
    "warning-response.record-feedback",
    "projection.query",
    "projection.subscribe",
    // C34：补齐已公开矩阵/措施与投影的读取面，使处置角色能读风险解释与终局结果；
    // 不授予经理的启动/采纳/确认/校准治理写权（design D-06）。
    "projection.result-read",
    "knowledge-modeling.governance-read",
    "engineering-data.evidence-access",
    "engineering-data.context-read",
    "engineering-data.monitoring-catalog",
    "engineering-data.read-result",
    "risk-identification.run-list",
    "risk-identification.run-read",
    "risk-identification.record-catalog",
    "risk-identification.record-read",
    "risk-assessment.read",
    "warning-response.read",
    // CH-2（design D-05）：现场处置人员取得聚合入口资格，但因无资料目录入口
    // 不补原件读取分支，也不借 UI 补授资料路径；执行/反馈写权不变。
    "review-todo.read",
    // CH-3（design D-03）：仪表盘入口资格；现场处置人员仍无资料目录来源，
    // 该来源在仪表盘内按当前授权独立失败，不影响其它来源。
    "projection.dashboard-read",
  ),
  "business-viewer": branchSet(
    "projection.query",
    "projection.subscribe",
    "projection.export",
    "projection.result-read",
    "engineering-data.evidence-access",
    "engineering-data.context-read",
    "engineering-data.source-catalog",
    // CH-2（design D-05）：查看者已有资料目录读能力，同样补齐原件读取分支；
    // 无来源权时仍在原件读取处被拒，不扩大来源可见集合，也不新增任何写权。
    "engineering-data.source-original-read",
    "engineering-data.monitoring-catalog",
    "engineering-data.read-result",
    "knowledge-modeling.governance-read",
    "risk-identification.run-list",
    "risk-identification.run-read",
    "risk-identification.record-catalog",
    "risk-identification.record-read",
    "review-audit.queue-read",
    "knowledge-modeling.retrieval-result",
    "risk-assessment.read",
    "warning-response.read",
    // C35：业务观察者加入统一复核/活动窄读与报告窄读（design D-02），
    // 分别沿原 review-audit.read 与 projection.export 能力；不新增任何写权。
    "review-audit.read",
    "projection.report-read",
    // CH-2（design D-05）：查看者取得聚合入口资格；不因此获得任何写权或 Agent 能力。
    "review-todo.read",
    // CH-3（design D-03）：仪表盘入口资格；不因此获得任何来源写权或 Agent 能力。
    "projection.dashboard-read",
  ),
});

export const PRESET_ROLE_BRANCHES_V1 = roleBranches;

export const SYSTEM_ACCESS_ACTIONS_V1 = Object.freeze([
  "create-account",
  "disable-account",
  "reset-password",
  "open-project",
  "suspend-project",
  "revise-membership",
] as const);

export const PROJECT_MANAGER_ACCESS_ACTIONS_V1 = Object.freeze([
  "revise-membership",
  "create-spatial-scope",
  "revise-spatial-scope",
  "revise-source-access",
] as const);

export const branchCapability = (branch: ModuleBranchV1): ModuleCapabilityV1 => {
  ModuleBranchV1Schema.parse(branch);
  return MODULE_BRANCH_CAPABILITY_V1[branch];
};

export const branchesForRoles = (roles: readonly PresetRoleV1[]): readonly ModuleBranchV1[] => {
  const result = new Set<ModuleBranchV1>();
  for (const role of roles) {
    PresetRoleV1Schema.parse(role);
    for (const branch of roleBranches[role]) result.add(branch);
  }
  return Object.freeze(allBranches.filter((branch) => result.has(branch)));
};

export const capabilitiesForBranches = (
  branches: readonly ModuleBranchV1[],
): readonly ModuleCapabilityV1[] =>
  Object.freeze(Array.from(new Set(branches.map((branch) => branchCapability(branch)))).sort());

export const isBranchAllowed = (roles: readonly PresetRoleV1[], branch: ModuleBranchV1): boolean =>
  branchesForRoles(roles).includes(branch);

export const isSystemAccessAction = (action: string): boolean =>
  (SYSTEM_ACCESS_ACTIONS_V1 as readonly string[]).includes(action);
