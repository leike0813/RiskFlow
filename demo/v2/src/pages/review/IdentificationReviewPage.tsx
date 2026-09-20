// P-RV-03 识别复核·修正并通过（E 复核骨架）。
// 骨架：E 复核（候选字段卡 + 字段级修正 diff + 决定记录 + 历史决定区）。
// 数据 branch：review-audit.decide-review；页面级能力位：review-audit.decide（框架层门控）。
// 动作级：「提交修正并通过」需 review-audit.decide；决定种类为
// ReviewDecisionV1 的 approve-revised-candidate，携带修正候选集版本引用。
// 七态：非 ready 态由 PageFrame 承载；路由参数未命中或非识别复核任务时给出自然提示卡片。

import { BRANCH_CAPABILITY } from '../../app/contract-mirror';
import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  LINKS,
  decisionsForTarget,
  identificationCandidateForTask,
  reviewTaskById,
  DECISION_KIND_LABELS,
  type IdentificationReviewCandidate,
  type ReviewTaskFixture,
} from '../../content/review';
import {
  CapabilityGate,
  DiffTable,
  EventTimeline,
  Field,
  FieldCard,
  NotFoundCard,
  VersionedRefText,
} from './widgets';

const DECIDE_CAPABILITY = BRANCH_CAPABILITY['review-audit.decide-review'];

function CandidateCard({ candidate }: { readonly candidate: IdentificationReviewCandidate }) {
  const record = candidate.candidate;
  return (
    <FieldCard title="识别候选（待复核字段）">
      <dl className="rv-field-grid">
        <Field label="工序节点">
          <a href="#/identification/process-model">
            {record.processNodeName}（<span className="mono">{record.processNodeId}</span>）
          </a>
        </Field>
        <Field label="风险源">{record.riskSource}</Field>
        <Field label="风险因素">{record.riskFactor}</Field>
        <Field label="风险事件">{record.riskEvent}</Field>
        <Field label="机理条目">
          <a className="mono" href={LINKS.knowledgeMechanisms}>
            {record.mechanismEntryId}
          </a>
        </Field>
        <Field label="证据资料段">
          <a className="mono" href={LINKS.evidenceTrace}>
            {record.evidenceLocator.sourceSegmentId}
          </a>
        </Field>
        <Field label="模型置信度">
          <span className="mono">{record.modelConfidence.toFixed(2)}</span>
        </Field>
        <Field label="综合置信度">
          <span className="mono">{record.compositeConfidence.value.toFixed(2)}</span>
          <span className="rv-muted">{record.compositeConfidence.basis.join('；')}</span>
        </Field>
      </dl>
      <div className="rv-table-wrap" style={{ marginTop: 'var(--space-3)' }}>
        <table className="rv-table">
          <thead>
            <tr>
              <th scope="col">源要素</th>
              <th scope="col">关系</th>
              <th scope="col">目标要素</th>
            </tr>
          </thead>
          <tbody>
            {record.riskElementRelations.map((relation) => (
              <tr key={`${relation.sourceElement}-${relation.relation}-${relation.targetElement}`}>
                <td>{relation.sourceElement}</td>
                <td>{relation.relation}</td>
                <td>{relation.targetElement}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </FieldCard>
  );
}

function IdentificationReviewContent({
  task,
  candidate,
  capabilities,
}: {
  readonly task: ReviewTaskFixture;
  readonly candidate: IdentificationReviewCandidate;
  readonly capabilities: ReadonlySet<string> | null;
}) {
  const history = decisionsForTarget(task.targetRef.reference.entityId);
  return (
    <div className="rv-page">
      <p className="rv-context-subtitle">
        复核任务{' '}
        <a className="mono" href={LINKS.reviewDetail(task.reviewTaskId)}>
          {task.reviewTaskId}
        </a>{' '}
        · 识别运行{' '}
        <a className="mono" href={task.waitingRunHref ?? LINKS.reviewQueue}>
          {task.waitingRunRef.reference.entityId}
        </a>
      </p>

      <FieldCard title="版本引用">
        <div className="rv-vref-list">
          <VersionedRefText kindLabel="识别分组" reference={candidate.groupRef} />
          <VersionedRefText kindLabel="候选集" reference={candidate.candidateSetRef} />
          <VersionedRefText kindLabel="机理库" reference={candidate.mechanismReleaseRef} />
          <VersionedRefText kindLabel="识别策略集" reference={candidate.identificationPolicyRef} />
          <VersionedRefText kindLabel="复核策略" reference={task.reviewPolicyRef} />
        </div>
      </FieldCard>

      <CandidateCard candidate={candidate} />

      <FieldCard title="字段级修正（修正前 → 修正后）">
        <DiffTable diffs={candidate.fieldCorrections} />
        <p className="rv-muted" style={{ marginTop: 'var(--space-3)' }}>
          修正写入修正候选集{' '}
          <span className="mono">
            {candidate.revisedCandidateSetRef.entityId} · {candidate.revisedCandidateSetRef.versionId}
          </span>
          ，原候选集 {candidate.candidateSetRef.entityId} · {candidate.candidateSetRef.versionId}{' '}
          保留不可变。
        </p>
      </FieldCard>

      <FieldCard title="决定记录（修正并通过）">
        {task.status === 'pending' ? (
          <div className="rv-decision-form">
            <p className="rv-muted">
              决定种类 <span className="mono">approve-revised-candidate</span>
              （修正并通过）；提交后识别运行{' '}
              <span className="mono">{task.waitingRunRef.reference.entityId}</span>{' '}
              按复核解决恢复推进。
            </p>
            <label className="rv-decision-form">
              <span>理由（必填，随决定记录留痕）</span>
              <textarea rows={3} defaultValue="" aria-label="复核理由" />
            </label>
            <div className="rv-form-footer">
              <a className="rv-btn" href={LINKS.reviewDetail(task.reviewTaskId)}>
                返回复核详情
              </a>
              <CapabilityGate capabilities={capabilities} capability={DECIDE_CAPABILITY} primary>
                提交修正并通过
              </CapabilityGate>
            </div>
          </div>
        ) : (
          <p className="rv-muted">
            本任务状态为「{task.status === 'decided' ? '已决定' : '已被替代'}」，不能再提交决定。
          </p>
        )}
      </FieldCard>

      <FieldCard title="历史决定">
        {history.length === 0 ? (
          <p className="rv-muted">本复核对象暂无历史决定。</p>
        ) : (
          <ul className="rv-decision-list">
            {history.map((decision) => (
              <li key={decision.reviewDecisionId} className="rv-decision-item">
                <span>
                  <span className="mono">{decision.reviewDecisionId}</span> ·{' '}
                  {DECISION_KIND_LABELS[decision.decisionKind] ?? decision.decisionKind}
                </span>
                <span className="rv-muted">
                  {decision.actorLabel} · {decision.decidedAt.slice(0, 16).replace('T', ' ')} ·{' '}
                  理由码 <span className="mono">{decision.reasonCode}</span>
                </span>
                <span>{decision.reasonText}</span>
              </li>
            ))}
          </ul>
        )}
      </FieldCard>

      <EventTimeline
        events={[
          {
            at: '2026-08-27 08:52',
            label: '识别运行进入上下文组装与候选推理',
            href: task.waitingRunHref ?? undefined,
          },
          {
            at: task.requestedAt.slice(0, 16).replace('T', ' '),
            label: `验收路由转入人工复核（${task.reviewTaskId}）`,
            href: LINKS.reviewDetail(task.reviewTaskId),
          },
        ]}
      />
    </div>
  );
}

export function IdentificationReviewPage({ input }: { readonly input: RouteRenderInput }) {
  const reviewId = input.params['reviewId'] ?? '';
  const task = reviewTaskById(reviewId);
  const candidate = identificationCandidateForTask(reviewId);
  const mismatched = task !== undefined && task.reviewType !== 'identification-group';
  return (
    <PageFrame
      title="识别复核·修正并通过"
      state={input.pageState}
      skeleton="E"
      emptyMessage="当前没有待复核的识别分组"
      content={
        task === undefined || candidate === undefined ? (
          <NotFoundCard
            kind={mismatched ? '识别复核任务（本任务不是识别分组复核）' : '识别复核任务'}
            id={reviewId}
            backHref={LINKS.reviewQueue}
            backLabel="返回待复核队列"
          />
        ) : (
          <IdentificationReviewContent
            task={task}
            candidate={candidate}
            capabilities={input.capabilities}
          />
        )
      }
    />
  );
}
