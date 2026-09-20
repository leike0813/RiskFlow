# Tasks

## 1. 重开规划任务说明

- [x] 1.1 `taskSpec` 接受派发选项；当 `approvalRef` 非空时追加「本次为重开规划」段落（批准引用、被取代尝试组、被取代尝试的 issueRefs/evidenceRefs）
- [x] 1.2 段落包含处置要求：先读 proposal 引用的批准记录、逐项展开为 IP-ID/文件/验证命令、`worker_done` 逐项说明闭合情况、无法闭合则 escalation
- [x] 1.3 `createTask` 把派发选项传入 `taskSpec`

## 2. 测试

- [x] 2.1 扩展重开规划用例：断言生成的 spec 含批准引用、被取代尝试组、被取代尝试的 issueRefs 与读取批准记录的指引
- [x] 2.2 覆盖常规规划任务不含该段落

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-replan-briefing-input --strict --no-interactive` 通过
