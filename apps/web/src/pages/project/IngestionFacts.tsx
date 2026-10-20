import { useState } from "react";

import { Card } from "../../components/Card";
import { PageStateView } from "../../components/PageStateView";
import { StatusTag } from "../../components/StatusTag";
import { useEngineering, usePageQuery } from "../../api/engineering";
import {
  readEngineeringWorkspaceCleaningExclusions,
  readEngineeringWorkspaceConversionFailure,
  readEngineeringWorkspaceIngestion,
  type EngineeringWorkspaceIngestionItemView,
  type KindRefView,
} from "../../api/engineeringWorkspace";

/**
 * 接入事实区域（design D-06）。
 *
 * 只展示所属领域已登记的处理关系：转换、资料段、识别准备、清洗结果与监测批次快照。
 * 阶段缺席以空列表表达，不折算为“未清洗”或“处理成功”；正式结果引用只从 cleaning 条目取得，
 * 排除范围按该结果自己的游标分页读取，不从来源引用猜。
 */
export interface IngestionFactsPropsV1 {
  readonly subject: KindRefView;
}

const STAGE_LABEL: Record<string, string> = {
  conversion: "文档转换",
  segments: "资料分段",
  preparation: "识别准备",
  cleaning: "数据清洗",
  "monitoring-batch": "监测批次",
  "monitoring-snapshot": "监测快照",
};

const AVAILABILITY_LABEL: Record<string, string> = {
  available: "可用",
  partial: "部分可用",
  unavailable: "不可用",
};

const RELATION_LABEL: Record<string, string> = {
  original: "原始批次",
  correction: "更正批次",
  supplement: "补充批次",
};

const refText = (ref: {
  readonly reference: { readonly entityId: string; readonly versionId: string };
}): string => `${ref.reference.entityId}@${ref.reference.versionId}`;

/** 失败转换按需读取安全摘要：只有原因码与段定位，不返回诊断正文。 */
function ConversionFailureNote({ conversionRef }: { readonly conversionRef: KindRefView }) {
  const [requested, setRequested] = useState(false);
  const failure = usePageQuery(
    (projectId, signal) =>
      requested
        ? readEngineeringWorkspaceConversionFailure(projectId, conversionRef, signal)
        : Promise.resolve(null),
    [requested, refText(conversionRef)],
  );
  if (!requested) {
    return (
      <button type="button" className="pjwf-secondary" onClick={() => setRequested(true)}>
        读取安全失败摘要
      </button>
    );
  }
  const state = failure.state;
  if (state.kind === "ready") {
    if (state.value === null) return <span className="pjwf-note">正在读取失败摘要…</span>;
    return (
      <span className="pjwf-note">
        失败原因 {state.value.reasonCode}
        {state.value.sourceSegmentId === undefined
          ? ""
          : ` · 资料段 ${state.value.sourceSegmentId}`}
      </span>
    );
  }
  if (state.kind === "forbidden") {
    return <span className="pjwf-note">该转换的失败摘要不可读（无权或不存在）。</span>;
  }
  if (state.kind === "error") {
    return (
      <span className="pjwf-note">
        失败摘要读取失败（{state.error.code}）。
        <button type="button" className="pjwf-secondary" onClick={failure.retry}>
          重试
        </button>
      </span>
    );
  }
  return <span className="pjwf-note">正在读取失败摘要…</span>;
}

/** 分阶段呈现真实联合字段；缺席阶段不在这里生成。 */
function StageDetail({
  item,
  subject,
}: {
  readonly item: EngineeringWorkspaceIngestionItemView;
  readonly subject: KindRefView;
}) {
  if (item.stage === "conversion") {
    const succeeded = item.status === "succeeded";
    return (
      <div className="pjwf-stage">
        <StatusTag tone={succeeded ? "success" : "failed"}>
          {succeeded ? "转换完成" : "转换失败"}
        </StatusTag>
        <span className="mono pjwf-fact-ref">{refText(item.conversionRef)}</span>
        <span>
          资料段 {item.statistics.sourceSegmentCount} · 页 {item.statistics.pageCount} · 表{" "}
          {item.statistics.tableCount} · {item.statistics.durationMs} ms
          {item.statistics.limitCode === undefined ? "" : ` · 限制 ${item.statistics.limitCode}`}
        </span>
        {item.sourceSegmentSetRef !== undefined && (
          <span className="mono pjwf-fact-ref">段集合 {refText(item.sourceSegmentSetRef)}</span>
        )}
        {!succeeded && <ConversionFailureNote conversionRef={item.conversionRef} />}
      </div>
    );
  }
  if (item.stage === "segments") {
    return (
      <div className="pjwf-stage">
        <span className="mono pjwf-fact-ref">{refText(item.sourceSegmentSetRef)}</span>
        <span>{item.segmentCount} 段</span>
      </div>
    );
  }
  if (item.stage === "preparation") {
    return (
      <div className="pjwf-stage">
        <span>已登记的识别准备</span>
        <span className="mono pjwf-fact-ref">{refText(item.preparationRef)}</span>
      </div>
    );
  }
  if (item.stage === "cleaning") {
    return (
      <div className="pjwf-stage">
        <StatusTag
          tone={
            item.availability === "available"
              ? "success"
              : item.availability === "partial"
                ? "review"
                : "failed"
          }
        >
          {AVAILABILITY_LABEL[item.availability] ?? item.availability}
        </StatusTag>
        <span>
          保留 {item.retainedCount}/{item.totalCount}（{(item.retainedRatio * 100).toFixed(0)}%）
        </span>
        <span className="mono pjwf-fact-ref">结果 {refText(item.resultRef)}</span>
        <span className="mono pjwf-fact-ref">
          策略 {item.policyRef.entityId}@{item.policyRef.versionId}
        </span>
        {item.reasonCodes.length > 0 && <span>原因码 {item.reasonCodes.join("、")}</span>}
        <ExclusionPanel resultRef={item.resultRef} subject={subject} />
      </div>
    );
  }
  if (item.stage === "monitoring-batch") {
    const window = item.batch.window;
    return (
      <div className="pjwf-stage">
        <span>
          {RELATION_LABEL[item.batch.relation] ?? item.batch.relation} ·{" "}
          <span className="mono">
            {window.from.slice(0, 19).replace("T", " ")} ~{" "}
            {window.to.slice(0, 19).replace("T", " ")}
          </span>{" "}
          · 样本量 {item.batch.sampleCount}
        </span>
        <span className="mono pjwf-fact-ref">{refText(item.batch.monitoringBatchRef)}</span>
      </div>
    );
  }
  const snapshot = item.snapshot;
  return (
    <div className="pjwf-stage">
      <span>
        可用性 {AVAILABILITY_LABEL[snapshot.availability] ?? snapshot.availability} · 覆盖率{" "}
        {(snapshot.coverageRatio * 100).toFixed(1)}%
      </span>
      <span className="mono pjwf-fact-ref">{refText(snapshot.monitoringSnapshotRef)}</span>
      <span className="mono">{snapshot.cutoff.slice(0, 19).replace("T", " ")}</span>
    </div>
  );
}

/** 正式结果的排除范围：引用来自所属 cleaning 条目，按结果自己的游标显式续页。 */
function ExclusionPanel({
  resultRef,
  subject,
}: {
  readonly resultRef: KindRefView;
  readonly subject: KindRefView;
}) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState<string>();
  const exclusions = usePageQuery(
    (projectId, signal) =>
      open
        ? readEngineeringWorkspaceCleaningExclusions(
            projectId,
            resultRef,
            subject,
            signal,
            cursor === undefined ? {} : { cursor },
          )
        : Promise.resolve(null),
    [open, cursor, refText(resultRef), refText(subject)],
  );
  return (
    <div className="pjwf-exclusions">
      <button type="button" className="pjwf-secondary" onClick={() => setOpen((value) => !value)}>
        {open ? "收起正式排除范围" : "核对正式排除范围"}
      </button>
      {open && (
        <PageStateView
          state={exclusions.state}
          title="正式排除范围"
          emptyMessage="该正式结果没有针对当前来源的排除项"
          onRetry={exclusions.retry}
        >
          {(page) =>
            page === null ? (
              <p className="pjwf-note">正在读取排除范围…</p>
            ) : (
              <>
                {page.items.length === 0 ? (
                  <p className="pjwf-note">该正式结果没有针对当前来源的排除项。</p>
                ) : (
                  <ul className="pjwf-facts-list">
                    {page.items.map((exclusion) => (
                      <li key={exclusion.decisionId}>
                        <StatusTag
                          tone={exclusion.disposition === "accepted" ? "success" : "review"}
                        >
                          {exclusion.disposition === "accepted" ? "排除已接受" : "排除被拒绝"}
                        </StatusTag>
                        <span className="pjwf-fact-detail">
                          {exclusion.targetKind} · {exclusion.reasonCode}
                          {exclusion.rejectionClass === undefined
                            ? ""
                            : `（${exclusion.rejectionClass}）`}
                          {exclusion.sourceSegmentId === undefined
                            ? ""
                            : ` · 段 ${exclusion.sourceSegmentId}`}
                        </span>
                        <span className="mono pjwf-fact-ref">{exclusion.decisionId}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {page.nextCursor !== undefined && (
                  <div className="pjwf-more">
                    <button
                      type="button"
                      className="pjwf-secondary"
                      onClick={() => setCursor(page.nextCursor!)}
                    >
                      继续读取后续排除项
                    </button>
                  </div>
                )}
              </>
            )
          }
        </PageStateView>
      )}
    </div>
  );
}

export function IngestionFacts({ subject }: IngestionFactsPropsV1) {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const subjectKey = `${projectId ?? ""}:${subject.kind}:${refText(subject)}`;
  const [paging, setPaging] = useState<{ readonly key: string; readonly cursor: string }>();
  const cursor = paging?.key === subjectKey ? paging.cursor : undefined;

  const facts = usePageQuery(
    (id, signal) =>
      readEngineeringWorkspaceIngestion(
        id,
        subject,
        signal,
        cursor === undefined ? {} : { cursor },
      ),
    [subjectKey, cursor],
  );

  return (
    <Card title="接入事实">
      <p className="pjwf-note">
        来源 <span className="mono">{refText(subject)}</span>
      </p>
      <PageStateView
        state={facts.state}
        title="接入处理关系"
        emptyMessage="当前来源尚无已登记的处理关系"
        onRetry={facts.retry}
      >
        {(page) => (
          <>
            {page.items.length === 0 ? (
              <p className="pjwf-note">
                当前未登记可读取的处理关系；这不等于“未清洗”，也不表示处理成功。
              </p>
            ) : (
              <ul className="pjwf-facts-list">
                {page.items.map((item) => (
                  <li
                    key={`${subjectKey}:${item.stage}:${refText(item.recordRef)}`}
                    aria-label={STAGE_LABEL[item.stage] ?? item.stage}
                  >
                    <span className="pjwf-fact-stage">
                      <StatusTag tone="neutral">{STAGE_LABEL[item.stage] ?? item.stage}</StatusTag>
                    </span>
                    <StageDetail item={item} subject={subject} />
                  </li>
                ))}
              </ul>
            )}
            {page.nextCursor !== undefined && (
              <div className="pjwf-more">
                <button
                  type="button"
                  className="pjwf-secondary"
                  onClick={() => setPaging({ key: subjectKey, cursor: page.nextCursor! })}
                >
                  继续读取后续接入记录
                </button>
              </div>
            )}
          </>
        )}
      </PageStateView>
    </Card>
  );
}
