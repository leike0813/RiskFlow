import { useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { PageStateView } from '../components/PageStateView'
import { useEngineering, usePageQuery, useProjectPath } from '../api/context'
import {
  readAssessmentRecordCatalog,
  readCurrentReleaseSet,
  readKnowledgeRelease,
  type AssessmentRecordCatalogItemView,
  type RecordCatalogView,
  type ReleaseSetMemberView,
} from '../api/operations'
import {
  RiskMatrixVersionChart,
  type RiskMatrixDefinition,
} from '../charts/RiskMatrixChart'
import { FieldCard, FieldRow, NextPageButton, VersionRefText } from './assessmentResponseShared'
import './assessment-response.css'

/**
 * 矩阵定义直接由版本化风险矩阵发布正文投影：刻度来自两轴分带，等级顺序取登记的 ordinal。
 * 页面不假设 5×5，也不假设等级是四档。可接受区需要另行取得风险可接受阈值正文才可绘制，
 * 本页不据等级顺序推测阈值，因此不渲染该边界。
 */
const definitionOf = (
  release: Awaited<ReturnType<typeof readKnowledgeRelease>>,
): RiskMatrixDefinition | null => {
  if (release.body.definitionType !== 'risk-matrix') return null
  const matrix = release.body.matrix
  const levels = [...matrix.riskLevels].sort((a, b) => a.ordinal - b.ordinal)
  const probabilityTicks = new Map<string, string>()
  const consequenceTicks = new Map<string, string>()
  matrix.possibilityBands.forEach((band, index) => probabilityTicks.set(band.bandId, `P${index + 1}`))
  matrix.consequenceBands.forEach((band, index) => consequenceTicks.set(band.bandId, `C${index + 1}`))
  const cellLevels = matrix.possibilityBands.map((possibilityBand) =>
    matrix.consequenceBands.map((consequenceBand) => {
      const cell = matrix.cells.find(
        (candidate) =>
          candidate.possibilityBandId === possibilityBand.bandId &&
          candidate.consequenceBandId === consequenceBand.bandId,
      )
      return cell?.riskLevelId ?? ''
    }),
  )
  return {
    probability: {
      label: '发生可能性 P',
      ticks: matrix.possibilityBands.map((band) => probabilityTicks.get(band.bandId) ?? band.bandId),
    },
    consequence: {
      label: '后果严重度 C',
      ticks: matrix.consequenceBands.map((band) => consequenceTicks.get(band.bandId) ?? band.bandId),
    },
    levels: levels.map((level) => ({ key: level.levelId, label: `${level.levelId}（序 ${level.ordinal}）` })),
    cellLevels,
    thresholdVersion: release.releaseRef.reference.versionId,
  }
}

/**
 * P-RA-06 P/C 风险矩阵视图（design D-02、D-09）。
 *
 * 矩阵定义取当前生效的风险矩阵发布版本；落点只画当前目录页内已登记的记录，
 * 历史记录仍按各自冻结的矩阵版本在记录页解释，不在图上合并不同版本。
 */
export default function AssessmentMatrixPage() {
  const { selector } = useEngineering()
  const projectPath = useProjectPath()
  const [cursor, setCursor] = useState<string | undefined>(undefined)

  const releases = usePageQuery<ReleaseSetMemberView[]>(
    (projectId, signal) => readCurrentReleaseSet(projectId, signal),
    [],
  )
  const matrixReleaseRef =
    releases.state.kind === 'ready'
      ? (releases.state.value.find((entry) => entry.definitionType === 'risk-matrix')?.releaseRef ?? null)
      : null
  const matrixRelease = usePageQuery(
    (projectId, signal) =>
      matrixReleaseRef === null
        ? Promise.reject(new Error('matrix-release-unavailable'))
        : readKnowledgeRelease(projectId, matrixReleaseRef, signal),
    [matrixReleaseRef?.reference.entityId, matrixReleaseRef?.reference.versionId],
  )
  const records = usePageQuery<RecordCatalogView>(
    (projectId, signal) =>
      readAssessmentRecordCatalog(
        projectId,
        { ...(cursor === undefined ? {} : { cursor }) },
        signal,
      ),
    [cursor],
  )

  const definition =
    matrixRelease.state.kind === 'ready' ? definitionOf(matrixRelease.state.value) : null

  return (
    <AppShell activeNav="assessment" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">P/C 风险矩阵视图</h1>
            <p className="page-subtitle">按当前生效矩阵版本解释当前页内已登记记录的落点</p>
          </div>
        </header>

        <FieldCard title="风险矩阵">
          {matrixRelease.state.kind === 'ready' && definition !== null ? (
            <>
              <RiskMatrixVersionChart
                definition={definition}
                title="P/C 风险矩阵"
                emptyMessage="当前页内暂无已登记落点"
                plots={
                  records.state.kind === 'ready'
                    ? records.state.value.items.map((item) => ({
                        possibilityBandId: item.matrixPlot.possibilityBandId,
                        consequenceBandId: item.matrixPlot.consequenceBandId,
                      }))
                    : []
                }
              />
              <dl style={{ marginTop: 12 }}>
                <FieldRow label="矩阵发布">
                  <VersionRefText reference={matrixRelease.state.value.releaseRef.reference} />
                </FieldRow>
                <FieldRow label="矩阵定义">
                  <VersionRefText reference={matrixRelease.state.value.definitionRef.reference} />
                </FieldRow>
                <FieldRow label="生效时点">
                  <span className="mono">{matrixRelease.state.value.effectiveFrom}</span>
                </FieldRow>
              </dl>
            </>
          ) : (
            <p className="ar-note">
              {matrixRelease.state.kind === 'error'
                ? `当前工程未给出已生效的风险矩阵发布（${matrixRelease.state.code}）。`
                : '正在读取风险矩阵发布版本。'}
            </p>
          )}
        </FieldCard>

        <Card title="落点清单" style={{ marginTop: 16 }}>
          <PageStateView
            state={records.state}
            title="落点清单"
            emptyMessage="当前页内暂无已登记的评估记录"
            onRetry={records.retry}
          >
            {(page) => (
              <>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>评估记录</th>
                      <th>矩阵版本</th>
                      <th>落点</th>
                      <th>风险等级</th>
                      <th>入口模式</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((item) => {
                      const record: AssessmentRecordCatalogItemView = item
                      return (
                        <tr key={record.assessmentRecordRef.reference.entityId}>
                          <td>
                            <Link
                              className="mono"
                              to={projectPath(
                                `assessment/records/${record.assessmentRecordRef.reference.entityId}?version=${record.assessmentRecordRef.reference.versionId}`,
                              )}
                            >
                              {record.assessmentRecordRef.reference.entityId}
                            </Link>
                          </td>
                          <td className="mono">
                            {record.matrixPlot.riskMatrixRef.entityId} · {record.matrixPlot.riskMatrixRef.versionId}
                          </td>
                          <td className="mono">
                            {record.matrixPlot.possibilityBandId} × {record.matrixPlot.consequenceBandId}
                          </td>
                          <td className="mono">
                            {record.matrixPlot.riskLevelId}（序 {record.matrixPlot.riskLevelOrdinal}）
                          </td>
                          <td className="mono">{record.entryMode}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                <NextPageButton nextCursor={page.nextCursor} onContinue={setCursor} />
                <p className="ar-note">
                  图上只画当前页内记录的落点；历史记录若冻结的是其它矩阵版本，仍在记录页按其自身版本解释。
                </p>
              </>
            )}
          </PageStateView>
        </Card>
      </div>
    </AppShell>
  )
}
