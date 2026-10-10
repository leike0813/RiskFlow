import { clientError } from "../api/client";
import { Link, useParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { EvidenceLink } from "../components/EvidenceLink";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { usePageQuery, useProjectPath } from "../api/engineering";
import {
  listRiskRecords,
  locateSegmentSources,
  readRiskRecord,
  type RiskRecordDetailView,
  type VersionRef,
} from "../api/operations";
import { ACCEPTANCE_KIND_LABEL, identificationTabs } from "./identificationShared";
import "./RiskDetailPage.css";

interface RiskDetailPageData {
  readonly detail: RiskRecordDetailView;
  /** 资料段标识 → 来源版本引用：可证明时证据入口走真实 evidence-access 查询。 */
  readonly evidenceSources: ReadonlyMap<string, VersionRef>;
}

export default function RiskDetailPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const projectPath = useProjectPath();
  const { state, retry } = usePageQuery<RiskDetailPageData>(
    async (projectId, signal) => {
      // riskRecordRef 需要精确版本：先经 record-catalog 按实体标识解析出完整引用，再精确读取。
      const catalog = await listRiskRecords(projectId, {}, signal);
      const item = catalog.items.find(
        (entry) => entry.riskRecordRef.reference.entityId === recordId,
      );
      if (item === undefined) throw clientError("NOT_FOUND");
      const detail = await readRiskRecord(projectId, item.riskRecordRef, signal);
      const evidenceSources = await locateSegmentSources(
        projectId,
        detail.sourceSegmentIds,
        signal,
      );
      return { detail, evidenceSources };
    },
    [recordId],
  );

  return (
    <AppShell activeNav="identification" agentContext={recordId === undefined ? [] : [recordId]}>
      <div className="page rdp">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险记录详情</h1>
            <p className="page-subtitle">
              <span className="mono">{recordId ?? ""}</span>
            </p>
          </div>
          {state.kind === "ready" && (
            <div className="rdp-header-tags">
              <StatusTag
                tone={
                  state.value.detail.acceptanceDecisionRef.kind === "review-decision"
                    ? "review"
                    : "success"
                }
              >
                {state.value.detail.acceptanceDecisionRef.kind === "review-decision"
                  ? ACCEPTANCE_KIND_LABEL.review
                  : ACCEPTANCE_KIND_LABEL.automatic}
              </StatusTag>
              {state.value.detail.supersededBy !== undefined && (
                <StatusTag tone="failed">已被取代</StatusTag>
              )}
            </div>
          )}
        </header>
        <SectionTabs items={identificationTabs} />

        <PageStateView
          state={state}
          title="风险记录详情"
          emptyMessage="未找到该风险记录"
          forbiddenHint="当前角色不具备查看风险记录的权限，或该记录不存在"
          onRetry={retry}
        >
          {({ detail, evidenceSources }) => (
            <div className="rdp-grid">
              <Card
                title="标准化风险记录"
                extra={
                  <>
                    <span className="mono rdp-record-id">
                      {detail.riskRecordRef.reference.entityId}
                    </span>
                    <VersionTag>{detail.riskRecordRef.reference.versionId}</VersionTag>
                  </>
                }
              >
                <dl className="rdp-fields">
                  <div className="rdp-field">
                    <dt>工序节点标识</dt>
                    <dd className="mono">{detail.record.processNodeId}</dd>
                  </div>
                  <div className="rdp-field">
                    <dt>风险源</dt>
                    <dd>{detail.record.riskSource}</dd>
                  </div>
                  <div className="rdp-field">
                    <dt>风险因素</dt>
                    <dd>{detail.record.riskFactor}</dd>
                  </div>
                  <div className="rdp-field">
                    <dt>风险事件</dt>
                    <dd>{detail.record.riskEvent}</dd>
                  </div>
                  <div className="rdp-field">
                    <dt>风险要素关系</dt>
                    <dd>
                      <ul className="rdp-relations">
                        {detail.record.riskElementRelations.map((relation, index) => (
                          <li key={index}>
                            <span className="mono">{relation.sourceElement}</span>
                            <span className="rdp-dim"> —{relation.relation}→ </span>
                            <span className="mono">{relation.targetElement}</span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>证据定位信息</dt>
                    <dd className="rdp-field-ev">
                      {detail.sourceSegmentIds.map((segmentId) => {
                        const sourceVersionRef = evidenceSources.get(segmentId);
                        return sourceVersionRef === undefined ? (
                          <span key={segmentId} className="mono rdp-dim">
                            {segmentId}（来源版本不可证明，仅呈现定位摘要）
                          </span>
                        ) : (
                          <EvidenceLink
                            key={segmentId}
                            segmentId={segmentId}
                            sourceVersionRef={sourceVersionRef}
                            referencedBy={detail.riskRecordRef.reference.entityId}
                          />
                        );
                      })}
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>模型置信度</dt>
                    <dd>
                      <span className="mono rdp-confidence">
                        {detail.record.modelConfidence.toFixed(2)}
                      </span>
                      {detail.acceptanceDecisionRef.kind === "review-decision" && (
                        <StatusTag tone="review">经人工复核验收</StatusTag>
                      )}
                    </dd>
                  </div>
                </dl>
              </Card>

              <Card title="记录信封">
                <dl className="rdp-fields">
                  <div className="rdp-field">
                    <dt>机理条目引用</dt>
                    <dd>
                      {detail.riskMechanismEntryIds.map((entryId) => (
                        <span key={entryId} className="mono rdp-ref-chip">
                          {entryId}
                        </span>
                      ))}
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>识别运行</dt>
                    <dd>
                      <Link
                        to={projectPath(
                          `/identification/runs/${encodeURIComponent(
                            detail.identificationRunRef.reference.entityId,
                          )}`,
                        )}
                        className="mono"
                      >
                        {detail.identificationRunRef.reference.entityId}
                      </Link>
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>综合置信度</dt>
                    <dd>
                      <span className="mono rdp-confidence">
                        {detail.compositeConfidence.value.toFixed(2)}
                      </span>
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>形成依据</dt>
                    <dd>
                      <ul className="rdp-relations">
                        {detail.compositeConfidence.basis.map((basis) => (
                          <li key={basis} className="mono">
                            {basis}
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>验收决定</dt>
                    <dd>
                      <StatusTag
                        tone={
                          detail.acceptanceDecisionRef.kind === "review-decision"
                            ? "review"
                            : "success"
                        }
                      >
                        {detail.acceptanceDecisionRef.kind === "review-decision"
                          ? "人工复核决定"
                          : "自动路由决定"}
                      </StatusTag>
                      <span className="mono rdp-dim">
                        {" "}
                        {detail.acceptanceDecisionRef.reference.entityId}
                      </span>
                    </dd>
                  </div>
                  <div className="rdp-field">
                    <dt>审计引用</dt>
                    <dd className="mono">{detail.auditTrailRef.reference.entityId}</dd>
                  </div>
                  {detail.supersededBy !== undefined && (
                    <div className="rdp-field">
                      <dt>取代关系</dt>
                      <dd>
                        <span className="rdp-dim">已被 </span>
                        <Link
                          to={projectPath(
                            `/identification/records/${encodeURIComponent(
                              detail.supersededBy.reference.entityId,
                            )}`,
                          )}
                          className="mono"
                        >
                          {detail.supersededBy.reference.entityId}
                        </Link>
                        <span className="rdp-dim"> 取代</span>
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="rdp-chain-entry">
                  <Link
                    to={projectPath(
                      `/review-audit/trace?subject=${encodeURIComponent(
                        detail.riskRecordRef.reference.entityId,
                      )}`,
                    )}
                  >
                    查看端到端追溯链
                  </Link>
                </div>
              </Card>
            </div>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
