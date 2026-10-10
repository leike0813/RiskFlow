import { useState } from "react";
import { Link } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  readAssessmentRecordCatalog,
  readReassessmentHistory,
  type AssessmentRecordCatalogItemView,
  type KindRef,
  type RecordCatalogView,
  type ReassessmentHistoryView,
} from "../api/operations";
import { FieldCard, NextPageButton } from "./assessmentResponseShared";
import "./assessment-response.css";

const ASSESSMENT_TABS = [
  { to: "/assessment", label: "待评估" },
  { to: "/assessment/records", label: "评估记录" },
  { to: "/assessment/reassessments", label: "重评历史" },
  { to: "/assessment/matrix", label: "风险矩阵" },
];

/**
 * P-RA-07 重评历史（design D-02、D-12）。
 *
 * 原因与变化引用取 C30 保存的入口事实，不从冻结引用反推、也不由页面推断"改了什么"。
 * 入口元数据缺失时服务端失败闭合，页面显示失败而不是给出默认原因或空变化集合。
 */
export default function ReassessmentsPage() {
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const contextKey = JSON.stringify([
    selector.projectId,
    selector.revisionId,
    selector.assessmentSources,
  ]);
  const [selection, setSelection] = useState<{ key: string; reference: KindRef }>();
  const riskInput = selection?.key === contextKey ? selection.reference : null;
  const setRiskInput = (reference: KindRef) => setSelection({ key: contextKey, reference });
  const cursorKey = contextKey + JSON.stringify(riskInput);
  const [pageCursor, setPageCursor] = useState<{ key: string; cursor: string | undefined }>();
  const cursor = pageCursor?.key === cursorKey ? pageCursor.cursor : undefined;
  const setCursor = (next: string | undefined) => setPageCursor({ key: cursorKey, cursor: next });
  const [catalogPage, setCatalogPage] = useState<{ key: string; cursor: string }>();
  const catalogCursor = catalogPage?.key === contextKey ? catalogPage.cursor : undefined;

  const catalog = usePageQuery<RecordCatalogView>(
    (projectId, signal) =>
      readAssessmentRecordCatalog(
        projectId,
        {
          entryMode: "reassess",
          ...(catalogCursor === undefined ? {} : { cursor: catalogCursor }),
        },
        signal,
      ),
    [catalogCursor],
  );
  const history = usePageQuery<ReassessmentHistoryView>(
    (projectId, signal) =>
      riskInput === null
        ? Promise.reject(new Error("no-risk-input"))
        : readReassessmentHistory(
            projectId,
            { riskInput, ...(cursor === undefined ? {} : { cursor }) },
            signal,
          ),
    [riskInput?.reference.entityId, riskInput?.reference.versionId, cursor],
  );

  return (
    <AppShell
      activeNav="assessment"
      agentContext={selector.projectId === null ? [] : [selector.projectId]}
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">重评历史</h1>
            <p className="page-subtitle">按已保存的重评入口事实解释每次重评</p>
          </div>
        </header>
        <SectionTabs items={ASSESSMENT_TABS} />

        <Card title="风险输入">
          <PageStateView
            state={catalog.state}
            title="重评过的风险输入"
            emptyMessage="当前工程暂无重评记录"
            onRetry={catalog.retry}
          >
            {(page) => (
              <>
                <ul className="ar-ref-list">
                  {page.items.map((item: AssessmentRecordCatalogItemView) => (
                    <li key={item.riskInput.reference.entityId}>
                      <button
                        type="button"
                        className={`ar-chip${
                          riskInput?.reference.entityId === item.riskInput.reference.entityId
                            ? " ar-chip--active"
                            : ""
                        }`}
                        onClick={() => {
                          setRiskInput(item.riskInput);
                          setCursor(undefined);
                        }}
                      >
                        {item.riskInput.reference.entityId}
                      </button>
                    </li>
                  ))}
                </ul>
                <NextPageButton
                  nextCursor={page.nextCursor}
                  onContinue={(cursor) => setCatalogPage({ key: contextKey, cursor })}
                />
              </>
            )}
          </PageStateView>
        </Card>

        {riskInput !== null && (
          <Card title="重评记录" style={{ marginTop: 16 }}>
            <PageStateView
              state={history.state}
              title="重评记录"
              emptyMessage="该风险输入暂无已登记的重评记录"
              onRetry={history.retry}
            >
              {(page) => (
                <>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>重评记录</th>
                        <th>前驱记录</th>
                        <th>原因</th>
                        <th>变化引用</th>
                        <th>P / C</th>
                        <th>登记时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((item) => (
                        <tr key={item.assessmentRecordRef.reference.entityId}>
                          <td>
                            <Link
                              className="mono"
                              to={projectPath(
                                `assessment/records/${item.assessmentRecordRef.reference.entityId}?version=${item.assessmentRecordRef.reference.versionId}`,
                              )}
                            >
                              {item.assessmentRecordRef.reference.entityId}
                            </Link>
                          </td>
                          <td className="mono">
                            {item.previousAssessmentRecordRef === undefined
                              ? "—"
                              : item.previousAssessmentRecordRef.reference.entityId}
                          </td>
                          <td className="mono">{item.reason ?? "—"}</td>
                          <td>
                            {item.changedInputRefs.length === 0 ? (
                              <span className="ar-note">无变化引用</span>
                            ) : (
                              <ul className="ar-ref-list">
                                {item.changedInputRefs.map((ref) => (
                                  <li
                                    key={`${ref.kind}-${ref.reference.entityId}`}
                                    className="mono"
                                  >
                                    {ref.kind}: {ref.reference.entityId}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </td>
                          <td className="mono">
                            {item.likelihoodScore.toFixed(2)} / {item.consequenceScore.toFixed(2)}
                          </td>
                          <td className="mono">{item.occurredAt}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <NextPageButton nextCursor={page.nextCursor} onContinue={setCursor} />
                </>
              )}
            </PageStateView>
          </Card>
        )}

        {riskInput === null && (
          <FieldCard title="选择风险输入">
            <p className="ar-note">
              重评历史按风险输入组织，请先从上方选择一个已登记重评的风险输入。
            </p>
          </FieldCard>
        )}
      </div>
    </AppShell>
  );
}
