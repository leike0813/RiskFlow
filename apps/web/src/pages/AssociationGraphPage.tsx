import { clientError } from "../api/client";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { GraphLegend } from "../components/GraphLegend";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { GraphView } from "../charts/GraphView";
import { usePageQuery, useProjectPath } from "../api/engineering";
import {
  listRiskRecords,
  readAssociationGraphLinks,
  type KindRef,
  type RiskRecordCatalogPageView,
  type TraceLinkItemView,
} from "../api/operations";
import { identificationTabs } from "./identificationShared";
import "./AssociationGraphPage.css";

/** 链边端点种类 → 图节点分类；未识别种类兜底「其他」（GraphView 有兜底配色）。 */
const KIND_CATEGORY: Record<string, string> = {
  "standardized-risk-record": "风险事件",
  "risk-assessment-record": "评估记录",
  "warning-record": "预警信息",
  "response-recommendation": "处置建议",
  "deviation-record": "偏差记录",
  "calibration-suggestion": "校准建议",
  "workflow-run": "运行",
  "stage-result": "阶段结果",
  "source-version": "资料证据",
};

/** 已知对象种类的深链目标；未识别种类只呈现标识，不编造链接。 */
const NODE_DEEP_LINKS: Record<string, (entityId: string) => string> = {
  "standardized-risk-record": (entityId) =>
    `/identification/records/${encodeURIComponent(entityId)}`,
};

type GraphResult =
  | { readonly kind: "no-subject" }
  | { readonly kind: "graph"; readonly subject: KindRef; readonly links: TraceLinkItemView[] };

const refNodeId = (ref: KindRef) => `${ref.kind}:${ref.reference.entityId}`;

/** 关联图区：以 ?subject=<记录标识> 为聚焦主体读取可证明链边；失败闭合，不降级为裁切图。 */
function GraphSection({ subject }: { subject: string | null }) {
  const projectPath = useProjectPath();
  const { state, retry } = usePageQuery<GraphResult>(
    async (projectId, signal) => {
      if (subject === null) return { kind: "no-subject" };
      // subject 只有实体标识：先经记录目录解析精确版本引用，再读取关联图投影。
      const catalog = await listRiskRecords(projectId, {}, signal);
      const item = catalog.items.find(
        (entry) => entry.riskRecordRef.reference.entityId === subject,
      );
      if (item === undefined) throw clientError("NOT_FOUND");
      const links = await readAssociationGraphLinks(projectId, item.riskRecordRef, signal);
      return { kind: "graph", subject: item.riskRecordRef, links };
    },
    [subject],
  );

  return (
    <PageStateView
      state={state}
      title="关联图谱"
      emptyMessage="暂无可证明的关联边"
      forbiddenHint="暂无可证明的关联边，或当前角色不具备投影读取权限"
      onRetry={retry}
    >
      {(result) => {
        if (result.kind === "no-subject") {
          return (
            <Card title="关联图谱">
              <p className="graph-hint">
                在下方「按工序分组的风险记录」中选择一条记录，以其为主体聚焦关联图。
              </p>
            </Card>
          );
        }
        const nodeById = new Map<string, { id: string; name: string; category: string }>();
        const edges: { source: string; target: string; label?: string }[] = [];
        for (const link of result.links) {
          for (const ref of [link.fromRef, link.toRef]) {
            const id = refNodeId(ref);
            if (!nodeById.has(id)) {
              nodeById.set(id, {
                id,
                name: ref.reference.entityId,
                category: KIND_CATEGORY[ref.kind] ?? "其他",
              });
            }
          }
          edges.push({
            source: refNodeId(link.fromRef),
            target: refNodeId(link.toRef),
            label: link.relation,
          });
        }
        const nodes = [...nodeById.values()];
        const categories = [...new Set(nodes.map((node) => node.category))];
        return (
          <Card title="关联图谱" extra={<GraphLegend categories={categories} />}>
            <p className="graph-hint">
              主体 <span className="mono">{result.subject.reference.entityId}</span>{" "}
              的可证明关联边；节点可拖动、滚轮缩放。边与节点全部来自投影返回的链边，未证明的不呈现。
            </p>
            <GraphView nodes={nodes} edges={edges} height={480} />
            <ul className="graph-node-links">
              {nodes.map((node) => {
                const [kind, ...rest] = node.id.split(":");
                const entityId = rest.join(":");
                // 未登记的节点类型没有深链：呈现为纯文本条目，不构造错误链接。
                const deepLink = kind === undefined ? undefined : NODE_DEEP_LINKS[kind];
                return (
                  <li key={node.id}>
                    <span className="graph-node-kind">{node.category}</span>
                    {deepLink === undefined ? (
                      <span className="mono">{entityId}</span>
                    ) : (
                      <Link className="mono" to={projectPath(deepLink(entityId))}>
                        {entityId}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        );
      }}
    </PageStateView>
  );
}

/** 按工序分组的风险记录（降级视图）：来自记录目录查询，独立于图投影。 */
function RecordGroupsSection({ onFocus }: { onFocus: (entityId: string) => void }) {
  const projectPath = useProjectPath();
  const { state, retry } = usePageQuery<RiskRecordCatalogPageView>(
    (projectId, signal) => listRiskRecords(projectId, {}, signal),
    [],
  );

  return (
    <PageStateView
      state={state}
      title="按工序分组的风险记录"
      emptyMessage="当前工程暂无风险记录"
      forbiddenHint="当前角色不具备风险记录的读取权限"
      onRetry={retry}
    >
      {(page) => {
        const groups = new Map<string, typeof page.items>();
        for (const item of page.items) {
          const list = groups.get(item.processNodeId) ?? [];
          list.push(item);
          groups.set(item.processNodeId, list);
        }
        return (
          <Card title="按工序分组的风险记录" extra={<span>选择记录以聚焦其关联图</span>}>
            {page.items.length === 0 ? (
              <div className="graph-hint">当前工程暂无风险记录</div>
            ) : (
              <div className="graph-groups">
                {[...groups.entries()].map(([processNodeId, records]) => (
                  <div key={processNodeId} className="graph-group">
                    <div className="graph-group-head">
                      <span className="graph-group-name mono">{processNodeId}</span>
                      <span className="graph-group-count mono">{records.length}</span>
                    </div>
                    <ul className="graph-group-events">
                      {records.map((record) => {
                        const entityId = record.riskRecordRef.reference.entityId;
                        return (
                          <li key={entityId}>
                            <button
                              type="button"
                              className="graph-focus-btn"
                              onClick={() => onFocus(entityId)}
                            >
                              {record.riskEventSummary}
                            </button>
                            <Link
                              className="mono graph-event-id"
                              to={projectPath(
                                `/identification/records/${encodeURIComponent(entityId)}`,
                              )}
                            >
                              {entityId}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {page.nextCursor !== undefined && (
              <div className="graph-hint">结果按游标分页，当前呈现第一页</div>
            )}
          </Card>
        );
      }}
    </PageStateView>
  );
}

export default function AssociationGraphPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = useProjectPath();
  const subject = searchParams.get("subject");

  return (
    <AppShell
      activeNav="identification"
      agentContext={subject === null ? ["工序风险关联图谱"] : ["工序风险关联图谱", subject]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">工序风险关联图谱</h1>
            <p className="page-subtitle">以风险记录为主体呈现投影可证明的关联边</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <GraphSection subject={subject} />
        <div style={{ marginTop: 16 }}>
          <RecordGroupsSection
            onFocus={(entityId) =>
              navigate(projectPath(`/identification/graph?subject=${encodeURIComponent(entityId)}`))
            }
          />
        </div>
      </div>
    </AppShell>
  );
}
