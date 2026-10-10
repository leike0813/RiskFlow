import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { useEngineering, useProjectPath } from "../api/engineering";
import {
  reviewTabs,
  ReviewDecisionPanel,
  ReviewDecisionRecordCard,
  ReviewTaskFactsCard,
  useLocatedReviewTask,
  type ReviewDecisionOutcome,
} from "./ReviewDetailPage";
import "./ReviewDetailPage.css";

/**
 * 识别候选复核：只呈现该复核类型自身的六个合法分支，「修正并通过」只能选择复核详情
 * 返回的候选引用，不在页面编辑记录正文或置信度。
 */
export default function IdentificationReviewPage() {
  const { selector } = useEngineering();
  const projectPath = useProjectPath();
  const { taskId } = useParams();
  const [searchParams] = useSearchParams();
  const versionId = searchParams.get("version");
  const [outcomes, setOutcomes] = useState<readonly ReviewDecisionOutcome[]>([]);
  const { state, retry } = useLocatedReviewTask(taskId, versionId);

  return (
    <AppShell
      activeNav="review"
      agentContext={
        selector.projectId === null
          ? []
          : [selector.projectId, taskId ?? ""].filter((tag) => tag.length > 0)
      }
    >
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">识别候选复核</h1>
            <p className="page-subtitle">
              原样通过 / 修正并通过 / 确认合并 / 保持分离 / 拒绝 / 退回上游，六种分支各自提交
            </p>
          </div>
        </header>

        <SectionTabs items={reviewTabs} />

        {outcomes.length > 0 && (
          <Card title="决定提交结果" style={{ marginBottom: 16 }}>
            <ul className="rv-outcomes">
              {outcomes.map((outcome, index) => (
                <li key={index} className={outcome.ok ? "rv-ok" : "rv-fail"}>
                  {outcome.label}：{outcome.detail}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <PageStateView
          state={state}
          title="识别候选复核"
          emptyMessage="未找到该识别复核任务"
          forbiddenHint="复核任务不存在，或当前角色不具备识别复核读取权限"
          onRetry={retry}
        >
          {(result) => {
            if (result.kind === "missing-identity") {
              return (
                <Card title="识别候选复核">
                  <div className="rv-muted">
                    缺少复核任务的身份版本。请从复核队列点击识别复核任务进入。
                  </div>
                  <Link className="rv-back" to={projectPath("/review")}>
                    返回复核队列
                  </Link>
                </Card>
              );
            }
            if (
              result.kind === "not-in-queue" ||
              result.taskRef === undefined ||
              result.detail === undefined
            ) {
              return (
                <Card title="识别候选复核">
                  <div className="rv-muted">
                    当前队列页中未见该实体标识与身份版本组合：任务可能已被决定、被取代，或超出本页范围。
                  </div>
                  <Link className="rv-back" to={projectPath("/review")}>
                    返回复核队列
                  </Link>
                </Card>
              );
            }
            const { taskRef, detail } = result;
            const projectId = selector.projectId;
            if (detail.reviewType !== "identification-group") {
              return (
                <Card title="识别候选复核">
                  <div className="rv-muted">
                    该复核任务不是识别候选复核，页面不展示识别分支。请回到复核详情按其复核类型决定。
                  </div>
                  <Link
                    className="rv-back"
                    to={projectPath(
                      `/review-audit/tasks/${encodeURIComponent(detail.reviewTaskRef.reference.entityId)}?version=${encodeURIComponent(detail.reviewTaskRef.reference.versionId)}`,
                    )}
                  >
                    前往复核详情
                  </Link>
                </Card>
              );
            }
            return (
              <div className="rv-stack">
                <ReviewTaskFactsCard detail={detail} />

                <Card title="识别决定" extra={<span>候选由识别所属模块生成，页面不生成候选</span>}>
                  {projectId === null ? (
                    <div className="rv-muted">尚未选择工程，无法提交决定。</div>
                  ) : (
                    <>
                      {detail.revisedCandidateRefs.length === 0 && (
                        <div className="rv-muted">
                          复核详情未返回修正候选引用，「修正并通过」在当前候选集下业务不可用。
                        </div>
                      )}
                      <ReviewDecisionPanel
                        projectId={projectId}
                        taskRef={taskRef}
                        detail={detail}
                        candidateOptions={detail.revisedCandidateRefs.map((candidateRef) => ({
                          entityId: candidateRef.reference.entityId,
                          versionId: candidateRef.reference.versionId,
                        }))}
                        onDecided={(outcome) => {
                          setOutcomes((prev) => [outcome, ...prev]);
                          retry();
                        }}
                      />
                    </>
                  )}
                </Card>

                <ReviewDecisionRecordCard detail={detail} />
              </div>
            );
          }}
        </PageStateView>
      </div>
    </AppShell>
  );
}
