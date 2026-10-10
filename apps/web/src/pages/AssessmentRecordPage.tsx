import { useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  readAssessmentRecord,
  readAssessmentResolve,
  type AssessmentRecordView,
  type AssessmentResolveView,
  type KindRef,
} from "../api/operations";
import { FieldCard, FieldRow, VersionRefText } from "./assessmentResponseShared";
import "./assessment-response.css";

/**
 * P-RA-05 评估记录详情（design D-02、D-04）。
 *
 * 指标取值、轴贡献、矩阵落点与触发事实全部取自该记录保存的工件；解释不完整时服务端返回
 * 失败闭合，页面不会用当前配置补齐缺失依据。
 */
export default function AssessmentRecordPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const version = searchParams.get("version");

  const recordRef: KindRef | null =
    recordId === undefined
      ? null
      : {
          kind: "risk-assessment-record",
          reference: { entityId: recordId, versionId: version ?? "" },
        };

  const record = usePageQuery<AssessmentRecordView>(
    (projectId, signal) =>
      recordRef === null
        ? Promise.reject(new Error("missing record"))
        : readAssessmentRecord(projectId, recordRef, signal),
    [recordId, version],
  );

  const resolve = usePageQuery<AssessmentResolveView>(
    (projectId, signal) =>
      recordId === undefined
        ? Promise.reject(new Error("missing record"))
        : readAssessmentResolve(
            projectId,
            {
              entityId: recordId,
              targetKind: "record",
              ...(version === null ? {} : { versionId: version }),
            },
            signal,
          ),
    [recordId, version],
  );

  useEffect(() => {
    if (version !== null || resolve.state.kind !== "ready") return;
    const ref = resolve.state.value.assessmentRecordRef;
    if (ref === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.set("version", ref.reference.versionId);
    setSearchParams(next, { replace: true });
  }, [resolve.state, version]);

  return (
    <AppShell
      activeNav="assessment"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">评估记录</h1>
            <p className="page-subtitle">冻结评分依据、轴贡献与矩阵落点</p>
          </div>
        </header>

        <PageStateView
          state={record.state}
          title="评估记录详情"
          emptyMessage="该记录暂无登记事实"
          onRetry={record.retry}
        >
          {(value) => (
            <>
              <Card title="记录登记">
                <dl>
                  <FieldRow label="记录引用">
                    <VersionRefText reference={value.assessmentRecordRef.reference} />
                  </FieldRow>
                  <FieldRow label="入口模式">
                    <span className="mono">{value.entryMode}</span>
                  </FieldRow>
                  <FieldRow label="准备快照">
                    <VersionRefText reference={value.preparationSnapshotRef.reference} />
                  </FieldRow>
                  <FieldRow label="输入快照">
                    <VersionRefText reference={value.inputSnapshotRef.reference} />
                  </FieldRow>
                  {value.previousAssessmentRecordRef !== undefined && (
                    <FieldRow label="前驱记录">
                      <Link
                        className="mono"
                        to={projectPath(
                          `assessment/records/${value.previousAssessmentRecordRef.reference.entityId}?version=${value.previousAssessmentRecordRef.reference.versionId}`,
                        )}
                      >
                        {value.previousAssessmentRecordRef.reference.entityId}
                      </Link>
                    </FieldRow>
                  )}
                  {value.reassessmentReason !== undefined && (
                    <FieldRow label="重评原因">
                      <span className="mono">{value.reassessmentReason}</span>
                    </FieldRow>
                  )}
                  <FieldRow label="变化引用">
                    {value.changedInputRefs.length === 0 ? (
                      <span className="ar-note">非重评入口，无变化引用集合</span>
                    ) : (
                      <ul className="ar-ref-list">
                        {value.changedInputRefs.map((ref) => (
                          <li key={`${ref.kind}-${ref.reference.entityId}`}>
                            <VersionRefText label={ref.kind} reference={ref.reference} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </FieldRow>
                  <FieldRow label="审计轨迹">
                    <VersionRefText reference={value.auditTrailRef.reference} />
                  </FieldRow>
                </dl>
              </Card>

              <Card title="评分依据（冻结引用）" style={{ marginTop: 16 }}>
                <dl>
                  {Object.entries(value.configurationRefs).map(([key, ref]) => (
                    <FieldRow key={key} label={key}>
                      <VersionRefText reference={ref} />
                    </FieldRow>
                  ))}
                  <FieldRow label="风险矩阵">
                    <VersionRefText reference={value.matrixPlot.riskMatrixRef} />
                  </FieldRow>
                  <FieldRow label="矩阵落点">
                    <span className="mono">
                      {value.matrixPlot.possibilityBandId} × {value.matrixPlot.consequenceBandId} →{" "}
                      {value.matrixPlot.riskLevelId}（序 {value.matrixPlot.riskLevelOrdinal}）
                    </span>
                  </FieldRow>
                </dl>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="可能性轴">
                  <dl>
                    <FieldRow label="策略">
                      <span className="mono">{value.axes.possibility.strategy}</span>
                    </FieldRow>
                    <FieldRow label="原始分">
                      <span className="mono">{value.axes.possibility.score}</span>
                    </FieldRow>
                    <FieldRow label="公开分">
                      <span className="mono">{value.axes.possibility.publicScore.toFixed(4)}</span>
                    </FieldRow>
                    {value.axes.possibility.weightSetRef !== undefined && (
                      <FieldRow label="权重集">
                        <VersionRefText reference={value.axes.possibility.weightSetRef} />
                      </FieldRow>
                    )}
                  </dl>
                </FieldCard>

                <FieldCard title="后果轴">
                  <dl>
                    <FieldRow label="策略">
                      <span className="mono">{value.axes.consequence.strategy}</span>
                    </FieldRow>
                    <FieldRow label="原始分">
                      <span className="mono">{value.axes.consequence.score}</span>
                    </FieldRow>
                    <FieldRow label="公开分">
                      <span className="mono">{value.axes.consequence.publicScore.toFixed(4)}</span>
                    </FieldRow>
                    {value.axes.consequence.weightSetRef !== undefined && (
                      <FieldRow label="权重集">
                        <VersionRefText reference={value.axes.consequence.weightSetRef} />
                      </FieldRow>
                    )}
                  </dl>
                </FieldCard>
              </div>

              <Card title="指标取值与贡献" style={{ marginTop: 16 }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>指标</th>
                      <th>实际值</th>
                      <th>标准化</th>
                      <th>规则</th>
                      <th>等级</th>
                      <th>基础分</th>
                      <th>加权分</th>
                    </tr>
                  </thead>
                  <tbody>
                    {value.indicators.map((indicator) => {
                      const contribution = [
                        ...value.axes.possibility.contributions,
                        ...value.axes.consequence.contributions,
                      ].find((item) => item.indicatorId === indicator.indicatorId);
                      return (
                        <tr key={indicator.indicatorId}>
                          <td className="mono">{indicator.indicatorId}</td>
                          <td className="mono">{JSON.stringify(indicator.actualValue)}</td>
                          <td className="mono">
                            {indicator.canonicalValue}
                            {indicator.canonicalUnit === undefined
                              ? ""
                              : ` ${indicator.canonicalUnit}`}
                          </td>
                          <td className="mono">
                            {indicator.ruleId} · {indicator.ruleVersion.entityId}/
                            {indicator.ruleVersion.versionId}
                          </td>
                          <td className="mono">{indicator.grade}</td>
                          <td className="mono">{indicator.baseScore}</td>
                          <td className="mono">
                            {contribution === undefined ? "—" : contribution.weightedScore}
                            {contribution?.basisPoints === undefined
                              ? ""
                              : `（${contribution.basisPoints} bp）`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>

              <Card title="触发事实" style={{ marginTop: 16 }}>
                {value.triggerFacts.length === 0 ? (
                  <p className="ar-note">该记录未登记触发事实。</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>触发类型</th>
                        <th>指标项</th>
                        <th>阈值</th>
                        <th>联合规则</th>
                        <th>证据条目</th>
                      </tr>
                    </thead>
                    <tbody>
                      {value.triggerFacts.map((fact, index) => (
                        <tr key={`${fact.triggerType}-${fact.indicatorItem}-${index}`}>
                          <td>
                            <StatusTag tone="review">{fact.triggerType}</StatusTag>
                          </td>
                          <td className="mono">{fact.indicatorItem}</td>
                          <td className="mono">
                            {fact.thresholdId === undefined
                              ? "—"
                              : `${fact.thresholdId}=${fact.thresholdValue ?? ""}`}
                          </td>
                          <td className="mono">{fact.jointRuleId ?? "—"}</td>
                          <td className="mono">{fact.evidenceReferences.length}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                <p className="ar-note">
                  阈值解释取该记录冻结的触发事实，不引用当前监测预警阈值配置。
                </p>
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
