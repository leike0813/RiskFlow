// P-RS-03 处置效果预测详情（骨架 B 详情；branch warning-response.calculate-deviation；
// 能力位 warning-response.read）。呈现预测对象、预测后风险状态（P/C/等级分列，矩阵落点
// 经版本化矩阵配置渲染）、预测依据与全部版本引用（处置前监测快照 / 冻结评估依据 /
// 预测策略 / 措施库），预测趋势走图表库 TrendChart。路由标识未命中 fixture 时落入
// 自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import { RiskMatrixVersionChart, TrendChart, type RiskMatrixPlot } from '../../charts';
import { RISK_MATRIX_CONFIG } from '../../content/assessment';
import { LINKS, MEASURE_LIBRARY_REF, forecastById, type EffectForecastView } from '../../content/response';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  Field,
  FieldCard,
  RiskStateFields,
  TraceCard,
  VersionRefLine,
} from './response-shared';
import './response.css';

function ForecastContent({ forecast }: { readonly forecast: EffectForecastView }) {
  const plots: readonly RiskMatrixPlot[] = [
    { id: 'ASSESS-2026-001（处置前）', p: 'P4', c: 'C4' },
    {
      id: `${forecast.forecastId}（预测）`,
      p: `P${forecast.predictedRiskChange.likelihoodScore}`,
      c: `C${forecast.predictedRiskChange.consequenceScore}`,
    },
  ];

  return (
    <div>
      <FieldCard title="预测对象">
        <dl className="rs-fields">
          <Field label="预测标识">
            <span className="mono">{forecast.forecastId}</span>
          </Field>
          <Field label="处置建议">
            <a
              className="mono"
              href={LINKS.responseRecommendation(forecast.responseRecommendationId)}
            >
              {forecast.responseRecommendationId}
            </a>
          </Field>
          <Field label="采纳决定">
            <span className="mono">
              {forecast.adoptionDecisionRef.entityId} · {forecast.adoptionDecisionRef.versionId}
            </span>
          </Field>
          <Field label="预测窗口">{forecast.predictionWindow}</Field>
          <Field label="生成审计">
            <span className="mono">{forecast.audit.actorId}</span> ·{' '}
            <span className="mono">{forecast.audit.action}</span> ·{' '}
            <span className="mono">{forecast.audit.recordedAt}</span>
          </Field>
        </dl>
      </FieldCard>

      <FieldCard title="预测后风险状态">
        <RiskStateFields state={forecast.predictedRiskChange} />
        <div className="rs-charts-row" style={{ marginTop: 'var(--space-4)' }}>
          <RiskMatrixVersionChart
            config={RISK_MATRIX_CONFIG}
            plots={plots}
            title="处置前与预测落点"
            emptyMessage="暂无预测落点"
          />
          <TrendChart
            series={forecast.trend.series}
            thresholds={forecast.trend.thresholds}
            yUnit={forecast.trend.yUnit}
            title="地表沉降短期斜率预测趋势"
            emptyMessage="暂无预测趋势数据"
          />
        </div>
      </FieldCard>

      <FieldCard title="预测指标明细">
        <div className="rs-table-wrap">
          <table className="rs-table">
            <thead>
              <tr>
                <th>指标项</th>
                <th>处置前取值</th>
                <th>预测取值</th>
                <th>目标口径</th>
              </tr>
            </thead>
            <tbody>
              {forecast.predictedIndicators.map((indicator) => (
                <tr key={indicator.indicatorItem}>
                  <td>{indicator.indicatorItem}</td>
                  <td className="mono">
                    {indicator.beforeValue} {indicator.unit}
                  </td>
                  <td className="mono">
                    {indicator.predictedValue} {indicator.unit}
                  </td>
                  <td>{indicator.targetValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="预测依据与版本引用">
        <VersionRefLine kind="处置前监测快照" reference={forecast.preActionMonitoringSnapshotRef} />
        <VersionRefLine kind="冻结评估依据" reference={forecast.frozenAssessmentBasisRef} />
        <VersionRefLine kind="预测策略" reference={forecast.forecastPolicyRef} />
        <VersionRefLine kind="措施库" reference={MEASURE_LIBRARY_REF} />
        <ul className="rs-trace-list" style={{ marginTop: 'var(--space-3)' }}>
          {forecast.basisNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
          <li>
            类比案例入口 <a href={LINKS.knowledgeCases}>类比工程案例库</a>
          </li>
        </ul>
      </FieldCard>

      <TraceCard
        items={[
          {
            label: '处置建议',
            id: forecast.responseRecommendationId,
            href: LINKS.responseRecommendation(forecast.responseRecommendationId),
          },
          { label: '处置效果预测', id: forecast.forecastId, current: true },
          {
            label: '反馈与偏差',
            id: 'FBK-2026-001',
            href: LINKS.responseFeedback('FBK-2026-001'),
          },
        ]}
      />

      <BusinessTimeline events={forecast.timeline} />
    </div>
  );
}

export function PredictionDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const forecastId = input.params.predictionId ?? '';
  const forecast = forecastById(forecastId);
  const state =
    input.pageState.kind === 'ready' && forecast === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  return (
    <PageFrame
      title={`处置效果预测详情 ${forecastId}`}
      state={state}
      skeleton="B"
      emptyMessage="未找到该处置效果预测"
      content={forecast === undefined ? null : <ForecastContent forecast={forecast} />}
    />
  );
}
