import { sql, type Kysely } from "kysely";

const timestamptz = sql`timestamp with time zone`;

const lineageTables = [
  "business.calibration_suggestion_lineage_reservations",
  "business.calibration_suggestion_lineage_consumptions",
] as const;

const revokeAll = async (db: Kysely<unknown>): Promise<void> => {
  await sql`
    REVOKE ALL PRIVILEGES ON TABLE
      business.calibration_suggestion_lineage_consumptions,
      business.calibration_suggestion_lineage_reservations
    FROM PUBLIC, riskflow_app, riskflow_outbox_worker, riskflow_checkpointer
  `.execute(db);
};

/**
 * 退回只预留后继精确引用；完整建议由后续 C08 结果在独立命令中消费预留后插入。
 * 两张表均只追加，公共偏差记录的建议引用可指向已成立建议或未消费预留。
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable("business.calibration_suggestion_lineage_reservations")
    .ifNotExists()
    .addColumn("reservation_id", "text", (column) => column.primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("deviation_id", "text", (column) => column.notNull())
    .addColumn("predecessor_suggestion_id", "text", (column) => column.notNull())
    .addColumn("predecessor_suggestion_version_id", "text", (column) => column.notNull())
    .addColumn("successor_suggestion_id", "text", (column) => column.notNull())
    .addColumn("successor_suggestion_version_id", "text", (column) => column.notNull())
    .addColumn("review_decision_id", "text", (column) => column.notNull())
    .addColumn("review_decision_version_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("calibration_lineage_reservation_predecessor_uidx", [
      "project_id",
      "predecessor_suggestion_id",
      "predecessor_suggestion_version_id",
    ])
    .addUniqueConstraint("calibration_lineage_reservation_decision_uidx", [
      "project_id",
      "review_decision_id",
      "review_decision_version_id",
    ])
    .addUniqueConstraint("calibration_lineage_reservation_successor_uidx", [
      "project_id",
      "successor_suggestion_id",
      "successor_suggestion_version_id",
    ])
    .addForeignKeyConstraint(
      "calibration_lineage_reservation_predecessor_fk",
      ["predecessor_suggestion_id", "predecessor_suggestion_version_id"],
      "business.calibration_suggestions",
      ["suggestion_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "calibration_lineage_reservation_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "calibration_lineage_reservation_identity_ck",
      sql`reservation_id <> '' AND project_id <> '' AND deviation_id <> ''
        AND predecessor_suggestion_id <> '' AND predecessor_suggestion_version_id <> ''
        AND successor_suggestion_id <> '' AND successor_suggestion_version_id <> ''
        AND review_decision_id <> '' AND review_decision_version_id <> ''
        AND command_id <> '' AND idempotency_key <> '' AND audit_entry_id <> ''
        AND (predecessor_suggestion_id, predecessor_suggestion_version_id)
          <> (successor_suggestion_id, successor_suggestion_version_id)`,
    )
    .execute();

  await db.schema
    .createTable("business.calibration_suggestion_lineage_consumptions")
    .ifNotExists()
    .addColumn("reservation_id", "text", (column) => column.primaryKey())
    .addColumn("project_id", "text", (column) => column.notNull())
    .addColumn("successor_suggestion_id", "text", (column) => column.notNull())
    .addColumn("successor_suggestion_version_id", "text", (column) => column.notNull())
    .addColumn("command_id", "text", (column) => column.notNull())
    .addColumn("idempotency_key", "text", (column) => column.notNull())
    .addColumn("audit_entry_id", "text", (column) => column.notNull())
    .addColumn("recorded_at", timestamptz, (column) => column.notNull())
    .addColumn("persisted_at", timestamptz, (column) =>
      column.notNull().defaultTo(sql`clock_timestamp()`),
    )
    .addUniqueConstraint("calibration_lineage_consumption_successor_uidx", [
      "project_id",
      "successor_suggestion_id",
      "successor_suggestion_version_id",
    ])
    .addForeignKeyConstraint(
      "calibration_lineage_consumption_reservation_fk",
      ["reservation_id"],
      "business.calibration_suggestion_lineage_reservations",
      ["reservation_id"],
    )
    .addForeignKeyConstraint(
      "calibration_lineage_consumption_successor_fk",
      ["successor_suggestion_id", "successor_suggestion_version_id"],
      "business.calibration_suggestions",
      ["suggestion_id", "version_id"],
    )
    .addForeignKeyConstraint(
      "calibration_lineage_consumption_command_fk",
      ["command_id"],
      "business.command_receipts",
      ["command_id"],
    )
    .addCheckConstraint(
      "calibration_lineage_consumption_identity_ck",
      sql`reservation_id <> '' AND project_id <> ''
        AND successor_suggestion_id <> '' AND successor_suggestion_version_id <> ''
        AND command_id <> '' AND idempotency_key <> '' AND audit_entry_id <> ''`,
    )
    .execute();

  await sql`
    ALTER TABLE business.calibration_deviation_records
      DROP CONSTRAINT IF EXISTS calibration_deviation_records_suggestion_fk
  `.execute(db);
  await sql`
    CREATE OR REPLACE FUNCTION business.assert_calibration_deviation_suggestion_ref()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM business.calibration_suggestions AS suggestion
        WHERE suggestion.project_id = NEW.project_id
          AND suggestion.suggestion_id = NEW.suggestion_id
          AND suggestion.version_id = NEW.suggestion_version_id
      ) AND NOT EXISTS (
        SELECT 1 FROM business.calibration_suggestion_lineage_reservations AS reservation
        WHERE reservation.project_id = NEW.project_id
          AND reservation.successor_suggestion_id = NEW.suggestion_id
          AND reservation.successor_suggestion_version_id = NEW.suggestion_version_id
      ) THEN
        RAISE EXCEPTION 'calibration deviation suggestion reference is unavailable'
          USING ERRCODE = '23503';
      END IF;
      RETURN NEW;
    END
    $$
  `.execute(db);
  await sql`
    DROP TRIGGER IF EXISTS calibration_deviation_records_suggestion_ref_ck
      ON business.calibration_deviation_records
  `.execute(db);
  await sql`
    CREATE CONSTRAINT TRIGGER calibration_deviation_records_suggestion_ref_ck
    AFTER INSERT ON business.calibration_deviation_records
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION business.assert_calibration_deviation_suggestion_ref()
  `.execute(db);

  for (const table of lineageTables) {
    const constraint = `${table.split(".")[1]}_audit_fk`;
    await sql`
      ALTER TABLE ${sql.raw(table)}
        ADD CONSTRAINT ${sql.raw(constraint)}
        FOREIGN KEY (audit_entry_id) REFERENCES audit.entries(audit_entry_id)
        DEFERRABLE INITIALLY DEFERRED
    `.execute(db);
  }

  await revokeAll(db);
  await sql`GRANT SELECT, INSERT ON TABLE ${sql.raw(lineageTables.join(", "))} TO riskflow_app`.execute(
    db,
  );
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await revokeAll(db);
  await sql`
    DROP TRIGGER IF EXISTS calibration_deviation_records_suggestion_ref_ck
      ON business.calibration_deviation_records
  `.execute(db);
  await sql`DROP FUNCTION IF EXISTS business.assert_calibration_deviation_suggestion_ref()`.execute(
    db,
  );
  await db.schema
    .dropTable("business.calibration_suggestion_lineage_consumptions")
    .ifExists()
    .execute();
  await db.schema
    .dropTable("business.calibration_suggestion_lineage_reservations")
    .ifExists()
    .execute();
  await sql`
    ALTER TABLE business.calibration_deviation_records
      ADD CONSTRAINT calibration_deviation_records_suggestion_fk
      FOREIGN KEY (suggestion_id, suggestion_version_id)
      REFERENCES business.calibration_suggestions (suggestion_id, version_id)
      NOT VALID
  `.execute(db);
}
