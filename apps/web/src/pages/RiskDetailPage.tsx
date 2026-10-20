import { clientError } from "../api/client";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { StandardizedRiskRecordRefV1Schema } from "@riskflow/contracts/ports";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { EvidenceLink } from "../components/EvidenceLink";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { usePageQuery, useProjectPath, type PageState } from "../api/engineering";
import {
  locateSegmentSources,
  readRiskRecord,
  type RiskRecordDetailView,
  type VersionRef,
} from "../api/operations";
import {
  ACCEPTANCE_KIND_LABEL,
  IDENTIFICATION_ROUTE_TITLES,
  identificationTabs,
} from "./identificationShared";
import { RiskTraceSection } from "./RiskTraceSection";
import "./RiskDetailPage.css";

interface RiskDetailPageData {
  readonly detail: RiskRecordDetailView;
  /** 资料段标识 → 来源版本引用：可证明时证据入口走真实 evidence-access 查询。 */
  readonly evidenceSources: ReadonlyMap<string, VersionRef>;
}

export default function RiskDetailPage() {
  const { recordId } = useParams<{ recordId: string }>();
  const projectPath = useProjectPath();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const versions = searchParams.getAll("version");
  const versionKey = JSON.stringify(versions);
  // 导航型未知页签回落到正文，不改动已读到的精确对象。
  const tab = searchParams.get("tab") === "trace" ? "trace" : "details";
  // 写回精确版本期间同版本正文已在手：保留上次结果，避免同版本重读造成内容闪烁。
  const [lastGood, setLastGood] = useState<RiskDetailPageData | undefined>(undefined);

  const { state, retry } = usePageQuery<RiskDetailPageData>(
    async (projectId, signal) => {
      if (recordId === undefined) throw clientError("NOT_FOUND");
      // 精确引用按给定版本读取；无版本按裸身份由所属读面窄解析到唯一登记版本。
      if (versions.length > 0) {
        const parsed = StandardizedRiskRecordRefV1Schema.safeParse({
          kind: "standardized-risk-record",
          reference: { entityId: recordId, versionId: versions[0] },
        });
        if (new Set(versions).size !== 1 || !parsed.success) throw clientError("NOT_FOUND");
        const detail = await readRiskRecord(projectId, { riskRecordRef: parsed.data }, signal);
        const evidenceSources = await locateSegmentSources(
          projectId,
          detail.sourceSegmentIds,
          signal,
        );
        return { detail, evidenceSources };
      }
      const detail = await readRiskRecord(projectId, { riskRecordId: recordId }, signal);
      const evidenceSources = await locateSegmentSources(
        projectId,
        detail.sourceSegmentIds,
        signal,
      );
      return { detail, evidenceSources };
    },
    [recordId, versionKey],
  );

  useEffect(() => {
    if (state.kind === "ready") setLastGood(state.value);
  }, [state]);

  // 无版本旧地址解析成功后写回唯一登记版本：后续刷新与深链都指向同一精确版本。
  useEffect(() => {
    if (state.kind !== "ready" || versions.length === 1) return;
    const params = new URLSearchParams(searchParams);
    params.set("version", state.value.detail.riskRecordRef.reference.versionId);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  }, [state, versions.length, navigate, location.pathname, searchParams]);

  const shownState: PageState<RiskDetailPageData> =
    state.kind === "loading" && lastGood !== undefined ? { kind: "ready", value: lastGood } : state;
  const resolvedVersion =
    state.kind === "ready" ? state.value.detail.riskRecordRef.reference.versionId : versions[0];
  const recordPath = `/identification/records/${encodeURIComponent(recordId ?? "")}`;
  // 查询串按片段拼装：版本可能尚未解析，缺省时页签地址仍是一个合法 URL。
  const queryOf = (...parts: readonly (string | undefined)[]) =>
    `?${parts.filter((part) => part !== undefined && part !== "").join("&")}`;
  const versionPart =
    resolvedVersion === undefined ? undefined : `version=${encodeURIComponent(resolvedVersion)}`;
  const detailsHref = projectPath(`${recordPath}${queryOf(versionPart)}`);
  const traceHref = projectPath(`${recordPath}${queryOf(versionPart, "tab=trace")}`);

  return (
    <AppShell activeNav="identification" agentContext={recordId === undefined ? [] : [recordId]}>
      <div className="page rdp">
        <header className="page-header">
          <div>
            <h1 className="page-title">
              {IDENTIFICATION_ROUTE_TITLES["/identification/records/:recordId"]}
            </h1>
            <p className="page-subtitle">
              <span className="mono">{recordId ?? ""}</span>
            </p>
          </div>
          {shownState.kind === "ready" && (
            <div className="rdp-header-tags">
              <StatusTag
                tone={
                  shownState.value.detail.acceptanceDecisionRef.kind === "review-decision"
                    ? "review"
                    : "success"
                }
              >
                {shownState.value.detail.acceptanceDecisionRef.kind === "review-decision"
                  ? ACCEPTANCE_KIND_LABEL.review
                  : ACCEPTANCE_KIND_LABEL.automatic}
              </StatusTag>
              {shownState.value.detail.supersededBy !== undefined && (
                <StatusTag tone="failed">已被取代</StatusTag>
              )}
            </div>
          )}
        </header>
        <SectionTabs items={identificationTabs} />

        <nav className="rdp-tabs" role="tablist" aria-label="风险记录页签">
          <Link
            className={`rdp-tab${tab === "details" ? " rdp-tab--active" : ""}`}
            role="tab"
            aria-selected={tab === "details"}
            to={detailsHref}
          >
            记录正文
          </Link>
          <Link
            className={`rdp-tab${tab === "trace" ? " rdp-tab--active" : ""}`}
            role="tab"
            aria-selected={tab === "trace"}
            to={traceHref}
          >
            追溯链
          </Link>
        </nav>

        <PageStateView
          state={shownState}
          title={IDENTIFICATION_ROUTE_TITLES["/identification/records/:recordId"]}
          emptyMessage="未找到该风险记录"
          forbiddenHint="当前角色不具备查看风险记录的权限，或该记录不存在"
          onRetry={retry}
        >
          {({ detail, evidenceSources }) =>
            tab === "trace" ? (
              <RiskTraceSection detail={detail} evidenceSources={evidenceSources} />
            ) : (
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
                            )}?version=${encodeURIComponent(
                              detail.identificationRunRef.reference.versionId,
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
                              )}?version=${encodeURIComponent(
                                detail.supersededBy.reference.versionId,
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
                    <Link to={traceHref}>查看端到端追溯链</Link>
                  </div>
                </Card>
              </div>
            )
          }
        </PageStateView>
      </div>
    </AppShell>
  );
}
