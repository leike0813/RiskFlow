import { sql, type Kysely } from "kysely";

/** 原事件同事务登记运行引用；工程锁使序号顺序与提交顺序一致。 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE SEQUENCE business.workflow_run_event_order_seq AS bigint`.execute(db);
  await sql`CREATE TABLE business.workflow_run_events (
    project_id text NOT NULL,
    run_id text NOT NULL,
    run_version_id text NOT NULL,
    event_id text NOT NULL REFERENCES outbox.events(event_id),
    event_version integer NOT NULL CHECK (event_version = 1),
    event_order bigint NOT NULL,
    authorization_context_ref jsonb NOT NULL,
    PRIMARY KEY (project_id, run_id, run_version_id, event_id),
    CHECK (project_id <> '' AND run_id <> '' AND run_version_id <> '')
  )`.execute(db);
  await sql`CREATE INDEX workflow_run_events_cursor_idx
    ON business.workflow_run_events(project_id, run_id, run_version_id, event_order)`.execute(db);

  await sql`CREATE FUNCTION business.register_workflow_run_event(event_body jsonb)
    RETURNS void LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, business
    AS $$
    DECLARE
      context_cause jsonb;
      run_refs jsonb[];
      run_ref jsonb;
      ordinal bigint;
    BEGIN
      SELECT causal_run_ref INTO context_cause
        FROM business.authorization_contexts
        WHERE context_id = event_body #>> '{authorizationContextRef,reference,entityId}'
          AND version_id = event_body #>> '{authorizationContextRef,reference,versionId}'
          AND project_id = event_body ->> 'projectId'
          AND context_kind = 'c02';
      SELECT array_agg(DISTINCT candidate) INTO run_refs
        FROM (VALUES
          (event_body -> 'aggregateRef'),
          (event_body #> '{payload,identificationRunRef}'),
          (event_body #> '{payload,assessmentRunRef}'),
          (event_body #> '{payload,waitingRunRef}'),
          (event_body #> '{payload,resumeRunRef}'),
          (context_cause)
        ) AS refs(candidate)
        WHERE candidate ->> 'kind' = 'workflow-run'
          AND jsonb_typeof(candidate -> 'reference') = 'object'
          AND length(candidate #>> '{reference,entityId}') > 0
          AND length(candidate #>> '{reference,versionId}') > 0;
      IF run_refs IS NULL THEN RETURN; END IF;
      PERFORM pg_advisory_xact_lock(hashtextextended(
        'riskflow:run-events:' || (event_body ->> 'projectId'), 0));
      ordinal := nextval('business.workflow_run_event_order_seq');
      FOREACH run_ref IN ARRAY run_refs LOOP
        INSERT INTO business.workflow_run_events
          (project_id, run_id, run_version_id, event_id, event_version,
           event_order, authorization_context_ref)
        VALUES (event_body ->> 'projectId', run_ref #>> '{reference,entityId}',
          run_ref #>> '{reference,versionId}', event_body ->> 'eventId',
          (event_body ->> 'eventVersion')::integer, ordinal,
          event_body -> 'authorizationContextRef');
      END LOOP;
    END;
    $$`.execute(db);
  await sql`REVOKE ALL ON FUNCTION business.register_workflow_run_event(jsonb) FROM PUBLIC`.execute(
    db,
  );

  await sql`CREATE FUNCTION business.capture_workflow_run_event()
    RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
    SET search_path = pg_catalog, business
    AS $$
    BEGIN
      PERFORM business.register_workflow_run_event(NEW.event_json);
      RETURN NEW;
    END;
    $$`.execute(db);
  await sql`REVOKE ALL ON FUNCTION business.capture_workflow_run_event() FROM PUBLIC`.execute(db);

  // 初始化持有表锁，历史回填与新事件之间不存在可见的半完成窗口。
  await sql`LOCK TABLE outbox.events IN SHARE ROW EXCLUSIVE MODE`.execute(db);
  await sql`DO $$
    DECLARE historical record;
    BEGIN
      FOR historical IN SELECT event_json FROM outbox.events ORDER BY persisted_at, event_id LOOP
        PERFORM business.register_workflow_run_event(historical.event_json);
      END LOOP;
    END;
    $$`.execute(db);
  await sql`CREATE TRIGGER workflow_run_event_capture
    AFTER INSERT ON outbox.events FOR EACH ROW
    EXECUTE FUNCTION business.capture_workflow_run_event()`.execute(db);
  await sql`REVOKE ALL ON TABLE business.workflow_run_events FROM PUBLIC, riskflow_app,
    riskflow_outbox_worker, riskflow_checkpointer, riskflow_deployment_operator`.execute(db);
  await sql`REVOKE ALL ON SEQUENCE business.workflow_run_event_order_seq FROM PUBLIC, riskflow_app,
    riskflow_outbox_worker, riskflow_checkpointer, riskflow_deployment_operator`.execute(db);
  await sql`GRANT SELECT ON business.workflow_run_events
    TO riskflow_app, riskflow_outbox_worker`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER workflow_run_event_capture ON outbox.events`.execute(db);
  await sql`DROP FUNCTION business.capture_workflow_run_event()`.execute(db);
  await sql`DROP FUNCTION business.register_workflow_run_event(jsonb)`.execute(db);
  await sql`DROP TABLE business.workflow_run_events`.execute(db);
  await sql`DROP SEQUENCE business.workflow_run_event_order_seq`.execute(db);
}
