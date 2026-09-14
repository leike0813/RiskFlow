## Why

当前编排把强模型定义为独立验证者，却仍允许普通验证失败退回廉价实现角色；动态接管状态又混在手册历史中，导致责任循环、过期检查点和下一会话起点不确定。需要把收尾责任和合法状态转换固化为可重建状态与受控操作，并把现有活动工作树迁移到该机制。

## What Changes

- 将验证阶段改为强模型 Finalizer：在已批准语义范围内核验、修复、回归并给出最终报告，普通缺陷不再退回首轮实现角色。
- 升级执行信封，分离工作项、OpenSpec change、任务角色、阶段、运行状态与质量结论，并兼容读取旧信封。
- 在静态路线 frontier 外生成包含活动节点、辅助 change、恢复和收尾动作的确定性 `resumeQueue`。
- 新增薄控制层和 OMP 扩展，在执行前拒绝非法派发、过期验收、重复写者、违规集成和过早目标完成。
- 清理手册中的动态历史指令，使用 Git、OpenSpec 和 Orca 作为当前状态来源。
- 将新机制同步到现有活动工作树，回填当前执行信封，并回收已合并的旧工作树。

## Capabilities

### New Capabilities

- `operations/orchestration-controlled-actions`: 定义编排阶段转换、Finalizer 责任、受控操作、幂等并发门禁与完成条件。

### Modified Capabilities

- `operations/orchestration-execution-status`: 扩展执行信封、辅助 change 发现、`resumeQueue` 和当前接管状态重建要求。

## Impact

- 影响根目录编排手册、项目 Agent 规则、OpenSpec workflow 模板和执行图 Manifest。
- 修改现有只读状态脚本，新增无第三方依赖的控制器、OMP 扩展和测试。
- 增加 OMP 显式扩展加载与诊断命令；不改变生产应用 API、数据库、依赖或业务领域模型。
- rollout 会合并 main 到四个活动工作树、更新其 Orca 执行信封，并核验后回收三个旧工作树。
