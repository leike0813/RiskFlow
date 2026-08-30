import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { EvidenceLink } from '../components/EvidenceLink'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag, type StatusTone } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { applicableRuleSet, scoringRules, type ScoringRule } from '../content/knowledge'
import './RuleSetsPage.css'

const knowledgeTabs = [
  { to: '/knowledge/mechanisms', label: '风险机理库' },
  { to: '/knowledge/rules', label: '评分规则' },
  { to: '/knowledge/matrix', label: '风险矩阵' },
  { to: '/knowledge/measures', label: '措施库' },
]

const statusTone = (status: string): StatusTone =>
  status === '已发布' ? 'success' : status === '待审核' ? 'review' : 'neutral'

const columns: DataTableColumn[] = [
  {
    key: 'ruleId',
    title: '规则标识',
    width: 160,
    render: (row) => <span className="mono">{(row as unknown as ScoringRule).ruleId}</span>,
  },
  { key: 'indicatorItem', title: '指标项', width: 150 },
  {
    key: 'scoringThresholds',
    title: '评分阈值',
    render: (row) => (
      <span className="krs-thresholds">{(row as unknown as ScoringRule).scoringThresholds}</span>
    ),
  },
  { key: 'gradeIntervals', title: '分级区间', width: 130 },
  {
    key: 'exceptionClauses',
    title: '例外条款摘要',
    width: 220,
    render: (row) => (row as unknown as ScoringRule).exceptionClauses,
  },
  {
    key: 'reviewStatus',
    title: '审核状态',
    width: 100,
    render: (row) => {
      const r = row as unknown as ScoringRule
      return <StatusTag tone={statusTone(r.reviewStatus)}>{r.reviewStatus}</StatusTag>
    },
  },
  {
    key: 'evidenceLocator',
    title: '证据',
    width: 230,
    render: (row) => (
      <EvidenceLink segmentId={(row as unknown as ScoringRule).evidenceLocator} />
    ),
  },
]

export default function RuleSetsPage() {
  const members = applicableRuleSet.memberRuleIds
    .map((id) => scoringRules.find((r) => r.ruleId === id))
    .filter((r): r is ScoringRule => Boolean(r))

  return (
    <AppShell activeNav="knowledge" agentContext={[`${applicableRuleSet.id} ${applicableRuleSet.version}`]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">评分规则</h1>
            <p className="page-subtitle">管理结构化评分规则与适用规则集版本</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <Card
          title={`适用规则集 ${applicableRuleSet.id} · ${applicableRuleSet.name}`}
          extra={
            <>
              <StatusTag tone={statusTone(applicableRuleSet.status)}>{applicableRuleSet.status}</StatusTag>
              <VersionTag>规则集 {applicableRuleSet.version}</VersionTag>
            </>
          }
          style={{ marginBottom: 16 }}
        >
          <div className="krs-ruleset-grid">
            <div className="krs-field">
              <div className="krs-field-label">生成时间</div>
              <div className="krs-field-value mono">{applicableRuleSet.publishedAt}</div>
            </div>
            <div className="krs-field">
              <div className="krs-field-label">适用性元数据快照</div>
              <div className="krs-tags">
                {applicableRuleSet.metadataSnapshot.map((m) => (
                  <span key={m} className="krs-tag">{m}</span>
                ))}
              </div>
            </div>
            <div className="krs-field">
              <div className="krs-field-label">成员规则版本清单（发布时冻结）</div>
              <div className="krs-member-list">
                {members.map((r) => (
                  <span key={r.ruleId} className="krs-member">
                    <span className="mono">{r.ruleId}</span>
                    <VersionTag>{r.ruleVersion}</VersionTag>
                  </span>
                ))}
              </div>
            </div>
            <div className="krs-field">
              <div className="krs-field-label">冲突检测结果</div>
              <div className="krs-conflict">
                <StatusTag tone="success">无冲突</StatusTag>
                <span className="krs-conflict-note">
                  一致性校验未发现成员规则之间存在冲突或覆盖重叠
                </span>
              </div>
            </div>
          </div>
        </Card>

        <Card title="成员规则" extra={`来源：${scoringRules[0].source}`}>
          <DataTable
            columns={columns}
            rows={scoringRules as unknown as Record<string, unknown>[]}
          />
        </Card>
      </div>
    </AppShell>
  )
}
