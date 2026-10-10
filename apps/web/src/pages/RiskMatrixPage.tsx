import AppShell from "../components/AppShell";
import { AssociatedObjects } from "../components/AssociatedObjects";
import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery } from "../api/engineering";
import {
  listKnowledgeDefinitions,
  readKnowledgeRelease,
  type GovernanceListItemView,
  type GovernanceReleaseView,
  type RiskMatrixView,
} from "../api/operations";
import { LifecycleTag, knowledgeTabs, lifecycleStatusOf } from "./knowledgeShared";
import "./RiskMatrixPage.css";

interface MatrixFacts {
  readonly definitions: GovernanceListItemView[];
  readonly release: GovernanceReleaseView | null;
}

const definitionColumns: DataTableColumn[] = [
  {
    key: "definitionRef",
    title: "矩阵定义",
    render: (row) => (
      <span className="mono">
        {(row.definitionRef as { reference: { entityId: string } }).reference.entityId}
      </span>
    ),
  },
  {
    key: "lifecycleStatus",
    title: "审核状态",
    width: 100,
    render: (row) => (
      <LifecycleTag
        status={row.lifecycleStatus as "draft" | "in-review" | "published" | "deactivated"}
      />
    ),
  },
  {
    key: "currentReleaseRef",
    title: "当前发布",
    width: 140,
    render: (row) => {
      const release = row.currentReleaseRef as
        { reference: { entityId: string; versionId: string } } | undefined;
      return release === undefined ? "—" : <VersionTag>{release.reference.versionId}</VersionTag>;
    },
  },
  { key: "updatedAt", title: "更新时间", width: 170 },
];

export default function RiskMatrixPage() {
  const { selector } = useEngineering();
  const { state, retry } = usePageQuery<MatrixFacts>(async (projectId, signal) => {
    const definitions = await listKnowledgeDefinitions(
      projectId,
      { definitionType: "risk-matrix" },
      signal,
    );
    const published = definitions.items.find((item) => item.currentReleaseRef !== undefined);
    const release =
      published?.currentReleaseRef === undefined
        ? null
        : await readKnowledgeRelease(projectId, published.currentReleaseRef, signal);
    return { definitions: definitions.items, release };
  }, []);

  return (
    <AppShell
      activeNav="knowledge"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">风险矩阵</h1>
            <p className="page-subtitle">风险矩阵版本与分级区间（只读）</p>
          </div>
        </header>

        <SectionTabs items={knowledgeTabs} />

        <PageStateView
          state={state}
          title="风险矩阵"
          emptyMessage="当前工程尚无风险矩阵定义"
          forbiddenHint="当前角色不具备知识库读取权限"
          onRetry={retry}
        >
          {(facts) => (
            <>
              {facts.release === null || facts.release.body.definitionType !== "risk-matrix" ? (
                <Card title="风险矩阵">
                  <div className="kmx-empty">当前工程无已发布风险矩阵（治理空态）</div>
                </Card>
              ) : (
                <Card
                  title={`${facts.release.body.matrix.matrixId}`}
                  extra={
                    <>
                      <LifecycleTag status={lifecycleStatusOf(facts.release)} />
                      <VersionTag>矩阵 {facts.release.body.matrix.matrixVersion}</VersionTag>
                    </>
                  }
                >
                  <MatrixGrid matrix={facts.release.body.matrix} />
                </Card>
              )}

              <Card title="版本列表">
                <DataTable
                  columns={definitionColumns}
                  rows={facts.definitions.map((item) => ({ ...item }))}
                />
              </Card>

              {facts.release !== null && (
                <AssociatedObjects subjectRef={facts.release.releaseRef} />
              )}

              <Card title="分级图例">
                {facts.release !== null && facts.release.body.definitionType === "risk-matrix" ? (
                  <div className="kmx-legend">
                    {facts.release.body.matrix.riskLevels.map((level) => (
                      <span key={level.levelId} className="kmx-level">
                        {level.levelId}（序 {level.ordinal}）
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="kmx-empty">无已发布分级定义</div>
                )}
                <p className="kmx-note">
                  风险等级由发生可能性分值 P 与后果严重性分值 C
                  经矩阵映射确定；矩阵发布后不可原地修改。
                </p>
              </Card>
            </>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}

/** 通用矩阵网格：按发布版本的轴带与单元格渲染，不假定 5×5 形状。 */
function MatrixGrid({ matrix }: { matrix: RiskMatrixView }) {
  const cellLevel = new Map(
    matrix.cells.map((cell) => [
      `${cell.possibilityBandId}|${cell.consequenceBandId}`,
      cell.riskLevelId,
    ]),
  );
  return (
    <div className="kmx-grid-wrap">
      <table className="kmx-grid">
        <thead>
          <tr>
            <th>P \ C</th>
            {matrix.consequenceBands.map((band) => (
              <th key={band.bandId}>
                {band.bandId}
                <span className="kmx-band-range mono">
                  [{band.lower}, {band.upper})
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.possibilityBands.map((possibility) => (
            <tr key={possibility.bandId}>
              <th>
                {possibility.bandId}
                <span className="kmx-band-range mono">
                  [{possibility.lower}, {possibility.upper})
                </span>
              </th>
              {matrix.consequenceBands.map((consequence) => {
                const level = cellLevel.get(`${possibility.bandId}|${consequence.bandId}`);
                return (
                  <td key={consequence.bandId} className="kmx-cell">
                    {level ?? "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
