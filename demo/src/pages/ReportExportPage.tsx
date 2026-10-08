import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { DataTable, type DataTableColumn } from '../components/DataTable'
import { PageStateView } from '../components/PageStateView'
import { SectionTabs } from '../components/SectionTabs'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { useEngineering, usePageQuery, type PageState } from '../api/context'
import {
  downloadReportArtifact,
  readReportHistory,
  readReportPolicies,
  readReportPreview,
  type KindRef,
  type ReportHistoryItemView,
  type ReportPolicyView,
} from '../api/agentAuditOperations'
import './ReportExportPage.css'

/** 导出范围由 C31 登记的 queryResultRef 固定：三个参数齐备才发起范围预览。 */
const queryResultRefFrom = (params: URLSearchParams): KindRef | undefined => {
  const kind = params.get('sourceKind')
  const entityId = params.get('sourceId')
  const versionId = params.get('sourceVersion')
  if (kind === null || entityId === null || versionId === null) return undefined
  return { kind, reference: { entityId, versionId } }
}

interface ReportData {
  readonly policies: readonly ReportPolicyView[]
  readonly history: readonly ReportHistoryItemView[]
  readonly historyCursor?: string
}

/** 报告面只有四种只读查询：策略、范围预览、导出历史与工件读取，页面不新造导出命令。 */
const useReportData = (): {
  readonly state: PageState<ReportData> | { readonly kind: 'idle' }
  readonly retry: () => void
} =>
  usePageQuery<ReportData>(async (projectId, signal) => {
    const policies = await readReportPolicies(projectId, signal)
    const history = await readReportHistory(projectId, {}, signal)
    return {
      policies,
      history: history.items,
      ...(history.nextCursor === undefined ? {} : { historyCursor: history.nextCursor }),
    }
  }, [])

/**
 * 页面自己创建的对象 URL 只在下一次下载或离开页面时释放：紧跟点击立即撤销会中断浏览器取文件。
 * read 层创建的对象 URL 由 read 层在用后立即撤销，两侧句柄都不长期留存。
 */
const useReleasableObjectUrl = () => {
  const pending = useRef<string | null>(null)
  const release = () => {
    if (pending.current === null) return
    URL.revokeObjectURL(pending.current)
    pending.current = null
  }
  useEffect(() => release, [])
  return {
    hold: (url: string) => {
      release()
      pending.current = url
    },
    release,
  }
}

export default function ReportExportPage() {
  const { selector } = useEngineering()
  const [searchParams] = useSearchParams()
  const sourceRef = queryResultRefFrom(searchParams)
  const [policyIndex, setPolicyIndex] = useState(0)
  const [previewState, setPreviewState] = useState<
    | { readonly kind: 'idle' }
    | { readonly kind: 'loading' }
    | { readonly kind: 'ready'; readonly itemCount: number; readonly queryType: string; readonly source: KindRef; readonly hasNext: boolean }
    | { readonly kind: 'error'; readonly code: string }
  >({ kind: 'idle' })
  const [downloaded, setDownloaded] = useState<{ readonly fileName: string; readonly byteLength: number } | null>(null)
  const [downloadFailure, setDownloadFailure] = useState<string | null>(null)
  const [busyEntityId, setBusyEntityId] = useState<string | null>(null)
  const objectUrl = useReleasableObjectUrl()
  const { state, retry } = useReportData()

  const policies = state.kind === 'ready' ? state.value.policies : []
  const policy = policies.length === 0 ? undefined : policies[Math.min(policyIndex, policies.length - 1)]

  const preview = async () => {
    if (selector.projectId === null || policy === undefined || sourceRef === undefined) return
    setPreviewState({ kind: 'loading' })
    try {
      const result = await readReportPreview(selector.projectId, {
        queryResultRef: sourceRef,
        exportPolicyRef: policy.policyRef,
      })
      setPreviewState({
        kind: 'ready',
        itemCount: result.itemCount,
        queryType: result.queryType,
        source: result.sourceRef,
        hasNext: result.nextCursor !== undefined,
      })
    } catch (error) {
      setPreviewState({ kind: 'error', code: error instanceof Error ? error.message : 'TERMINAL_FAILURE' })
    }
  }

  /** 真实 JSON 下载：正文与文件名都取自服务端工件读；两侧对象 URL 用后释放。 */
  const download = async (artifactRef: KindRef) => {
    const projectId = selector.projectId
    if (projectId === null) return
    setBusyEntityId(artifactRef.reference.entityId)
    setDownloadFailure(null)
    try {
      const artifact = await downloadReportArtifact(projectId, artifactRef)
      try {
        const url = URL.createObjectURL(new Blob([artifact.json], { type: 'application/json' }))
        objectUrl.hold(url)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = artifact.fileName
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setDownloaded({ fileName: artifact.fileName, byteLength: artifact.byteLength })
      } finally {
        artifact.revoke()
      }
    } catch (error) {
      setDownloadFailure(error instanceof Error ? error.message : 'TERMINAL_FAILURE')
    } finally {
      setBusyEntityId(null)
    }
  }

  const historyColumns: DataTableColumn[] = [
    {
      key: 'exportArtifactRef',
      title: '导出工件',
      width: 280,
      render: (row) => {
        const item = row as unknown as ReportHistoryItemView
        return (
          <span className="rv-cell-stack">
            <span className="mono">{item.exportArtifactRef.reference.entityId}</span>
            <VersionTag>{item.exportArtifactRef.reference.versionId}</VersionTag>
          </span>
        )
      },
    },
    {
      key: 'sourceRef',
      title: '来源引用',
      render: (row) => {
        const item = row as unknown as ReportHistoryItemView
        return (
          <span className="rv-cell-stack">
            <span className="mono">{item.sourceRef.reference.entityId}</span>
            <span className="au-note-inline">
              {item.sourceRef.kind} · {item.sourceRef.reference.versionId}
            </span>
          </span>
        )
      },
    },
    {
      key: 'recordedAt',
      title: '登记时间',
      width: 200,
      render: (row) => (
        <span className="mono">
          {String((row as unknown as ReportHistoryItemView).recordedAt).replace('T', ' ')}
        </span>
      ),
    },
    {
      key: 'download',
      title: '下载',
      width: 120,
      render: (row) => {
        const item = row as unknown as ReportHistoryItemView
        const busy = busyEntityId === item.exportArtifactRef.reference.entityId
        return (
          <button
            type="button"
            className="au-btn"
            disabled={busy}
            onClick={() => void download(item.exportArtifactRef)}
          >
            {busy ? '下载中…' : '下载 JSON'}
          </button>
        )
      },
    },
  ]

  return (
    <AppShell activeNav="review" agentContext={selector.projectId === null ? [] : [selector.projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">报告导出</h1>
            <p className="page-subtitle">
              导出策略、范围与工件由服务端登记；页面只下载已登记的 JSON 工件，不重算分值或风险统计
            </p>
          </div>
        </header>

        <SectionTabs
          items={[
            { to: '/review', label: '复核队列' },
            { to: '/review/audit', label: '审计日志' },
            { to: '/report/export', label: '报告导出' },
          ]}
        />

        <PageStateView
          state={state}
          title="报告导出"
          emptyMessage="当前工程暂无已登记的导出策略"
          forbiddenHint="当前角色不具备报告导出面的读取权限"
          onRetry={retry}
        >
          {(data) => (
            <div className="au-stack">
              <section className="au-card" aria-label="导出策略">
                <h3>导出策略</h3>
                {data.policies.length === 0 ? (
                  <div className="rv-muted">
                    服务端未配置报告导出策略，本轮不提供任何导出；不展示示例策略，也不代填默认策略。
                  </div>
                ) : (
                  <>
                    <table className="au-table">
                      <caption className="au-caption">已登记导出策略</caption>
                      <thead>
                        <tr>
                          <th scope="col">策略引用</th>
                          <th scope="col">查询类型</th>
                          <th scope="col">章节</th>
                          <th scope="col">页 / 条 / 字节上限</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.policies.map((item, index) => (
                          <tr
                            key={item.policyRef.entityId}
                            className={index === policyIndex ? 'au-row-active' : undefined}
                          >
                            <td>
                              <label>
                                <input
                                  type="radio"
                                  name="export-policy"
                                  checked={index === policyIndex}
                                  onChange={() => {
                                    setPolicyIndex(index)
                                    setPreviewState({ kind: 'idle' })
                                  }}
                                />{' '}
                                <span className="mono">{item.policyRef.entityId}</span>{' '}
                                <VersionTag>{item.policyRef.versionId}</VersionTag>
                              </label>
                            </td>
                            <td className="mono">{item.queryTypes.join('、') || '—'}</td>
                            <td>{item.sections.join('、') || '—'}</td>
                            <td className="mono">
                              {item.maxPages} / {item.maxItems} / {item.maxBytes}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="au-note">
                      上限为技术资源上限，不含评分、矩阵或阈值规则；章节只能取自已配置策略。
                    </p>
                  </>
                )}
              </section>

              <section className="au-card" aria-label="导出范围预览">
                <h3>导出范围预览</h3>
                {sourceRef === undefined ? (
                  <div className="rv-muted">
                    未指定已登记的查询结果引用，范围预览不可发起。请携带
                    <span className="mono"> ?sourceKind=&lt;种类&gt;&amp;sourceId=&lt;标识&gt;&amp;sourceVersion=&lt;版本&gt;</span>
                    后访问。
                  </div>
                ) : policy === undefined ? (
                  <div className="rv-muted">未选定导出策略，范围预览不可发起。</div>
                ) : (
                  <>
                    <p className="au-note">
                      范围来源 <span className="mono">{sourceRef.kind} {sourceRef.reference.entityId} · {sourceRef.reference.versionId}</span>
                      {' '}· 策略 <span className="mono">{policy.policyRef.entityId} · {policy.policyRef.versionId}</span>
                    </p>
                    <div className="au-actions">
                      <button
                        type="button"
                        className="au-btn au-btn-primary"
                        onClick={() => void preview()}
                        disabled={previewState.kind === 'loading'}
                      >
                        {previewState.kind === 'loading' ? '预览中…' : '预览已登记范围'}
                      </button>
                    </div>
                    {previewState.kind === 'ready' && (
                      <dl className="rv-field-grid">
                        <div className="rv-field">
                          <dt>来源引用</dt>
                          <dd className="mono">
                            {previewState.source.kind} {previewState.source.reference.entityId}
                          </dd>
                        </div>
                        <div className="rv-field">
                          <dt>查询类型</dt>
                          <dd className="mono">{previewState.queryType}</dd>
                        </div>
                        <div className="rv-field">
                          <dt>本页条目数</dt>
                          <dd className="mono">{previewState.itemCount}</dd>
                        </div>
                        <div className="rv-field">
                          <dt>后续页</dt>
                          <dd className={previewState.hasNext ? undefined : 'rv-muted'}>
                            {previewState.hasNext ? '存在续页，页面不扫完整工程' : '已读尽登记范围'}
                          </dd>
                        </div>
                      </dl>
                    )}
                    {previewState.kind === 'error' && (
                      <p className="rv-fail">范围预览失败（{previewState.code}）。</p>
                    )}
                    <p className="au-note">
                      预览只呈现登记范围与条目数；缺席项按原样保留，页面不重读领域正文，也不重新计算 P/C。
                    </p>
                  </>
                )}
              </section>

              <section className="au-card" aria-label="导出历史与下载">
                <h3>导出历史与下载</h3>
                {data.history.length === 0 ? (
                  <div className="rv-muted">当前工程暂无已登记的导出工件。</div>
                ) : (
                  <DataTable columns={historyColumns} rows={data.history.map((item) => ({ ...item }))} />
                )}
                {data.historyCursor !== undefined && (
                  <p className="au-note">导出历史按游标分页，当前呈现第一页。</p>
                )}
                {downloaded !== null && (
                  <p className="au-note">
                    已下载 <span className="mono">{downloaded.fileName}</span>（{downloaded.byteLength} 字节，文件名由服务端给定）
                  </p>
                )}
                {downloadFailure !== null && (
                  <p className="rv-fail">导出工件读取失败（{downloadFailure}），可重试下载。</p>
                )}
                <p className="au-note">
                  下载为服务端已登记 JSON 工件的原样落地，缺席事实保留在正文中；页面不提供浏览器打印或重新生成。
                </p>
              </section>

              <section className="au-card" aria-label="报告内容边界">
                <h3>报告内容边界</h3>
                <ul className="au-list">
                  <li>导出正文只包含服务端登记的投影条目与引用，不含页面推导的风险统计。</li>
                  <li>章节范围以策略配置为准；未登记章节不补写、不折叠为空标题。</li>
                  <li>每条缺席事实按原样保留，便于第三方据工件重放导出时点。</li>
                </ul>
                <StatusTag tone="neutral">JSON</StatusTag>
              </section>
            </div>
          )}
        </PageStateView>
      </div>
    </AppShell>
  )
}
