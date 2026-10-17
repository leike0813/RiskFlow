import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { Card } from "../components/Card";
import { ConfirmButton } from "../components/ConfirmButton";
import { PageStateView } from "../components/PageStateView";
import { SectionTabs } from "../components/SectionTabs";
import { StatusTag, type StatusTone } from "../components/StatusTag";
import { VersionTag } from "../components/VersionTag";
import { useEngineering, usePageQuery, useProjectPath, type PageState } from "../api/engineering";
import { submitReviewDecision, type ReviewTaskRefView as ReviewTaskRef } from "../api/operations";
import { readReviewTaskDetail, type ReviewTaskDetailView } from "../api/agentAuditOperations";
import "./ReviewDetailPage.css";

export const reviewTabs = [
  { to: "/review", label: "复核队列" },
  { to: "/review/audit", label: "审计日志" },
  { to: "/review/trace", label: "证据追溯" },
  { to: "/review/runs", label: "运行记录" },
];

/** 复核类型中文呈现（契约 ReviewTypeV1 五值，UI 不扩张取值）。 */
export const REVIEW_TYPE_LABEL: Record<string, string> = {
  "identification-group": "识别候选复核",
  "knowledge-revision": "知识草案复核",
  "rule-conflict": "规则冲突复核",
  "response-candidate": "处置建议复核",
  "calibration-suggestion": "校准建议复核",
};

export const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending: "待决定",
  decided: "已决定",
  superseded: "已取代",
};

export const REVIEW_STATUS_TONE: Record<string, StatusTone> = {
  pending: "review",
  decided: "success",
  superseded: "neutral",
};

/** 决定写动作的分支：只读授权不等于写权，写可用性只取该分支的 actions 判定。 */
export const REVIEW_DECIDE_BRANCH = "review-audit.decide-review";

/** 契约要求的精确候选集版本引用：实体标识与身份版本缺一不可，UI 不代填。 */
export interface RevisedCandidateRefInput {
  readonly entityId: string;
  readonly versionId: string;
}

export interface ReviewDecisionOption {
  readonly kind: string;
  readonly label: string;
  /** 需要候选集精确引用的决定：识别「修正并通过」与处置「提交修正候选」。 */
  readonly requiresCandidateRef: boolean;
}

/**
 * 契约 ReviewDecisionV1 五类判别联合在 UI 侧的选项表：逐复核类型只列其自身合法分支，
 * 不归并为通用「原样通过」，也不新增第六种决定。
 */
const REVIEW_DECISION_OPTIONS: Readonly<Record<string, readonly ReviewDecisionOption[]>> = {
  "identification-group": [
    { kind: "approve-unchanged", label: "按原样通过", requiresCandidateRef: false },
    { kind: "approve-revised-candidate", label: "修正并通过", requiresCandidateRef: true },
    { kind: "confirm-merge", label: "确认合并", requiresCandidateRef: false },
    { kind: "keep-separate", label: "保持分离", requiresCandidateRef: false },
    { kind: "reject", label: "拒绝", requiresCandidateRef: false },
    { kind: "return-upstream", label: "退回上游", requiresCandidateRef: false },
  ],
  "knowledge-revision": [
    { kind: "approve-publication", label: "批准发布", requiresCandidateRef: false },
    { kind: "reject", label: "拒绝", requiresCandidateRef: false },
    { kind: "return-for-revision", label: "退回修订", requiresCandidateRef: false },
  ],
  "rule-conflict": [
    { kind: "approve-publication", label: "批准发布", requiresCandidateRef: false },
    { kind: "reject", label: "拒绝", requiresCandidateRef: false },
    { kind: "return-for-revision", label: "退回修订", requiresCandidateRef: false },
  ],
  "response-candidate": [
    { kind: "submit-revised-candidate", label: "提交修正候选", requiresCandidateRef: true },
    { kind: "return-upstream", label: "退回上游", requiresCandidateRef: false },
    { kind: "reject", label: "拒绝", requiresCandidateRef: false },
  ],
  "calibration-suggestion": [
    { kind: "approve-draft-creation", label: "批准生成草稿", requiresCandidateRef: false },
    { kind: "reject", label: "拒绝", requiresCandidateRef: false },
    { kind: "return-for-revision", label: "退回修订", requiresCandidateRef: false },
  ],
};

/** 未知复核类型不猜测分支：返回空集合由页面按缺席呈现。 */
export const reviewDecisionOptions = (reviewType: string): readonly ReviewDecisionOption[] =>
  REVIEW_DECISION_OPTIONS[reviewType] ?? [];

const reasonCodeFor = (kind: string): string =>
  kind.startsWith("return-")
    ? "review-return"
    : kind === "reject"
      ? "review-reject"
      : "review-approve";

const candidateKindFor = (reviewType: string): string => {
  if (reviewType === "identification-group") return "identification-candidate-set";
  if (reviewType === "response-candidate") return "recommendation-candidate";
  throw new Error(`复核类型 ${reviewType} 没有候选集引用形态`);
};

/**
 * 统一决定构造器：按复核类型冻结输入，只接受该类型在契约联合中的合法分支；
 * 需要候选集引用的决定必须携带所属模块给出的实体标识与身份版本，UI 不自造候选。
 */
export const buildReviewDecision = (
  reviewType: string,
  option: ReviewDecisionOption,
  candidateRef?: RevisedCandidateRefInput,
): Record<string, unknown> => {
  const target = reviewDecisionOptions(reviewType).find((item) => item.kind === option.kind);
  if (target === undefined) {
    throw new Error(`复核类型 ${reviewType} 不存在决定分支 ${option.kind}`);
  }
  if (!target.requiresCandidateRef) return { reviewType, kind: target.kind };
  if (
    candidateRef === undefined ||
    candidateRef.entityId.trim().length === 0 ||
    candidateRef.versionId.trim().length === 0
  ) {
    throw new Error(`${target.label} 需要所属模块提供的候选集精确版本引用`);
  }
  return {
    reviewType,
    kind: target.kind,
    revisedCandidateRef: {
      kind: candidateKindFor(reviewType),
      reference: { entityId: candidateRef.entityId, versionId: candidateRef.versionId },
    },
  };
};

/** 决定命令幂等键：同一任务同一决定形态重放不重复生效。 */
const decisionCommandId = (
  taskRef: ReviewTaskRef,
  option: ReviewDecisionOption,
  candidateRef?: RevisedCandidateRefInput,
): string => {
  const base = `decide-${taskRef.reviewTaskRef.reference.entityId}-${option.kind}`;
  return candidateRef === undefined ? base : `${base}-${candidateRef.entityId}`;
};

/**
 * 全部复核页面的唯一决定提交路径：经既有 review-audit.decide-review 命令下发，
 * 幂等、陈旧版本与授权仍由服务端闭合。
 */
export const submitReviewTaskDecision = async (request: {
  readonly projectId: string;
  readonly reviewTaskRef: ReviewTaskRef;
  readonly reviewType: string;
  readonly option: ReviewDecisionOption;
  readonly candidateRef?: RevisedCandidateRefInput;
}): Promise<string> => {
  const submitted = await submitReviewDecision(request.projectId, {
    reviewTaskRef: request.reviewTaskRef,
    decision: buildReviewDecision(request.reviewType, request.option, request.candidateRef),
    reasonCode: reasonCodeFor(request.option.kind),
    commandId: decisionCommandId(request.reviewTaskRef, request.option, request.candidateRef),
  });
  return submitted.reviewDecisionRef.reference.entityId;
};

export type DecisionAvailability = "allowed" | "denied" | "business-unavailable" | "hidden";

/** 动作可用性只取 decide-review 分支的读判定；缺项按无权处理，不假设可用。 */
export const decideAvailability = (detail: ReviewTaskDetailView): DecisionAvailability => {
  const action = detail.actions.find((item) => item.branch === REVIEW_DECIDE_BRANCH);
  const availability = action?.availability ?? "denied";
  if (availability === "business-unavailable" || availability === "hidden") return availability;
  if (availability === "allowed")
    return detail.status === "pending" ? "allowed" : "business-unavailable";
  return "denied";
};

/** 不可用原因码取服务端判定，页面不自行解释为权限或业务结论。 */
const decideReasonCode = (detail: ReviewTaskDetailView): string | undefined =>
  detail.actions.find((item) => item.branch === REVIEW_DECIDE_BRANCH)?.reasonCode;

export interface ReviewDecisionOutcome {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

interface DetailQueryResult {
  readonly kind: "missing-identity" | "detail";
  readonly taskRef?: ReviewTaskRef;
  readonly detail?: ReviewTaskDetailView;
}

const DECISION_SUMMARY_LEAD =
  "决定写入审计日志且不可撤销；命令携带幂等键，重复提交同一决定不重复生效";

/**
 * 复核决定面板：队列、详情与识别复核三处共用同一构造器与提交路径，
 * 按钮可用性取 decide-review 分支的真实判定，任务非 pending 时只读。
 */
export function ReviewDecisionPanel({
  projectId,
  taskRef,
  detail,
  candidateOptions,
  onDecided,
}: {
  readonly projectId: string;
  readonly taskRef: ReviewTaskRef;
  readonly detail: ReviewTaskDetailView;
  /** 候选集引用来自所属模块；缺身份版本的条目只能定位，不能据此构造决定。 */
  readonly candidateOptions: readonly { readonly entityId: string; readonly versionId?: string }[];
  readonly onDecided: (outcome: ReviewDecisionOutcome) => void;
}) {
  const [candidateIndex, setCandidateIndex] = useState(0);
  const options = reviewDecisionOptions(detail.reviewType);
  const availability = decideAvailability(detail);
  const selected = candidateOptions[candidateIndex];
  const candidateRef =
    selected !== undefined && selected.versionId !== undefined && selected.versionId.length > 0
      ? { entityId: selected.entityId, versionId: selected.versionId }
      : undefined;

  if (options.length === 0) {
    return (
      <div className="rv-muted">该复核类型在契约中没有可提交的决定分支，暂不支持在此决定。</div>
    );
  }

  const submit = async (option: ReviewDecisionOption) => {
    try {
      const decisionRefId = await submitReviewTaskDecision({
        projectId,
        reviewTaskRef: taskRef,
        reviewType: detail.reviewType,
        option,
        ...(option.requiresCandidateRef && candidateRef !== undefined ? { candidateRef } : {}),
      });
      onDecided({ label: option.label, ok: true, detail: `已登记决定 ${decisionRefId}` });
    } catch (error) {
      const code = error instanceof Error ? error.message : "TERMINAL_FAILURE";
      onDecided({ label: option.label, ok: false, detail: `提交失败（${code}）` });
      throw error;
    }
  };

  return (
    <>
      <ul className="rv-decision-list">
        {options.map((option) => {
          const missingRef = option.requiresCandidateRef && candidateRef === undefined;
          const effective: DecisionAvailability =
            missingRef && availability === "allowed" ? "business-unavailable" : availability;
          const reasonCode = decideReasonCode(detail);
          const reason =
            availability !== "allowed"
              ? `${detail.status === "pending" ? "服务端判定该决定分支当前不可提交" : `任务已${REVIEW_STATUS_LABEL[detail.status] ?? detail.status}，只读`}${reasonCode === undefined ? "" : `（${reasonCode}）`}`
              : missingRef
                ? "缺少所属模块给出的候选集身份版本，无法构造精确决定"
                : undefined;
          return (
            <li key={option.kind} className="rv-decision-item">
              <ConfirmButton
                label={option.label}
                availability={effective}
                {...(reason === undefined ? {} : { unavailableReason: reason })}
                resetKey={`${detail.reviewTaskRef.reference.entityId}-${detail.reviewTaskRef.reference.versionId}`}
                summary={[
                  `工程：${projectId}`,
                  `对象：${REVIEW_TYPE_LABEL[detail.reviewType] ?? detail.reviewType} ${detail.targetRef.kind} ${detail.targetRef.reference.entityId}`,
                  `精确版本：任务 ${detail.reviewTaskRef.reference.versionId} · 目标 ${detail.targetRef.reference.versionId}`,
                  `决定：${option.kind}${candidateRef !== undefined && option.requiresCandidateRef ? ` · 候选 ${candidateRef.entityId}@${candidateRef.versionId}` : ""}`,
                  `预计结果：${option.label}，等待中的运行据此恢复或改道`,
                  `副作用：${DECISION_SUMMARY_LEAD}`,
                ]}
                onConfirm={() => submit(option)}
              />
            </li>
          );
        })}
      </ul>
      {candidateOptions.length > 0 && (
        <fieldset className="rv-candidates">
          <legend>修正候选（取自复核详情返回的候选引用）</legend>
          {candidateOptions.map((candidate, index) => (
            <label key={candidate.entityId} className="rv-candidate">
              <input
                type="radio"
                name="revised-candidate"
                checked={candidateIndex === index}
                onChange={() => setCandidateIndex(index)}
              />
              <span className="mono">{candidate.entityId}</span>
              <span className="rv-muted">
                {candidate.versionId === undefined
                  ? "详情只给出候选标识，未给出身份版本，不能据此构造精确决定"
                  : candidate.versionId}
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </>
  );
}

/** 复核任务详情的只读区块：身份、目标、动作可用性与已登记决定，全部来自复核详情读。 */
export function ReviewTaskFactsCard({ detail }: { readonly detail: ReviewTaskDetailView }) {
  return (
    <Card
      title="复核任务"
      extra={
        <StatusTag tone={REVIEW_STATUS_TONE[detail.status] ?? "neutral"}>
          {REVIEW_STATUS_LABEL[detail.status] ?? detail.status}
        </StatusTag>
      }
    >
      <dl className="rv-field-grid">
        <div className="rv-field">
          <dt>任务标识</dt>
          <dd className="mono">{detail.reviewTaskRef.reference.entityId}</dd>
        </div>
        <div className="rv-field">
          <dt>任务身份版本</dt>
          <dd>
            <VersionTag>{detail.reviewTaskRef.reference.versionId}</VersionTag>
          </dd>
        </div>
        <div className="rv-field">
          <dt>复核类型</dt>
          <dd>{REVIEW_TYPE_LABEL[detail.reviewType] ?? detail.reviewType}</dd>
        </div>
        <div className="rv-field">
          <dt>复核对象</dt>
          <dd className="mono">
            {detail.targetRef.kind} · {detail.targetRef.reference.entityId}
          </dd>
        </div>
        <div className="rv-field">
          <dt>目标版本</dt>
          <dd>
            <VersionTag>{detail.targetRef.reference.versionId}</VersionTag>
          </dd>
        </div>
        <div className="rv-field">
          <dt>等待运行</dt>
          <dd className={detail.reviewTaskRef.waitingRunRef === undefined ? "rv-muted" : "mono"}>
            {detail.reviewTaskRef.waitingRunRef === undefined
              ? "详情未返回等待运行引用"
              : `${detail.reviewTaskRef.waitingRunRef.kind} · ${detail.reviewTaskRef.waitingRunRef.reference.entityId}`}
          </dd>
        </div>
        <div className="rv-field">
          <dt>请求人</dt>
          <dd>{detail.requestedBy}</dd>
        </div>
        <div className="rv-field">
          <dt>请求时间</dt>
          <dd className="mono">{detail.requestedAt}</dd>
        </div>
        <div className="rv-field">
          <dt>决定时间</dt>
          <dd className={detail.decidedAt === undefined ? "rv-muted" : "mono"}>
            {detail.decidedAt ?? "尚未决定"}
          </dd>
        </div>
        <div className="rv-field">
          <dt>取代时间</dt>
          <dd className={detail.supersededAt === undefined ? "rv-muted" : "mono"}>
            {detail.supersededAt ?? "未被取代"}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

/** 已登记决定：原样呈现原五类决定形态，不改写为通用结论。 */
export function ReviewDecisionRecordCard({ detail }: { readonly detail: ReviewTaskDetailView }) {
  return (
    <Card title="已登记决定">
      {detail.decision === undefined ? (
        <div className="rv-muted">该复核任务尚无决定记录。</div>
      ) : (
        <dl className="rv-field-grid">
          <div className="rv-field">
            <dt>决定引用</dt>
            <dd className="mono">{detail.decision.reviewDecisionRef.reference.entityId}</dd>
          </div>
          <div className="rv-field">
            <dt>决定形态</dt>
            <dd className="mono">
              {String(detail.decision.decision.kind)} ·{" "}
              {String(detail.decision.decision.reviewType)}
            </dd>
          </div>
          <div className="rv-field">
            <dt>原因码</dt>
            <dd className="mono">{detail.decision.reasonCode}</dd>
          </div>
          <div className="rv-field">
            <dt>决定人</dt>
            <dd>{detail.decision.actorRef}</dd>
          </div>
          <div className="rv-field">
            <dt>决定时间</dt>
            <dd className="mono">{detail.decision.decidedAt}</dd>
          </div>
          {detail.decision.decision.revisedCandidateRef !== undefined && (
            <div className="rv-field">
              <dt>所选候选</dt>
              <dd className="mono">
                {String(
                  (
                    detail.decision.decision.revisedCandidateRef as {
                      reference?: { entityId?: string; versionId?: string };
                    }
                  ).reference?.entityId,
                )}{" "}
                <VersionTag>
                  {String(
                    (
                      detail.decision.decision.revisedCandidateRef as {
                        reference?: { entityId?: string; versionId?: string };
                      }
                    ).reference?.versionId,
                  )}
                </VersionTag>
              </dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

/**
 * 深链按精确身份窄读；决定所需完整任务引用只取所属详情返回值。
 */
export const useLocatedReviewTask = (
  taskId: string | undefined,
  versionId: string | null,
): {
  readonly state: PageState<DetailQueryResult> | { readonly kind: "idle" };
  readonly retry: () => void;
} =>
  usePageQuery<DetailQueryResult>(
    async (projectId, signal) => {
      if (taskId === undefined || versionId === null) return { kind: "missing-identity" };
      const detail = await readReviewTaskDetail(
        projectId,
        { kind: "review-task", reference: { entityId: taskId, versionId } },
        signal,
      );
      return {
        kind: "detail",
        taskRef: {
          reviewTaskRef: { kind: "review-task", reference: detail.reviewTaskRef.reference },
          reviewType: detail.reviewTaskRef.reviewType,
          targetRef: detail.reviewTaskRef.targetRef,
          waitingRunRef: detail.reviewTaskRef.waitingRunRef,
        },
        detail,
      };
    },
    [taskId, versionId],
  );

export default function ReviewDetailPage() {
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
            <h1 className="page-title">复核详情</h1>
            <p className="page-subtitle">按实体标识与身份版本定位的复核任务、决定与后续精确引用</p>
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
          title="复核详情"
          emptyMessage="未找到该复核任务"
          forbiddenHint="复核任务不存在，或当前角色不具备复核详情读取权限"
          onRetry={retry}
        >
          {(result) => {
            if (result.kind === "missing-identity") {
              return (
                <Card title="复核详情">
                  <div className="rv-muted">
                    缺少复核任务的身份版本。请从复核队列点击任务进入，并在地址栏携带
                    <span className="mono"> ?version=&lt;身份版本&gt;</span>。
                  </div>
                  <Link className="rv-back" to={projectPath("/review")}>
                    返回复核队列
                  </Link>
                </Card>
              );
            }
            if (result.taskRef === undefined || result.detail === undefined) {
              return (
                <Card title="复核详情">
                  <div className="rv-muted">复核任务不可用，请返回复核队列选择任务。</div>
                  <Link className="rv-back" to={projectPath("/review")}>
                    返回复核队列
                  </Link>
                </Card>
              );
            }
            const { taskRef, detail } = result;
            const projectId = selector.projectId;
            return (
              <div className="rv-stack">
                <ReviewTaskFactsCard detail={detail} />

                {detail.reviewType === "identification-group" && (
                  <Link
                    className="rv-jump"
                    to={projectPath(
                      `/review-audit/identification/${encodeURIComponent(detail.reviewTaskRef.reference.entityId)}?version=${encodeURIComponent(detail.reviewTaskRef.reference.versionId)}`,
                    )}
                  >
                    进入识别候选复核（选择修正候选）
                  </Link>
                )}

                <Card title="提交决定">
                  {projectId === null ? (
                    <div className="rv-muted">尚未选择工程，无法提交决定。</div>
                  ) : (
                    <ReviewDecisionPanel
                      projectId={projectId}
                      taskRef={taskRef}
                      detail={detail}
                      candidateOptions={[]}
                      onDecided={(outcome) => {
                        setOutcomes((prev) => [outcome, ...prev]);
                        retry();
                      }}
                    />
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
