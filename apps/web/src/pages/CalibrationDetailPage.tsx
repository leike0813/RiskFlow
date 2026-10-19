import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { ConfirmButton, useProjectConfirmationScope } from "../components/ConfirmButton";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery } from "../api/engineering";
import { clientError, type PreparedCommandV1 } from "../api/client";
import { availabilityFromBusiness } from "../shared/actions.js";
import type { CommandConfirmationPlanV1 } from "../shared/confirmation.js";
import {
  actionAvailability,
  asContractReference,
  prepareCalibrationGovernanceDraft,
  prepareCalibrationReviewOutcome,
  readCalibrationSuggestion,
  readWarningResponseResolve,
  sendCalibrationGovernanceDraft,
  sendCalibrationReviewOutcome,
  type CalibrationReviewOutcomeV1,
  type CalibrationView,
  type KindRef,
  type WarningResponseResolveView,
} from "../api/operations";
import { FieldCard, FieldRow, VersionRefText, stateTone } from "./assessmentResponseShared";
import "./assessment-response.css";

/**
 * P-RS-05 校准建议与治理（design D-02、D-08）。
 *
 * 状态取当前偏差记录版本，不是不可变的建议行。收口（拒绝/退回）与创建草案是两个独立
 * 分支、各自确认：批准只生成未发布修订，页面不显示为已发布知识，也不代专家作决定。
 */
export default function CalibrationDetailPage() {
  const { suggestionId } = useParams<{ suggestionId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selector } = useEngineering();
  const version = searchParams.get("version");
  const [tick, setTick] = useState(0);
  const [decisionId, setDecisionId] = useState("");
  const [decisionVersion, setDecisionVersion] = useState("");
  const contextKey = JSON.stringify([
    selector.projectId,
    selector.revisionId,
    selector.assessmentSources,
    suggestionId,
    version,
  ]);
  useEffect(() => {
    setDecisionId("");
    setDecisionVersion("");
  }, [contextKey]);

  const suggestionRef: KindRef | null =
    suggestionId === undefined
      ? null
      : {
          kind: "calibration-suggestion",
          reference: { entityId: suggestionId, versionId: version ?? "" },
        };

  const calibration = usePageQuery<CalibrationView>(
    (projectId, signal) =>
      suggestionRef === null
        ? Promise.reject(new Error("missing suggestion"))
        : readCalibrationSuggestion(projectId, suggestionRef, signal),
    [suggestionId, version, tick],
  );

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      suggestionId === undefined
        ? Promise.reject(new Error("missing suggestion"))
        : readWarningResponseResolve(
            projectId,
            {
              entityId: suggestionId,
              targetKind: "calibration",
              ...(version === null ? {} : { versionId: version }),
            },
            signal,
          ),
    [suggestionId, version],
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

  const calibrationPlan = (
    suggestionRef: KindRef,
    reviewDecisionRef: KindRef,
    outcome: CalibrationReviewOutcomeV1 | "approve-draft-creation",
  ): CommandConfirmationPlanV1<PreparedCommandV1> => {
    // 请求在打开确认这一刻定型：命令身份、幂等键与两条收口分支各自的载荷此后不再重算。
    if (scope === undefined || scope.kind !== "project") throw clientError("CONTRACT_INVALID");
    const commandId = `demo-cal-${outcome}-${suggestionRef.reference.entityId}-${suggestionRef.reference.versionId}-${reviewDecisionRef.reference.entityId}-${reviewDecisionRef.reference.versionId}`;
    const request =
      outcome === "approve-draft-creation"
        ? prepareCalibrationGovernanceDraft(scope.projectId, {
            commandId,
            calibrationSuggestionRef: suggestionRef,
            reviewDecisionRef,
          })
        : prepareCalibrationReviewOutcome(scope.projectId, {
            commandId,
            calibrationSuggestionRef: suggestionRef,
            reviewDecisionRef,
            outcome,
          });
    return {
      confirmationId: `confirm-${request.envelope.commandId}`,
      operationId:
        outcome === "approve-draft-creation"
          ? "warning-response.calibration-governance-draft"
          : "warning-response.calibration-review-outcome",
      scope,
      targets: [asContractReference(suggestionRef), asContractReference(reviewDecisionRef)],
      inputVersions: [
        {
          entityId: suggestionRef.reference.entityId,
          versionId: suggestionRef.reference.versionId,
        },
      ],
      expectedFacts: ["calibration-suggestion:v1"],
      externalEffects:
        outcome === "approve-draft-creation"
          ? ["创建未发布草案修订；页面不显示为已发布知识"]
          : outcome === "reject"
            ? ["收口为 rejected 并登记偏差记录版本；不创建后继候选"]
            : ["收口为 returned 并登记偏差记录版本；不发布任何知识"],
      impact: "standard",
      commandId: request.envelope.commandId,
      idempotencyKey: request.envelope.idempotencyKey,
      request,
    };
  };

  const decideRef = (value: CalibrationView): KindRef | null =>
    value.reviewDecisionRef ??
    (decisionId.trim() !== "" && decisionVersion.trim() !== ""
      ? {
          kind: "review-decision",
          reference: { entityId: decisionId.trim(), versionId: decisionVersion.trim() },
        }
      : null);

  const actions = calibration.state.kind === "ready" ? calibration.state.value.actions : [];
  const outcomeAvailability = actionAvailability(
    actions,
    "warning-response.calibration-review-outcome",
  );
  const draftAvailability = actionAvailability(
    actions,
    "warning-response.calibration-governance-draft",
  );
  const hasDecision =
    (calibration.state.kind === "ready" &&
      calibration.state.value.reviewDecisionRef !== undefined) ||
    (decisionId.trim() !== "" && decisionVersion.trim() !== "");

  return (
    <AppShell
      activeNav="warnings"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">校准建议</h1>
            <p className="page-subtitle">类型化变化摘要、校验结果与治理动作</p>
          </div>
        </header>

        <PageStateView
          state={calibration.state}
          title="校准详情"
          emptyMessage="该校准建议暂无登记事实"
          onRetry={calibration.retry}
        >
          {(value) => (
            <>
              <Card title="建议登记">
                <dl>
                  <FieldRow label="建议引用">
                    <VersionRefText reference={value.calibrationSuggestionRef.reference} />
                  </FieldRow>
                  <FieldRow label="目标类型">
                    <span className="mono">{value.targetKind}</span>
                  </FieldRow>
                  <FieldRow label="目标发布">
                    <VersionRefText reference={value.targetReleaseRef.reference} />
                  </FieldRow>
                  <FieldRow label="冻结输入">
                    <VersionRefText reference={value.inputSnapshotRef.reference} />
                  </FieldRow>
                  <FieldRow label="校验策略">
                    <VersionRefText reference={value.validationPolicyRef} />
                  </FieldRow>
                  <FieldRow label="状态">
                    <StatusTag tone={stateTone(value.status)}>{value.status}</StatusTag>
                  </FieldRow>
                  <FieldRow label="偏差记录">
                    <VersionRefText reference={value.deviationRecordRef.reference} />
                    <span className="ar-note"> · 版本 {value.deviationRecordVersionId}</span>
                  </FieldRow>
                  {value.reviewTaskRef !== undefined && (
                    <FieldRow label="复核任务">
                      <VersionRefText reference={value.reviewTaskRef.reference} />
                    </FieldRow>
                  )}
                  {value.reviewDecisionRef !== undefined && (
                    <FieldRow label="复核决定">
                      <VersionRefText reference={value.reviewDecisionRef.reference} />
                    </FieldRow>
                  )}
                  {value.candidateArtifactRef !== undefined && (
                    <FieldRow label="候选工件">
                      <VersionRefText reference={value.candidateArtifactRef.reference} />
                    </FieldRow>
                  )}
                  {value.knowledgeRevisionRef !== undefined && (
                    <FieldRow label="知识修订">
                      <VersionRefText reference={value.knowledgeRevisionRef.reference} />
                      <span className="ar-note"> · 未发布草案，发布由知识治理负责</span>
                    </FieldRow>
                  )}
                </dl>
              </Card>

              <Card title="类型化变化摘要" style={{ marginTop: 16 }}>
                {value.operations.length === 0 ? (
                  <p className="ar-note">暂无变化摘要。</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>操作</th>
                        <th>校验</th>
                        <th>原因码</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.operations.map((operation, index) => (
                        <tr key={index}>
                          <td>
                            <pre className="ar-record-body">
                              {JSON.stringify(operation.operation, null, 2)}
                            </pre>
                          </td>
                          <td>
                            <StatusTag tone={operation.valid ? "success" : "failed"}>
                              {operation.valid ? "通过" : "未通过"}
                            </StatusTag>
                          </td>
                          <td className="mono">{operation.reasonCode ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="ar-note">
                  摘要只用于呈现，完整重建入口是候选工件引用；摘要不能作为写命令载荷。
                </p>
              </Card>

              {value.reviewDecisionRef === undefined &&
                (outcomeAvailability === "allowed" || draftAvailability === "allowed") && (
                  <Card title="复核决定" style={{ marginTop: 16 }}>
                    <p className="ar-note">请在复核队列完成决定后，填写该决定的精确引用。</p>
                    <label className="ar-form-field">
                      复核决定标识
                      <input
                        value={decisionId}
                        onChange={(event) => setDecisionId(event.target.value)}
                      />
                    </label>
                    <label className="ar-form-field">
                      复核决定版本
                      <input
                        value={decisionVersion}
                        onChange={(event) => setDecisionVersion(event.target.value)}
                      />
                    </label>
                  </Card>
                )}
              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="记录拒绝 / 退回">
                  <p className="ar-note">
                    两条收口分支各走各自的公共命令。收口成功输出偏差记录引用与版本；
                    不创建后继候选。
                  </p>
                  <ConfirmButton
                    label="记录拒绝"
                    tone="danger"
                    availability={availabilityFromBusiness(
                      outcomeAvailability === "hidden" || outcomeAvailability === null
                        ? "hidden"
                        : outcomeAvailability === "allowed" && hasDecision
                          ? "allowed"
                          : "business-unavailable",
                      { kind: "business", capability: "warning-response.record" },
                    )}
                    requiredPermission={{
                      kind: "business",
                      capability: "warning-response.record",
                    }}
                    scope={scope}
                    intentRevision={JSON.stringify([contextKey, decisionId, decisionVersion])}
                    createPlan={() => {
                      const reviewDecisionRef = decideRef(value);
                      if (reviewDecisionRef === null) throw clientError("CONTRACT_INVALID");
                      return calibrationPlan(
                        value.calibrationSuggestionRef,
                        reviewDecisionRef,
                        "reject",
                      );
                    }}
                    submit={async (plan) => ({
                      kind: "reference",
                      resultRef: asContractReference(
                        (await sendCalibrationReviewOutcome(plan.request)).deviationRecordRef,
                      ),
                    })}
                    onSucceeded={() => setTick((value) => value + 1)}
                  />
                  <ConfirmButton
                    label="记录退回"
                    availability={availabilityFromBusiness(
                      outcomeAvailability === "hidden" || outcomeAvailability === null
                        ? "hidden"
                        : outcomeAvailability === "allowed" && hasDecision
                          ? "allowed"
                          : "business-unavailable",
                      { kind: "business", capability: "warning-response.record" },
                    )}
                    requiredPermission={{
                      kind: "business",
                      capability: "warning-response.record",
                    }}
                    scope={scope}
                    intentRevision={JSON.stringify([contextKey, decisionId, decisionVersion])}
                    createPlan={() => {
                      const reviewDecisionRef = decideRef(value);
                      if (reviewDecisionRef === null) throw clientError("CONTRACT_INVALID");
                      return calibrationPlan(
                        value.calibrationSuggestionRef,
                        reviewDecisionRef,
                        "return-for-revision",
                      );
                    }}
                    submit={async (plan) => ({
                      kind: "reference",
                      resultRef: asContractReference(
                        (await sendCalibrationReviewOutcome(plan.request)).deviationRecordRef,
                      ),
                    })}
                    onSucceeded={() => setTick((value) => value + 1)}
                  />
                </FieldCard>

                <FieldCard title="创建治理草案">
                  <p className="ar-note">
                    批准只生成未发布修订：草案、知识修订与候选工件按精确引用登记，
                    发布仍由既有知识治理负责。
                  </p>
                  <ConfirmButton
                    label="创建治理草案"
                    availability={availabilityFromBusiness(
                      draftAvailability === "hidden" || draftAvailability === null
                        ? "hidden"
                        : draftAvailability === "allowed" && hasDecision
                          ? "allowed"
                          : "business-unavailable",
                      { kind: "business", capability: "warning-response.record" },
                    )}
                    requiredPermission={{
                      kind: "business",
                      capability: "warning-response.record",
                    }}
                    scope={scope}
                    intentRevision={JSON.stringify([contextKey, decisionId, decisionVersion])}
                    createPlan={() => {
                      const reviewDecisionRef = decideRef(value);
                      if (reviewDecisionRef === null) throw clientError("CONTRACT_INVALID");
                      return calibrationPlan(
                        value.calibrationSuggestionRef,
                        reviewDecisionRef,
                        "approve-draft-creation",
                      );
                    }}
                    submit={async (plan) => ({
                      kind: "reference",
                      resultRef: asContractReference(
                        (await sendCalibrationGovernanceDraft(plan.request)).knowledgeRevisionRef,
                      ),
                    })}
                    onSucceeded={() => setTick((value) => value + 1)}
                  />
                </FieldCard>
              </div>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
