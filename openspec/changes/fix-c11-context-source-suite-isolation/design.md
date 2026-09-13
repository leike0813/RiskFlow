## Context

参见 [proposal.md](./proposal.md) 的动因。本 change 使用 `spec-driven`，规划 base 为 `f7b568907026864735dee8599f8aae1a1cf34794`。该 base 的目标文件只有外层 `C11 PostgreSQL context/source registry` 和 25 个测试；C25 分支提交 `8e3b0b8` 在文件末尾新增了三个测试组成的 `C25 assessment-preparation freeze` 子套件。

C11 文件当前通过外层 `beforeAll` 创建一个 `EngineeringContextSourcePostgresFixture`，全部用例共享其中的 PostgreSQL 身份、授权和业务状态。前序用例 `persists context, snapshot, source delivery, access closure, and segments` bootstrap `c11-admin`，再把密码从 `c11-admin-password` 改为 `c11-admin-password-changed`。C25 子套件的 `beforeAll` 直接用后一个密码登录该账号；过滤运行 C25 时，前序用例被跳过，空 fixture 中没有该账号，登录因而返回 `AUTHENTICATION_REJECTED`。

本 change 不改变业务规格；测试契约是：`C25 assessment-preparation freeze` 以其名称过滤执行时，必须自行建立所有身份与授权前置状态，并保持三个既有场景、断言和生产行为不变。

## Goals / Non-Goals

**Goals:**

- C25 子套件不读取或假定外层其它用例留下的账号、密码、会话、工程或授权状态。
- 完整文件与 C25 过滤执行都使用确定性 setup/teardown，并保留相邻 C11 用例现有结果。
- 修改范围保持在一个既有测试文件内。

**Non-Goals:**

- 不修改生产实现、公共 Schema、数据库迁移、端口或授权规则。
- 不改变 C25 三个测试的业务断言，也不把每个 `it` 拆成独立数据库 fixture。
- 不通过捕获认证失败后改用另一密码、条件 bootstrap、sleep 或重试兼容共享状态。

## Decisions

### D-01：C25 子套件持有独立 fixture

在 `C25 assessment-preparation freeze` 的词法作用域内声明同类型的 `fixture`，用现有 `startEngineeringContextSourceFixture({ now })` 在子套件 `beforeAll` 中创建，并在子套件 `afterAll` 中关闭。C25 现有 helper 和测试继续引用名称 `fixture`，自然解析到内层实例；外层 C11 fixture 及其它用例不改。

这会让过滤执行仍先创建外层 fixture、再创建 C25 fixture，但它是唯一不改变其它测试语义且完全切断数据库状态依赖的现有机制。把账号初始化上移到外层 hook 会改变前序 C11 用例对初始管理员 bootstrap/改密的覆盖；在共享库中按存在性选择 bootstrap 或登录则继续依赖执行顺序，均不采用。

### D-02：C25 在自身 setup 中建立完整身份链

内层 fixture 创建后，使用既有 `bootstrapInitialSystemAdministrator` 在空数据库建立 `c25-admin`，以初始密码登录并通过 `changePassword` 完成首次改密，取得系统管理授权上下文。随后沿用现有 C25 setup 创建 `c25-manager`、完成其首次改密、开通 `project-c25-freeze`，并从该会话签发 C25 所需分支授权。

所有账号名、命令 ID、幂等键和密码继续使用 C25 专属前缀。不得复用 `c11-admin`、`e2eState`、外层 manager session 或前序工程状态。

### D-03：只修 fixture 生命周期，不改测试观察面

保留 C25 三个 `it` 的名称、超时、命令、断言和数据库查询。实现只增加内层 fixture 的创建/关闭和专用管理员 bootstrap/改密，既有公共 fixture 工厂无需扩展参数或新增抽象。

对应验证边界为：

1. 完整目标文件通过，证明双 fixture 生命周期未破坏 C11 与 C25 组合运行。
2. `-t "C25 assessment-preparation freeze"` 通过且实际执行三个 C25 测试，证明不再依赖前序身份状态。
3. 单跑紧邻 C25 之前的 `denies historical read resolutions once current authorization is revoked` 通过，证明外层 fixture 与相邻 C11 行为未被改写。

### D-04：目标代码进入基线后才实施

当前 base 不含 C25 子套件，不能在本 change 中直接修改目标符号或复现所述认证失败。实施必须基于已集成 C25 子套件的提交；若集成后的套件名称、fixture 工厂、身份 setup 或测试数量与 `8e3b0b8` 不同，先更新本设计与 tasks，再修改代码。

## Implementation Plan

- **IP-01（D-01、D-02）**：在 `packages/adapters/test/engineering-data/context-source/postgres-engineering-context-source-registry.test.ts` 的 `C25 assessment-preparation freeze` 作用域内创建/关闭专用 fixture，并把管理员准备改为 C25 自有 bootstrap、登录和首次改密；保留其余 helper、测试和断言。
- **IP-02（D-03、D-04）**：在含 C25 目标代码的实施基线上执行 C25 过滤、完整文件及相邻 C11 组合验证，并检查格式、OpenSpec 和补丁范围。

## Risks / Trade-offs

- [完整文件会额外启动一个 PostgreSQL fixture，运行时间和资源占用上升] → 以套件级 fixture 复用三个 C25 测试，避免每个测试启动一个容器；只有出现实测资源问题时才考虑重构公共 fixture 的数据库隔离能力。
- [内层变量与外层变量同名可能被误读] → 变量只在具名 C25 `describe` 内声明，利用词法作用域把现有引用最小化；不为一次性需求新增包装器或工厂抽象。
- [当前 base 无法验证缺陷和修复] → tasks 首项检查目标子套件已进入实施基线，并先记录未修复的过滤命令确实执行三个测试且因认证失败退出 1。

## Migration Plan

1. 先把包含 `C25 assessment-preparation freeze` 的 C25 实现集成到本 change 的实施基线，并核对目标结构与 `8e3b0b8` 一致。
2. 仅修改目标测试文件，加入内层 fixture 生命周期和 C25 专用身份 bootstrap。
3. 按 D-03 运行三类测试验证，再执行格式与 OpenSpec 校验。
4. 回滚时只撤销该测试文件中的内层 fixture/setup 变更；没有生产部署、数据迁移或依赖回滚。
