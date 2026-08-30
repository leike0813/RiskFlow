import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { KpiCard } from '../components/KpiCard'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { processNodes, projectContext } from '../content/context'
import { documentCatalog, monitoringSeries } from '../content/evidence'
import { applicableRuleSet } from '../content/knowledge'
import { assessmentVersions } from '../content/assessment'
import './ProjectOverviewPage.css'

const sectionTabs = [
  { to: '/project', label: '工程概览' },
  { to: '/project/documents', label: '资料目录' },
  { to: '/project/monitoring/SRC-MON-003', label: '监测数据' },
]

const applicabilityDimensions = [
  { label: '施工工法数据', value: projectContext.constructionMethod },
  { label: '地层条件数据', value: projectContext.stratumCondition },
  { label: '工程阶段数据', value: projectContext.engineeringStage },
]

export default function ProjectOverviewPage() {
  const segmentTotal = documentCatalog.reduce((sum, d) => sum + d.segmentCount, 0)
  const sourceUnits = [...new Set(documentCatalog.map((d) => d.sourceUnit))]
  const publishedSets = [
    assessmentVersions.applicableRuleSet,
    assessmentVersions.quantStandard,
    assessmentVersions.riskMatrix,
  ]

  return (
    <AppShell
      activeNav="project"
      agentContext={[projectContext.project, projectContext.section]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">工程概览</h1>
            <p className="page-subtitle">
              工程身份、适用性元数据、空间区段与发布集合版本引用
            </p>
          </div>
          <StatusTag tone="success">工程已生效</StatusTag>
        </header>

        <SectionTabs items={sectionTabs} />

        <div className="pjov-kpis">
          <KpiCard label="登记资料" value={documentCatalog.length} unit="份" />
          <KpiCard label="资料段合计" value={segmentTotal} unit="段" />
          <KpiCard label="监测序列" value={monitoringSeries.length} unit="条" />
          <KpiCard label="发布集合" value={publishedSets.length} unit="项" />
        </div>

        <div className="pjov-grid">
          <Card title="工程身份信息">
            <dl className="pjov-meta">
              <div className="pjov-meta-row">
                <dt>工程名称</dt>
                <dd>{projectContext.project}</dd>
              </div>
              <div className="pjov-meta-row">
                <dt>当前区段</dt>
                <dd>{projectContext.section}</dd>
              </div>
              <div className="pjov-meta-row">
                <dt>当前工序</dt>
                <dd>{projectContext.process}</dd>
              </div>
              <div className="pjov-meta-row">
                <dt>数据时点</dt>
                <dd className="mono">{projectContext.dataTimestamp}</dd>
              </div>
            </dl>

            <div className="pjov-block-label">适用性元数据（三个必含维度）</div>
            <div className="pjov-dims">
              {applicabilityDimensions.map((d) => (
                <div key={d.label} className="pjov-dim">
                  <span className="pjov-dim-label">{d.label}</span>
                  <span className="pjov-dim-value">{d.value}</span>
                </div>
              ))}
            </div>

            <div className="pjov-block-label">参与单位</div>
            <div className="pjov-units">
              {sourceUnits.map((u) => (
                <span key={u} className="pjov-unit">
                  {u}
                </span>
              ))}
            </div>
          </Card>

          <div className="pjov-side">
            <Card title="空间区段树">
              <ul className="pjov-tree">
                <li className="pjov-tree-project">{projectContext.project}</li>
                <li>
                  <div className="pjov-tree-section">
                    {projectContext.section}
                    <span className="pjov-tree-tag">当前区段</span>
                  </div>
                  <ul className="pjov-tree-children">
                    {processNodes.map((n) => (
                      <li
                        key={n.id}
                        className={
                          n.name === projectContext.process ? 'pjov-tree-current' : undefined
                        }
                      >
                        <span className="pjov-tree-order mono">{n.order}</span>
                        {n.name}
                        {n.name === projectContext.process && (
                          <span className="pjov-tree-tag">当前工序</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              </ul>
            </Card>

            <Card title="发布集合版本引用">
              <ul className="pjov-sets">
                {publishedSets.map((s) => (
                  <li key={s.id} className="pjov-set">
                    <div className="pjov-set-main">
                      <span className="pjov-set-name">{s.name}</span>
                      <span className="pjov-set-id mono">{s.id}</span>
                    </div>
                    <VersionTag>{s.version}</VersionTag>
                  </li>
                ))}
              </ul>
              <p className="pjov-set-note">
                适用规则集 {applicableRuleSet.version} 于 {applicableRuleSet.publishedAt}{' '}
                发布，状态：{applicableRuleSet.status}
              </p>
            </Card>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
