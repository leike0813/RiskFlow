import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { EvidenceLink } from '../components/EvidenceLink'
import { Icon } from '../components/icons'
import { PageStateView } from '../components/PageStateView'
import { useEngineering, usePageQuery } from '../api/context'
import {
  readCurrentReleaseSet,
  readKnowledgeRelease,
  type GovernanceReleaseView,
} from '../api/operations'
import './ProcessModelPage.css'

const tabs = [
  { to: '/identification', label: '识别任务' },
  { to: '/identification/records', label: '风险记录' },
  { to: '/identification/graph', label: '关联图谱' },
  { to: '/identification/process-model', label: '工序模型' },
]

/** 五个必含工序节点（最小覆盖集 RI-S31）：按工序种类枚举核对发布模型覆盖。 */
const REQUIRED_PROCESS_KINDS = [
  '扩径准备',
  '变径空间扩挖',
  '刀盘扩径',
  '盾体扩径',
  '缩径转换',
] as const

interface ProcessModelFacts {
  readonly release: GovernanceReleaseView | null
}

export default function ProcessModelPage() {
  const { selector } = useEngineering()
  const { state, retry } = usePageQuery<ProcessModelFacts>(async (projectId, signal) => {
    const releaseSet = await readCurrentReleaseSet(projectId, signal)
    const processModel = releaseSet.find((member) => member.definitionType === 'process-model')
    if (processModel === undefined) return { release: null }
    const release = await readKnowledgeRelease(projectId, processModel.releaseRef, signal)
    return { release }
  }, [])

  return (
    <AppShell
      activeNav="identification"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">项目工序模型</h1>
            <p className="page-subtitle">查看站隧一体化施工工序模型及其依赖关系</p>
          </div>
        </header>
        <SectionTabs items={tabs} />

        <PageStateView
          state={state}
          title="工序模型"
          emptyMessage="当前工程尚无已发布工序模型"
          onRetry={retry}
        >
          {({ release }) =>
            release === null || release.body.definitionType !== 'process-model' ? (
              <Card title="工序模型">
                <div className="pm-empty">
                  当前工程无已发布工序模型版本（治理空态），模型发布后此处呈现节点与依赖关系。
                </div>
              </Card>
            ) : (
              <ProcessModelBody release={release} />
            )
          }
        </PageStateView>
      </div>
    </AppShell>
  )
}

function ProcessModelBody({ release }: { release: GovernanceReleaseView }) {
  if (release.body.definitionType !== 'process-model') return null
  const { nodes, dependencyEdges } = release.body
  const coveredKinds = new Set(nodes.map((node) => node.processKind))
  const equipment = [...new Set(nodes.flatMap((node) => node.equipmentRefs))]
  const structural = [...new Set(nodes.flatMap((node) => node.structuralComponentRefs))]
  const edgeGroups = new Map<string, typeof dependencyEdges>()
  for (const edge of dependencyEdges) {
    const list = edgeGroups.get(edge.relationType) ?? []
    list.push(edge)
    edgeGroups.set(edge.relationType, list)
  }

  return (
    <>
      <div className="pm-header-tags">
        <VersionTag>
          工序模型发布 {release.releaseRef.reference.entityId}@
          {release.releaseRef.reference.versionId}
        </VersionTag>
        {release.deactivatedAt !== undefined && <StatusTag tone="failed">已停用</StatusTag>}
      </div>

      <Card
        title="工序节点流程"
        extra={
          <span>
            必含五节点覆盖：
            {REQUIRED_PROCESS_KINDS.every((kind) => coveredKinds.has(kind))
              ? '全部覆盖'
              : `缺 ${REQUIRED_PROCESS_KINDS.filter((kind) => !coveredKinds.has(kind)).join('、')}`}
          </span>
        }
      >
        <div className="pm-flow">
          {nodes.map((node, index) => (
            <div key={node.nodeId} className="pm-flow-item">
              {index > 0 && (
                <span className="pm-arrow">
                  <Icon name="arrowRight" size={18} />
                </span>
              )}
              <div className="pm-node">
                <div className="pm-node-head">
                  <span className="pm-node-order">{index + 1}</span>
                  <span className="pm-node-name">{node.processKind}</span>
                </div>
                <div className="pm-node-io mono">{node.nodeId}</div>
                <div className="pm-node-io">输入：{node.inputs.join('、')}</div>
                <div className="pm-node-io">输出：{node.outputs.join('、')}</div>
                <div className="pm-node-params">
                  {node.stateParameters.map((parameter) => (
                    <span key={parameter} className="pm-chip">
                      {parameter}
                    </span>
                  ))}
                </div>
                <div className="pm-node-evidence">
                  {node.evidence.map((reference) => (
                    <EvidenceLink
                      key={reference.sourceSegmentId}
                      segmentId={reference.sourceSegmentId}
                      sourceVersionRef={reference.sourceVersionRef}
                      referencedBy={node.nodeId}
                    />
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="pm-bottom">
        <Card title="装备部件与构件">
          <div className="pm-group-label">装备部件</div>
          <div className="pm-chips">
            {equipment.map((item) => (
              <span key={item} className="pm-chip pm-chip--equip">
                {item}
              </span>
            ))}
            {equipment.length === 0 && <span className="pm-chip">无登记</span>}
          </div>
          <div className="pm-group-label">构件</div>
          <div className="pm-chips">
            {structural.map((item) => (
              <span key={item} className="pm-chip pm-chip--part">
                {item}
              </span>
            ))}
            {structural.length === 0 && <span className="pm-chip">无登记</span>}
          </div>
        </Card>

        <Card title="依赖关系">
          {edgeGroups.size === 0 ? (
            <div className="pm-empty">已发布模型未登记依赖边</div>
          ) : (
            <ul className="pm-deps">
              {[...edgeGroups.entries()].map(([relationType, edges]) => (
                <li key={relationType} className="pm-dep">
                  <span className="pm-dep-name">{relationType}</span>
                  <span className="pm-dep-desc">
                    {edges
                      .map((edge) => `${edge.fromNodeId} → ${edge.toNodeId}`)
                      .join('；')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}
