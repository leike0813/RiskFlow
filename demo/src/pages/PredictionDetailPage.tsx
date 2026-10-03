import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { PageStateView } from '../components/PageStateView'
import { StatusTag } from '../components/StatusTag'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readEffectForecast,
  readWarningResponseResolve,
  type ForecastView,
  type KindRef,
  type WarningResponseResolveView,
} from '../api/operations'
import { FieldCard, FieldRow, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * P-RS-03 效果预测详情（design D-02、D-05）。
 *
 * 可用性由登记事实给出：`unavailable` 只呈现原因码，页面不补预测值、不伪造趋势曲线。
 * 方法、步长、目标指标与冻结依据都取该预测登记的引用。
 */
export default function PredictionDetailPage() {
  const { predictionId } = useParams<{ predictionId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const version = searchParams.get('version')

  const forecastRef: KindRef | null =
    predictionId === undefined
      ? null
      : { kind: 'effect-forecast', reference: { entityId: predictionId, versionId: version ?? '' } }

  const forecast = usePageQuery<ForecastView>(
    (projectId, signal) =>
      forecastRef === null
        ? Promise.reject(new Error('missing forecast'))
        : readEffectForecast(projectId, forecastRef, signal),
    [predictionId, version],
  )

  const resolve = usePageQuery<WarningResponseResolveView>(
    (projectId, signal) =>
      predictionId === undefined
        ? Promise.reject(new Error('missing forecast'))
        : readWarningResponseResolve(
            projectId,
            { entityId: predictionId, targetKind: 'forecast', ...(version === null ? {} : { versionId: version }) },
            signal,
          ),
    [predictionId, version],
  )

  useEffect(() => {
    if (version !== null || resolve.state.kind !== 'ready') return
    const ref = resolve.state.value.refs[0]
    if (ref === undefined) return
    const next = new URLSearchParams(searchParams)
    next.set('version', ref.reference.versionId)
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolve.state, version])

  return (
    <AppShell activeNav="warnings" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">效果预测</h1>
            <p className="page-subtitle">预测方法、冻结依据与可用性</p>
          </div>
        </header>

        <PageStateView
          state={forecast.state}
          title="预测详情"
          emptyMessage="该预测暂无登记事实"
          onRetry={forecast.retry}
        >
          {(value) => (
            <>
              <Card title="预测登记">
                <dl>
                  <FieldRow label="预测引用">
                    <VersionRefText reference={value.effectForecastRef.reference} />
                  </FieldRow>
                  <FieldRow label="关联建议">
                    <Link
                      className="mono"
                      to={projectPath(
                        `response/recommendations/${value.recommendationRef.reference.entityId}?version=${value.recommendationRef.reference.versionId}`,
                      )}
                    >
                      {value.recommendationRef.reference.entityId}
                    </Link>
                  </FieldRow>
                  <FieldRow label="路由决定">
                    <VersionRefText reference={value.routeDecisionRef.reference} />
                  </FieldRow>
                  <FieldRow label="预测运行">
                    <VersionRefText reference={value.runRef.reference} />
                  </FieldRow>
                  <FieldRow label="输入快照">
                    <VersionRefText reference={value.inputSnapshotRef.reference} />
                  </FieldRow>
                  <FieldRow label="冻结评估依据">
                    <VersionRefText reference={value.frozenAssessmentBasisRef.reference} />
                  </FieldRow>
                  <FieldRow label="执行前监测快照">
                    <VersionRefText reference={value.preActionMonitoringSnapshotRef.reference} />
                  </FieldRow>
                  <FieldRow label="基准评估记录">
                    <VersionRefText reference={value.baselineAssessmentRecordRef.reference} />
                  </FieldRow>
                  <FieldRow label="预测策略">
                    <VersionRefText reference={value.forecastPolicyRef.reference} />
                  </FieldRow>
                </dl>
              </Card>

              <div className="ar-two-col" style={{ marginTop: 16 }}>
                <FieldCard title="预测方法">
                  <dl>
                    <FieldRow label="方法">
                      <span className="mono">{value.method}</span>
                    </FieldRow>
                    <FieldRow label="目标指标">
                      <span className="mono">{value.targetIndicatorId}</span>
                    </FieldRow>
                    <FieldRow label="单位">
                      <span className="mono">{value.unit}</span>
                    </FieldRow>
                    <FieldRow label="预测步长">
                      <span className="mono">{value.horizonSteps}</span>
                    </FieldRow>
                  </dl>
                </FieldCard>

                <FieldCard title="预测结果">
                  {value.availability.kind === 'available' ? (
                    <dl>
                      <FieldRow label="可用性">
                        <StatusTag tone="success">已给出预测值</StatusTag>
                      </FieldRow>
                      <FieldRow label="预测取值">
                        <span className="mono">{JSON.stringify(value.availability.predictedValue)}</span>
                      </FieldRow>
                      {value.availability.predictedRiskState !== undefined && (
                        <>
                          <FieldRow label="预测 P">
                            <span className="mono">
                              {value.availability.predictedRiskState.likelihoodScore}
                            </span>
                          </FieldRow>
                          <FieldRow label="预测 C">
                            <span className="mono">
                              {value.availability.predictedRiskState.consequenceScore}
                            </span>
                          </FieldRow>
                          <FieldRow label="预测风险等级">
                            <span className="mono">
                              {value.availability.predictedRiskState.riskLevel}
                            </span>
                          </FieldRow>
                        </>
                      )}
                    </dl>
                  ) : (
                    <dl>
                      <FieldRow label="可用性">
                        <StatusTag tone="review">不可用（{value.availability.reasonCode}）</StatusTag>
                      </FieldRow>
                    </dl>
                  )}
                  <p className="ar-note">
                    不可用时页面只呈现原因码，不补预测值、不绘制趋势曲线。
                  </p>
                </FieldCard>
              </div>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
