// PROTOTYPE · THROWAWAY — 票 05 第 16 页：预警中心

import {
  WARNING_LEVELS,
  WARNING_RECORDS,
  WARNING_RESPONSE_TASKS,
  WARNING_TRIGGER_TYPES,
  taskStatusById,
  triggerSummaryOf,
  warningLevelById,
  warningTaskForWarning,
  type WarningRecordView,
} from '../../../content/warning';
import { AgentNote, Ids, RiskBadge, Section, Stats, Tag } from '../parts';

function Delivery({ warning }: { warning: WarningRecordView }) {
  const pending = warning.notificationIntents.filter((intent) => intent.status !== '已送达');
  return (
    <span>
      {warning.notificationStatus}
      {pending.length > 0 ? <span className="dl-faint">（{pending.length} 条待投递）</span> : null}
    </span>
  );
}

export function WarningCenterPage() {
  const openTasks = WARNING_RESPONSE_TASKS.filter((task) => task.status === 'open');
  const pendingDelivery = WARNING_RECORDS.filter((w) =>
    w.notificationIntents.some((intent) => intent.status !== '已送达'),
  );
  const ackNoPlan = WARNING_RESPONSE_TASKS.filter(
    (task) => task.status === 'acknowledged' && !task.recommendationId,
  );

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">预警与处置 / 预警中心</div>
          <h1 className="dl-h1">预警中心</h1>
          <div className="dl-head-meta">
            <span className="dl-xs dl-faint">
              按开立时间倒序 · 触发事实取自已冻结的评估记录与监测数据
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">触发类型筛选</button>
          <button className="dl-btn" type="button">等级筛选</button>
          <button className="dl-btn dl-btn--primary" type="button">确认预警</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '预警记录', value: WARNING_RECORDS.length },
          { label: '未确认处置任务', value: openTasks.length },
          { label: '已确认未出建议', value: ackNoPlan.length },
          { label: '通知待投递', value: pendingDelivery.length },
        ]}
      />

      <AgentNote
        why="确认不关闭任务、不解除风险；是否采纳处置与是否执行都由你决定。"
        actions={
          <button className="dl-btn dl-btn--sm" type="button">按待办筛选</button>
        }
      >
        {openTasks.length + ackNoPlan.length} 个处置任务正等你推进：
        {openTasks.map((task) => task.title).join('、')} 尚未确认；
        {ackNoPlan.map((task) => task.title).join('、')} 已确认但还没有处置建议。
      </AgentNote>

      <Section
        title="预警记录"
        action={
          <span className="dl-xs dl-faint">
            触发类型口径：{WARNING_TRIGGER_TYPES.join(' · ')}
          </span>
        }
        flush
      >
        <table className="dl-table">
          <thead>
            <tr>
              <th>开立时间</th>
              <th>预警等级</th>
              <th>风险事件</th>
              <th>触发类型</th>
              <th>触发指标</th>
              <th>建议处置方向</th>
              <th>通知</th>
              <th>处置任务</th>
              <th className="is-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {WARNING_RECORDS.map((warning) => {
              const task = warningTaskForWarning(warning.warningRecordId);
              return (
                <tr key={warning.warningRecordId}>
                  <td className="dl-mono dl-xs dl-num">{warning.openedAt}</td>
                  <td>
                    <RiskBadge
                      levelId={`level-${warningLevelById(warning.warningLevel).riskLevel}`}
                      label={warningLevelById(warning.warningLevel).label}
                    />
                  </td>
                  <td>
                    <div>{warning.riskEventSummary}</div>
                    <div className="dl-xs dl-faint">{warning.riskRecordId}</div>
                  </td>
                  <td>{warning.triggerType}</td>
                  <td>
                    <div>{triggerSummaryOf(warning)}</div>
                    <div className="dl-xs dl-faint">
                      越限方向{' '}
                      {warning.triggerIndicators
                        .map((indicator) => `${indicator.indicatorItem} ${indicator.exceedDirection === 'above' ? '高于' : '低于'}阈值`)
                        .join('；')}
                    </div>
                  </td>
                  <td className="dl-muted">{warning.recommendedResponseDirection}</td>
                  <td>
                    <Delivery warning={warning} />
                  </td>
                  <td>
                    {task ? <Tag>{taskStatusById(task.status).label}</Tag> : <span className="dl-faint">—</span>}
                  </td>
                  <td className="is-right">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="dl-btn dl-btn--sm" type="button">详情</button>
                      {task ? (
                        <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">
                          处置任务
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section title="预警等级口径">
        <div style={{ display: 'flex', gap: 'var(--dl-s4)', flexWrap: 'wrap' }}>
          {WARNING_LEVELS.map((level) => (
            <span key={level.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />
              <span className="dl-xs dl-faint">
                归集处置任务 {WARNING_RECORDS.filter((w) => w.warningLevel === level.id).length} 条
              </span>
            </span>
          ))}
        </div>
        <div className="dl-xs dl-faint" style={{ marginTop: 6 }}>
          等级色只用于表达等级、越限与预警，处置闭环各环节的状态一律用文字标签表达。
        </div>
      </Section>

      <Ids
        pairs={[
          ['风险记录', WARNING_RECORDS[0]?.riskRecordId ?? ''],
          ['处置任务', WARNING_RESPONSE_TASKS[0]?.warningResponseTaskId ?? ''],
          ['监测数据批次', 'MON-BATCH-2026-0827 · v2026.08'],
          ['预警阈值', 'MWT-001 · v2026.08'],
          ['预警聚合策略', 'WAP-001 · v2026.09'],
          ['通知策略', 'NP-001 · v2026.09'],
        ]}
      />
    </div>
  );
}
