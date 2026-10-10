import { StatusTag, type StatusTone } from "../components/StatusTag";
import type {
  GovernanceLifecycleStatus,
  GovernanceListItemView,
  GovernanceReleaseView,
  GovernanceRevisionView,
} from "../api/operations";
import { readKnowledgeRelease, readKnowledgeRevision } from "../api/operations";

export const knowledgeTabs = [
  { to: "/knowledge/mechanisms", label: "风险机理库" },
  { to: "/knowledge/rules", label: "评分规则" },
  { to: "/knowledge/matrix", label: "风险矩阵" },
  { to: "/knowledge/measures", label: "措施库" },
];

export const LIFECYCLE_LABEL: Record<GovernanceLifecycleStatus, string> = {
  draft: "草稿",
  "in-review": "待审核",
  published: "已发布",
  deactivated: "已停用",
};

export const LIFECYCLE_TONE: Record<GovernanceLifecycleStatus, StatusTone> = {
  draft: "neutral",
  "in-review": "review",
  published: "success",
  deactivated: "failed",
};

export const LIFECYCLE_FILTERS: {
  value: GovernanceLifecycleStatus | undefined;
  label: string;
}[] = [
  { value: undefined, label: "全部" },
  { value: "draft", label: "草稿" },
  { value: "in-review", label: "待审核" },
  { value: "published", label: "已发布" },
  { value: "deactivated", label: "已停用" },
];

/** 审核状态筛选行（知识四页共用）。 */
export function LifecycleFilters({
  value,
  onChange,
  className,
}: {
  value: GovernanceLifecycleStatus | undefined;
  onChange: (next: GovernanceLifecycleStatus | undefined) => void;
  className: string;
}) {
  return (
    <div className={className}>
      {LIFECYCLE_FILTERS.map((filter) => (
        <button
          key={filter.label}
          type="button"
          className={`kme-filter${value === filter.value ? " kme-filter--active" : ""}`}
          onClick={() => onChange(filter.value)}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}

/** 治理条目精确读取：优先当前发布，否则最新修订；两者皆无返回 null（定义无版本）。 */
export const readGovernanceDetail = async (
  projectId: string,
  item: GovernanceListItemView,
  signal: AbortSignal,
): Promise<GovernanceReleaseView | GovernanceRevisionView | null> => {
  if (item.currentReleaseRef !== undefined) {
    return readKnowledgeRelease(projectId, item.currentReleaseRef, signal);
  }
  if (item.currentRevisionRef !== undefined) {
    return readKnowledgeRevision(projectId, item.currentRevisionRef, signal);
  }
  return null;
};

export const lifecycleStatusOf = (
  detail: GovernanceReleaseView | GovernanceRevisionView,
): GovernanceLifecycleStatus =>
  "releaseRef" in detail
    ? detail.deactivatedAt !== undefined
      ? "deactivated"
      : "published"
    : (detail.revisionStatus as GovernanceLifecycleStatus);

/** 治理状态标签（知识四页共用）。 */
export function LifecycleTag({ status }: { status: GovernanceLifecycleStatus }) {
  return <StatusTag tone={LIFECYCLE_TONE[status]}>{LIFECYCLE_LABEL[status]}</StatusTag>;
}
