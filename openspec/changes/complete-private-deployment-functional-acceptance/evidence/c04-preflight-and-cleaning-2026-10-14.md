# C04 父工件预检补充与真实清洗取证（2026-10-14）

状态：IP-19补充及原五格式正式清洗通过。后续目录/Agent读取、DOCX及16份治理来源转换已通过，最新运行与治理清洗阻塞见 [续接证据](visible-read-and-docx-2026-10-14.md)。下文保留c04-v3阶段取证；完整功能未通过，tasks仍1/14、仅2.1完成。

## 实施与工程回归

- `packages/adapters/src/artifacts/index.ts`：C04 handle 暴露既有 `ArtifactManifestReaderV1` 形状的精确 `readManifest(projectId, artifactRef)`，绑定既有 registry 方法；只读一个工程下一个精确工件。
- `scripts/deployment/start.mjs`：模型父工件预检先读取每个父工件的精确清单，以真实 `manifest.purposeCode` 调用原受权 `open` 并等待 `verified`；缺失返回 `ARTIFACT_ACCESS_DENIED`。基础宿主与图工厂传入 `readArtifactManifest`。
- 本轮回归与门禁：entrypoints 123/123、C04 集成 29/29（`c04-full-regression.log`）、build/typecheck、ESLint、Prettier 与当前 change strict 通过。
- 发布身份 `release-c04-v3.json` / `c04-v3-workspace-identity.json`：release `functional-workspace-20261014-c04-v3`，configRef `physical-20261014-c04-v3`，codeCommit `31ad1a2c…`，trackedDiffSha256 `7adc1b3c…`，runtimeArtifact sha256 `ea4a2811…`（3173565 字节）；标记 `scope: synthetic-acceptance-workspace-build`、`formalOfflineMediaPass: false`，是 dirty 工作区准备包，不是已提交检查点或 C38 完整离线介质。
- c04-v3取证阶段API/Worker使用 `deployment-c04-v3.json` + `release-c04-v3.json`；目录 `data/policies/catalog-c04-v3.json` 的策略正文版本未变。最新API已切v5，Worker停止，见续接证据。

## 真实清洗（c04-v3）

- `cleaning-c04-v3/command.json` 为原 `engineering-data.identification-preparation` 命令（idempotencyKey `physical-five-documents-cleaning-20261014-c04-v3`，清洗策略 `physical-cleaning-policy@physical-20261014-v2`）。首个回执 HTTP 422 `BUSINESS_BLOCKED`；任务完成后原命令重放返回 HTTP 200 与准备快照 `identification-preparation-50efff5ad17336023281c241aba94e153465e03a`（版本1，`reply-1791983424396.json`）。
- 任务 `data-cleaning-task-50efff5ad17336023281c241aba94e153465e03a`（版本1）终态 completed（taskVersion 4）；实际用量 1 次模型调用、1515 输入 / 108 输出 token、活动墙钟 4094 ms（`task-detail-1791983397069.json`）。
- `verified-result.json`：结果工件 `data-cleaning-result-50efff5ad17336023281c241aba94e153465e03a`（sha256:e3f9e23d…），用途 `engineering-data.data-cleaning-result`；5 个输入 available、0 排除、`verified: true`。
- 预检复现仅供诊断、不计为真实模型成功：修复前复现停在错误用途 `model-raw-response`（`cleaning/parent-preflight-reproduction-*.json`）；修复后复现按真实用途 `agent-model-input` 通过预检，网络被诊断显式阻止（`MODEL_SERVICE_UNAVAILABLE`，`networkBlockedByDiagnostic: true`，`cleaning/parent-preflight-fixed-*.json`）。原失败任务未续接、未改写。
- 物理目录与 Agent 界面仍未通过：资料目录把清洗结果按 `engineering-data.source-catalog` 用途读取而被省略为“未清洗”；`AgentTaskProvider` 代际问题使任务详情持续读取中。早期探针 `cleaning-c04-v3/catalog-purpose-probe.json` 返回空目录，空数组断言不构成通过证据；已补资料数量断言并确认失败。修复已获授权（见 [可见读取范围补充](visible-read-scope-proposal.md)）。

## 治理来源续接

- `process-model`、`risk-mechanism` 两份治理 docx 经正式登记后转换 BLOCKED（`TERMINAL_FAILURE`）；只读复现（`governance-sources/process-model/inspection-*.json`）显示官网流程完成、规范化返回 `MINERU_MIDDLE_INVALID`（docx 源文/服务文本不一致），诊断与修复授权见 [DOCX 标准字符引用修复提案](docx-entities-scope-proposal.md)；其余治理来源未跑。
- 官网解析实际输出仍为 MinerU 3.4.4（backend office），与五格式取证一致，不改记为 C38 离线交付。

## 受控证据路径

实例根 `/home/joshua/.local/state/riskflow/acceptance/run-20261014-physical`，限属主访问；不提交秘密、Cookie、签名上传地址、业务正文或模型思考内容。

- `cleaning-c04-v3/`：command、reply、task-detail、verified-result、catalog-purpose-probe。
- `cleaning/`：原失败任务详情、原预算、预检复现与修复后复现。
- `c04-full-regression.log`、`release-c04-v3.json`、`deployment-c04-v3.json`、`c04-v3-workspace-identity.json`。
- `governance-sources/`、`governance-sources-provision.log`、`governance-source-inputs/`。

未运行完整 Electron、RI/RA 业务终态、完整功能报告或故障恢复；未提交、归档或创建 verification。
