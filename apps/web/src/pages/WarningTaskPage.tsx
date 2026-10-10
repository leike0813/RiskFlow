import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  actionAvailability,
  readWarningResponseResolve,
  readWarningTask,
  type KindRef,
  type WarningResponseResolveView,
  type WarningTaskView,
} from "../api/operations";
import { FieldRow, VersionRefText } from "./assessmentResponseShared";
import "./assessment-response.css";

type RelationKey =
  | "warningRefs"
  | "recommendationRefs"
  | "decisionRefs"
  | "executionRefs"
  | "forecastRefs"
  | "feedbackRefs"
  | "calibrationRefs";

/**
 * 七组关系各自的深链目标。公共契约只有一个 relatedCursor，一次续页只推进一组，
 * 其余组回到第一页——页面不合并这些集合，也不解析游标内容。
 */
const RELATION_TABS: readonly {
  readonly key: RelationKey;
  readonly label: string;
  readonly link: (ref: KindRef) => string;
  readonly cursorKey: keyof WarningTaskView["relations"];
}[] = [
  {
    key: "warningRefs",
    label: "预警",
    link: (ref) => `warnings/${ref.reference.entityId}?version=${ref.reference.versionId}`,
    cursorKey: "warningNextCursor",
  },
  {
    key: "recommendationRefs",
    label: "正式建议",
    link: (ref) =>
      `response/recommendations/${ref.reference.entityId}?version=${ref.reference.versionId}`,
    cursorKey: "recommendationNextCursor",
  },
  {
    key: "decisionRefs",
    label: "人工决定",
    link: (ref) => `warnings/tasks/${ref.reference.entityId}`,
    cursorKey: "decisionNextCursor",
  },
  {
    key: "executionRefs",
    label: "执行",
    link: (ref) =>
      `response/executions/register?execution=${ref.reference.entityId}&version=${ref.reference.versionId}`,
    cursorKey: "executionNextCursor",
  },
  {
    key: "forecastRefs",
    label: "预测",
    link: (ref) =>
      `response/predictions/${ref.reference.entityId}?version=${ref.reference.versionId}`,
    cursorKey: "forecastNextCursor",
  },
  {
    key: "feedbackRefs",
    label: "反馈",
    link: (ref) => `response/feedback/${ref.reference.entityId}?version=${ref.reference.versionId}`,
    cursorKey: "feedbackNextCursor",
  },
  {
    key: "calibrationRefs",
    label: "校准",
    link: (ref) =>
      `response/calibrations/${ref.reference.entityId}?version=${ref.reference.versionId}`,
    cursorKey: "calibrationNextCursor",
  },
];

/**
 * P-WR-04 处置任务详情（design D-02、D-05）。
 *
 * 关系集合由各所属接缝分别提供：建议来自 C27、决定来自 C41、执行/预测/反馈来自 C28、
 * 校准来自 C29。确认事实不改变任务状态，页面分别呈现登记事实与各组关系的独立分页。
 */
export default function WarningTaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const version = searchParams.get("version");
  const [relation, setRelation] = useState<RelationKey>("warningRefs");
  const [relatedCursor, setRelatedCursor] = useState<string | undefined>(undefined);

  const taskRef: KindRef | null =
    taskId === undefined
      ? null
      : {
          kind: "warning-response-task",
          reference: { entityId: taskId, versionId: version ?? "" },
        };

  const task = usePageQuery<WarningTaskView>(
    (projectId, signal) =>
      taskRef === null
        ? Promise.reject(new Error("missing task"))
        : readWarningTask(
            projectId,
            taskRef,
            relatedCursor === undefined ? {} : { relatedCursor },
            signal,
          ),
    [taskId, version, relatedCursor],
  );

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      taskId === undefined
        ? Promise.reject(new Error("missing task"))
        : readWarningResponseResolve(
            projectId,
            {
              entityId: taskId,
              targetKind: "task",
              ...(version === null ? {} : { versionId: version }),
            },
            signal,
          ),
    [taskId, version],
  );

  useEffect(() => {
    if (version !== null || resolve.state.kind !== "ready") return;
    const ref = resolve.state.value.refs[0];
    if (ref === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.set("version", ref.reference.versionId);
    setSearchParams(next, { replace: true });
  }, [resolve.state, version]);

  return (
    <AppShell
      activeNav="warnings"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">处置任务</h1>
            <p className="page-subtitle">任务登记事实与各所属处置关系</p>
          </div>
        </header>

        <PageStateView
          state={task.state}
          title="任务详情"
          emptyMessage="该任务暂无登记事实"
          onRetry={task.retry}
        >
          {(value) => {
            // 关系页签是固定清单；为空时按空态呈现，不做越界访问。
            const active = RELATION_TABS.find((tab) => tab.key === relation) ?? RELATION_TABS[0];
            if (active === undefined) return <Card title="关联">{null}</Card>;
            const refs = value.relations[active.key];
            const cursor = value.relations[active.cursorKey] as string | undefined;
            return (
              <>
                <Card title="任务登记">
                  <dl>
                    <FieldRow label="任务引用">
                      <VersionRefText reference={value.taskRef.reference} />
                    </FieldRow>
                    <FieldRow label="状态">
                      <StatusTag tone={value.status === "open" ? "review" : "success"}>
                        {value.status}
                      </StatusTag>
                    </FieldRow>
                    <FieldRow label="风险输入">
                      <VersionRefText
                        label={value.riskInput.kind}
                        reference={value.riskInput.reference}
                      />
                    </FieldRow>
                    <FieldRow label="空间范围">
                      <VersionRefText reference={value.spatialScopeRef.reference} />
                    </FieldRow>
                    <FieldRow label="登记时间">
                      <span className="mono">{value.occurredAt}</span>
                    </FieldRow>
                  </dl>
                </Card>

                <Card title="处置关系" style={{ marginTop: 16 }}>
                  {actionAvailability(value.actions, "warning-response.record-execution") ===
                    "allowed" && (
                    <Link
                      className="btn btn-primary"
                      to={projectPath(
                        `response/executions/register?task=${value.taskRef.reference.entityId}&taskVersion=${value.taskRef.reference.versionId}`,
                      )}
                    >
                      登记执行
                    </Link>
                  )}
                  <div className="wc-filter" role="group" aria-label="关系分组">
                    <span className="wc-filter-label">分组</span>
                    {RELATION_TABS.map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        className={`wc-chip${relation === tab.key ? " wc-chip--active" : ""}`}
                        onClick={() => {
                          setRelation(tab.key);
                          setRelatedCursor(undefined);
                        }}
                      >
                        {tab.label}（{value.relations[tab.key].length}）
                      </button>
                    ))}
                  </div>
                  {refs.length === 0 ? (
                    <p className="ar-note">该分组当前没有已登记引用。</p>
                  ) : (
                    <ul className="ar-ref-list">
                      {refs.map((ref) => (
                        <li
                          key={`${ref.kind}-${ref.reference.entityId}-${ref.reference.versionId}`}
                        >
                          <Link className="mono" to={projectPath(active.link(ref))}>
                            {ref.reference.entityId}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                  {cursor === undefined ? null : (
                    <div className="ar-next-page">
                      <button
                        type="button"
                        className="ar-chip"
                        onClick={() => setRelatedCursor(cursor)}
                      >
                        续页（{active.label}）
                      </button>
                    </div>
                  )}
                  <p className="ar-note">
                    各分组按所属接缝分别分页；一次续页只推进当前分组，其余分组回到第一页。
                  </p>
                </Card>
              </>
            );
          }}
        </PageStateView>
      </div>
    </AppShell>
  );
}
