import { Icon } from "./icons";
import { useEvidence, type EvidenceTarget } from "./EvidenceDrawer";
import "./EvidenceLink.css";

/** 证据引用入口：文档图标 + 等宽资料段标识 + 名称，点击打开证据抽屉 */
export function EvidenceLink({
  segmentId,
  name,
  sourceVersionRef,
  referencedBy,
}: {
  segmentId: string;
  name?: string;
  /** 提供后经真实 evidence-access 查询呈现定位；缺省为旧静态原型路径（C33–C35 域）。 */
  sourceVersionRef?: EvidenceTarget["sourceVersionRef"];
  referencedBy?: string;
}) {
  const { openEvidence } = useEvidence();
  return (
    <button
      type="button"
      className="evidence-link"
      onClick={() =>
        openEvidence({
          segmentId,
          ...(name === undefined ? {} : { name }),
          ...(sourceVersionRef === undefined ? {} : { sourceVersionRef }),
          ...(referencedBy === undefined ? {} : { referencedBy }),
        })
      }
      title="查看证据定位"
    >
      <Icon name="doc" size={14} />
      <span className="evidence-link-id mono">{segmentId}</span>
      {name && <span className="evidence-link-name">{name}</span>}
    </button>
  );
}
