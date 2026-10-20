import { clientError } from "../api/client";
import { useParams, useSearchParams } from "react-router-dom";
import { useState } from "react";
import { DocumentOriginalView } from "./DocumentOriginalView.js";
import AppShell from "../components/AppShell";
import { AssociatedObjects } from "../components/AssociatedObjects";
import { Card } from "../components/Card";
import { EvidenceLink } from "../components/EvidenceLink";
import { Icon } from "../components/icons";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery } from "../api/engineering";
import {
  listSourceCatalog,
  readSourceSegments,
  type SourceCatalogItemView,
  type SourceSegmentSetView,
} from "../api/operations";
import { IngestionFacts } from "./project/IngestionFacts";
import "./DocumentDetailPage.css";
import "../components/SectionTabs.css";

interface DocumentDetailFacts {
  readonly item: SourceCatalogItemView;
  readonly segmentSet: SourceSegmentSetView | null;
  /** 段集合读取被拒绝时只降级段列表区，不影响资料元数据主体。 */
  readonly segmentsDenied: boolean;
}

const PARSE_STATUS_LABEL: Record<string, string> = {
  registered: "已登记",
  processing: "解析中",
  parsed: "解析通过",
  failed: "解析失败",
};

const CLEANING_LABEL: Record<string, string> = {
  available: "清洗可用",
  partial: "部分可用",
  unavailable: "不可用",
};

export default function DocumentDetailPage() {
  const { docId } = useParams<{ docId: string }>();
  const [searchParams] = useSearchParams();
  const anchorSegmentId = searchParams.get("segment");
  const requestedVersion = searchParams.get("version");
  const [tab, setTab] = useState<"original" | "processing">("original");
  const { selector } = useEngineering();

  const { state, retry } = usePageQuery<DocumentDetailFacts>(
    async (projectId, signal) => {
      const catalog = await listSourceCatalog(
        projectId,
        requestedVersion === null
          ? {}
          : {
              sourceVersionRefs: [
                {
                  kind: "source-version",
                  reference: { entityId: docId!, versionId: requestedVersion },
                },
              ],
            },
        signal,
      );
      const item = catalog.items.find(
        (entry) =>
          entry.sourceVersionRef.reference.entityId === docId &&
          (requestedVersion === null ||
            entry.sourceVersionRef.reference.versionId === requestedVersion),
      );
      if (item === undefined) {
        throw clientError("NOT_FOUND");
      }
      let segmentSet: SourceSegmentSetView | null = null;
      let segmentsDenied = false;
      if (tab === "processing" && item.sourceSegmentSetRef !== undefined) {
        try {
          segmentSet = await readSourceSegments(
            projectId,
            item.sourceSegmentSetRef,
            item.sourceVersionRef,
            signal,
          );
        } catch {
          signal.throwIfAborted();
          segmentsDenied = true;
        }
      }
      return { item, segmentSet, segmentsDenied };
    },
    [docId, requestedVersion, tab],
  );

  const segmentsByChapter = (segmentSet: SourceSegmentSetView) => {
    const groups = new Map<string, SourceSegmentSetView["segments"]>();
    for (const segment of segmentSet.segments) {
      const key = segment.headingPath.join(" / ") || segment.chapterId;
      const list = groups.get(key) ?? [];
      list.push(segment);
      groups.set(key, list);
    }
    return [...groups.entries()];
  };

  return (
    <AppShell
      activeNav="project"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <PageStateView
          state={state}
          title="资料详情"
          emptyMessage="未找到该资料版本，或当前会话无权访问"
          forbiddenHint="无权访问该资料版本"
          onRetry={retry}
        >
          {({ item, segmentSet, segmentsDenied }) => (
            <>
              <header className="page-header">
                <div>
                  <h1 className="page-title">{item.sourceName ?? item.sourceId}</h1>
                  <p className="page-subtitle">
                    资料版本{" "}
                    <span className="mono">
                      {item.sourceVersionRef.reference.entityId}@
                      {item.sourceVersionRef.reference.versionId}
                    </span>
                  </p>
                </div>
                <StatusTag
                  tone={
                    item.parseStatus === "parsed"
                      ? "success"
                      : item.parseStatus === "failed"
                        ? "failed"
                        : "running"
                  }
                >
                  {PARSE_STATUS_LABEL[item.parseStatus] ?? item.parseStatus}
                </StatusTag>
              </header>

              <div role="tablist" aria-label="资料内容" className="section-tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "original"}
                  className={`section-tab${tab === "original" ? " section-tab--active" : ""}`}
                  onClick={() => setTab("original")}
                >
                  原件
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "processing"}
                  className={`section-tab${tab === "processing" ? " section-tab--active" : ""}`}
                  onClick={() => setTab("processing")}
                >
                  解析与清洗
                </button>
              </div>
              {tab === "original" ? (
                <DocumentOriginalView
                  key={`${selector.projectId}:${item.sourceVersionRef.reference.entityId}:${item.sourceVersionRef.reference.versionId}`}
                  sourceVersionRef={item.sourceVersionRef}
                />
              ) : (
                <div className="pjdd-grid">
                  <div className="pjdd-span">
                    <IngestionFacts subject={item.sourceVersionRef} />
                  </div>
                  <Card title="资料元数据">
                    <dl className="pjdd-meta">
                      <div className="pjdd-meta-row">
                        <dt>资料标识</dt>
                        <dd className="mono">{item.sourceId}</dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>资料类型</dt>
                        <dd>{item.documentType ?? "—"}</dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>版本</dt>
                        <dd>
                          <VersionTag>{item.externalVersion ?? "—"}</VersionTag>
                        </dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>形成时间</dt>
                        <dd className="mono">{item.formedAt ?? "—"}</dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>来源单位</dt>
                        <dd>{item.sourceOrganization ?? "—"}</dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>解析状态</dt>
                        <dd>
                          <StatusTag tone={item.parseStatus === "parsed" ? "success" : "neutral"}>
                            {PARSE_STATUS_LABEL[item.parseStatus] ?? item.parseStatus}
                          </StatusTag>
                        </dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>清洗可用性</dt>
                        <dd>
                          {item.cleaningAvailability === undefined ? (
                            <StatusTag tone="neutral">未登记清洗摘要</StatusTag>
                          ) : (
                            <StatusTag
                              tone={
                                item.cleaningAvailability === "available" ? "success" : "review"
                              }
                            >
                              {CLEANING_LABEL[item.cleaningAvailability]}
                              {item.cleaningAvailability === "partial" &&
                              item.cleaningExclusionCount !== undefined
                                ? `（排除 ${item.cleaningExclusionCount} 段）`
                                : ""}
                            </StatusTag>
                          )}
                        </dd>
                      </div>
                      <div className="pjdd-meta-row">
                        <dt>资料段数</dt>
                        <dd className="mono">
                          {segmentSet === null ? "—" : `${segmentSet.segments.length} 段`}
                        </dd>
                      </div>
                    </dl>
                  </Card>

                  <Card title="章节结构与资料段" style={{ minWidth: 0 }}>
                    {segmentsDenied ? (
                      <p className="pjdd-empty">暂无法读取该版本的资料段，可返回原件查看。</p>
                    ) : segmentSet === null ? (
                      <p className="pjdd-empty">该资料版本尚无解析后的资料段集合</p>
                    ) : (
                      segmentsByChapter(segmentSet).map(([chapter, segments]) => (
                        <section key={chapter} className="pjdd-chapter">
                          <header className="pjdd-chapter-header">
                            <Icon name="doc" size={14} />
                            <span>{chapter}</span>
                            <span className="pjdd-chapter-count mono">{segments.length} 段</span>
                          </header>
                          <ul className="pjdd-segments">
                            {segments.map((segment) => (
                              <li
                                key={segment.sourceSegmentId}
                                className={`pjdd-segment${
                                  anchorSegmentId === segment.sourceSegmentId
                                    ? " pjdd-segment--anchor"
                                    : ""
                                }`}
                              >
                                <div className="pjdd-segment-head">
                                  <EvidenceLink
                                    segmentId={segment.sourceSegmentId}
                                    sourceVersionRef={segmentSet.sourceVersionRef.reference}
                                    referencedBy={item.sourceId}
                                  />
                                  <StatusTag tone="neutral">
                                    {segment.kind === "chapter"
                                      ? "章节"
                                      : segment.kind === "table"
                                        ? "表格"
                                        : "监测窗口"}
                                  </StatusTag>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </section>
                      ))
                    )}
                  </Card>
                </div>
              )}

              <AssociatedObjects subjectRef={item.sourceVersionRef} />
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
