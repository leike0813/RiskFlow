import { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { PageStateView } from "../components/PageStateView";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  readAssessmentRecordCatalog,
  readCurrentReleaseSet,
  readKnowledgeRelease,
  type AssessmentRecordCatalogItemView,
  type GovernanceReleaseView,
  type RecordCatalogView,
  type VersionRef,
} from "../api/operations";
import { RiskMatrixVersionChart, type RiskMatrixDefinition } from "../charts/RiskMatrixChart";
import { FieldCard, FieldRow, NextPageButton, VersionRefText } from "./assessmentResponseShared";
import "./assessment-response.css";

/**
 * 矩阵定义直接由版本化风险矩阵发布正文投影：刻度取真实分带标识（落点按同一标识匹配），
 * 等级顺序取登记的 ordinal。页面不假设 5×5，也不假设等级是四档。可接受区需要另行取得
 * 风险可接受阈值正文才可绘制，本页不据等级顺序推测阈值，因此不渲染该边界。
 */
const definitionOf = (
  release: GovernanceReleaseView,
): {
  readonly definition: RiskMatrixDefinition;
  readonly matrixId: string;
  readonly matrixVersion: string;
} | null => {
  if (release.body.definitionType !== "risk-matrix") return null;
  const matrix = release.body.matrix;
  const levels = [...matrix.riskLevels].sort((a, b) => a.ordinal - b.ordinal);
  const cellLevels = matrix.possibilityBands.map((possibilityBand) =>
    matrix.consequenceBands.map((consequenceBand) => {
      const cell = matrix.cells.find(
        (candidate) =>
          candidate.possibilityBandId === possibilityBand.bandId &&
          candidate.consequenceBandId === consequenceBand.bandId,
      );
      return cell?.riskLevelId ?? "";
    }),
  );
  return {
    matrixId: matrix.matrixId,
    matrixVersion: matrix.matrixVersion,
    definition: {
      probability: {
        label: "发生可能性 P",
        ticks: matrix.possibilityBands.map((band) => band.bandId),
      },
      consequence: {
        label: "后果严重度 C",
        ticks: matrix.consequenceBands.map((band) => band.bandId),
      },
      levels: levels.map((level) => ({
        key: level.levelId,
        label: level.levelId + "（序 " + level.ordinal + "）",
        // 配色只由发布登记的顺序决定；不在界面重算分带或等级。
        ordinal: level.ordinal,
      })),
      cellLevels,
    },
  };
};

const releaseKeyOf = (ref: VersionRef): string => ref.entityId + "@" + ref.versionId;

/** 冻结矩阵发布按引用去重后各自精确读取；并发上限 4，目录页内引用最多 50 条。 */
const MATRIX_READ_CONCURRENCY = 4;

const mapBounded = async <T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await run(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};

interface MatrixGroup {
  readonly key: string;
  readonly release: GovernanceReleaseView;
  readonly matrixId: string;
  readonly matrixVersion: string;
  readonly definition: RiskMatrixDefinition;
  readonly items: readonly AssessmentRecordCatalogItemView[];
}

interface MatrixCatalogView {
  readonly page: RecordCatalogView;
  readonly groups: readonly MatrixGroup[];
}

/** 页内暂无记录时读当前生效矩阵发布，只用于呈现空网格；有记录时绝不拿当前版本冒充历史。 */
const readEmptyGridReleases = async (
  projectId: string,
  signal: AbortSignal,
): Promise<GovernanceReleaseView[]> => {
  const set = await readCurrentReleaseSet(projectId, signal);
  const ref = set.find((entry) => entry.definitionType === "risk-matrix")?.releaseRef;
  return ref === undefined ? [] : [await readKnowledgeRelease(projectId, ref, signal)];
};

/**
 * P-RA-06 P/C 风险矩阵视图（design D-02、D-09）。
 *
 * 矩阵按记录各自冻结的矩阵发布版本分组：先读当前目录页（≤50），再按引用去重、
 * 以有界并发精确读取每个冻结发布正文，逐版本绘制各自落点，不把历史落点合并到当前矩阵上。
 * 页内没有记录时退化为当前生效矩阵的空网格，保持入口可用。
 */
export default function AssessmentMatrixPage() {
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  // 续页游标绑定当前工程/修订上下文：切换上下文即失效，不把上一工程的游标带过来。
  const contextKey = JSON.stringify([
    selector.projectId,
    selector.revisionId,
    selector.assessmentSources,
  ]);
  const [paged, setPaged] = useState<{ readonly key: string; readonly cursor: string }>();
  const cursor = paged !== undefined && paged.key === contextKey ? paged.cursor : undefined;

  const view = usePageQuery<MatrixCatalogView>(
    async (projectId, signal) => {
      const page = await readAssessmentRecordCatalog(
        projectId,
        { ...(cursor === undefined ? {} : { cursor }) },
        signal,
      );
      const refs: VersionRef[] = [];
      const seen = new Set<string>();
      for (const item of page.items) {
        const ref = item.matrixPlot.riskMatrixRef;
        const key = releaseKeyOf(ref);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      }
      const releases =
        refs.length > 0
          ? await mapBounded(refs, MATRIX_READ_CONCURRENCY, (reference) =>
              readKnowledgeRelease(projectId, { kind: "knowledge-release", reference }, signal),
            )
          : await readEmptyGridReleases(projectId, signal);
      const groups: MatrixGroup[] = [];
      for (const release of releases) {
        const built = definitionOf(release);
        if (built === null) continue;
        const key = releaseKeyOf(release.releaseRef.reference);
        groups.push({
          key,
          release,
          matrixId: built.matrixId,
          matrixVersion: built.matrixVersion,
          definition: built.definition,
          items: page.items.filter((item) => releaseKeyOf(item.matrixPlot.riskMatrixRef) === key),
        });
      }
      return { page, groups };
    },
    [cursor],
  );

  return (
    <AppShell
      activeNav="assessment"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">P/C 风险矩阵视图</h1>
            <p className="page-subtitle">按各记录冻结的矩阵版本分组解释当前页内已登记落点</p>
          </div>
        </header>

        <PageStateView
          state={view.state}
          title="风险矩阵"
          emptyMessage="当前页内暂无已登记记录"
          onRetry={view.retry}
        >
          {({ page, groups }) => (
            <>
              {groups.length === 0 ? (
                <FieldCard title="风险矩阵">
                  <p className="ar-note">当前工程尚无已生效的风险矩阵发布，无法绘制矩阵。</p>
                </FieldCard>
              ) : (
                groups.map((group, index) => (
                  <div key={group.key} style={index === 0 ? undefined : { marginTop: 16 }}>
                    <FieldCard title={"风险矩阵 · " + group.matrixId + " " + group.matrixVersion}>
                      <RiskMatrixVersionChart
                        definition={group.definition}
                        title="P/C 风险矩阵"
                        emptyMessage="该矩阵版本下本页暂无落点"
                        plots={group.items.map((item) => ({
                          possibilityBandId: item.matrixPlot.possibilityBandId,
                          consequenceBandId: item.matrixPlot.consequenceBandId,
                        }))}
                      />
                      <dl style={{ marginTop: 12 }}>
                        <FieldRow label="矩阵发布">
                          <VersionRefText reference={group.release.releaseRef.reference} />
                        </FieldRow>
                        <FieldRow label="矩阵定义">
                          <VersionRefText reference={group.release.definitionRef.reference} />
                        </FieldRow>
                        <FieldRow label="生效时点">
                          <span className="mono">{group.release.effectiveFrom}</span>
                        </FieldRow>
                        <FieldRow label="本页落点数">
                          <span className="mono">{group.items.length}</span>
                        </FieldRow>
                      </dl>
                    </FieldCard>
                  </div>
                ))
              )}

              <Card title="落点清单" style={{ marginTop: 16 }}>
                {page.items.length === 0 ? (
                  <p className="ar-note">当前页内暂无已登记的评估记录。</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>评估记录</th>
                        <th>矩阵版本</th>
                        <th>落点</th>
                        <th>风险等级</th>
                        <th>入口模式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((item) => {
                        const record: AssessmentRecordCatalogItemView = item;
                        return (
                          <tr key={record.assessmentRecordRef.reference.entityId}>
                            <td>
                              <Link
                                className="mono"
                                to={projectPath(
                                  "assessment/records/" +
                                    record.assessmentRecordRef.reference.entityId +
                                    "?version=" +
                                    record.assessmentRecordRef.reference.versionId,
                                )}
                              >
                                {record.assessmentRecordRef.reference.entityId}
                              </Link>
                            </td>
                            <td className="mono">
                              {record.matrixPlot.riskMatrixRef.entityId} ·{" "}
                              {record.matrixPlot.riskMatrixRef.versionId}
                            </td>
                            <td className="mono">
                              {record.matrixPlot.possibilityBandId} ×{" "}
                              {record.matrixPlot.consequenceBandId}
                            </td>
                            <td className="mono">
                              {record.matrixPlot.riskLevelId}（序{" "}
                              {record.matrixPlot.riskLevelOrdinal}）
                            </td>
                            <td className="mono">{record.entryMode}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
                <NextPageButton
                  nextCursor={page.nextCursor}
                  onContinue={(next) => setPaged({ key: contextKey, cursor: next })}
                />
                <p className="ar-note">
                  图上只画当前页内记录的落点，并按各记录冻结的矩阵版本分组；历史记录若冻结的是其它矩阵版本，
                  在对应分组或记录页按其自身版本解释，不合并到当前矩阵上。
                </p>
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
