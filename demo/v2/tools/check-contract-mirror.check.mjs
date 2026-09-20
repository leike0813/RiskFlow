// 契约镜像一致性校验：demo/v2/src/app/contract-mirror.data.json
// 必须与 packages/contracts、packages/core 的构建产物一致。
// 运行：node tools/check-contract-mirror.check.mjs（经 npm run check）。

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const failures = [];

const data = JSON.parse(
  await readFile(new URL('../src/app/contract-mirror.data.json', import.meta.url), 'utf8'),
);

const ports = await import(`${repoRoot}/packages/contracts/dist/ports/index.js`);
const workflows = await import(`${repoRoot}/packages/contracts/dist/workflows/index.js`);
const policy = await import(`${repoRoot}/packages/core/dist/access/policy.js`);

function expectEqual(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${label} 与事实源不一致。\n  镜像: ${a}\n  事实源: ${e}`);
}

expectEqual('29 个能力位', data.capabilities, [...ports.ModuleCapabilityV1_VALUES]);
expectEqual(
  '53 个 branch→能力位映射',
  data.branchCapability,
  ports.MODULE_BRANCH_CAPABILITY_V1,
);
expectEqual('I0–I9 阶段', data.identificationStages, [
  ...workflows.IdentificationStageV1Schema.options,
]);
expectEqual('A0–A9 阶段', data.assessmentStages, [
  ...workflows.AssessmentStageV1Schema.options,
]);
expectEqual('五角色分支集合', data.roles, policy.PRESET_ROLE_BRANCHES_V1);
expectEqual('系统访问动作', data.systemAccessActions, [...policy.SYSTEM_ACCESS_ACTIONS_V1]);
expectEqual('项目经理访问动作', data.projectManagerAccessActions, [
  ...policy.PROJECT_MANAGER_ACCESS_ACTIONS_V1,
]);

// 推导语义校验：镜像的「并集 + 映射去重排序」必须等于 policy 的运行结果。
const allBranches = Object.keys(data.branchCapability);
for (const [role, branches] of Object.entries(data.roles)) {
  const mirrored = [
    ...new Set(branches.map((branch) => data.branchCapability[branch])),
  ].sort();
  const truth = policy.capabilitiesForBranches(
    policy.branchesForRoles([role]),
    allBranches,
  );
  expectEqual(`角色 ${role} 的能力位推导`, mirrored, [...truth]);
}
if (data.roles['system-administrator'].length !== 0) {
  failures.push('system-administrator 的分支集必须为空集（AGENTS.md §17 语义）。');
}

if (failures.length > 0) {
  console.error(`契约镜像校验失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('契约镜像校验通过：能力位 29、branch 53、阶段 I0–I9/A0–A9、五角色策略与推导语义一致。');
