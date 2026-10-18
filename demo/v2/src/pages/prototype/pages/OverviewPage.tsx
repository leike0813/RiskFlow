// PROTOTYPE · THROWAWAY — 票 05 第 1 页：风险总览仪表盘。
// 四区块（票 02 定）：态势分布 + 变化时间线 + 待办摘要 + 投料入口。

import { TrendChart } from '../../../charts';
import { PENDING_RISKS, matrixLevelAt } from '../../../content/assessment';
import { INGESTION_TASKS } from '../../../content/project';
import { pendingReviewTasks } from '../../../content/review';
import {
  LEVEL_DISTRIBUTION,
  LEVEL_DISTRIBUTION_TOTAL,
  OVERVIEW_BASIS_REFS,
  OVERVIEW_DATA_AS_OF,
  OVERVIEW_KPIS,
  OVERVIEW_MATRIX_PLOTS,
  SETTLEMENT_TREND,
  riskLevelIndex,
} from '../../../content/overview';
import { WARNING_RECORDS, warningLevelById } from '../../../content/warning';
import { AgentNote, Ids, RiskBadge, Section, StateTag, Stats, Tag, Timeline } from '../parts';

/** 外壳按 hash 切换页面；跳转第一跳用同一入口，不新增路由层。 */
function goto(pageKey: string) {
  window.location.hash = `#/prototype/ui?p=${pageKey}`;
}

type Todo = { readonly kind: string; readonly item: string; readonly why: string; readonly state: 'current' | 'pending' };

const TODOS: readonly Todo[] = [
  ...pendingReviewTasks().map<Todo>((task) => ({
    kind: '复核',
    item: task.targetLabel,
    why: task.triggerReason,
    state: 'current' as const,
  })),
  ...PENDING_RISKS.filter((risk) => risk.status !== 'assessed').map<Todo>((risk) => ({
    kind: '评估',
    item: risk.riskEvent,
    why: `综合置信度 ${risk.compositeConfidence.value.toFixed(2)}，工序 ${risk.processNodeName}`,
    state: 'pending' as const,
  })),
  ...INGESTION_TASKS.filter((task) => task.status !== 'succeeded').map<Todo>((task) => ({
    kind: '资料接入',
    item: task.subjectLabel,
    why: task.stages.find((stage) => stage.status === 'failed')?.errorCode
      ? `卡在「${task.stages.find((stage) => stage.status === 'failed')?.label}」，需重投`
      : '接入未完成',
    state: 'pending' as const,
  })),
];

const EVENTS = [
  ...WARNING_RECORDS.map((record) => {
    const level = warningLevelById(record.warningLevel);
    return {
      time: record.openedAt,
      title: `${record.riskEventSummary} · 开立预警`,
      badge: <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />,
      body: record.triggerType,
    };
  }),
  ...pendingReviewTasks().map((task) => ({
    time: task.requestedAt,
    title: `${task.targetLabel} · 提请人工复核`,
    badge: <Tag>待你决定</Tag>,
    body: task.triggerReason,
  })),
]
  .sort((a, b) => (a.time < b.time ? 1 : -1))
  .slice(0, 6);

export function OverviewPage() {
  const calibrationTask = pendingReviewTasks().find((task) => task.reviewType === 'calibration-suggestion');
  const plots = OVERVIEW_MATRIX_PLOTS.reduce<Record<string, number>>((acc, plot) => {
    const key = `${plot.p} / ${plot.c}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">站隧一体化标 · 风险总览</div>
          <h1 className="dl-h1">本工程风险态势</h1>
          <div className="dl-head-meta dl-sm dl-faint">
            <span>数据时点 {OVERVIEW_DATA_AS_OF}</span>
            <span>·</span>
            <span>风险记录 {LEVEL_DISTRIBUTION_TOTAL} 条</span>
            <span>·</span>
            <span>评估口径见页面底部</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--primary" type="button" onClick={() => goto('documentList')}>
            上传资料
          </button>
          <button className="dl-btn" type="button" onClick={() => goto('documentList')}>
            投送监测批次
          </button>
        </div>
      </header>

      <AgentNote
        why={`依据 ${OVERVIEW_BASIS_REFS.length} 项评估口径与 ${WARNING_RECORDS.length} 条生效预警；本区只摆事实与待你决定的事，不代你决定。`}
        actions={
          <button className="dl-btn dl-btn--sm" type="button" onClick={() => goto('pendingAssessment')}>
            看待办
          </button>
        }
      >
        助手在读本工程今日结果：新增 {OVERVIEW_MATRIX_PLOTS.length} 条风险的最新评估已入库，
        {calibrationTask ? <>其中「{calibrationTask.targetLabel}」偏差超阈值，需要你确认是否采纳。</> : '暂无待你确认的偏差。'}
      </AgentNote>

      <Stats
        items={OVERVIEW_KPIS.map((kpi) => ({
          label: `${kpi.label} · ${kpi.hint}`,
          value: (
            <>
              {kpi.value}
              <span className="dl-sm dl-faint"> {kpi.unit}</span>
            </>
          ),
        }))}
      />

      <Section
        title="态势分布"
        action={<span className="dl-xs dl-faint">按最新评估口径；未评估单列中性项</span>}
      >
        <div style={{ display: 'flex', gap: 2, height: 8, marginBottom: 'var(--dl-s3)' }}>
          {LEVEL_DISTRIBUTION.map((slice) => (
            <div
              key={slice.key}
              title={`${slice.label} ${slice.value} 条`}
              style={{
                width: `${(slice.value / LEVEL_DISTRIBUTION_TOTAL) * 100}%`,
                background: slice.riskLevel ? 'var(--dl-border-strong)' : 'var(--dl-border)',
                borderRadius: 2,
              }}
            />
          ))}
        </div>
        <table className="dl-table">
          <tbody>
            {LEVEL_DISTRIBUTION.map((slice) => (
              <tr key={slice.key}>
                <td style={{ width: 160 }}>
                  {slice.riskLevel ? (
                    <RiskBadge levelId={`level-${slice.riskLevel}`} label={slice.label} />
                  ) : (
                    <Tag>{slice.label}</Tag>
                  )}
                </td>
                <td className="is-num is-right" style={{ width: 64 }}>{slice.value}</td>
                <td className="dl-faint dl-sm">
                  占全部风险记录 {Math.round((slice.value / LEVEL_DISTRIBUTION_TOTAL) * 100)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="dl-h3 dl-faint" style={{ margin: 'var(--dl-s5) 0 var(--dl-s2)' }}>
          矩阵落点（行 可能性 · 列 后果，维度随矩阵口径）
        </div>
        <table className="dl-table">
          <thead>
            <tr>
              <th>落点</th>
              <th>对应等级</th>
              <th className="is-right">条数</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(plots).map(([plot, count]) => {
              const [p, c] = plot.split(' / ');
              const level = matrixLevelAt(p, c);
              return (
                <tr key={plot}>
                  <td className="dl-mono">{plot}</td>
                  <td>
                    {level ? (
                      <RiskBadge levelId={`level-${riskLevelIndex(level.key)}`} label={level.label} />
                    ) : (
                      <span className="dl-faint">落在矩阵口径外</span>
                    )}
                  </td>
                  <td className="is-num is-right">{count}</td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {SETTLEMENT_TREND ? (
          <div style={{ marginTop: 'var(--dl-s5)' }}>
            <div className="dl-h3 dl-faint" style={{ marginBottom: 'var(--dl-s2)' }}>
              {SETTLEMENT_TREND.seriesLabel} · 近 {SETTLEMENT_TREND.points.length} 期（越限段铺风险色）
            </div>
            <TrendChart
              series={[{ key: 'settlement', label: SETTLEMENT_TREND.seriesLabel, points: SETTLEMENT_TREND.points }]}
              thresholds={[
                {
                  value: SETTLEMENT_TREND.threshold.value,
                  label: SETTLEMENT_TREND.threshold.label,
                  riskLevel: SETTLEMENT_TREND.threshold.riskLevel,
                },
              ]}
              yUnit={SETTLEMENT_TREND.unit}
              width={720}
              height={200}
            />
          </div>
        ) : null}
      </Section>

      <Section title="变化时间线" action={<span className="dl-xs dl-faint">最近 6 条业务事件</span>}>
        <Timeline
          items={EVENTS.map((event, index) => ({
            at: event.time.slice(5, 16).replace('T', ' '),
            title: event.title,
            state: index === 0 ? 'current' : 'done',
            meta: event.badge,
            body: <div className="dl-sm dl-faint">{event.body}</div>,
          }))}
        />
      </Section>

      <Section
        title="待办摘要"
        action={<span className="dl-xs dl-faint">{TODOS.length} 项等你处理</span>}
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 72 }}>类别</th>
              <th>事项</th>
              <th style={{ width: '34%' }}>等你决定的原因</th>
              <th style={{ width: 72 }}>状态</th>
            </tr>
          </thead>
          <tbody>
            {TODOS.map((todo) => (
              <tr key={`${todo.kind}-${todo.item}`}>
                <td><Tag>{todo.kind}</Tag></td>
                <td>{todo.item}</td>
                <td className="dl-sm dl-faint">{todo.why}</td>
                <td><StateTag state={todo.state}>{todo.state === 'current' ? '等你决定' : '排队中'}</StateTag></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Ids pairs={OVERVIEW_BASIS_REFS.map((ref) => [ref.label, `${ref.reference.entityId} ${ref.reference.versionId}`])} />
    </div>
  );
}
