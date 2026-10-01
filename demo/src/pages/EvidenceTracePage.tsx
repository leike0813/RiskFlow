import type { ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { EvidenceLink } from '../components/EvidenceLink'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { VersionTag } from '../components/VersionTag'
import { ApiError } from '../api/client'
import { usePageQuery, useProjectPath } from '../api/context'
import {
  listRiskRecords,
  locateSegmentSources,
  readRiskRecord,
  readTraceChainLinks,
  type KindRef,
  type RiskRecordDetailView,
  type TraceLinkItemView,
  type VersionRef,
} from '../api/operations'
import './EvidenceTracePage.css'

const reviewTabs = [
  { to: '/review', label: '复核队列' },
  { to: '/review/trace', label: '证据追溯' },
  { to: '/review/runs', label: '运行记录' },
]

interface TracePageData {
  readonly detail: RiskRecordDetailView
  readonly links: TraceLinkItemView[]
  /** 资料段标识 → 来源版本引用：可证明时证据入口走真实 evidence-access 查询。 */
  readonly evidenceSources: ReadonlyMap<string, VersionRef>
}

type TraceQueryResult = { readonly kind: 'no-subject' } | { readonly kind: 'data'; readonly data: TracePageData }

/** 下游链对象：按链关系取另一端的指定种类引用；投影未返回时保持缺席。 */
const downstreamRef = (
  links: readonly TraceLinkItemView[],
  relation: string,
  kind: string,
): KindRef | undefined => {
  for (const link of links) {
    if (link.relation !== relation) continue
    if (link.toRef.kind === kind) return link.toRef
    if (link.fromRef.kind === kind) return link.fromRef
  }
  return undefined
}

interface ChainNode {
  readonly order: number
  readonly kind: string
  readonly absent?: string
  readonly content?: ReactNode
}

export default function EvidenceTracePage() {
  const [searchParams] = useSearchParams()
  const projectPath = useProjectPath()
  const subject = searchParams.get('subject')

  const { state, retry } = usePageQuery<TraceQueryResult>(
    async (projectId, signal) => {
      if (subject === null) return { kind: 'no-subject' }
      // subject 只有实体标识：先经记录目录解析精确版本引用，再并行读取记录正文与追溯链边。
      const catalog = await listRiskRecords(projectId, {}, signal)
      const item = catalog.items.find(
        (entry) => entry.riskRecordRef.reference.entityId === subject,
      )
      if (item === undefined) throw new ApiError('NOT_FOUND')
      const [detail, links] = await Promise.all([
        readRiskRecord(projectId, item.riskRecordRef, signal),
        readTraceChainLinks(projectId, item.riskRecordRef, signal),
      ])
      const evidenceSources = await locateSegmentSources(projectId, detail.sourceSegmentIds, signal)
      return { kind: 'data', data: { detail, links, evidenceSources } }
    },
    [subject],
  )

  return (
    <AppShell activeNav="review" agentContext={subject === null ? [] : [subject]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">证据追溯</h1>
            <p className="page-subtitle">
              端到端固定追溯链：资料段标识 → 工序节点 → 风险机理条目 → 标准化风险记录 →
              风险评估记录 → 预警信息 → 处置建议 → 偏差/校准
            </p>
          </div>
        </header>

        <SectionTabs items={reviewTabs} />

        <PageStateView
          state={state}
          title="证据追溯"
          emptyMessage="未找到该追溯主体"
          forbiddenHint="追溯主体不存在，或当前角色不具备追溯投影的读取权限"
          onRetry={retry}
        >
          {(result) => {
            if (result.kind === 'no-subject') {
              return (
                <Card title="证据追溯">
                  <div className="et-intro">
                    未指定追溯主体。请在风险记录详情页点击「查看端到端追溯链」，或在地址栏携带
                    <span className="mono"> ?subject=&lt;记录标识&gt;</span> 后访问。
                  </div>
                </Card>
              )
            }
            const { detail, links, evidenceSources } = result.data
            const recordRef = detail.riskRecordRef
            const recordEntityId = recordRef.reference.entityId
            const assessmentRef = downstreamRef(links, 'risk-assessment', 'risk-assessment-record')
            const warningRef = downstreamRef(links, 'assessment-warning', 'warning-record')
            const recommendationRef = downstreamRef(
              links,
              'warning-recommendation',
              'response-recommendation',
            )
            const deviationRef = downstreamRef(links, 'feedback-deviation', 'deviation-record')
            const calibrationRef = downstreamRef(
              links,
              'deviation-calibration',
              'calibration-suggestion',
            )

            const refNode = (
              kind: string,
              ref: KindRef | undefined,
            ): Pick<ChainNode, 'absent' | 'content'> =>
              ref === undefined
                ? { absent: '投影暂无该环节事实' }
                : {
                    content: (
                      <>
                        <div className="et-head">
                          <span className="et-kind">{kind}</span>
                          <span className="et-id mono">{ref.reference.entityId}</span>
                          <VersionTag>{ref.reference.versionId}</VersionTag>
                        </div>
                        <div className="et-name">该对象详情页属评估/处置域，当前仅呈现标识</div>
                      </>
                    ),
                  }

            const nodes: ChainNode[] = [
              {
                order: 1,
                kind: '资料段标识',
                content: (
                  <>
                    <div className="et-head">
                      <span className="et-kind">资料段标识</span>
                    </div>
                    <div className="et-name">
                      {detail.sourceSegmentIds.map((segmentId) => {
                        const sourceVersionRef = evidenceSources.get(segmentId)
                        return (
                          <span key={segmentId} className="et-evidence">
                            {sourceVersionRef === undefined ? (
                              <span className="mono">{segmentId}（来源版本不可证明，仅呈现定位摘要）</span>
                            ) : (
                              <EvidenceLink
                                segmentId={segmentId}
                                sourceVersionRef={sourceVersionRef}
                                referencedBy={recordEntityId}
                              />
                            )}
                          </span>
                        )
                      })}
                    </div>
                  </>
                ),
              },
              {
                order: 2,
                kind: '工序节点',
                content: (
                  <>
                    <div className="et-head">
                      <span className="et-kind">工序节点</span>
                      <span className="et-id mono">{detail.record.processNodeId}</span>
                    </div>
                    <Link
                      className="et-name et-jump"
                      to={projectPath('/identification/process-model')}
                    >
                      查看工序模型
                    </Link>
                  </>
                ),
              },
              {
                order: 3,
                kind: '风险机理条目',
                content: (
                  <>
                    <div className="et-head">
                      <span className="et-kind">风险机理条目</span>
                      {detail.riskMechanismEntryIds.map((entryId) => (
                        <span key={entryId} className="et-id mono">
                          {entryId}
                        </span>
                      ))}
                    </div>
                    <Link className="et-name et-jump" to={projectPath('/knowledge/mechanisms')}>
                      查看机理库
                    </Link>
                  </>
                ),
              },
              {
                order: 4,
                kind: '标准化风险记录',
                content: (
                  <>
                    <div className="et-head">
                      <span className="et-kind">标准化风险记录</span>
                      <span className="et-id mono">{recordEntityId}</span>
                      <VersionTag>{recordRef.reference.versionId}</VersionTag>
                    </div>
                    <div className="et-name">{detail.record.riskEvent}</div>
                    <Link
                      className="et-name et-jump"
                      to={projectPath(`/identification/records/${encodeURIComponent(recordEntityId)}`)}
                    >
                      查看记录详情
                    </Link>
                  </>
                ),
              },
              { order: 5, kind: '风险评估记录', ...refNode('风险评估记录', assessmentRef) },
              { order: 6, kind: '预警信息', ...refNode('预警信息', warningRef) },
              { order: 7, kind: '处置建议', ...refNode('处置建议', recommendationRef) },
              {
                order: 8,
                kind: '偏差/校准',
                ...(deviationRef === undefined && calibrationRef === undefined
                  ? { absent: '投影暂无该环节事实' }
                  : {
                      content: (
                        <>
                          <div className="et-head">
                            <span className="et-kind">偏差/校准</span>
                          </div>
                          <div className="et-name">
                            {deviationRef !== undefined && (
                              <span className="mono et-evidence">
                                偏差 {deviationRef.reference.entityId}
                              </span>
                            )}
                            {calibrationRef !== undefined && (
                              <span className="mono et-evidence">
                                校准 {calibrationRef.reference.entityId}
                              </span>
                            )}
                          </div>
                        </>
                      ),
                    }),
              },
            ]

            return (
              <>
                <div className="et-intro">
                  该链以 <span className="mono">{recordEntityId}</span>{' '}
                  为主体串联固定追溯链：上游节点事实来自记录读取，下游环节来自 trace-chain
                  投影的可证明链边；投影未返回的环节按缺席如实呈现。资料段节点可就地打开证据定位。
                </div>
                <div className="et-chain">
                  {nodes.map((node, index) => (
                    <div key={node.order}>
                      {index > 0 && <div className="et-connector" />}
                      <div className={`et-node${node.absent !== undefined ? ' et-node--absent' : ''}`}>
                        <div className="et-order">{node.order}</div>
                        <div className="et-main">
                          {node.absent !== undefined ? (
                            <>
                              <div className="et-head">
                                <span className="et-kind">{node.kind}</span>
                              </div>
                              <div className="et-name">{node.absent}</div>
                            </>
                          ) : (
                            node.content
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )
          }}
        </PageStateView>
      </div>
    </AppShell>
  )
}
