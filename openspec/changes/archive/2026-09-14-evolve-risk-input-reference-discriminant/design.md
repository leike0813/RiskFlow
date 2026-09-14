## Context

动机见 [proposal.md](./proposal.md#why)。基线固定为 `f7b568907026864735dee8599f8aae1a1cf34794`。`packages/contracts/src/records/index.ts` 当前以两个 strict object 的普通 union 定义 `RiskInputReferenceSchema`；运行时会拒绝双标识对象，但推导类型缺少判别字段，也没有禁止另一分支字段，因此结构性赋值可绕过 XOR。归档 C01 design 曾把“字段名可辨识”当作类型层约束，已与主规格“可辨识联合”和项目 `AGENTS.md` §4.2 发生 drift。

影响分析使用 CodeGraph 后再以 `rg` 全仓枚举符号、两个标识字段和同类 discriminated union：

| 位置与符号 | 当前关系 | 是否适配 |
| --- | --- | --- |
| `packages/contracts/src/records/index.ts`：`RiskRecordInputSchema`、`ExternalRiskEventInputSchema`、`RiskInputReferenceSchema`、`RiskInputReference` | 目标契约定义 | 是，增加判别并收紧推导类型 |
| 同文件：`RiskAssessmentRecordSchema`、`RiskAssessmentRecord` | 复用两种风险输入分支形成公共评估记录 | 是，沿用同一判别分支；这是除独立 C25 命令层外唯一会改变公共对象形状的同包消费者 |
| `packages/contracts/src/ports/index.ts`：`RiskInputReferenceSchema`、`RiskInputReference` re-export | 仅重导出，无构造、解析或映射 | 否；导出名称和路径不变 |
| `packages/contracts/src/index.ts` 与 `packages/contracts/package.json` | 通过根入口和 `./records` 公开既有导出 | 否；无需增加入口 |
| `packages/contracts/test/contract-kernel.test.ts`：“以可辨识联合类型强制风险输入 XOR” | 唯一直接解析夹具；覆盖共享引用与评估记录 | 是，合法夹具补 `kind`，负例和类型层证据收紧 |

`packages/contracts` 外没有 `RiskInputReference` 或 `RiskInputReferenceSchema` 的引用。C25 相关命令、快照和事件链使用另一项已安全的版本化契约 `RiskInputVersionRefV1Schema`：`AssessmentPreparationCommandPayloadV1Schema`、`StartWorkflowPayloadV1Schema` 的 `assess`/`historical-backfill` 分支、`AssessmentPreparationSnapshotV1Schema` 及 `assessment.recorded.v1` 均已携带 `kind`，不映射或嵌入本次目标契约。全仓也没有将目标契约或 `RiskAssessmentRecordSchema` 送入 JSON-LD 转换的路径。当前基线上没有 C25 风险评估生产模块或持久化记录需要迁移。

## Goals / Non-Goals

**Goals:**

- 让共享引用与评估记录在 Zod 解析和 TypeScript 结构性赋值中共同拒绝双标识。
- 保持 strict 未声明字段拒绝、现有导出位置及其它记录字段不变。
- 用现有测试文件留下运行时与类型层回归证据。

**Non-Goals:**

- 不修改版本化 `RiskInputVersionRefV1Schema`、命令、事件、工作流或 C25 领域逻辑。
- 不增加兼容 shim、无判别别名、数据库迁移、数据回填、依赖或新测试框架。
- 不演进风险评估记录的计算、版本、证据、审计及其它字段。

## Decisions

### D-01：使用 `kind` discriminated union，并在分支中禁止另一标识

旧推导类型等价于：

```ts
type RiskInputReference =
  | { riskRecordId: string }
  | { externalRiskEventId: string };
```

新 Schema 形状固定为：

```ts
const rejectPresentOppositeRiskInputField = (
  input: { kind: "standardized-risk-record" | "external-risk-event" },
  context: z.core.$RefinementCtx,
) => {
  const oppositeField =
    input.kind === "standardized-risk-record" ? "externalRiskEventId" : "riskRecordId";
  if (Object.hasOwn(input, oppositeField)) {
    context.addIssue({ code: "custom", path: [oppositeField], message: "conflicting risk input" });
  }
};

// 对侧标识运行时可放行（冲突统一由精炼报稳定错误），类型层仍收紧为 never。
const AbsentRiskInputFieldSchema = z.custom<never>(() => true);

const RiskRecordInputSchema = z.strictObject({
  kind: z.literal("standardized-risk-record"),
  riskRecordId: IdentifierSchema,
  externalRiskEventId: AbsentRiskInputFieldSchema.optional(),
});
const ExternalRiskEventInputSchema = z.strictObject({
  kind: z.literal("external-risk-event"),
  externalRiskEventId: IdentifierSchema,
  riskRecordId: AbsentRiskInputFieldSchema.optional(),
});

export const RiskInputReferenceSchema = z
  .discriminatedUnion("kind", [RiskRecordInputSchema, ExternalRiskEventInputSchema])
  .superRefine(rejectPresentOppositeRiskInputField);
export type RiskInputReference = z.infer<typeof RiskInputReferenceSchema>;
```

其推导类型等价于：

```ts
type RiskInputReference =
  | {
      kind: "standardized-risk-record";
      riskRecordId: string;
      externalRiskEventId?: undefined;
    }
  | {
      kind: "external-risk-event";
      externalRiskEventId: string;
      riskRecordId?: undefined;
    };
```

仅增加 `kind` 的普通可辨识联合仍可能让预先赋值的对象以额外属性形式携带另一标识；对侧字段以 `z.custom<never>(() => true).optional()` 参与解析，使携带另一有效标识的结构性赋值失败。运行时与类型层在这里有意不对称：对侧字段若用 `z.never()` 收紧，双标识输入会在精炼运行前以 `invalid_type`、`expected: "never"` 失败，公开错误会泄露内部 Schema 手段，且 `rejectPresentOppositeRiskInputField` 对双标识不可达；因此对侧字段必须运行时可放行，双标识与显式 `undefined` 只由精炼按自有属性报稳定的 `custom` 冲突错误。缺少标识由分支必需字段的 `invalid_type` 拒绝，缺少或未知 `kind` 由判别器错误拒绝，均不泄露内部手段。类型仍只从 Schema 推导（`z.infer`），不新增手写公共别名。

备选一是只把 `z.union` 改为 `z.discriminatedUnion`；因不能完整关闭已确认的结构性赋值缺口而否决。备选二是以 optional 字段加 `refine`；其推导类型仍宽松而否决。备选三是手写 XOR utility/type；会建立第二事实源而否决。备选四是对侧字段用 `z.never()` 快速失败；因泄露内部 Schema 表示并让稳定冲突错误不可达而否决。

### D-02：判别字段和值复用同域版本化引用

判别字段固定为 `kind`。`packages/contracts/src/ports/index.ts` 的同域 `RiskInputVersionRefV1Schema` 已用 `kind` 区分 `StandardizedRiskRecordRefV1Schema` 与 `ExternalRiskEventRefV1Schema`，literal 分别是 `standardized-risk-record` 和 `external-risk-event`；本次直接复用这组词汇。`inputKind` 在仓库中用于文档输入格式等对象属性，不是同层实体引用的通用判别字段，因此不采用。

### D-03：评估记录沿用相同分支，不增加嵌套或映射

`RiskAssessmentRecordSchema` 继续由两个输入分支扩展 `RiskAssessmentRecordBaseShape`，但顶层改为 `z.discriminatedUnion("kind", ...).superRefine(rejectPresentOppositeRiskInputField)`。这样只给现有平铺记录增加 `kind`，不引入 `riskInput` 嵌套，不复制标识，不改变其余十二项最小字段。

旧记录类型是“公共字段 + `{ riskRecordId } | { externalRiskEventId }`”；新记录类型是“相同公共字段 + D-01 的判别 union”。旧的无 `kind` 记录不再解析或通过类型检查，这是 delta spec 明示的唯一公共行为变化。基线没有该记录的 contracts 外调用方、JSON-LD 投影或持久化表，因此不需要机械适配其它文件。

### D-04：在现有契约测试中同时留下运行时与编译期证据

只修改 `packages/contracts/test/contract-kernel.test.ts`：

- 两个合法 `RiskInputReferenceSchema` 对象及两个合法 `RiskAssessmentRecordSchema` 对象补充对应 `kind`；
- 表格化覆盖缺少/未知 `kind`、判别与标识不匹配、双标识、无标识和额外字段的拒绝；双标识与缺少标识另按 `code` 与 `path` 断言稳定结构化错误，不断言完整文案，也不允许出现内部 Schema 表示；
- 导入 `RiskInputReference` 类型，以预先赋值的双标识对象配合 `@ts-expect-error`，确保结构性赋值不能通过；同时保留两个合法分支的静态赋值；
- 以现有 Vitest 命令验证运行时，以直接对该测试文件执行 TypeScript `--noEmit` 验证 `@ts-expect-error`，不新增测试文件或配置。

不精确断言 Zod 文案、issue 顺序或内部 option 顺序。

### D-05：其它工程语义保持不变

本 change 不引入状态、权限、错误码、事务、幂等、持久化、审计或可观测性路径；这些语义均不经过目标值对象。无依赖变更，文件所有权限于 C01 records 与既有契约测试。RA-S1/RA-S5 追踪只修复风险来源 XOR，不改变 C25 的确定性评估责任。

## Risks / Trade-offs

- [公共对象新增必填 `kind`，尚未合入本基线的下游分支可能需要适配] → 主调度在合并本 change 后重放下游分支；适配仅把现有来源映射为两个固定 literal，不提供兼容入口。
- [对侧字段运行时放行、类型层收紧，两侧有意不对称] → 精炼是对侧标识的唯一运行时闸门；契约测试对共享引用与评估记录分别断言双标识只返回稳定的 `custom` 冲突问题，任何放行回归都会失败。TypeScript 无法区分“属性缺失”与“显式 `undefined`”，但两者都携带对侧自有属性并被同一精炼拒绝，两个有效标识均为非空字符串，结构性赋值缺口保持关闭，不另建手写公共类型事实源。
- [新增 discriminator 改变已序列化对象形状] → 当前基线无目标类型持久化或 JSON-LD 消费；不做空迁移。未来生产记录从创建时写入 `kind`。

## Migration Plan

1. 先发布共享 contracts 的判别 Schema 与推导类型。
2. 同一变更中机械更新现有契约夹具并完成运行时、编译期和包级验证。
3. 合并到包含尚未落入本基线的 C25 实现时，按 `riskInput.kind` 原样投影到平铺评估记录的 `kind`；标准化记录分支写 `standardized-risk-record`，外部事件分支写 `external-risk-event`。
4. 回滚仅回退本 change 的 records 与测试改动；当前基线无数据迁移需要撤销。
