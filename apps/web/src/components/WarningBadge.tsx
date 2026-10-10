import { Icon } from "./icons";
import "./WarningBadge.css";

/** 预警状态标签：图标 + "红色预警 · 待处置"，与风险等级标签分开 */
export function WarningBadge({ text = "红色预警 · 待处置" }: { text?: string }) {
  return (
    <span className="warning-badge">
      <Icon name="alert" size={14} />
      {text}
    </span>
  );
}
