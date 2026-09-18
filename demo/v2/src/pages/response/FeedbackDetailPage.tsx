// P-RS-04 反馈与偏差记录详情（骨架 B 详情；branch warning-response.record-feedback；
// 能力位 warning-response.read）。上半为反馈登记（执行记录 / 处置后监测快照 / 反馈材料 /
// 实测指标 / 证据引用），下半为偏差记录 DEV-2026-001：预测值与实际值对照（P/C/等级分列）、
// 偏差值与计算口径、偏差阈值版本、超限判定与校准建议入口。动作级门控：登记补充反馈 →
// warning-response.record-feedback。路由标识未命中 fixture 时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import { RiskMatrixVersionChart, type RiskMatrixPlot } from '../../charts';
import { RISK_MATRIX_CONFIG } from '../../content/assessment';
import {
  LINKS,
  RESPONSE_POLICY_REFS,
  deviationById,
  feedbackById,
  type DeviationRecordView,
  type FeedbackRecordView,
} from '../../content/response';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  EvidenceLinks,
  Field,
  FieldCard,
  GatedAction,
  ReviewStatusChip,
  RiskStateFields,
  TraceCard,
  VersionRefLine,
} from './response-shared';
import './response.css';

function DeviationCard({ deviation }: { readonly deviation: DeviationRecordView }) {
  const plots: readonly RiskMatrixPlot[] = [
    {
      id: `${deviation.forecastId}（预测）`,
      p: `P${deviation.predictedRiskChange.likelihoodScore}`,
      c: `C${deviation.predictedRiskChange.consequenceScore}`,
    },
    {
      id: `${deviation.deviationRecordId}（实际）`,
      p: `P${deviation.actualRiskChange.likelihoodScore}`,
      c: `C${deviation.actualRiskChange.consequenceScore}`,
    },
  ];

  return (
    <FieldCard title="偏差记录">
      <dl className="rs-fields">
        <Field label="偏差记录标识">
          <span className="mono">{deviation.deviationRecordId}</span>
        </Field>
        <Field label="复核状态">
          <ReviewStatusChip status={deviation.reviewStatus} />
        </Field>
        <Field label="偏差值">
          <span className="mono">{deviation.deviationValue.toFixed(1)}</span>{' '}
          <span className={`rs-chip ${deviation.exceeded ? 'rs-chip--fail' : 'rs-chip--pass'}`}>
            {deviation.exceeded ? '超过冻结阈值' : '在冻结阈值内'}
          </span>
        </Field>
        <Field label="冻结阈值">
          <span className="mono">{deviation.deviationThresholdValue}</span>
        </Field>
      </dl>

      <div className="rs-compare" style={{ marginTop: 'var(--space-4)' }}>
        <div className="rs-compare-box">
          <h4 className="rs-compare-title">预测值（{deviation.forecastId}）</h4>
          <RiskStateFields state={deviation.predictedRiskChange} />
        </div>
        <div className="rs-compare-box">
          <h4 className="rs-compare-title">实际值（处置后）</h4>
          <RiskStateFields state={deviation.actualRiskChange} />
        </div>
      </div>

      <div className="rs-charts-row" style={{ marginTop: 'var(--space-4)' }}>
        <RiskMatrixVersionChart
          config={RISK_MATRIX_CONFIG}
          plots={plots}
          title="预测与实际落点对照"
          emptyMessage="暂无对照落点"
        />
      </div>

      <p className="rs-note">偏差计算口径：{deviation.deviationBasis}。</p>

      <dl className="rs-fields" style={{ marginTop: 'var(--space-3)' }}>
        <Field label="证据引用">
          <EvidenceLinks evidence={deviation.evidenceReferences} />
        </Field>
        <Field label="偏差审计">
          <span className="mono">{deviation.audit.action}</span> ·{' '}
          <span className="mono">{deviation.audit.recordedAt}</span>
        </Field>
        <Field label="校准建议">
          <a className="mono" href={LINKS.responseCalibration(deviation.calibrationRecommendation)}>
            {deviation.calibrationRecommendation}
          </a>
        </Field>
      </dl>

      <VersionRefLine kind="偏差阈值" reference={deviation.deviationThresholdVersion} />
      <VersionRefLine kind="偏差判定策略" reference={RESPONSE_POLICY_REFS.deviationPolicy} />
    </FieldCard>
  );
}

function FeedbackContent({
  feedback,
  input,
}: {
  readonly feedback: FeedbackRecordView;
  readonly input: RouteRenderInput;
}) {
  const deviation = deviationById(feedback.deviationRecordId);

  return (
    <div>
      <FieldCard title="反馈登记">
        <dl className="rs-fields">
          <Field label="反馈标识">
            <span className="mono">{feedback.feedbackId}</span>
          </Field>
          <Field label="执行记录">
            <span className="mono">{feedback.executionRecordId}</span>
          </Field>
          <Field label="处置建议">
            <a
              className="mono"
              href={LINKS.responseRecommendation(feedback.responseRecommendationId)}
            >
              {feedback.responseRecommendationId}
            </a>
          </Field>
          <Field label="处置任务">
            <a className="mono" href={LINKS.warningTask(feedback.warningResponseTaskId)}>
              {feedback.warningResponseTaskId}
            </a>
          </Field>
          <Field label="反馈时间">
            <span className="mono">{feedback.occurredAt}</span>
          </Field>
          <Field label="反馈材料">
            <span className="mono">
              {feedback.feedbackArtifactRef.entityId} · {feedback.feedbackArtifactRef.versionId}
            </span>
          </Field>
          <Field label="登记审计">
            <span className="mono">{feedback.audit.actorId}</span> ·{' '}
            <span className="mono">{feedback.audit.action}</span> ·{' '}
            <span className="mono">{feedback.audit.recordedAt}</span>
          </Field>
        </dl>
        <p className="rs-note">{feedback.summary}</p>
      </FieldCard>

      <FieldCard title="处置后实测指标">
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>指标项</th>
                <th>实测值</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {feedback.observedIndicators.map((indicator) => (
                <tr key={indicator.indicatorItem}>
                  <td>{indicator.indicatorItem}</td>
                  <td className="mono">
                    {indicator.value} {indicator.unit}
                  </td>
                  <td>{indicator.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="rs-fields" style={{ marginTop: 'var(--space-3)' }}>
          <Field label="证据引用">
            <EvidenceLinks evidence={feedback.evidenceReferences} />
          </Field>
        </dl>
        <div className="rs-btn-row">
          <GatedAction
            label="登记补充反馈"
            branch="warning-response.record-feedback"
            capabilities={input.capabilities}
          />
        </div>
      </FieldCard>

      {deviation === undefined ? null : <DeviationCard deviation={deviation} />}

      <FieldCard title="版本引用">
        <VersionRefLine
          kind="处置后监测快照"
          reference={feedback.postActionMonitoringSnapshotRef}
        />
      </FieldCard>

      <TraceCard
        items={[
          {
            label: '处置建议',
            id: feedback.responseRecommendationId,
            href: LINKS.responseRecommendation(feedback.responseRecommendationId),
          },
          { label: '执行登记', id: feedback.executionRecordId, href: LINKS.responseExecutionRegister },
          {
            label: '处置效果预测',
            id: feedback.forecastId,
            href: LINKS.responsePrediction(feedback.forecastId),
          },
          { label: '反馈与偏差', id: feedback.feedbackId, current: true },
          ...(deviation === undefined
            ? []
            : [
                {
                  label: '校准建议',
                  id: deviation.calibrationRecommendation,
                  href: LINKS.responseCalibration(deviation.calibrationRecommendation),
                },
              ]),
        ]}
      />

      <BusinessTimeline events={deviation?.timeline ?? []} />
    </div>
  );
}

export function FeedbackDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const feedbackId = input.params.feedbackId ?? '';
  const feedback = feedbackById(feedbackId);
  const state =
    input.pageState.kind === 'ready' && feedback === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title={`反馈与偏差记录详情 ${feedbackId}`}
      state={state}
      skeleton="B"
      emptyMessage="未找到该反馈与偏差记录"
      content={
        feedback === undefined ? null : <FeedbackContent feedback={feedback} input={input} />
      }
    />
  );
}
