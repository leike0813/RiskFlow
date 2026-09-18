// P-WR-02 预警详情（骨架 B 详情；branch warning-response.open；能力位 warning-response.read）。
// 字段分组卡：基本信息 / 触发指标（实际值、阈值、越限方向、证据入口）/ 版本引用 / 追溯链；
// 底部业务事件时间线；确认动作按 warning-response.acknowledge 三态门控。
// 七态：input.pageState 经 PageFrame 承载；路由标识未命中 fixture 时落入自然 empty 态。

import type { RouteRenderInput } from '../../app/routes';
import {
  taskStatusById,
  warningById,
  warningTaskById,
} from '../../content/warning';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  Field,
  GatedAction,
  StatusChip,
  VersionRefLine,
  WarningLevelChip,
} from './warning-shared';
import './warning.css';

const EXCEED_DIRECTION_LABELS = { above: '向上越限', below: '向下越限' } as const;

export function WarningDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const warningId = input.params.warningId ?? '';
  const warning = warningById(warningId);
  const state =
    input.pageState.kind === 'ready' && warning === undefined
      ? ({ kind: 'empty' } as const)
      : input.pageState;

  const task = warning === undefined ? undefined : warningTaskById(warning.warningResponseTaskId);

  return (
    <PageFrame
      title={`预警详情 ${warningId}`}
      state={state}
      skeleton="B"
      emptyMessage="未找到该预警记录"
      content={
        warning === undefined ? null : (
          <div>
            <section className="wr-card" aria-label="预警基本信息">
              <h3 className="wr-card-title">基本信息</h3>
              <dl className="wr-fields">
                <Field label="预警标识">
                  <span className="mono">{warning.warningRecordId}</span>
                </Field>
                <Field label="预警等级">
                  <WarningLevelChip levelId={warning.warningLevel} />
                </Field>
                <Field label="触发类型">{warning.triggerType}</Field>
                <Field label="建议处置方向">{warning.recommendedResponseDirection}</Field>
                <Field label="通知状态">{warning.notificationStatus}</Field>
                <Field label="开立时间">
                  <span className="mono">{warning.openedAt}</span>
                </Field>
                <Field label="入库审计">
                  <span className="mono">{warning.audit.actorId}</span> ·{' '}
                  <span className="mono">{warning.audit.action}</span> ·{' '}
                  <span className="mono">{warning.audit.recordedAt}</span>
                </Field>
                <Field label="处置状态">
                  {task === undefined ? (
                    <span className="wr-muted">未归集</span>
                  ) : (
                    <StatusChip label={taskStatusById(task.status).label} />
                  )}
                </Field>
              </dl>
              <div className="wr-btn-row" style={{ marginTop: 'var(--space-4)' }}>
                {task?.status === 'open' ? (
                  <GatedAction
                    label="确认预警"
                    branch="warning-response.acknowledge"
                    capabilities={input.capabilities}
                  />
                ) : (
                  <p className="wr-muted" style={{ margin: 0 }}>
                    {task?.acknowledgedBy != null ? (
                      <>
                        确认人 {task.acknowledgedBy.actorLabel} ·{' '}
                        <span className="mono">{task.acknowledgedBy.at}</span>
                      </>
                    ) : (
                      '尚未确认'
                    )}
                  </p>
                )}
              </div>
            </section>

            <section className="wr-card" aria-label="触发指标">
              <h3 className="wr-card-title">触发指标</h3>
              <div className="wr-table-wrap">
                <table className="wr-table">
                  <thead>
                    <tr>
                      <th>指标项</th>
                      <th>触发类型</th>
                      <th>实际值</th>
                      <th>阈值</th>
                      <th>越限方向</th>
                      <th>证据</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warning.triggerIndicators.map((indicator) => (
                      <tr key={`${indicator.indicatorItem}-${indicator.triggerType}`}>
                        <td>{indicator.indicatorItem}</td>
                        <td>{indicator.triggerType}</td>
                        <td>
                          <span className="mono wr-exceeded">
                            {indicator.actualValue} {indicator.unit}
                          </span>
                        </td>
                        <td className="mono">{indicator.threshold}</td>
                        <td className="wr-direction">
                          {EXCEED_DIRECTION_LABELS[indicator.exceedDirection]}
                        </td>
                        <td>
                          {indicator.evidenceReferences.map((evidence) => (
                            <a
                              key={evidence.locator.sourceSegmentId}
                              className="mono"
                              href="#/review-audit/trace"
                            >
                              {evidence.locator.sourceSegmentId}
                            </a>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="wr-card" aria-label="版本引用">
              <h3 className="wr-card-title">版本引用</h3>
              <VersionRefLine
                kind="监测预警阈值"
                entityId={warning.monitoringWarningThresholdRef.entityId}
                versionId={warning.monitoringWarningThresholdRef.versionId}
              />
              <VersionRefLine
                kind="预警聚合策略"
                entityId={warning.warningAggregationPolicyRef.entityId}
                versionId={warning.warningAggregationPolicyRef.versionId}
              />
              <VersionRefLine
                kind="通知策略"
                entityId={warning.notificationPolicyRef.entityId}
                versionId={warning.notificationPolicyRef.versionId}
              />
            </section>

            <section className="wr-card" aria-label="通知投递">
              <h3 className="wr-card-title">通知投递</h3>
              <div className="wr-table-wrap">
                <table className="wr-table">
                  <thead>
                    <tr>
                      <th>通知意图</th>
                      <th>渠道</th>
                      <th>接收角色</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {warning.notificationIntents.map((intent) => (
                      <tr key={intent.notificationIntentId}>
                        <td className="mono">{intent.notificationIntentId}</td>
                        <td>{intent.channel}</td>
                        <td>{intent.recipientRole}</td>
                        <td>{intent.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="wr-card" aria-label="追溯链">
              <h3 className="wr-card-title">追溯链</h3>
              <ul className="wr-trace-list">
                <li>
                  标准化风险记录{' '}
                  <a className="mono" href={`#/identification/records/${warning.riskRecordId}`}>
                    {warning.riskRecordId}
                  </a>
                  <span className="wr-muted">（{warning.riskEventSummary}）</span>
                </li>
                <li>
                  风险评估记录{' '}
                  <a className="mono" href={`#/assessment/records/${warning.assessmentRecordId}`}>
                    {warning.assessmentRecordId}
                  </a>
                </li>
                <li>
                  预警信息 <span className="mono">{warning.warningRecordId}</span>
                  <span className="wr-muted">（当前页）</span>
                </li>
                <li>
                  处置任务{' '}
                  <a className="mono" href={`#/warnings/tasks/${warning.warningResponseTaskId}`}>
                    {warning.warningResponseTaskId}
                  </a>
                </li>
                <li>
                  处置建议{' '}
                  {task?.recommendationId == null ? (
                    <span className="wr-muted">尚未记录</span>
                  ) : (
                    <a
                      className="mono"
                      href={`#/response/recommendations/${task.recommendationId}`}
                    >
                      {task.recommendationId}
                    </a>
                  )}
                </li>
                <li>
                  证据{' '}
                  {warning.evidenceReferences.map((evidence) => (
                    <a
                      key={evidence.locator.sourceSegmentId}
                      className="mono"
                      href="#/review-audit/trace"
                    >
                      {evidence.locator.sourceSegmentId}
                    </a>
                  ))}
                </li>
              </ul>
            </section>

            <BusinessTimeline events={task?.timeline ?? []} />
          </div>
        )
      }
    />
  );
}
