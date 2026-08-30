import { useParams } from 'react-router-dom'
import AppShell from '../components/AppShell'
import { Card } from '../components/Card'
import { EvidenceLink } from '../components/EvidenceLink'
import { StatusTag } from '../components/StatusTag'
import { VersionTag } from '../components/VersionTag'
import { Icon } from '../components/icons'
import { projectContext } from '../content/context'
import { documentCatalog, evidenceSegments } from '../content/evidence'
import './DocumentDetailPage.css'

export default function DocumentDetailPage() {
  const { docId } = useParams<{ docId: string }>()
  const doc = documentCatalog.find((d) => d.id === docId) ?? documentCatalog[0]
  const segments = evidenceSegments.filter((s) => s.documentId === doc.id)
  const chapters = [...new Set(segments.map((s) => s.chapterPath))]

  return (
    <AppShell activeNav="project" agentContext={[projectContext.project, doc.name]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{doc.name}</h1>
            <p className="page-subtitle">
              资料标识 <span className="mono">{doc.id}</span> · {doc.type}
            </p>
          </div>
          <StatusTag tone="success">{doc.parseStatus}</StatusTag>
        </header>

        <div className="pjdd-grid">
          <Card title="资料元数据">
            <dl className="pjdd-meta">
              <div className="pjdd-meta-row">
                <dt>资料标识</dt>
                <dd className="mono">{doc.id}</dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>资料类型</dt>
                <dd>{doc.type}</dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>版本</dt>
                <dd>
                  <VersionTag>{doc.version}</VersionTag>
                </dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>形成时间</dt>
                <dd className="mono">{doc.formedAt}</dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>来源单位</dt>
                <dd>{doc.sourceUnit}</dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>解析状态</dt>
                <dd>
                  <StatusTag tone="success">{doc.parseStatus}</StatusTag>
                </dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>资料段数</dt>
                <dd className="mono">{doc.segmentCount} 段</dd>
              </div>
              <div className="pjdd-meta-row">
                <dt>已登记详情</dt>
                <dd className="mono">{segments.length} 段</dd>
              </div>
            </dl>
          </Card>

          <Card title="章节结构与资料段" style={{ minWidth: 0 }}>
            {chapters.length === 0 ? (
              <p className="pjdd-empty">暂无逐段登记的资料段详情</p>
            ) : (
              chapters.map((chapter) => (
                <section key={chapter} className="pjdd-chapter">
                  <header className="pjdd-chapter-header">
                    <Icon name="doc" size={14} />
                    <span>{chapter}</span>
                    <span className="pjdd-chapter-count mono">
                      {segments.filter((s) => s.chapterPath === chapter).length} 段
                    </span>
                  </header>
                  <ul className="pjdd-segments">
                    {segments
                      .filter((s) => s.chapterPath === chapter)
                      .map((s) => (
                        <li key={s.segmentId} className="pjdd-segment">
                          <div className="pjdd-segment-head">
                            <EvidenceLink segmentId={s.segmentId} name={s.name} />
                            <StatusTag tone="success">校验通过</StatusTag>
                            <span className="pjdd-segment-page">{s.page}</span>
                          </div>
                          <p className="pjdd-segment-summary">{s.summary}</p>
                        </li>
                      ))}
                  </ul>
                </section>
              ))
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  )
}
