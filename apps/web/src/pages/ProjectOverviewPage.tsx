import { useMemo, type ReactNode } from "react";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { KpiCard } from "../components/KpiCard";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery } from "../api/engineering";
import {
  listMonitoringSeries,
  listSourceCatalog,
  readCurrentReleaseSet,
  type MonitoringSeriesPageView,
  type SourceCatalogPageView,
} from "../api/operations";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./project/projectNavigation";
import "./ProjectOverviewPage.css";

const APPLICABILITY_DIMENSIONS = [
  { key: "constructionMethod", label: "施工工法数据" },
  { key: "stratumCondition", label: "地层条件数据" },
  { key: "engineeringStage", label: "工程阶段数据" },
] as const;

interface ReleaseSetFacts {
  readonly definitionType: string;
  readonly releaseId: string;
  readonly releaseVersionId: string;
}

const DEFINITION_TYPE_LABEL: Record<string, string> = {
  "process-model": "工序模型",
  "risk-mechanism": "风险机理库",
  "standard-library": "标准规范库",
  "case-library": "案例库",
  "structured-scoring-rule": "结构化评分规则",
  "applicable-rule-set": "适用规则集",
  "risk-matrix": "风险矩阵",
  "measure-library": "措施库",
};

export default function ProjectOverviewPage() {
  const { selector, state: engineering, reload } = useEngineering();
  // 上下文、资料、监测与知识版本分别取数：任一来源拒权或失败都不抹掉其它区域。
  const sources = usePageQuery<SourceCatalogPageView>(
    (projectId, signal) => listSourceCatalog(projectId, {}, signal),
    [],
  );
  const monitoring = usePageQuery<MonitoringSeriesPageView>(
    (projectId, signal) => listMonitoringSeries(projectId, {}, signal),
    [],
  );
  const releases = usePageQuery<readonly ReleaseSetFacts[]>(
    async (projectId, signal) =>
      (await readCurrentReleaseSet(projectId, signal)).map((member) => ({
        definitionType: member.definitionType,
        releaseId: member.releaseRef.reference.entityId,
        releaseVersionId: member.releaseRef.reference.versionId,
      })),
    [],
  );

  const context = engineering.kind === "ready" ? engineering.value : null;
  const spatialTree = useMemo(() => {
    if (context === null) return [];
    const byParent = new Map<string | null, typeof context.spatialScopes>();
    for (const node of context.spatialScopes) {
      const parent = node.parentSpatialScopeRef?.reference.entityId ?? null;
      const list = byParent.get(parent) ?? [];
      list.push(node);
      byParent.set(parent, list);
    }
    const render = (parent: string | null, depth: number): ReactNode[] =>
      (byParent.get(parent) ?? []).flatMap((node) => [
        <li key={node.spatialScopeRef.reference.entityId}>
          <span className="pjov-tree-order mono">{depth + 1}</span>
          {node.name}
          {node.worksiteLocation !== undefined && (
            <span className="pjov-tree-tag">{node.worksiteLocation}</span>
          )}
          {(byParent.get(node.spatialScopeRef.reference.entityId) ?? []).length > 0 && (
            <ul className="pjov-tree-children">
              {render(node.spatialScopeRef.reference.entityId, depth + 1)}
            </ul>
          )}
        </li>,
      ]);
    return render(null, 0);
  }, [context]);

  return (
    <AppShell
      activeNav="project"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">工程概览</h1>
            <p className="page-subtitle">工程身份、适用性元数据、空间区段与发布集合版本引用</p>
          </div>
          {context !== null && (
            <StatusTag tone={context.contextStatus === "active" ? "success" : "review"}>
              {context.contextStatus === "active" ? "工程已生效" : "上下文准备中"}
            </StatusTag>
          )}
        </header>

        <SectionTabs items={[...PROJECT_NAVIGATION_ITEMS_V1]} />

        {engineering.kind === "idle" && (
          <Card title="工程概览">
            <div className="pjov-guide">
              尚未选择工程。请通过顶栏「选择工程」输入工程标识后查看。
            </div>
          </Card>
        )}
        {engineering.kind === "loading" && (
          <Card title="工程概览">
            <div className="pjov-guide">工程上下文加载中…</div>
          </Card>
        )}
        {engineering.kind === "forbidden" && (
          <Card title="工程概览">
            <div className="pjov-guide">无权访问该工程的上下文信息</div>
          </Card>
        )}
        {engineering.kind === "error" && (
          <Card title="工程概览">
            <div className="pjov-guide">
              工程上下文加载失败（{engineering.error.code}）
              <button type="button" className="pjov-retry" onClick={reload}>
                重试
              </button>
            </div>
          </Card>
        )}

        {context !== null && (
          <>
            <div className="pjov-kpis">
              <KpiCard
                label="适用性缺失维度"
                value={context.missingApplicabilityDimensions.length}
                unit="项"
              />
            </div>

            <Card title="资料概况">
              <PageStateView
                state={sources.state}
                title="资料目录"
                emptyMessage="当前工程尚无登记资料"
                onRetry={sources.retry}
              >
                {(page) => (
                  <p className="pjov-guide">
                    登记资料 {page.totalCount} 份；本页列出 {page.items.length} 份。
                  </p>
                )}
              </PageStateView>
            </Card>

            <Card title="监测概况">
              <PageStateView
                state={monitoring.state}
                title="监测目录"
                emptyMessage="当前工程尚无登记监测序列"
                onRetry={monitoring.retry}
              >
                {(page) => (
                  <p className="pjov-guide">
                    监测序列 {page.totalCount} 条；本页列出 {page.items.length} 条。
                  </p>
                )}
              </PageStateView>
            </Card>

            <Card title="知识版本">
              <PageStateView
                state={releases.state}
                title="知识版本目录"
                emptyMessage="当前工程尚无发布的知识版本"
                onRetry={releases.retry}
              >
                {(value) => (
                  <p className="pjov-guide">
                    发布集合 {value.length} 项；无知识治理权限时此处单独显示，不影响其它区域。
                  </p>
                )}
              </PageStateView>
            </Card>

            <div className="pjov-grid">
              <Card title="工程身份信息">
                <dl className="pjov-meta">
                  <div className="pjov-meta-row">
                    <dt>工程标识</dt>
                    <dd className="mono">{context.projectId}</dd>
                  </div>
                  <div className="pjov-meta-row">
                    <dt>当前工程修订</dt>
                    <dd className="mono">
                      {context.currentProjectRevisionRef === undefined
                        ? "尚未冻结修订"
                        : `${context.currentProjectRevisionRef.reference.entityId}@${context.currentProjectRevisionRef.reference.versionId}`}
                    </dd>
                  </div>
                </dl>

                <div className="pjov-block-label">适用性元数据（三个必含维度）</div>
                <div className="pjov-dims">
                  {APPLICABILITY_DIMENSIONS.map((dimension) => {
                    const missing = context.missingApplicabilityDimensions.includes(
                      dimension.label,
                    );
                    const value =
                      context.applicabilityMetadata === undefined
                        ? undefined
                        : context.applicabilityMetadata[dimension.key];
                    return (
                      <div key={dimension.key} className="pjov-dim">
                        <span className="pjov-dim-label">{dimension.label}</span>
                        {missing || typeof value !== "string" ? (
                          <span className="pjov-dim-value pjov-dim-missing">缺失</span>
                        ) : (
                          <span className="pjov-dim-value">{value}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </Card>

              <div className="pjov-side">
                <Card title="空间区段树">
                  {spatialTree.length === 0 ? (
                    <div className="pjov-guide">当前工程尚无空间区段登记</div>
                  ) : (
                    <ul className="pjov-tree">{spatialTree}</ul>
                  )}
                </Card>

                <PageStateView
                  state={releases.state}
                  title="发布集合版本引用"
                  emptyMessage="当前工程尚无已发布知识版本"
                  onRetry={releases.retry}
                >
                  {(value) => (
                    <Card title="发布集合版本引用">
                      {value.length === 0 ? (
                        <div className="pjov-guide">当前工程尚无已发布知识版本</div>
                      ) : (
                        <ul className="pjov-sets">
                          {value.map((member) => (
                            <li key={member.definitionType} className="pjov-set">
                              <div className="pjov-set-main">
                                <span className="pjov-set-name">
                                  {DEFINITION_TYPE_LABEL[member.definitionType] ??
                                    member.definitionType}
                                </span>
                                <span className="pjov-set-id mono">{member.releaseId}</span>
                              </div>
                              <VersionTag>{member.releaseVersionId}</VersionTag>
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                  )}
                </PageStateView>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
