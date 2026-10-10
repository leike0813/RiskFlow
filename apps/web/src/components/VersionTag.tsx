import type { ReactNode } from "react";
import "./VersionTag.css";

/** 版本标签：中性描边，如"规则集 V1.3"，不使用风险色 */
export function VersionTag({ children }: { children: ReactNode }) {
  return <span className="version-tag">{children}</span>;
}
