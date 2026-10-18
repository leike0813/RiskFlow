// PROTOTYPE · THROWAWAY — 票 05 第 17 页：预警详情

import {
  WARNING_TRIGGER_TYPES,
  taskStatusById,
  warningById,
  warningLevelById,
  warningTaskForWarning,
  type EvidenceReference,
} from '../../../content/warning';
import { AgentNote, Ids, KeyValue, RiskBadge, Section, Stats, Tag, Timeline } from '../parts';

/** 监测截止点由已冻结的监测数据段标识推出（票 01 的用词禁忌）。 */
function monitoringCutoff(refs: readonly EvidenceReference[]): string {
  const segment = refs
    .map((ref) => ref.locator.sourceSegmentId)
    .find((id) => /^MON-\d{4}-\d{2}-\d{2}-\d{4}$/.test(id));
  if (!segment) return '—';
  const [, day, time] = segment.split('-');
  return `${day?.slice(0, 4)}-${day?.slice(4, 6)}-${day?.slice(6)} ${time?.slice(0, 2)}:${time?.slice(2)}`;
}

export function WarningDetailPage() {
  const warning = warningById('WARN-2026-001');
  if (!warning) {
    return (
      <div className="dl dl-page">
        <header className="dl-head">
          <div>
            <div className="dl-head-crumb">预警与处置 / 预警中心</div>
            <h1 className="dl-h1">预警详情</h1>
          </div>
        </header>
        <Section title="本工程尚无可用于查看的预警记录">
          <div className="dl-sm dl-muted">本工程尚无可用于评估的数据。</div>
        </Section>
      </div>
    );
  }

  const level = warningLevelById(warning.warningLevel);
  const task = warningTaskForWarning(warning.warningRecordId);
  const overCount = warning.triggerIndicators.filter((i) => i.exceedDirection === 'above').length;
  const underCount = warning.triggerIndicators.length - overCount;
  const monitoring = warning.triggerIndicators[0]?.evidenceReferences[0];

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">预警与处置 / 预警中心 / 预警详情</div>
          <h1 className="dl-h1">{warning.riskEventSummary}</h1>
          <div className="dl-head-meta">
            <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />
            <Tag>{warning.triggerType}</Tag>
            <Tag>{warning.notificationStatus}</Tag>
            {task ? <Tag>处置任务 · {taskStatusById(task.status).label}</Tag> : null}
            <span className="dl-xs dl-faint">开立于 {warning.openedAt}</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">证据链追溯</button>
          <button className="dl-btn dl-btn--primary" type="button">
            {task?.acknowledgedBy ? '打开处置任务' : '确认预警'}
          </button>
        </div>
      </header>

      <Stats
        items={[
          { label: '触发指标', value: warning.triggerIndicators.length },
          { label: '高于阈值', value: overCount },
          { label: '低于阈值', value: underCount },
          { label: '通知渠道', value: warning.notificationIntents.length },
        ]}
      />

      <AgentNote
        why="Agent 只陈述事实与缺口；确认、采纳、执行、关闭都由你决定。"
        actions={
          <button className="dl-btn dl-btn--sm" type="button">逐项核对触发指标</button>
        }
      >
        这条预警的 {warning.triggerIndicators.length} 项触发指标全部来自同一份已冻结的监测数据
        （监测截止点 {monitoringCutoff(warning.evidenceReferences)}）。其中{' '}
        {warning.triggerIndicators.find((i) => i.exceedDirection === 'below')?.indicatorItem}{' '}
        是低于生效区间下限，与其余高于阈值的指标方向不同——现场核查时按这个方向优先。
      </AgentNote>

      <Section title="触发事实">
        <KeyValue
          items={[
            ['触发类型', warning.triggerType],
            [
              '触发口径',
              `${warning.triggerIndicators.length} 项触发指标经「${warning.triggerType}」归并为一条预警`,
            ],
            ['触发事实来源', `评估记录 ${warning.assessmentRecordId} 的已冻结事实`],
            ['风险记录', `${warning.riskRecordId} · ${warning.riskEventSummary}`],
            ['监测截止点', monitoringCutoff(warning.evidenceReferences)],
            ['已冻结的监测数据', `${monitoring?.locator.sourceSegmentId ?? '—'} · ${monitoring?.sourceVersion.entityId ?? ''} · ${monitoring?.sourceVersion.versionId ?? ''}`],
            ['预警阈值版本', `${warning.monitoringWarningThresholdRef.entityId} · ${warning.monitoringWarningThresholdRef.versionId}`],
            ['建议处置方向', warning.recommendedResponseDirection],
          ]}
        />
        <div className="dl-xs dl-faint" style={{ marginTop: 6 }}>
          触发类型取值：{WARNING_TRIGGER_TYPES.join(' · ')}
        </div>
      </Section>

      <Section title="触发指标与越限方向" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>指标项</th>
              <th>触发类型</th>
              <th className="is-right">实测值</th>
              <th>阈值</th>
              <th>越限方向</th>
              <th>监测数据</th>
            </tr>
          </thead>
          <tbody>
            {warning.triggerIndicators.map((indicator) => (
              <tr key={indicator.indicatorItem}>
                <td>{indicator.indicatorItem}</td>
                <td className="dl-muted">{indicator.triggerType}</td>
                <td className="is-right is-num">
                  {indicator.actualValue} {indicator.unit}
                </td>
                <td className="is-num">{indicator.threshold}</td>
                <td>{indicator.exceedDirection === 'above' ? '实测高于阈值' : '实测低于阈值'}</td>
                <td className="dl-xs dl-faint dl-mono">
                  {indicator.evidenceReferences[0]?.locator.sourceSegmentId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="通知送达">
        <table className="dl-table">
          <thead>
            <tr>
              <th>渠道</th>
              <th>接收角色</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {warning.notificationIntents.map((intent) => (
              <tr key={intent.notificationIntentId}>
                <td>{intent.channel}</td>
                <td className="dl-muted">{intent.recipientRole}</td>
                <td>{intent.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="确认记录与处置进程">
        {task ? (
          <>
            <KeyValue
              items={[
                [
                  '确认记录',
                  task.acknowledgedBy
                    ? `${task.acknowledgedBy.actorLabel} 于 ${task.acknowledgedBy.at} 确认并接管处置任务`
                    : '尚无人确认，处置任务仍待确认',
                ],
                ['责任角色', task.ownerRole === 'project-risk-manager' ? '项目风险负责人' : '现场处置员'],
                [
                  '处置建议',
                  task.recommendationId ? `已生成正式建议 ${task.recommendationId}` : '尚未生成处置建议',
                ],
              ]}
            />
            <hr className="dl-rule" />
            <Timeline
              items={task.timeline.map((event, index) => ({
                at: event.at,
                state: index === task.timeline.length - 1 ? ('current' as const) : ('done' as const),
                title: event.action,
                meta: <span className="dl-xs dl-faint">{event.actorLabel}</span>,
              }))}
            />
          </>
        ) : (
          <div className="dl-muted">本预警尚未归集到处置任务。</div>
        )}
      </Section>

      <Ids
        pairs={[
          ['预警', warning.warningRecordId],
          ['评估记录', warning.assessmentRecordId],
          ['风险记录', warning.riskRecordId],
          ['处置任务', task?.warningResponseTaskId ?? ''],
          ['通知意图', warning.notificationIntents.map((i) => i.notificationIntentId).join(' ')],
          ['资料段', warning.evidenceReferences[0]?.locator.sourceSegmentId ?? ''],
          ['登记动作', warning.audit.action],
        ]}
      />
    </div>
  );
}
