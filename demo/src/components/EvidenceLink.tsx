import { Icon } from './icons'
import { useEvidence } from './EvidenceDrawer'
import './EvidenceLink.css'

/** 证据引用入口：文档图标 + 等宽资料段标识 + 名称，点击打开证据抽屉 */
export function EvidenceLink({ segmentId, name }: { segmentId: string; name?: string }) {
  const { openEvidence } = useEvidence()
  return (
    <button
      type="button"
      className="evidence-link"
      onClick={() => openEvidence(segmentId)}
      title="查看证据定位"
    >
      <Icon name="doc" size={14} />
      <span className="evidence-link-id mono">{segmentId}</span>
      {name && <span className="evidence-link-name">{name}</span>}
    </button>
  )
}
