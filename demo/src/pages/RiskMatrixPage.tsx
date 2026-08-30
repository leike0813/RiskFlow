import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { RiskBadge } from '../components/RiskBadge'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { RiskMatrix5x5 } from '../charts/RiskMatrix5x5'
import {
  assessmentRecord,
  assessmentVersions,
  matrixHighlight,
  riskMatrixGrid,
} from '../content/assessment'
import type { RiskLevel } from '../content/risks'
import './RiskMatrixPage.css'

const knowledgeTabs = [
  { to: '/knowledge/mechanisms', label: '风险机理库' },
  { to: '/knowledge/rules', label: '评分规则' },
  { to: '/knowledge/matrix', label: '风险矩阵' },
  { to: '/knowledge/measures', label: '措施库' },
]

const levels: RiskLevel[] = ['I', 'II', 'III', 'IV']

export default function RiskMatrixPage() {
  const matrix = assessmentVersions.riskMatrix

  return (
    <AppShell activeNav="knowledge" agentContext={[`${matrix.name} ${matrix.version}`]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险矩阵</h1>
            <p className="page-subtitle">查看风险矩阵版本与分级区间</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <div className="kmx-layout">
          <Card title={matrix.name} extra={<VersionTag>矩阵 {matrix.version}</VersionTag>}>
            <RiskMatrix5x5 grid={riskMatrixGrid} highlight={matrixHighlight} height={520} />
            <p className="kmx-caption">
              高亮格为风险评估记录 {assessmentRecord.id} 的落点（P{matrixHighlight.p} / C
              {matrixHighlight.c}）
            </p>
          </Card>

          <div className="kmx-side">
            <Card title="版本列表">
              <div className="kmx-version-row">
                <div className="kmx-version-main">
                  <span className="mono">{matrix.id}</span>
                  <span className="kmx-version-name">{matrix.name}</span>
                </div>
                <div className="kmx-version-tags">
                  <StatusTag tone="success">已发布</StatusTag>
                  <VersionTag>{matrix.version}</VersionTag>
                </div>
              </div>
              <p className="kmx-note">
                矩阵发布后不可原地修改；回滚通过重新启用历史版本完成，历史评估记录仍引用其评估时使用的矩阵版本。
              </p>
            </Card>

            <Card title="分级图例">
              <div className="kmx-legend">
                {levels.map((lv) => (
                  <RiskBadge key={lv} level={lv} />
                ))}
              </div>
              <p className="kmx-note">
                I 级为最高风险等级，IV 级为最低；风险等级由发生可能性分值 P 与后果严重性分值 C 经矩阵映射确定。
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
