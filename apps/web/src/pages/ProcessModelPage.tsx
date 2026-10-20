import { Link, useSearchParams } from "react-router-dom";
import { PROCESS_NODE_VALUES } from "@riskflow/contracts/vocabulary";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { EvidenceLink } from "../components/EvidenceLink";
import { Icon } from "../components/icons";
import { PageStateView } from "../components/PageStateView";
import { clientError } from "../api/client";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  readCurrentReleaseSet,
  readKnowledgeRelease,
  type GovernanceReleaseView,
} from "../api/operations";
import { IDENTIFICATION_ROUTE_TITLES, identificationTabs } from "./identificationShared";
import "./ProcessModelPage.css";

interface ProcessModelFacts {
  readonly release: GovernanceReleaseView | null;
  /** 显式选择的发布版本：只读该版本，不被当前发布集合替换。 */
  readonly explicit: boolean;
}

export default function ProcessModelPage() {
  const { selector } = useEngineering();
  const [searchParams] = useSearchParams();
  const releases = searchParams.getAll("release");
  const releaseVersions = searchParams.getAll("releaseVersion");
  const nodeId = searchParams.get("node");
  const releaseKey = releases.join(",");
  const versionKey = releaseVersions.join(",");

  const { state, retry } = usePageQuery<ProcessModelFacts>(
    async (projectId, signal) => {
      const selected = releases.length > 0 || releaseVersions.length > 0;
      if (selected) {
        // 成套选择：缺项、重复、错版与错误类型都拒绝，不回退到当前发布集合。
        if (releases.length !== 1 || releaseVersions.length !== 1) throw clientError("NOT_FOUND");
        const release = await readKnowledgeRelease(
          projectId,
          {
            kind: "knowledge-release",
            reference: { entityId: releases[0] ?? "", versionId: releaseVersions[0] ?? "" },
          },
          signal,
        );
        if (release.body.definitionType !== "process-model") throw clientError("NOT_FOUND");
        return { release, explicit: true };
      }
      const releaseSet = await readCurrentReleaseSet(projectId, signal);
      const processModel = releaseSet.find((member) => member.definitionType === "process-model");
      if (processModel === undefined) return { release: null, explicit: false };
      const release = await readKnowledgeRelease(projectId, processModel.releaseRef, signal);
      if (release.body.definitionType !== "process-model")
        return { release: null, explicit: false };
      return { release, explicit: false };
    },
    [releaseKey, versionKey],
  );

  return (
    <AppShell
      activeNav="identification"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">
              {IDENTIFICATION_ROUTE_TITLES["/identification/process-model"]}
            </h1>
            <p className="page-subtitle">查看站隧一体化施工工序模型及其依赖关系</p>
          </div>
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title={IDENTIFICATION_ROUTE_TITLES["/identification/process-model"]}
          emptyMessage="当前工程尚无已发布工序模型"
          onRetry={retry}
        >
          {({ release, explicit }) =>
            release === null ? (
              <Card title={IDENTIFICATION_ROUTE_TITLES["/identification/process-model"]}>
                <div className="pm-empty">
                  当前工程无已发布工序模型版本（治理空态），模型发布后此处呈现节点与依赖关系。
                </div>
              </Card>
            ) : (
              <ProcessModelBody release={release} nodeId={nodeId} explicit={explicit} />
            )
          }
        </PageStateView>
      </div>
    </AppShell>
  );
}

function ProcessModelBody({
  release,
  nodeId,
  explicit,
}: {
  release: GovernanceReleaseView;
  nodeId: string | null;
  explicit: boolean;
}) {
  const projectPath = useProjectPath();
  if (release.body.definitionType !== "process-model") return null;
  const { nodes, dependencyEdges } = release.body;
  const coveredKinds = new Set(nodes.map((node) => node.processKind));
  const missingKinds = PROCESS_NODE_VALUES.filter((kind) => !coveredKinds.has(kind));
  const equipment = [...new Set(nodes.flatMap((node) => node.equipmentRefs))];
  const structural = [...new Set(nodes.flatMap((node) => node.structuralComponentRefs))];
  const edgeGroups = new Map<string, typeof dependencyEdges>();
  for (const edge of dependencyEdges) {
    const list = edgeGroups.get(edge.relationType) ?? [];
    list.push(edge);
    edgeGroups.set(edge.relationType, list);
  }
  // 节点定位：指定节点不存在即如实说明无法定位，不自动改选首个节点。
  const located = nodeId === null ? undefined : nodes.find((node) => node.nodeId === nodeId);
  const nodeMissing = nodeId !== null && located === undefined;

  return (
    <>
      <div className="pm-header-tags">
        <VersionTag>
          工序模型发布 {release.releaseRef.reference.entityId}@
          {release.releaseRef.reference.versionId}
        </VersionTag>
        {explicit && <StatusTag tone="neutral">所选历史发布</StatusTag>}
        {release.deactivatedAt !== undefined && <StatusTag tone="failed">已停用</StatusTag>}
      </div>

      {nodeMissing && (
        <Card title="节点定位">
          <div className="pm-empty">
            所选发布版本中没有节点 <span className="mono">{nodeId}</span>，无法定位。
          </div>
        </Card>
      )}

      <Card
        title="工序节点流程"
        extra={
          <span>
            必含工序覆盖：
            {missingKinds.length === 0 ? "全部覆盖" : `缺 ${missingKinds.join("、")}`}
          </span>
        }
      >
        <div className="pm-flow">
          {nodes.map((node, index) => (
            <div
              key={node.nodeId}
              className={`pm-flow-item${located?.nodeId === node.nodeId ? " pm-flow-item--current" : ""}`}
            >
              {index > 0 && (
                <span className="pm-arrow">
                  <Icon name="arrowRight" size={18} />
                </span>
              )}
              <div className="pm-node">
                <div className="pm-node-head">
                  <span className="pm-node-order">{index + 1}</span>
                  <span className="pm-node-name">{node.processKind}</span>
                </div>
                <div className="pm-node-io mono">{node.nodeId}</div>
                <div className="pm-node-io">输入：{node.inputs.join("、")}</div>
                <div className="pm-node-io">输出：{node.outputs.join("、")}</div>
                <div className="pm-node-io">装备：{node.equipmentRefs.join("、") || "无登记"}</div>
                <div className="pm-node-io">
                  构件：{node.structuralComponentRefs.join("、") || "无登记"}
                </div>
                <div className="pm-node-params">
                  {node.stateParameters.map((parameter) => (
                    <span key={parameter} className="pm-chip">
                      {parameter}
                    </span>
                  ))}
                </div>
                <div className="pm-node-params">
                  {node.monitoringIndicators.map((indicator) => (
                    <span key={indicator} className="pm-chip pm-chip--monitor">
                      {indicator}
                    </span>
                  ))}
                </div>
                <div className="pm-node-evidence">
                  {node.evidence.map((reference) => (
                    <EvidenceLink
                      key={reference.sourceSegmentId}
                      segmentId={reference.sourceSegmentId}
                      sourceVersionRef={reference.sourceVersionRef}
                      referencedBy={node.nodeId}
                    />
                  ))}
                </div>
                <Link
                  className="pm-node-jump"
                  to={projectPath(
                    `/identification/process-model?node=${encodeURIComponent(node.nodeId)}`,
                  )}
                >
                  定位该节点
                </Link>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="pm-bottom">
        <Card title="装备部件与构件">
          <div className="pm-group-label">装备部件</div>
          <div className="pm-chips">
            {equipment.map((item) => (
              <span key={item} className="pm-chip pm-chip--equip">
                {item}
              </span>
            ))}
            {equipment.length === 0 && <span className="pm-chip">无登记</span>}
          </div>
          <div className="pm-group-label">构件</div>
          <div className="pm-chips">
            {structural.map((item) => (
              <span key={item} className="pm-chip pm-chip--part">
                {item}
              </span>
            ))}
            {structural.length === 0 && <span className="pm-chip">无登记</span>}
          </div>
        </Card>

        <Card title="依赖关系">
          {edgeGroups.size === 0 ? (
            <div className="pm-empty">已发布模型未登记依赖边</div>
          ) : (
            <ul className="pm-deps">
              {[...edgeGroups.entries()].map(([relationType, edges]) => (
                <li key={relationType} className="pm-dep">
                  <span className="pm-dep-name">{relationType}</span>
                  <span className="pm-dep-desc">
                    {edges.map((edge) => `${edge.fromNodeId} → ${edge.toNodeId}`).join("；")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
