# C42 信任范围收窄批准记录

- 日期：2026-09-25（协调端转述的用户裁决日期）
- 批准人：用户，经协调端转述。
- 事项：将新工作树首次启动 Codex 的自动信任移出本 change。控制器只负责识别信任阻断，返回包含完整工作树路径、精确 terminalHandle 和修复指引的 `workspace_trust_required`，并复用同一 queued Task 与 terminalHandle 恢复。
- 信任执行者：协调端或人通过 Orca terminal 手动确认；也可仅为目标路径设置用户级 `[projects."<path>"]` 的 `trust_level = "trusted"`。控制器不自动写用户级配置。
- 用户指示原文（协调端转述）：「由你通过 Orca terminal 功能来手动信任即可」。
- 协调端实测：本机 Codex CLI 0.156.1 预置目标路径信任条目后，`worker-start` 成功派发 c31、c41、c42；未预置时返回 `agent_prompt_stalled`。原 `-c` 单次信任覆盖未使全新目录跳过信任提示。
- 批准边界：修订本 change 的 C 规格、设计、施工图、任务、实现、测试及 verification；A/B 的既有语义和证据保持有效。不合并 main、不归档。
