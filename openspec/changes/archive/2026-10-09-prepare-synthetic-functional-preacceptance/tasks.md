## 1. 材料和生成

- [x] 1.1 IP-01：完成来源分析、模拟工程、12开发+60试运行场景、候选预期、11配置/规则、工序机理/监测/反馈及各格式文件；运行共享schema与生成物读回检查。

## 2. 检查与运行

- [x] 2.1 IP-02：实现check/run、正式HTTP操作与引用绑定、失败/人工等待及恢复；追加根CLI入口，运行 pnpm exec vitest run scripts/acceptance/synthetic.test.mjs 与局部lint/format。

## 3. 验收证据

- [x] 3.1 IP-03：运行 pnpm acceptance:synthetic check、材料自检和环境可用时正式试运行；输出实际报告、RI/RA追踪和开发缺口。缺环境明确BLOCKED，不标业务通过；执行OpenSpec strict、verification并同步归档。
