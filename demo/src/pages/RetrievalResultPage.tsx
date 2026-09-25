import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { DataTable } from '../components/DataTable'
import { EvidenceLink } from '../components/EvidenceLink'
import { VersionTag } from '../components/VersionTag'
import { ApiError } from '../api/client'
import { useEngineering, type PageState } from '../api/context'
import {
  readRetrievalResult,
  type RetrievalResultView,
} from '../api/operations'
import './RetrievalResultPage.css'

const SOURCE_KIND_LABEL: Record<string, string> = {
  'risk-mechanism': '风险机理库',
  'standard-library': '标准规范库',
  'case-library': '案例库',
}

/**
 * 检索结果查看页：只作为深链目标，按 URL 中的精确 knowledgeQueryResultRef 呈现已登记
 * 检索事实；不提供自由文本检索或任何发起检索的入口。
 */
export default function RetrievalResultPage() {
  const { selector } = useEngineering()
  const [searchParams] = useSearchParams()
  const resultEntityId = searchParams.get('result')
  const resultVersionId = searchParams.get('version')
  const [state, setState] = useState<PageState<RetrievalResultView>>({ kind: 'loading' })

  useEffect(() => {
    if (selector.projectId === null || resultEntityId === null || resultVersionId === null) {
      setState({ kind: 'empty', message: '未指定检索结果引用' })
      return
    }
    const projectId = selector.projectId
    const controller = new AbortController()
    setState({ kind: 'loading' })
    readRetrievalResult(
      projectId,
      {
        kind: 'knowledge-query-result',
        reference: { entityId: resultEntityId, versionId: resultVersionId },
      },
      controller.signal,
    )
      .then((value) => setState({ kind: 'ready', value }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        if (
          error instanceof ApiError &&
          (error.code === 'NOT_FOUND' || error.code === 'AUTHENTICATION_REQUIRED')
        ) {
          setState({ kind: 'forbidden' })
          return
        }
        setState({
          kind: 'error',
          code: error instanceof ApiError ? error.code : 'TERMINAL_FAILURE',
          retryable: error instanceof ApiError ? error.retryable : false,
        })
      })
    return () => controller.abort()
  }, [selector.projectId, resultEntityId, resultVersionId])

  return (
    <AppShell activeNav="knowledge">
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">检索结果</div>
            <div className="page-subtitle">
              已登记检索事实的只读呈现，按精确结果引用重建
            </div>
          </div>
        </div>

        {state.kind === 'loading' && <Card title="检索结果">加载中…</Card>}
        {state.kind === 'empty' && (
          <Card title="检索结果">
            <div className="rr-empty">{state.message}</div>
          </Card>
        )}
        {state.kind === 'forbidden' && (
          <Card title="检索结果">
            <div className="rr-empty">无权访问该检索结果，或结果引用不存在</div>
          </Card>
        )}
        {state.kind === 'error' && (
          <Card title="检索结果">
            <div className="rr-empty">检索结果读取失败（{state.code}），请稍后重试</div>
          </Card>
        )}

        {state.kind === 'ready' && state.value.kind === 'hybrid-evidence' && (
          <>
            <Card
              title="混合检索命中"
              extra={
                <VersionTag>
                  策略 {state.value.policyRef.entityId}@{state.value.policyRef.versionId}
                </VersionTag>
              }
            >
              <DataTable
                columns={[
                  { key: 'rank', title: '名次', width: 56, align: 'center' },
                  { key: 'sourceEntryId', title: '条目标识' },
                  {
                    key: 'sourceKind',
                    title: '来源库',
                    render: (row) =>
                      SOURCE_KIND_LABEL[String(row.sourceKind)] ?? String(row.sourceKind),
                  },
                  {
                    key: 'fusionScore',
                    title: '融合得分',
                    align: 'right',
                    render: (row) => Number(row.fusionScore).toFixed(4),
                  },
                  {
                    key: 'denseContribution',
                    title: '向量贡献',
                    align: 'right',
                    render: (row) => Number(row.denseContribution).toFixed(4),
                  },
                  {
                    key: 'bm25Contribution',
                    title: 'BM25 贡献',
                    align: 'right',
                    render: (row) => Number(row.bm25Contribution).toFixed(4),
                  },
                ]}
                rows={state.value.hits.map((hit) => ({ ...hit }))}
              />
              <div className="rr-note">
                排序信号为 RRF 融合名次与分值，不是风险置信度，不参与 P/C、矩阵与预警判定。
              </div>
            </Card>
          </>
        )}

        {state.kind === 'ready' && state.value.kind === 'relationship-context' && (
          <>
            <Card
              title={`当前工序节点：${state.value.nodeId}`}
              extra={
                <VersionTag>
                  工序模型发布 {state.value.releaseBinding.processModelReleaseRef.reference.entityId}
                </VersionTag>
              }
            >
              <RelationshipNode node={state.value.currentNode} />
            </Card>
            <Card title="邻接工序节点">
              {state.value.neighborNodes.length === 0 ? (
                <div className="rr-empty">无邻接节点</div>
              ) : (
                <DataTable
                  columns={[
                    { key: 'nodeId', title: '节点标识' },
                    { key: 'processKind', title: '工序' },
                    { key: 'edgeId', title: '边标识' },
                    { key: 'relationType', title: '关系类型' },
                    {
                      key: 'upstream',
                      title: '方向',
                      render: (row) => (row.upstream === true ? '上游' : '下游'),
                    },
                  ]}
                  rows={state.value.neighborNodes.map((node) => ({ ...node }))}
                />
              )}
            </Card>
            <Card title="入选机理条目">
              {state.value.mechanisms.length === 0 ? (
                <div className="rr-empty">无入选机理条目</div>
              ) : (
                <DataTable
                  columns={[
                    { key: 'mechanismId', title: '机理标识' },
                    { key: 'mechanismType', title: '机理类型' },
                  ]}
                  rows={state.value.mechanisms.map((mechanism) => ({ ...mechanism }))}
                />
              )}
            </Card>
            <Card title="筛除机理条目">
              {state.value.excludedMechanisms.length === 0 ? (
                <div className="rr-empty">无筛除条目</div>
              ) : (
                <DataTable
                  columns={[
                    { key: 'mechanismId', title: '机理标识' },
                    { key: 'reasonCode', title: '筛除原因码' },
                  ]}
                  rows={state.value.excludedMechanisms.map((excluded) => ({ ...excluded }))}
                />
              )}
            </Card>
          </>
        )}
      </div>
    </AppShell>
  )
}

/** 关系上下文当前节点：只呈现契约字段，证据入口走 EvidenceLink。 */
function RelationshipNode({ node }: { node: Record<string, unknown> }) {
  const evidence = Array.isArray(node.evidence) ? node.evidence : []
  return (
    <dl className="rr-node">
      <dt>工序</dt>
      <dd>{String(node.processKind ?? '')}</dd>
      <dt>输入</dt>
      <dd>{Array.isArray(node.inputs) ? node.inputs.join('、') : ''}</dd>
      <dt>输出</dt>
      <dd>{Array.isArray(node.outputs) ? node.outputs.join('、') : ''}</dd>
      <dt>状态参数</dt>
      <dd>{Array.isArray(node.stateParameters) ? node.stateParameters.join('、') : ''}</dd>
      <dt>监测指标</dt>
      <dd>{Array.isArray(node.monitoringIndicators) ? node.monitoringIndicators.join('、') : ''}</dd>
      <dt>证据定位</dt>
      <dd>
        {evidence.map((item, index) => {
          const locator =
            typeof item === 'object' && item !== null
              ? (item as { locator?: { sourceSegmentId?: unknown } }).locator
              : undefined
          const segmentId =
            locator !== undefined && typeof locator.sourceSegmentId === 'string'
              ? locator.sourceSegmentId
              : null
          return segmentId === null ? null : (
            <EvidenceLink key={index} segmentId={segmentId} />
          )
        })}
      </dd>
    </dl>
  )
}
