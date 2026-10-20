import { useState } from "react";
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
  readRiskRecord,
  type KindRef,
  type RiskRecordCatalogPageView,
  type TraceLinkItemView,
} from "../api/operations";
import { IDENTIFICATION_ROUTE_TITLES, identificationTabs } from "./identificationShared";
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

/**
 * 关联图区：以 ?subject=<记录标识>（可选 version）为主体读取可证明链边。
 *
 * 主体按裸身份定向解析到精确记录引用，不经目录首页定位；链边读尽全部有界页后才呈现完整图，
 * 后续页失败按原结构化失败收口，不把前页称作完整图。
 */
function GraphSection({ subject, version }: { subject: string | null; version: string | null }) {
  const projectPath = useProjectPath();
  const { state, retry } = usePageQuery<GraphResult>(
    async (projectId, signal) => {
      if (subject === null || subject.trim().length === 0) return { kind: "no-subject" };
      const detail =
        version === null
          ? await readRiskRecord(projectId, { riskRecordId: subject }, signal)
          : await readRiskRecord(
              projectId,
              {
                riskRecordRef: {
                  kind: "standardized-risk-record",
                  reference: { entityId: subject, versionId: version },
                },
              },
              signal,
            );
      const links = await readAssociationGraphLinks(projectId, detail.riskRecordRef, signal);
      return { kind: "graph", subject: detail.riskRecordRef, links };
    },
    [subject, version],
  );

  return (
    <PageStateView
      state={state}
      title={IDENTIFICATION_ROUTE_TITLES["/identification/graph"]}
      emptyMessage="暂无可证明的关联边"
      forbiddenHint="暂无可证明的关联边，或当前角色不具备投影读取权限"
      onRetry={retry}
    >
      {(result) => {
        if (result.kind === "no-subject") {
          return (
            <Card title={IDENTIFICATION_ROUTE_TITLES["/identification/graph"]}>
              <p className="graph-hint">请在上方选择一条风险记录作为关联图主体。</p>
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
          <Card
            title={IDENTIFICATION_ROUTE_TITLES["/identification/graph"]}
            extra={<GraphLegend categories={categories} />}
          >
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
            <div className="graph-hint">
              <Link to={projectPath("/identification/records")}>前往风险记录列表</Link>
            </div>
          </Card>
        );
      }}
    </PageStateView>
  );
}

/**
 * 主体选择：来自有界风险记录目录的真实选项（含续页），不是第二份按工序分组的记录列表。
 * 图谱只呈现正式关联图；失败时给出规范风险记录入口。
 */
function SubjectSelector({ subject }: { subject: string | null }) {
  const navigate = useNavigate();
  const projectPath = useProjectPath();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const { state, retry } = usePageQuery<RiskRecordCatalogPageView>(
    (projectId, signal) =>
      listRiskRecords(projectId, cursor === undefined ? {} : { cursor }, signal),
    [cursor],
  );

  return (
    <PageStateView
      state={state}
      title="关联主体"
      emptyMessage="当前工程暂无风险记录"
      forbiddenHint="当前角色不具备风险记录的读取权限"
      onRetry={retry}
    >
      {(page) => (
        <Card
          title="关联主体"
          extra={
            <span>
              本页 {page.items.length} 条
              <button
                type="button"
                className="graph-page-btn"
                disabled={page.nextCursor === undefined}
                onClick={() => {
                  if (page.nextCursor === undefined) return;
                  setCursor(page.nextCursor);
                }}
              >
                下一页
              </button>
              <button
                type="button"
                className="graph-page-btn"
                disabled={cursor === undefined}
                onClick={() => setCursor(undefined)}
              >
                返回首屏
              </button>
            </span>
          }
        >
          {page.items.length === 0 ? (
            <div className="graph-hint">当前工程暂无风险记录</div>
          ) : (
            <select
              className="graph-subject-select"
              value={subject ?? ""}
              onChange={(event) => {
                const entityId = event.target.value;
                navigate(
                  projectPath(
                    entityId === ""
                      ? "/identification/graph"
                      : `/identification/graph?subject=${encodeURIComponent(entityId)}`,
                  ),
                );
              }}
              aria-label="选择关联图主体"
            >
              <option value="">未选择主体</option>
              {page.items.map((item) => (
                <option
                  key={item.riskRecordRef.reference.entityId}
                  value={item.riskRecordRef.reference.entityId}
                >
                  {item.riskEventSummary}（{item.riskRecordRef.reference.entityId}）
                </option>
              ))}
            </select>
          )}
          <div className="graph-hint">
            <Link to={projectPath("/identification/records")}>前往风险记录列表</Link>
          </div>
        </Card>
      )}
    </PageStateView>
  );
}

export default function AssociationGraphPage() {
  const [searchParams] = useSearchParams();
  const subject = searchParams.get("subject");
  const version = searchParams.get("version");

  return (
    <AppShell
      activeNav="identification"
      agentContext={subject === null ? ["工序风险关联图谱"] : ["工序风险关联图谱", subject]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">{IDENTIFICATION_ROUTE_TITLES["/identification/graph"]}</h1>
            <p className="page-subtitle">以风险记录为主体呈现投影可证明的关联边</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <SubjectSelector subject={subject} />
        <div style={{ marginTop: 16 }}>
          <GraphSection subject={subject} version={version} />
        </div>
      </div>
    </AppShell>
  );
}
