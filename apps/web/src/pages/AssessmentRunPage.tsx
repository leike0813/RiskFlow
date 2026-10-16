import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { ConfirmButton } from "../components/ConfirmButton";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  actionAvailability,
  readAssessmentResolve,
  readAssessmentRun,
  submitAssessmentPreparationResume,
  type AssessmentResolveView,
  type AssessmentRunView,
  type KindRef,
} from "../api/operations";
import {
  FieldCard,
  FieldRow,
  NextPageButton,
  VersionRefText,
  stateTone,
} from "./assessmentResponseShared";
import "./assessment-response.css";

/** 终态运行停止轮询；等待中与可重试失败保持单轮询观察，不做高频刷新。 */
const POLL_INTERVAL_MS = 5000;
const isTerminal = (status: string): boolean =>
  status === "completed" || status === "terminal-failure" || status === "cancelled";

/**
 * P-RA-03 评估运行（design D-02、D-04）。
 *
 * 阶段按登记的 stageCode 呈现，父运行的 R 阶段不改称 A 阶段。父运行有多个空间子运行时，
 * 由用户显式选择后读取该子运行的阶段；未选择时只列子运行引用，不合成一条阶段轨迹。
 * 只含实体 ID 的书签先经显式 resolve 取可见版本，随后替换 URL 为带 version 的深链。
 */
export default function AssessmentRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const version = searchParams.get("version");
  const assessmentRun = searchParams.get("assessmentRun");
  const assessmentRunVersion = searchParams.get("assessmentRunVersion");
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  // 续页游标绑定当前运行身份：切换父/子运行或版本即失效，不把上一集合的游标带过去。
  // 服务端把结果引用与复核任务两个集合的游标编码进同一个不透明 nextCursor，这里原样回传。
  const [pageCursor, setPageCursor] = useState<{ readonly key: string; readonly cursor: string }>();
  const runKey = [
    selector.projectId,
    selector.revisionId,
    selector.assessmentSources,
    runId ?? "",
    version ?? "",
    assessmentRun ?? "",
    assessmentRunVersion ?? "",
  ].join("|");
  const cursor =
    pageCursor !== undefined && pageCursor.key === runKey ? pageCursor.cursor : undefined;

  const runRef: KindRef | null =
    runId === undefined
      ? null
      : { kind: "workflow-run", reference: { entityId: runId, versionId: version ?? "" } };

  const run = usePageQuery<AssessmentRunView>(
    (projectId, signal) =>
      runRef === null
        ? Promise.reject(new Error("missing run"))
        : readAssessmentRun(
            projectId,
            {
              workflowRunRef: runRef,
              ...(assessmentRun === null || assessmentRunVersion === null
                ? {}
                : {
                    assessmentRunRef: {
                      kind: "workflow-run",
                      reference: { entityId: assessmentRun, versionId: assessmentRunVersion },
                    },
                  }),
              ...(cursor === undefined ? {} : { resultCursor: cursor }),
            },
            signal,
          ),
    [runId, version, assessmentRun, assessmentRunVersion, cursor, tick],
  );

  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);

  // 单在途轮询：本轮结果落地（run.state 变化）后才排下一次；隐藏页与终态都不排。
  useEffect(() => {
    if (run.state.kind !== "ready" || isTerminal(run.state.value.status) || !visible) return;
    const timer = window.setTimeout(() => setTick((value) => value + 1), POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [run.state, visible]);

  // 首次只含实体 ID 的书签：经显式 resolve 取得可见版本后替换 URL，带 version 后不再解析。
  const resolve = usePageQuery<AssessmentResolveView>(
    (projectId, signal) =>
      runId === undefined
        ? Promise.reject(new Error("missing run"))
        : readAssessmentResolve(
            projectId,
            {
              entityId: runId,
              targetKind: "run",
              ...(version === null ? {} : { versionId: version }),
            },
            signal,
          ),
    [runId, version],
  );

  useEffect(() => {
    if (version !== null || resolve.state.kind !== "ready") return;
    const ref = resolve.state.value.workflowRunRef;
    if (ref === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.set("version", ref.reference.versionId);
    setSearchParams(next, { replace: true });
  }, [resolve.state, version]);

  const resumeAvailability =
    run.state.kind === "ready"
      ? actionAvailability(run.state.value.actions, "workflow.resume-run")
      : null;
  const cancelAvailability =
    run.state.kind === "ready"
      ? actionAvailability(run.state.value.actions, "workflow.cancel-run")
      : null;
  const resumeCommand = useRef({ key: "", commandId: "" });

  return (
    <AppShell
      activeNav="assessment"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">评估运行</h1>
            <p className="page-subtitle">登记阶段轨迹与已成立结果引用</p>
          </div>
        </header>

        <PageStateView
          state={run.state}
          title="运行详情"
          emptyMessage="该运行暂无登记事实"
          onRetry={run.retry}
        >
          {(value) => (
            <>
              <Card title="运行登记">
                <dl>
                  <FieldRow label="运行引用">
                    <VersionRefText reference={value.runRef.reference} />
                  </FieldRow>
                  <FieldRow label="状态">
                    <StatusTag tone={stateTone(value.status)}>{value.status}</StatusTag>
                  </FieldRow>
                  {value.waitingRef?.missingKinds !== undefined && (
                    <FieldRow label="待准备">
                      {value.waitingRef.missingKinds
                        .map(
                          (kind) =>
                            ({
                              materials: "工程资料",
                              knowledge: "知识库",
                              "scoring-configuration": "评分配置",
                              "response-configuration": "处置配置",
                              "forecast-configuration": "预测配置",
                              "calibration-configuration": "校准配置",
                              "human-review": "人工审核",
                            })[kind] ?? kind,
                        )
                        .join("、")}
                    </FieldRow>
                  )}
                  <FieldRow label="入口模式">
                    <span className="mono">{value.entryMode}</span>
                  </FieldRow>
                  <FieldRow label="当前阶段">
                    <span className="mono">{value.stage}</span>
                  </FieldRow>
                  <FieldRow label="图版本">
                    <VersionRefText reference={value.graphVersion} />
                  </FieldRow>
                  <FieldRow label="发起主体">
                    <span className="mono">{value.actorRef}</span>
                  </FieldRow>
                  <FieldRow label="登记时间">
                    <span className="mono">{value.startedAt}</span>
                  </FieldRow>
                  <FieldRow label="状态版本">
                    <VersionRefText reference={value.stateVersion} />
                  </FieldRow>
                  {value.error !== undefined && (
                    <FieldRow label="失败引用">
                      <VersionRefText reference={value.error.reference} />
                    </FieldRow>
                  )}
                </dl>
              </Card>

              <Card title="阶段轨迹" style={{ marginTop: 16 }}>
                {value.stages.length === 0 ? (
                  <p className="ar-note">
                    该运行尚未选中具体的评估子运行，请从下方子运行引用中选择后再查看阶段。
                  </p>
                ) : (
                  <ol className="ar-stage-bar">
                    {value.stages.map((stage) => (
                      <li key={stage.stageCode}>
                        <span className="ar-stage-id mono">{stage.stageCode}</span>
                        <span className="ar-stage-name">{stage.stageCode}</span>
                        <span className="ar-stage-state">{stage.state}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>

              {value.assessmentRunRefs.length > 0 && (
                <Card title="评估子运行" style={{ marginTop: 16 }}>
                  <ul className="ar-ref-list">
                    {value.assessmentRunRefs.map((ref) => (
                      <li key={ref.reference.entityId}>
                        <button
                          type="button"
                          className={`ar-chip${
                            assessmentRun === ref.reference.entityId ? " ar-chip--active" : ""
                          }`}
                          onClick={() => {
                            const next = new URLSearchParams(searchParams);
                            next.set("assessmentRun", ref.reference.entityId);
                            next.set("assessmentRunVersion", ref.reference.versionId);
                            setSearchParams(next);
                          }}
                        >
                          {ref.reference.entityId}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {value.selectedAssessmentRunRef !== undefined && (
                    <p className="ar-note">
                      当前选中：
                      <VersionRefText reference={value.selectedAssessmentRunRef.reference} />
                    </p>
                  )}
                </Card>
              )}

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="已登记结果引用">
                  {value.resultRefs.length === 0 ? (
                    <p className="ar-note">暂无已登记结果引用。</p>
                  ) : (
                    <ul className="ar-ref-list">
                      {value.resultRefs.map((ref) => (
                        <li key={ref.reference.entityId}>
                          <VersionRefText label={ref.kind} reference={ref.reference} />
                        </li>
                      ))}
                    </ul>
                  )}
                  <NextPageButton
                    nextCursor={value.nextCursor}
                    onContinue={(next) => setPageCursor({ key: runKey, cursor: next })}
                  />
                </FieldCard>

                <FieldCard title="人工复核任务">
                  {value.reviewTaskRefs.length === 0 ? (
                    <p className="ar-note">暂无关联复核任务。</p>
                  ) : (
                    <ul className="ar-ref-list">
                      {value.reviewTaskRefs.map((ref) => (
                        <li key={ref.reference.entityId}>
                          <Link className="mono" to={projectPath(`/review`)}>
                            {ref.reference.entityId}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </FieldCard>
              </div>

              <Card title="运行控制" style={{ marginTop: 16 }}>
                {value.waitingRef?.kind === "business-preparation" ? (
                  <ConfirmButton
                    label="准备完成，继续"
                    resetKey={runKey + value.stateVersion.versionId}
                    availability={resumeAvailability ?? "hidden"}
                    summary={["重新检查本阶段所需资料与配置，齐备后继续本次运行。"]}
                    onConfirm={async () => {
                      if (selector.projectId === null) return;
                      const key = runKey + value.stateVersion.versionId;
                      if (resumeCommand.current.key !== key)
                        resumeCommand.current = { key, commandId: crypto.randomUUID() };
                      await submitAssessmentPreparationResume(selector.projectId, {
                        commandId: resumeCommand.current.commandId,
                        run: value,
                      });
                      run.retry();
                    }}
                  />
                ) : (
                  <p className="ar-note">
                    继续 {resumeAvailability ?? "—"}，取消 {cancelAvailability ?? "—"}。
                  </p>
                )}
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
