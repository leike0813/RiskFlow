import { sql, type Kysely } from "kysely";

const referenceColumns = [
  "entry_identity",
  "input_snapshot_ref",
  "stage_result_ref",
  "route_decision_ref",
  "waiting_ref",
  "workflow_error_ref",
  "run_result_ref",
  "route_kind",
  "stage",
] as const;

const pairings = [
  ["entry-snapshot", ["entry_identity", "stage"]],
  ["stage-result", ["stage", "stage_result_ref"]],
  ["route-decision", ["route_decision_ref", "route_kind"]],
  ["run-state", ["stage"]],
  ["waiting", ["waiting_ref", "stage"]],
  ["workflow-error", ["workflow_error_ref", "stage"]],
  ["run-result", ["run_result_ref", "stage"]],
] as const;

const replaceConstraint = async (db: Kysely<unknown>, allowEntryReference: boolean) => {
  const predicate = sql.join(
    pairings.map(([kind, required]) => {
      const columns = referenceColumns.filter(
        (column) =>
          !(allowEntryReference && kind === "entry-snapshot" && column === "input_snapshot_ref"),
      );
      return sql`(result_kind = ${sql.lit(kind)} AND ${sql.join(
        columns.map((column) =>
          (required as readonly string[]).includes(column)
            ? sql`${sql.raw(column)} IS NOT NULL`
            : sql`${sql.raw(column)} IS NULL`,
        ),
        sql` AND `,
      )})`;
    }),
    sql` OR `,
  );
  await sql`ALTER TABLE business.workflow_graph_results
    DROP CONSTRAINT workflow_graph_results_kind_ck`.execute(db);
  await sql`ALTER TABLE business.workflow_graph_results
    ADD CONSTRAINT workflow_graph_results_kind_ck CHECK (
      (${predicate}) AND (result_kind <> 'run-state' OR result_version_id = run_version_id)
    )`.execute(db);
};

export async function up(db: Kysely<unknown>): Promise<void> {
  await replaceConstraint(db, true);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await replaceConstraint(db, false);
}
