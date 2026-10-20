import { useEffect, useState } from "react";

import { Card } from "../../components/Card";
import { PageStateView } from "../../components/PageStateView";
import { StatusTag } from "../../components/StatusTag";
import { useEngineering, usePageQuery } from "../../api/engineering";
import {
  readEngineeringWorkspaceCleaningExclusions,
  readEngineeringWorkspaceIngestion,
  type EngineeringWorkspaceIngestionItemView,
  type KindRefView,
} from "../../api/engineeringWorkspace";

/**
 * 接入事实区域（design D-06）。
 *
 * 只展示所属领域已登记的处理关系：转换、资料段、清洗结果与监测批次快照。
 * 阶段缺席以空列表表达，不折算为“未清洗”或“处理成功”；可选 Agent 关联按权限裁剪，
 * 无权时这里不出现任何 Agent 引用。
 */
export interface IngestionFactsPropsV1 {
  readonly subject: KindRefView;
  /** 清洗结果引用：存在时按需展开该结果的排除项。 */
  readonly cleaningResultRef?: KindRefView | undefined;
}

const STAGE_LABEL: Record<string, string> = {
  conversion: "文档转换",
  segments: "资料分段",
  cleaning: "数据清洗",
  "monitoring-batch": "监测批次",
  "monitoring-snapshot": "监测快照",
};

export function IngestionFacts({ subject, cleaningResultRef }: IngestionFactsPropsV1) {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const [exclusions, setExclusions] = useState<
    readonly {
      readonly decisionId: string;
      readonly targetKind: string;
      readonly reasonCode: string;
      readonly disposition: string;
      readonly rejectionClass?: string;
    }[]
  >([]);
  const [exclusionError, setExclusionError] = useState<string | null>(null);

  const facts = usePageQuery<readonly EngineeringWorkspaceIngestionItemView[]>(
    (id, signal) =>
      readEngineeringWorkspaceIngestion(id, subject, signal).then((value) => value.items),
    [projectId, subject.kind, subject.reference.entityId, subject.reference.versionId],
  );

  useEffect(() => {
    if (cleaningResultRef === undefined || projectId === null) {
      setExclusions([]);
      return;
    }
    let cancelled = false;
    readEngineeringWorkspaceCleaningExclusions(projectId, cleaningResultRef, subject)
      .then((items) => {
        if (!cancelled) setExclusions(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setExclusions([]);
          setExclusionError(error instanceof Error ? error.message : "读取失败");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, cleaningResultRef, subject]);

  return (
    <Card title="接入事实">
      <PageStateView
        state={facts.state}
        title="接入处理关系"
        emptyMessage="当前来源尚无已登记的处理关系"
        onRetry={facts.retry}
      >
        {(items) => (
          <>
            {items.length === 0 ? (
              <p className="pjwf-note">
                当前未登记可读取的处理关系；这不等于“未清洗”，也不表示处理成功。
              </p>
            ) : (
              <ul className="pjwf-facts-list">
                {items.map((item) => (
                  <li key={`${item.stage}:${item.recordRef.reference.entityId}`}>
                    <span className="pjwf-fact-stage">
                      <StatusTag tone="neutral">{STAGE_LABEL[item.stage] ?? item.stage}</StatusTag>
                    </span>
                    <span className="pjwf-fact-detail">{item.detail}</span>
                    <span className="mono pjwf-fact-ref">
                      {item.recordRef.reference.entityId}@{item.recordRef.reference.versionId}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {exclusionError !== null && (
              <p className="pjwf-note">排除项读取失败：{exclusionError}</p>
            )}
            {exclusions.length > 0 && (
              <>
                <h3 className="pjwf-subtitle">正式排除范围</h3>
                <ul className="pjwf-facts-list">
                  {exclusions.map((exclusion) => (
                    <li key={exclusion.decisionId}>
                      <span className="pjwf-fact-stage">
                        <StatusTag
                          tone={exclusion.disposition === "accepted" ? "success" : "review"}
                        >
                          {exclusion.disposition === "accepted" ? "保留" : "排除"}
                        </StatusTag>
                      </span>
                      <span className="pjwf-fact-detail">
                        {exclusion.targetKind} · {exclusion.reasonCode}
                        {exclusion.rejectionClass === undefined
                          ? ""
                          : `（${exclusion.rejectionClass}）`}
                      </span>
                      <span className="mono pjwf-fact-ref">{exclusion.decisionId}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </PageStateView>
    </Card>
  );
}
