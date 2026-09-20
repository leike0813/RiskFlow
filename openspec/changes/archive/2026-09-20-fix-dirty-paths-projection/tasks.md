# Tasks

## 1. 修正 dirtyPaths 形状

- [x] 1.1 `collectGit` 新增 porcelain 行 → 裸路径的解析（`XY<space>PATH`、`old -> new` 取目标、剥离外层引号）
- [x] 1.2 `dirtyPaths` 使用解析结果；`dirty` 判定与分支行过滤保持不变

## 2. 测试

- [x] 2.1 `status.test.mjs` 覆盖：修改/未跟踪条目产出裸路径，重命名取目标路径，分支行不进入结果
- [x] 2.2 核对 `control.test.mjs` 中依赖该形状的 fixture 仍与新形状一致

## 3. 验证

- [x] 3.1 `npx vitest run scripts/orchestration/` 全部通过
- [x] 3.2 `npx prettier --check` 与 `npx eslint scripts/orchestration/` 干净
- [x] 3.3 `openspec validate fix-dirty-paths-projection --strict --no-interactive` 通过
- [x] 3.4 真实仓库验证：C26 以两个真实路径提交收口
