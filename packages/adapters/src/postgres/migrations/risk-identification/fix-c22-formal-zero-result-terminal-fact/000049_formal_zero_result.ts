import { sql, type Kysely, type RawBuilder, type SqlBool } from "kysely";

const jsonb = sql`jsonb`;

const resultsTable = "business.identification_finalization_results";
const zeroResultRefColumn = "zero_result_ref";
const kindCheckConstraint = "identification_finalization_results_kind_ck";
const jsonCheckConstraint = "identification_finalization_results_json_ck";
const zeroResultCommandIndex = "identification_finalization_results_zero_result_command_uidx";

/** D-06：`000042` 的八类结果不放宽，只新增一类「正式零结果」。 */
const resultKinds = [
  "candidate-set",
  "zero-result",
  "validated-candidate-set",
  "identification-group",
  "merge-plan",
  "validation-snapshot",
  "evidence-snapshot",
  "route-decision",
  "acceptance-route-set",
] as const;

const nullableObjectColumn = (column: string) =>
  sql`(${sql.raw(column)} IS NULL OR jsonb_typeof(${sql.raw(column)}) = 'object')`;

/** 可空引用列：`000042` 的十一列加本迁移新增的零结果引用列。 */
const nullableObjectColumnsWithZeroResult = [
  "work_item_ref",
  "model_context_artifact_set_ref",
  "candidate_set_ref",
  "validated_candidate_set_ref",
  "work_plan_ref",
  "group_ref",
  "merge_plan_ref",
  "validation_snapshot_ref",
  "evidence_snapshot_ref",
  "route_decision_ref",
  "acceptance_route_set_ref",
  zeroResultRefColumn,
];

/** `000042` 原有十一列：`down` 收敛回原定义，不引用新增列。 */
const nullableObjectColumnsWithoutZeroResult = nullableObjectColumnsWithZeroResult.filter(
  (column) => column !== zeroResultRefColumn,
);

const pairing = (kind: string, required: readonly string[], nullable: readonly string[]) =>
  sql`(result_kind = ${sql.lit(kind)} AND ${sql.join(
    [
      sql.join(
        required.map((column) => sql`${sql.raw(column)} IS NOT NULL`),
        sql` AND `,
      ),
      sql.join(
        nullable.map((column) => sql`${sql.raw(column)} IS NULL`),
        sql` AND `,
      ),
    ],
    sql` AND `,
  )})`;

const columnsByKind: Readonly<Record<string, readonly string[]>> = {
  "candidate-set": ["work_item_ref", "model_context_artifact_set_ref", "candidate_set_ref"],
  "zero-result": ["work_item_ref", "model_context_artifact_set_ref", zeroResultRefColumn],
  "validated-candidate-set": ["work_item_ref", "candidate_set_ref", "validated_candidate_set_ref"],
  "identification-group": ["work_plan_ref", "group_ref"],
  "merge-plan": ["work_plan_ref", "merge_plan_ref"],
  "validation-snapshot": ["work_plan_ref", "group_ref", "validation_snapshot_ref"],
  "evidence-snapshot": ["work_plan_ref", "group_ref", "evidence_snapshot_ref"],
  "route-decision": ["work_plan_ref", "group_ref", "route_decision_ref"],
  "acceptance-route-set": ["work_plan_ref", "merge_plan_ref", "acceptance_route_set_ref"],
};

const allReferenceColumns = nullableObjectColumnsWithZeroResult;

/**
 * 判别约束正文：每类的完整引用形状仍由 C22 核心判别联合唯一限定。`referenceColumns` 决定
 * 「本类专列以外必须为空」的列集合：`up` 用九类列集合，`down` 收敛回 `000042` 的十一列，
 * 否则 `down` 删除列时 PostgreSQL 会连引用该列的判别约束一并删除。
 */
const kindCheckDefinition = (kinds: readonly string[], referenceColumns: readonly string[]) =>
  sql`result_kind IN (${sql.join(
    kinds.map((kind) => sql.lit(kind)),
    sql`, `,
  )}) AND (${sql.join(
    kinds.map((kind) => {
      const required = columnsByKind[kind] ?? [];
      return pairing(
        kind,
        required,
        referenceColumns.filter((column) => !required.includes(column)),
      );
    }),
    sql` OR `,
  )})`;

/** JSON 列约束正文：必填三列与可空引用列一起限定 `object` 类型。 */
const jsonCheckDefinition = (nullableColumns: readonly string[]) =>
  sql.join(
    [
      ...["artifact_ref", "input_snapshot_ref", "authorization_context_ref"].map(
        (column) => sql`jsonb_typeof(${sql.raw(column)}) = 'object'`,
      ),
      ...nullableColumns.map(nullableObjectColumn),
    ],
    sql` AND `,
  );

/**
 * 同名约束在 `up`/`down` 两条路径上收敛到同一正文：单条 DO 语句先删后建，`ADD CONSTRAINT`
 * 在同一语句内立即校验既有行，任一行越界即整体回滚，不留无约束的已提交状态；重复执行得到
 * 相同约束。DO 块内不能使用绑定参数，故正文只含字面量。
 */
const convergeCheck = async (
  db: Kysely<unknown>,
  constraint: string,
  definition: RawBuilder<unknown>,
): Promise<void> => {
  await sql`
    DO $$
    BEGIN
      ALTER TABLE ${sql.raw(resultsTable)}
        DROP CONSTRAINT IF EXISTS ${sql.raw(constraint)};
      ALTER TABLE ${sql.raw(resultsTable)}
        ADD CONSTRAINT ${sql.raw(constraint)} CHECK (${definition});
    END
    $$;
  `.execute(db);
};

/** C22 正式零结果（design D-02/D-06）：
 *
 * - BREAKING：`candidates: []` 从结构化失败改为独立成功终态，登记表需要第九类结果与
 *   `zero_result_ref` 专列；
 * - 迁移只扩展既有追加式登记表：新增可空列、收敛判别与 JSON 约束、为
 *   `(project_id, command_id)` 建仅覆盖零结果的部分唯一索引，支撑模型调用前的重放预读与
 *   并发重复身份拒绝；
 * - 原八类列组合、主键、摘要与审核约束、审计外键、角色授权与 `standardized_risk_records`
 *   全部保持不动；不重建表，不使用 `NOT VALID`，可重复执行。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'business'
          AND table_name = 'identification_finalization_results'
          AND column_name = '${sql.raw(zeroResultRefColumn)}'
      ) THEN
        ALTER TABLE ${sql.raw(resultsTable)}
          ADD COLUMN ${sql.raw(zeroResultRefColumn)} ${jsonb};
      END IF;
    END
    $$;
  `.execute(db);

  await convergeCheck(
    db,
    kindCheckConstraint,
    kindCheckDefinition(resultKinds, allReferenceColumns),
  );
  await convergeCheck(
    db,
    jsonCheckConstraint,
    jsonCheckDefinition(nullableObjectColumnsWithZeroResult),
  );

  await db.schema
    .createIndex(zeroResultCommandIndex)
    .ifNotExists()
    .unique()
    .on(resultsTable)
    .columns(["project_id", "command_id"])
    .where(sql<SqlBool>`result_kind = 'zero-result'`)
    .execute();
}

/**
 * 退回八类结果：没有已成立零结果行时才撤销该类别、索引与列；存在零事实时显式失败，
 * 由前向修复处理，不静默删除已成立事实。
 */
export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM business.identification_finalization_results
        WHERE result_kind = 'zero-result'
      ) THEN
        RAISE EXCEPTION
          'formal zero results exist; forward-fix instead of dropping the zero-result kind';
      END IF;
    END
    $$;
  `.execute(db);

  await db.schema.dropIndex(zeroResultCommandIndex).ifExists().execute();

  const retainedKinds = resultKinds.filter((kind) => kind !== "zero-result");
  await convergeCheck(
    db,
    jsonCheckConstraint,
    jsonCheckDefinition(nullableObjectColumnsWithoutZeroResult),
  );
  // 收敛回 `000042` 的八类正文（不引用即将删除的列），再删列，判别约束保持有效。
  await convergeCheck(
    db,
    kindCheckConstraint,
    kindCheckDefinition(retainedKinds, nullableObjectColumnsWithoutZeroResult),
  );

  await sql`
    ALTER TABLE ${sql.raw(resultsTable)}
      DROP COLUMN IF EXISTS ${sql.raw(zeroResultRefColumn)}
  `.execute(db);
}
