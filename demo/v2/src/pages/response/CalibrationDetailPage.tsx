// P-RS-05 校准建议详情（骨架 B 详情；branch warning-response.create-calibration-suggestion；
// 能力位 warning-response.read）。校准建议是校准 Agent 任务候选经确定性校验后的产物：
// 页面呈现来源偏差、建议内容与目标知识版本、Agent 任务来源（模型 / 提示模板 / 工具与
// 预算策略版本）、校验结果，以及人工确认入口（校准生效必须人工确认；复核批准仅创建
// 知识修订草稿，正式发布走知识治理）。动作级门控：复核决定 → review-audit.decide-review。
// 路由标识未命中 fixture 时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import {
  LINKS,
  calibrationById,
  type CalibrationSuggestionView,
} from '../../content/response';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  Field,
  FieldCard,
  GatedAction,
  ReviewStatusChip,
  TraceCard,
  ValidationChip,
  VersionRefLine,
} from './response-shared';
import './response.css';

function CalibrationContent({
  suggestion,
  input,
}: {
  readonly suggestion: CalibrationSuggestionView;
  readonly input: RouteRenderInput;
}) {
  return (
    <div>
      <FieldCard title="校准建议">
        <dl className="rs-fields">
          <Field label="校准建议标识">
            <span className="mono">{suggestion.calibrationSuggestionId}</span>
          </Field>
          <Field label="复核状态">
            <ReviewStatusChip status={suggestion.reviewStatus} />
          </Field>
          <Field label="来源偏差记录">
            <a className="mono" href={LINKS.responseFeedback('FBK-2026-001')}>
              {suggestion.deviationRecordId}
            </a>
            <span className="rs-muted">（见反馈与偏差记录详情）</span>
          </Field>
          <Field label="记录版本">
            <span className="mono">
              {suggestion.version.reference.entityId} · {suggestion.version.reference.versionId}
            </span>
          </Field>
          <Field label="入库审计">
            <span className="mono">{suggestion.audit.actorId}</span> ·{' '}
            <span className="mono">{suggestion.audit.action}</span> ·{' '}
            <span className="mono">{suggestion.audit.recordedAt}</span>
          </Field>
        </dl>
        <p className="rs-note">{suggestion.suggestionSummary}</p>
      </FieldCard>

      <FieldCard title="校准目标">
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>知识对象</th>
                <th>当前版本</th>
                <th>建议调整内容</th>
              </tr>
            </thead>
            <tbody>
              {suggestion.targetKnowledge.map((target) => (
                <tr key={target.ref.entityId}>
                  <td>{target.label}</td>
                  <td>
                    <a className="mono" href={LINKS.knowledgeRuleSets}>
                      {target.ref.entityId} · {target.ref.versionId}
                    </a>
                  </td>
                  <td>{target.change}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="生成来源（校准建议 Agent 任务）">
        <dl className="rs-fields">
          <Field label="Agent 任务">
            <span className="mono">
              {suggestion.agentTask.agentTaskRef.entityId} ·{' '}
              {suggestion.agentTask.agentTaskRef.versionId}
            </span>
          </Field>
          <Field label="任务类型">{suggestion.agentTask.taskTypeLabel}</Field>
          <Field label="触发方式">{suggestion.agentTask.triggerModeLabel}</Field>
        </dl>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <VersionRefLine kind="模型部署" reference={suggestion.agentTask.modelDeploymentRef} />
          <VersionRefLine kind="提示模板" reference={suggestion.agentTask.promptTemplateRef} />
          <VersionRefLine kind="工具策略" reference={suggestion.agentTask.toolPolicyRef} />
          <VersionRefLine kind="预算策略" reference={suggestion.agentTask.budgetPolicyRef} />
        </div>
      </FieldCard>

      <FieldCard title="确定性校验结果">
        <dl className="rs-fields">
          <Field label="校验结果">
            <ValidationChip passed={suggestion.validationResult.passed} />
          </Field>
          <Field label="问题清单">
            {suggestion.validationResult.issues.length === 0 ? (
              <span className="rs-muted">无</span>
            ) : (
              suggestion.validationResult.issues.join('；')
            )}
          </Field>
        </dl>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <VersionRefLine kind="校准校验策略" reference={suggestion.calibrationValidationPolicyRef} />
        </div>
        <p className="rs-note">
          校验通过仅使建议入库成为待复核对象；校准生效必须人工确认，系统不自动修改规则、
          权重、阈值或矩阵版本。
        </p>
      </FieldCard>

      <FieldCard title="人工确认">
        <dl className="rs-fields">
          <Field label="复核任务">
            <a className="mono" href={LINKS.reviewTask(suggestion.reviewTaskRef.entityId)}>
              {suggestion.reviewTaskRef.entityId} · {suggestion.reviewTaskRef.versionId}
            </a>
          </Field>
          <Field label="确认入口">复核专家在复核任务中作出决定</Field>
        </dl>
        <p className="rs-note">
          复核批准仅授权创建知识修订草稿；修订草稿仍须经知识治理审核与发布后才生效，
          不覆盖当前生效的规则与阈值版本。
        </p>
        <div className="rs-btn-row">
          <GatedAction
            label="前往复核决定"
            branch="review-audit.decide-review"
            capabilities={input.capabilities}
            href={LINKS.reviewTask(suggestion.reviewTaskRef.entityId)}
          />
        </div>
      </FieldCard>

      <TraceCard
        items={[
          {
            label: '处置建议',
            id: 'RESP-2026-001',
            href: LINKS.responseRecommendation('RESP-2026-001'),
          },
          {
            label: '反馈与偏差',
            id: suggestion.deviationRecordId,
            href: LINKS.responseFeedback('FBK-2026-001'),
          },
          { label: '校准建议', id: suggestion.calibrationSuggestionId, current: true },
        ]}
      />

      <BusinessTimeline events={suggestion.timeline} />
    </div>
  );
}

export function CalibrationDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const suggestionId = input.params.suggestionId ?? '';
  const suggestion = calibrationById(suggestionId);
  const state =
    input.pageState.kind === 'ready' && suggestion === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title={`校准建议详情 ${suggestionId}`}
      state={state}
      skeleton="B"
      emptyMessage="未找到该校准建议"
      content={
        suggestion === undefined ? null : (
          <CalibrationContent suggestion={suggestion} input={input} />
        )
      }
    />
  );
}
