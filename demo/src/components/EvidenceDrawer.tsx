import { evidenceSegments, type EvidenceSegment } from '../content/evidence'
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { Icon } from './icons'
import './EvidenceDrawer.css'

interface EvidenceContextValue {
  openEvidence: (segmentId: string) => void
  closeEvidence: () => void
  current: EvidenceSegment | null
}

const EvidenceContext = createContext<EvidenceContextValue | null>(null)

/** 在任何"证据定位信息"入口内使用：打开右侧证据抽屉 */
export function useEvidence(): EvidenceContextValue {
  const ctx = useContext(EvidenceContext)
  if (!ctx) throw new Error('useEvidence 必须在 EvidenceProvider 内使用')
  return ctx
}

/**
 * 证据抽屉 Provider（AppShell 内挂载）。
 * 展示资料段详情：所属资料、版本、章节路径、页码、片段摘要、被引用对象列表。
 */
export function EvidenceProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<EvidenceSegment | null>(null)

  const openEvidence = useCallback((segmentId: string) => {
    const seg = evidenceSegments.find((s) => s.segmentId === segmentId) ?? null
    setCurrent(
      seg ?? {
        segmentId,
        name: '资料段',
        documentId: '',
        documentName: '未登记资料',
        documentType: '',
        version: '',
        chapterPath: '',
        page: '',
        summary: '该资料段尚未在资料目录中登记详情。',
        referencedBy: [],
      },
    )
  }, [])

  const closeEvidence = useCallback(() => setCurrent(null), [])

  const value = useMemo(
    () => ({ openEvidence, closeEvidence, current }),
    [openEvidence, closeEvidence, current],
  )

  return (
    <EvidenceContext.Provider value={value}>
      {children}
      {current && (
        <aside className="evidence-drawer">
          <header className="evidence-drawer-header">
            <span className="evidence-drawer-title">
              <Icon name="doc" size={16} />
              证据定位
            </span>
            <button
              type="button"
              className="evidence-drawer-close"
              onClick={closeEvidence}
              aria-label="关闭证据抽屉"
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className="evidence-drawer-body">
            <div className="evidence-field">
              <div className="evidence-field-label">资料段标识</div>
              <div className="evidence-field-value mono">{current.segmentId}</div>
            </div>
            <div className="evidence-field">
              <div className="evidence-field-label">所属资料</div>
              <div className="evidence-field-value">
                {current.documentName}
                {current.version && <span className="evidence-dim"> · {current.version}</span>}
              </div>
            </div>
            {current.documentType && (
              <div className="evidence-field">
                <div className="evidence-field-label">资料类型</div>
                <div className="evidence-field-value">{current.documentType}</div>
              </div>
            )}
            {current.chapterPath && (
              <div className="evidence-field">
                <div className="evidence-field-label">章节路径</div>
                <div className="evidence-field-value">{current.chapterPath}</div>
              </div>
            )}
            {current.page && (
              <div className="evidence-field">
                <div className="evidence-field-label">页码</div>
                <div className="evidence-field-value">{current.page}</div>
              </div>
            )}
            <div className="evidence-field">
              <div className="evidence-field-label">片段摘要</div>
              <div className="evidence-field-value">{current.summary}</div>
            </div>
            {current.referencedBy.length > 0 && (
              <div className="evidence-field">
                <div className="evidence-field-label">被引用对象</div>
                <div className="evidence-refs">
                  {current.referencedBy.map((r) => (
                    <span key={r} className="evidence-ref mono">
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>
      )}
    </EvidenceContext.Provider>
  )
}
