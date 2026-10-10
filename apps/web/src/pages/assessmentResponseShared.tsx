/**
 * 评估与处置域共享界面件（design D-02、D-06、D-07）。
 *
 * 共享规则：引用一律呈现 entityId · versionId；写动作一律取精确读的 `actions` 门控；
 * 关系集合各自续页，不在页面上合并或穷尽；页面不推导领域结论。
 */
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { actionAvailability, type ReadActionView } from "../api/operations";

/**
 * 表格边界取行：DataTable 的行类型是弱记录，解码后的条目已由 operations 校验过形状，
 * 这里只在渲染处重新收窄一次，不在渲染里做形状假设。
 */
export const tableRow = <T,>(row: Record<string, unknown>): T => row as unknown as T;

/** 版本引用：等宽呈现 entityId · versionId，快照语义一眼可辨。 */
export function VersionRefText({
  label,
  reference,
}: {
  label?: string;
  reference: { readonly entityId: string; readonly versionId: string };
}) {
  return (
    <span className="ar-ref">
      {label === undefined ? null : <span className="ar-ref-kind">{label}</span>}
      <span className="mono">
        {reference.entityId} · {reference.versionId}
      </span>
    </span>
  );
}

/** 可深链的引用：点击进入带精确 version 的目标页，不丢版本。 */
export function RefLink({
  to,
  reference,
}: {
  to: (reference: { readonly entityId: string; readonly versionId: string }) => string;
  reference: { readonly entityId: string; readonly versionId: string };
}) {
  return (
    <Link className="mono" to={to(reference)}>
      {reference.entityId}
    </Link>
  );
}

/**
 * 写动作门控：`allowed` 渲染传入的控件；`hidden` 完全不渲染；
 * `denied` 与 `business-unavailable` 说明原因后不渲染可提交控件。
 */
export function ActionGate({
  actions,
  branch,
  children,
  deniedReason = "当前角色无该操作权限",
}: {
  actions: readonly ReadActionView[];
  branch: string;
  children: (availability: "allowed") => ReactNode;
  deniedReason?: string;
}) {
  const availability = actionAvailability(actions, branch);
  if (availability === null || availability === "hidden") return null;
  if (availability !== "allowed") {
    return (
      <span className="ar-gated" data-action-availability={availability}>
        {deniedReason}
      </span>
    );
  }
  return <>{children("allowed")}</>;
}

/** 字段分组：标签 + 值列表，值由调用方按所属事实给出。 */
export function FieldCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="ar-card">
      <h3 className="ar-card-title">{title}</h3>
      <div className="ar-card-body">{children}</div>
    </section>
  );
}

export function FieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ar-field-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * 有界续页：只在服务端给出 nextCursor 时出现，点击原样回传游标。
 * 页面不自行拼接偏移，也不在循环里读尽目录。
 */
export function NextPageButton({
  nextCursor,
  onContinue,
  label = "续页",
}: {
  nextCursor?: string | undefined;
  onContinue: (cursor: string) => void;
  label?: string;
}) {
  if (nextCursor === undefined) return null;
  return (
    <div className="ar-next-page">
      <button type="button" className="ar-chip" onClick={() => onContinue(nextCursor)}>
        {label}
      </button>
    </div>
  );
}

/** 状态文案与色调映射：文案按登记取值本身给出，不套用原型固定等级。 */
export const stateTone = (
  value: string,
): "success" | "running" | "review" | "failed" | "neutral" => {
  if (
    value === "completed" ||
    value === "approved" ||
    value === "adopted" ||
    value === "acknowledged"
  ) {
    return "success";
  }
  if (value === "running" || value === "in-progress") return "running";
  if (
    value === "pending" ||
    value === "pending-review" ||
    value === "waiting" ||
    value === "returned"
  ) {
    return "review";
  }
  if (value === "failed" || value === "retryable" || value === "rejected" || value === "declined") {
    return "failed";
  }
  return "neutral";
};
