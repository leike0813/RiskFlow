// P-RS-01 处置建议详情（骨架 B 详情；branch warning-response.validate-and-record；
// 能力位 warning-response.read）。字段分组卡：上下文 / 建议组合与排序 / 三项校验 /
// 版本引用 / 采纳决定；底部业务事件时间线。语义：三项校验通过仅使建议成为正式建议，
// 采纳与执行由人决定，页面不呈现自动生效。路由标识未命中 fixture 时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import {
  CANONICAL_EVIDENCE,
  LINKS,
  VALIDATION_LABELS,
  recommendationById,
  type ResponseRecommendationView,
  type ValidationKey,
} from '../../content/response';
import { warningById, warningLevelById } from '../../content/warning';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  EvidenceLinks,
  Field,
  FieldCard,
  GatedAction,
  ReviewStatusChip,
  TraceCard,
  ValidationChip,
  VersionRefLine,
} from './response-shared';
import './response.css';

const VALIDATION_KEYS: readonly ValidationKey[] = [
  'triggerConsistencyValidation',
  'standardsComplianceValidation',
  'siteFeasibilityValidation',
];

const DECISION_LABELS = { adopted: '已采纳', declined: '不采纳' } as const;

function RecommendationContent({
  recommendation,
  input,
}: {
  readonly recommendation: ResponseRecommendationView;
  readonly input: RouteRenderInput;
}) {
  const warning = warningById(recommendation.warningRecordId);
  const orderedMeasures = recommendation.implementationOrder
    .map((measureId) => recommendation.measureItems.find((item) => item.measureId === measureId))
    .filter((item): item is NonNullable<typeof item> => item !== undefined);
  const allPassed = VALIDATION_KEYS.every((key) => recommendation[key].passed);

  return (
    <div>
      <FieldCard title="处置上下文">
        <dl className="rs-fields">
          <Field label="处置建议标识">
            <span className="mono">{recommendation.responseRecommendationId}</span>
          </Field>
          <Field label="复核状态">
            <ReviewStatusChip status={recommendation.reviewStatus} />
          </Field>
          <Field label="关联预警">
            <a className="mono" href={LINKS.warning(recommendation.warningRecordId)}>
              {recommendation.warningRecordId}
            </a>
            {warning === undefined ? null : (
              <span className="rs-muted">（{warningLevelById(warning.warningLevel).label}）</span>
            )}
          </Field>
          <Field label="处置任务">
            <a className="mono" href={LINKS.warningTask(recommendation.warningResponseTaskId)}>
              {recommendation.warningResponseTaskId}
            </a>
          </Field>
          <Field label="记录版本">
            <span className="mono">
              {recommendation.version.reference.entityId} ·{' '}
              {recommendation.version.reference.versionId}
            </span>
          </Field>
          <Field label="入库审计">
            <span className="mono">{recommendation.audit.actorId}</span> ·{' '}
            <span className="mono">{recommendation.audit.action}</span> ·{' '}
            <span className="mono">{recommendation.audit.recordedAt}</span>
          </Field>
        </dl>
      </FieldCard>

      <FieldCard title="建议组合与排序">
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>顺序</th>
                <th>措施标识</th>
                <th>措施内容</th>
              </tr>
            </thead>
            <tbody>
              {orderedMeasures.map((item, index) => (
                <tr key={item.measureId}>
                  <td className="mono">{index + 1}</td>
                  <td>
                    <a className="mono" href={LINKS.knowledgeMeasures}>
                      {item.measureId}
                    </a>
                  </td>
                  <td>{item.content}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rs-note">排序依据：{recommendation.orderingBasis}。</p>
        <dl className="rs-fields" style={{ marginTop: 'var(--space-3)' }}>
          <Field label="资源需求">{recommendation.resourceRequirements.join('、')}</Field>
          <Field label="候选来源">
            措施检索结果 <span className="mono">{recommendation.measureQueryResultRef.entityId} · {recommendation.measureQueryResultRef.versionId}</span>
            ，处置建议候选 <span className="mono">{recommendation.candidateRef.entityId} · {recommendation.candidateRef.versionId}</span>
          </Field>
        </dl>
      </FieldCard>

      <FieldCard title="目标指标">
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>指标项</th>
                <th>目标口径</th>
              </tr>
            </thead>
            <tbody>
              {recommendation.targetIndicators.map((target) => (
                <tr key={target.indicatorItem}>
                  <td>{target.indicatorItem}</td>
                  <td>{target.targetValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="三项校验结果">
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>校验项</th>
                <th>结果</th>
                <th>问题清单</th>
              </tr>
            </thead>
            <tbody>
              {VALIDATION_KEYS.map((key) => (
                <tr key={key}>
                  <td>{VALIDATION_LABELS[key]}</td>
                  <td>
                    <ValidationChip passed={recommendation[key].passed} />
                  </td>
                  <td>
                    {recommendation[key].issues.length === 0 ? (
                      <span className="rs-muted">无</span>
                    ) : (
                      recommendation[key].issues.join('；')
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rs-note">
          {allPassed
            ? '三项校验全部通过，建议已入库成为正式建议；采纳与执行由人决定，系统不自动执行。'
            : '存在未通过的校验项，建议不成为正式建议。'}
        </p>
      </FieldCard>

      <FieldCard title="版本引用">
        <VersionRefLine kind="措施库" reference={recommendation.measureLibraryRef} />
        <VersionRefLine kind="处置生成策略" reference={recommendation.generationPolicyRef} />
        <VersionRefLine kind="处置校验策略" reference={recommendation.validationPolicyRef} />
        <VersionRefLine kind="现场条件快照" reference={recommendation.siteContextRef} />
      </FieldCard>

      <FieldCard title="采纳决定">
        {recommendation.adoptionDecision === null ? (
          <>
            <p className="rs-muted" style={{ margin: 0 }}>
              尚未登记采纳决定；采纳与执行由人决定。
            </p>
            <div className="rs-btn-row">
              <GatedAction
                label="登记采纳决定"
                branch="warning-response.adopt-recommendation"
                capabilities={input.capabilities}
              />
            </div>
          </>
        ) : (
          <>
            <dl className="rs-fields">
              <Field label="决定">
                <span className="rs-chip rs-chip--pass">
                  {DECISION_LABELS[recommendation.adoptionDecision.decision]}
                </span>
              </Field>
              <Field label="决定引用">
                <span className="mono">
                  {recommendation.adoptionDecision.decisionRef.entityId} ·{' '}
                  {recommendation.adoptionDecision.decisionRef.versionId}
                </span>
              </Field>
              <Field label="决定人">
                {recommendation.adoptionDecision.decidedByLabel}（
                <span className="mono">{recommendation.adoptionDecision.decidedByActorId}</span>）
              </Field>
              <Field label="决定时间">
                <span className="mono">{recommendation.adoptionDecision.decidedAt}</span>
              </Field>
              <Field label="理由">{recommendation.adoptionDecision.reasonCode}</Field>
            </dl>
            <div className="rs-btn-row">
              <GatedAction
                label="登记现场处置执行"
                branch="warning-response.record-execution"
                capabilities={input.capabilities}
                href={LINKS.responseExecutionRegister}
              />
            </div>
          </>
        )}
      </FieldCard>

      <TraceCard
        items={[
          {
            label: '标准化风险记录',
            id: recommendation.riskRecordId,
            href: LINKS.identificationRecord(recommendation.riskRecordId),
          },
          {
            label: '风险评估记录',
            id: recommendation.assessmentRecordId,
            href: LINKS.assessmentRecord(recommendation.assessmentRecordId),
          },
          {
            label: '预警信息',
            id: recommendation.warningRecordId,
            href: LINKS.warning(recommendation.warningRecordId),
          },
          { label: '处置建议', id: recommendation.responseRecommendationId, current: true },
          { label: '执行登记', id: '现场处置执行登记', href: LINKS.responseExecutionRegister },
        ]}
      />

      <FieldCard title="证据引用">
        <EvidenceLinks evidence={[CANONICAL_EVIDENCE]} />
      </FieldCard>

      <BusinessTimeline events={recommendation.timeline} />
    </div>
  );
}

export function RecommendationDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const recommendationId = input.params.recommendationId ?? '';
  const recommendation = recommendationById(recommendationId);
  const state =
    input.pageState.kind === 'ready' && recommendation === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title={`处置建议详情 ${recommendationId}`}
      state={state}
      skeleton="B"
      emptyMessage="未找到该处置建议"
      content={
        recommendation === undefined ? null : (
          <RecommendationContent recommendation={recommendation} input={input} />
        )
      }
    />
  );
}
