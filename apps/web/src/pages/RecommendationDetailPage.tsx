import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { ConfirmButton, useProjectConfirmationScope } from "../components/ConfirmButton";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import { clientError, type PreparedCommandV1 } from "../api/client";
import { availabilityFromBusiness } from "../shared/actions.js";
import type { CommandConfirmationPlanV1 } from "../shared/confirmation.js";
import {
  actionAvailability,
  asContractReference,
  prepareRecommendationDecision,
  readResponseRecommendation,
  readWarningResponseResolve,
  sendRecommendationDecision,
  type KindRef,
  type RecommendationView,
  type WarningResponseResolveView,
} from "../api/operations";
import { FieldCard, FieldRow, VersionRefText } from "./assessmentResponseShared";
import "./assessment-response.css";

/**
 * P-RS-01 正式建议详情（design D-02、D-05、D-07）。
 *
 * 候选不能被采纳：这里读的是 C27 已成立的正式建议。采纳必须选择执行前监测快照的
 * 精确引用，页面不提交"最新监测"；拒绝不启动预测。两个动作分别确认，不合并为一个按钮。
 */
export default function RecommendationDetailPage() {
  const { recommendationId } = useParams<{ recommendationId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const version = searchParams.get("version");
  const preActionSnapshot = searchParams.get("preActionSnapshot") ?? "";
  const preActionSnapshotVersion = searchParams.get("preActionSnapshotVersion") ?? "";
  const [tick, setTick] = useState(0);
  const inputIdentity = JSON.stringify([
    selector.projectId,
    selector.revisionId,
    selector.assessmentSources,
    recommendationId,
    version,
    preActionSnapshot,
    preActionSnapshotVersion,
  ]);
  const command = useRef({ identity: "", id: "" });
  if (command.current.identity !== inputIdentity)
    command.current = { identity: inputIdentity, id: crypto.randomUUID() };

  const recommendationRef: KindRef | null =
    recommendationId === undefined
      ? null
      : {
          kind: "response-recommendation",
          reference: { entityId: recommendationId, versionId: version ?? "" },
        };

  const recommendation = usePageQuery<RecommendationView>(
    (projectId, signal) =>
      recommendationRef === null
        ? Promise.reject(new Error("missing recommendation"))
        : readResponseRecommendation(projectId, recommendationRef, signal),
    [recommendationId, version, tick],
  );

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      recommendationId === undefined
        ? Promise.reject(new Error("missing recommendation"))
        : readWarningResponseResolve(
            projectId,
            {
              entityId: recommendationId,
              targetKind: "recommendation",
              ...(version === null ? {} : { versionId: version }),
            },
            signal,
          ),
    [recommendationId, version],
  );

  useEffect(() => {
    if (version !== null || resolve.state.kind !== "ready") return;
    const ref = resolve.state.value.refs[0];
    if (ref === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.set("version", ref.reference.versionId);
    setSearchParams(next, { replace: true });
  }, [resolve.state, version]);

  const scope = useProjectConfirmationScope();

  const actions = recommendation.state.kind === "ready" ? recommendation.state.value.actions : [];
  const decideAvailability = actionAvailability(actions, "warning-response.adopt-recommendation");
  const decided =
    recommendation.state.kind === "ready" ? recommendation.state.value.decision : undefined;
  const monitorSnapshotRef: KindRef | null =
    preActionSnapshot === "" || preActionSnapshotVersion === ""
      ? null
      : {
          kind: "monitoring-snapshot",
          reference: {
            entityId: preActionSnapshot,
            versionId: preActionSnapshotVersion,
          },
        };

  const decidePlan = (
    recommendationRef: KindRef,
    decision: "adopted" | "declined",
  ): CommandConfirmationPlanV1<PreparedCommandV1> => {
    // 请求在打开确认这一刻定型：命令身份、幂等键与采纳所需的执行前监测快照此后不再重算。
    if (scope === undefined || scope.kind !== "project") throw clientError("CONTRACT_INVALID");
    if (decision === "adopted" && monitorSnapshotRef === null)
      throw clientError("CONTRACT_INVALID");
    const request = prepareRecommendationDecision(scope.projectId, {
      commandId: `demo-decide-${decision}-${command.current.id}`,
      responseRecommendationRef: recommendationRef,
      decision,
      reasonCode: decision === "adopted" ? "adopt-per-response-plan" : "decline-per-response-plan",
      ...(decision === "adopted" && monitorSnapshotRef !== null
        ? { preActionMonitoringSnapshotRef: monitorSnapshotRef }
        : {}),
    });
    return {
      confirmationId: `confirm-${request.envelope.commandId}`,
      operationId: "warning-response.adopt-recommendation",
      scope,
      targets: [
        asContractReference(recommendationRef),
        ...(monitorSnapshotRef === null ? [] : [asContractReference(monitorSnapshotRef)]),
      ],
      inputVersions: [
        {
          entityId: recommendationRef.reference.entityId,
          versionId: recommendationRef.reference.versionId,
        },
      ],
      expectedFacts: ["response-recommendation:v1"],
      externalEffects:
        decision === "adopted"
          ? ["登记人工采纳并建立真实等待运行；只有预测运行成立后才提交决定"]
          : ["登记拒绝事实；不启动预测运行"],
      impact: "standard",
      commandId: request.envelope.commandId,
      idempotencyKey: request.envelope.idempotencyKey,
      request,
    };
  };

  return (
    <AppShell
      activeNav="warnings"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">正式建议</h1>
            <p className="page-subtitle">正式建议、验证结果与人工决定</p>
          </div>
        </header>

        <PageStateView
          state={recommendation.state}
          title="建议详情"
          emptyMessage="该建议暂无登记事实"
          onRetry={recommendation.retry}
        >
          {(value) => (
            <>
              <Card title="建议登记">
                <dl>
                  <FieldRow label="建议引用">
                    <VersionRefText reference={value.responseRecommendationRef.reference} />
                  </FieldRow>
                  <FieldRow label="冻结任务">
                    <Link
                      className="mono"
                      to={projectPath(
                        `warnings/tasks/${value.taskRef.reference.entityId}?version=${value.taskRef.reference.versionId}`,
                      )}
                    >
                      {value.taskRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  <FieldRow label="生成策略">
                    <VersionRefText reference={value.generationPolicyRef} />
                  </FieldRow>
                  <FieldRow label="验证策略">
                    <VersionRefText reference={value.validationPolicyRef} />
                  </FieldRow>
                  <FieldRow label="措施发布">
                    {value.measureReleaseRefs.length === 0 ? (
                      <span className="ar-note">未关联措施发布引用</span>
                    ) : (
                      <ul className="ar-ref-list">
                        {value.measureReleaseRefs.map((ref) => (
                          <li key={ref.reference.entityId}>
                            <VersionRefText label={ref.kind} reference={ref.reference} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </FieldRow>
                </dl>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="验证结果">
                  {value.validationResults.length === 0 ? (
                    <p className="ar-note">暂无验证结果。</p>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>检查项</th>
                          <th>结论</th>
                          <th>原因码</th>
                          <th>证据</th>
                        </tr>
                      </thead>
                      <tbody>
                        {value.validationResults.map((check) => (
                          <tr key={check.checkId}>
                            <td className="mono">{check.checkId}</td>
                            <td>
                              <StatusTag tone={check.pass ? "success" : "failed"}>
                                {check.pass ? "通过" : "未通过"}
                              </StatusTag>
                            </td>
                            <td className="mono">{check.reasonCode ?? "—"}</td>
                            <td className="mono">{check.evidenceReferences.length}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </FieldCard>

                <FieldCard title="人工决定">
                  {decided === undefined ? (
                    <p className="ar-note">尚未形成人工决定。</p>
                  ) : (
                    <dl>
                      <FieldRow label="结论">
                        <StatusTag tone={decided.state === "adopted" ? "success" : "failed"}>
                          {decided.state === "adopted" ? "已采纳" : "已拒绝"}
                        </StatusTag>
                      </FieldRow>
                      <FieldRow label="决定引用">
                        <VersionRefText reference={decided.decisionRef.reference} />
                      </FieldRow>
                      <FieldRow label="决定主体">
                        <span className="mono">{decided.actorId}</span>
                      </FieldRow>
                      <FieldRow label="决定时间">
                        <span className="mono">{decided.decidedAt}</span>
                      </FieldRow>
                      <FieldRow label="原因码">
                        <span className="mono">{decided.reasonCode}</span>
                      </FieldRow>
                      {decided.forecastRunRef !== undefined && (
                        <FieldRow label="预测运行">
                          <VersionRefText reference={decided.forecastRunRef.reference} />
                        </FieldRow>
                      )}
                    </dl>
                  )}
                </FieldCard>
              </div>

              <Card title="采纳 / 拒绝" style={{ marginTop: 16 }}>
                <label className="ar-form-field">
                  执行前监测快照标识
                  <input
                    type="text"
                    value={preActionSnapshot}
                    onChange={(event) => {
                      const next = new URLSearchParams(searchParams);
                      if (event.target.value === "") next.delete("preActionSnapshot");
                      else next.set("preActionSnapshot", event.target.value);
                      setSearchParams(next);
                    }}
                    placeholder="采纳时必填：采纳路径据此建立真实等待运行"
                  />
                </label>
                <label className="ar-form-field">
                  执行前监测快照版本
                  <input
                    type="text"
                    value={preActionSnapshotVersion}
                    onChange={(event) => {
                      const next = new URLSearchParams(searchParams);
                      if (event.target.value === "") next.delete("preActionSnapshotVersion");
                      else next.set("preActionSnapshotVersion", event.target.value);
                      setSearchParams(next);
                    }}
                  />
                </label>
                <div className="wd-header-actions">
                  <ConfirmButton
                    label="采纳建议"
                    availability={availabilityFromBusiness(
                      decideAvailability === "hidden" || decideAvailability === null
                        ? "hidden"
                        : decided === undefined &&
                            decideAvailability === "allowed" &&
                            monitorSnapshotRef !== null
                          ? "allowed"
                          : "business-unavailable",
                      { kind: "business", capability: "warning-response.record" },
                    )}
                    requiredPermission={{
                      kind: "business",
                      capability: "warning-response.record",
                    }}
                    scope={scope}
                    intentRevision={inputIdentity}
                    createPlan={() => decidePlan(value.responseRecommendationRef, "adopted")}
                    submit={async (plan) => ({
                      kind: "reference",
                      resultRef: asContractReference(
                        (await sendRecommendationDecision(plan.request)).routeDecisionRef,
                      ),
                    })}
                    onSucceeded={() => setTick((value) => value + 1)}
                  />
                  <ConfirmButton
                    label="拒绝建议"
                    tone="danger"
                    availability={availabilityFromBusiness(
                      decideAvailability === "hidden" || decideAvailability === null
                        ? "hidden"
                        : decided === undefined && decideAvailability === "allowed"
                          ? "allowed"
                          : "business-unavailable",
                      { kind: "business", capability: "warning-response.record" },
                    )}
                    requiredPermission={{
                      kind: "business",
                      capability: "warning-response.record",
                    }}
                    scope={scope}
                    intentRevision={inputIdentity}
                    createPlan={() => decidePlan(value.responseRecommendationRef, "declined")}
                    submit={async (plan) => ({
                      kind: "reference",
                      resultRef: asContractReference(
                        (await sendRecommendationDecision(plan.request)).routeDecisionRef,
                      ),
                    })}
                    onSucceeded={() => setTick((value) => value + 1)}
                  />
                </div>
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
