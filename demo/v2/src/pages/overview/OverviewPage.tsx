// P-OV-01 风险态势总览（B 详情骨架 + KPI 横条网格形态）。
// 数据 branch：projection.query（risk-overview 只读投影）；页面级能力位 projection.query
// （框架层门控，本组件不读 URL 审阅参数）。
// KPI 计数、等级分布、矩阵落点、沉降趋势全部由 content/overview.ts 从既有域 fixture
// 派生；矩阵用 RiskMatrixVersionChart + 版本化配置（RISK_MATRIX_CONFIG），无字面量矩阵。
// 七态：非 ready 态由 PageFrame 承载；empty 态提示当前工程暂无风险记录。

import type { RouteRenderInput } from '../../app/routes';
import { DonutChart, RiskMatrixVersionChart, TrendChart } from '../../charts';
import {
  LEVEL_DISTRIBUTION,
  LEVEL_DISTRIBUTION_TOTAL,
  OVERVIEW_BASIS_REFS,
  OVERVIEW_DATA_AS_OF,
  OVERVIEW_KPIS,
  OVERVIEW_MATRIX_PLOTS,
  SETTLEMENT_TREND,
} from '../../content/overview';
import { RISK_MATRIX_CONFIG } from '../../content/assessment';
import { TRACE_CHAIN_EVENTS } from '../../content/review';
import {
  SHELL_PROCESS_OPTIONS,
  SHELL_PROJECT_OPTIONS,
  SHELL_SPATIAL_OPTIONS,
} from '../../content/shell-context';
import { PageFrame } from '../../shared/PageFrame';
import './overview.css';

const KPI_TONE_CLASS: Readonly<Record<string, string>> = {
  neutral: 'ov-kpi-tone-neutral',
  blue: 'ov-kpi-tone-blue',
  review: 'ov-kpi-tone-review',
  risk: 'ov-kpi-tone-risk',
};

function OverviewContent() {
  return (
    <div>
      <p className="ov-subtitle">
        {SHELL_PROJECT_OPTIONS[0].label} · {SHELL_SPATIAL_OPTIONS[0].label} ·{' '}
        {SHELL_PROCESS_OPTIONS[1].label} · 数据时点{' '}
        <span className="mono">{OVERVIEW_DATA_AS_OF}</span>
      </p>

      <div className="ov-kpi-grid" aria-label="风险态势关键指标">
        {OVERVIEW_KPIS.map((kpi) => (
          <a key={kpi.key} className="ov-kpi" href={`#${kpi.path}`}>
            <span className="ov-kpi-head">
              <span className="ov-kpi-label">{kpi.label}</span>
              <span className={`ov-kpi-tone ${KPI_TONE_CLASS[kpi.tone]}`} aria-hidden="true" />
            </span>
            <span className="ov-kpi-value">
              {kpi.value}
              <span className="ov-kpi-unit">{kpi.unit}</span>
            </span>
            <span className="ov-kpi-hint">{kpi.hint}</span>
          </a>
        ))}
      </div>

      <div className="ov-charts-row">
        <section className="ov-card" aria-label="风险矩阵落点总览">
          <h3>风险矩阵落点总览</h3>
          <RiskMatrixVersionChart
            config={RISK_MATRIX_CONFIG}
            plots={OVERVIEW_MATRIX_PLOTS}
            title="P/C 风险矩阵"
            emptyMessage="暂无评估记录"
          />
          <p className="ov-note">
            落点为各风险记录最新评估记录的 P/C 评分映射；明细见{' '}
            <a href="#/assessment/matrix">P/C 风险矩阵视图</a>。
          </p>
        </section>
        <section className="ov-card" aria-label="风险等级分布">
          <h3>风险等级分布</h3>
          <DonutChart
            title="风险等级分布"
            data={LEVEL_DISTRIBUTION}
            centerValue={String(LEVEL_DISTRIBUTION_TOTAL)}
            centerLabel="风险记录"
            emptyMessage="暂无风险记录"
          />
          <p className="ov-note">等级由最新评估记录按风险矩阵版本映射；未评估记录计入「待评估」。</p>
        </section>
      </div>

      <section className="ov-card" aria-label="地表沉降趋势">
        <h3>关键监测指标趋势</h3>
        {SETTLEMENT_TREND === null ? (
          <p className="ov-note">暂无监测序列</p>
        ) : (
          <>
            <TrendChart
              title={SETTLEMENT_TREND.seriesLabel}
              yUnit={SETTLEMENT_TREND.unit}
              thresholds={[
                {
                  value: SETTLEMENT_TREND.threshold.value,
                  label: SETTLEMENT_TREND.threshold.label,
                  riskLevel: SETTLEMENT_TREND.threshold.riskLevel,
                },
              ]}
              series={[
                {
                  key: 'settlement',
                  label: SETTLEMENT_TREND.seriesLabel,
                  points: SETTLEMENT_TREND.points,
                },
              ]}
              emptyMessage="暂无监测样本"
            />
            <p className="ov-note">
              横轴为数据时间；阈值取自监测预警阈值{' '}
              <span className="mono">
                {SETTLEMENT_TREND.threshold.thresholdRef.entityId} ·{' '}
                {SETTLEMENT_TREND.threshold.thresholdRef.versionId}
              </span>
              ；序列明细见 <a href={SETTLEMENT_TREND.monitoringHref}>监测序列详情</a>。
            </p>
          </>
        )}
      </section>

      <section className="ov-card" aria-label="版本引用">
        <h3>版本引用</h3>
        <ul className="ov-vref-list">
          {OVERVIEW_BASIS_REFS.map((item) => (
            <li key={`${item.reference.entityId}-${item.reference.versionId}`}>
              <span>{item.label}</span>{' '}
              <span className="mono">
                {item.reference.entityId} · {item.reference.versionId}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="ov-card" aria-label="业务事件时间线">
        <h3>业务事件时间线</h3>
        <ol className="ov-timeline">
          {TRACE_CHAIN_EVENTS.map((event) => (
            <li key={`${event.at}-${event.label}`}>
              <span className="mono ov-timeline-time">{event.at}</span>
              <span>{event.label}</span>
              {event.href === undefined ? null : (
                <a className="mono" href={event.href}>
                  查看
                </a>
              )}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function OverviewPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="风险态势总览"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前工程暂无风险记录，请先完成风险识别。"
      content={<OverviewContent />}
    />
  );
}
