// PROTOTYPE · THROWAWAY — 票 05 第 19 页：处置任务详情（闭环枢纽）

import {
  ACTION_SOURCE_LABELS,
  CALIBRATION_SUGGESTIONS,
  DEVIATION_RECORDS,
  EFFECT_FORECASTS,
  EXECUTION_RECORDS,
  FEEDBACK_RECORDS,
  RESPONSE_RECOMMENDATIONS,
  REVIEW_STATUS_LABELS,
  VALIDATION_LABELS,
  type ValidationKey,
} from '../../../content/response';
import { RISK_MATRIX_CONFIG } from '../../../content/assessment';
import { warningById, warningLevelById, taskStatusById, warningTaskById, WARNING_TASK_STATUSES } from '../../../content/warning';
import { AgentDelta, AgentNote, Ids, KeyValue, RiskBadge, Section, Tag, Timeline } from '../parts';

function RiskLevelChip({ levelKey }: { levelKey: string }) {
  const index = Math.max(
    RISK_MATRIX_CONFIG.levels.findIndex((level) => level.key === levelKey),
    0,
  );
  return (
    <RiskBadge
      levelId={`level-${index + 1}`}
      label={RISK_MATRIX_CONFIG.levels[index].label}
    />
  );
}

export function ResponseTaskDetailPage() {
  const task = warningTaskById('WRT-2026-001');
  const warning = warningById(task?.warningRecordIds[0] ?? '');
  const rec = RESPONSE_RECOMMENDATIONS.find((r) => r.responseRecommendationId === task?.recommendationId);
  const feedback = FEEDBACK_RECORDS.find((record) => record.warningResponseTaskId === task?.warningResponseTaskId);
  const execution = EXECUTION_RECORDS.find((record) => record.executionRecordId === feedback?.executionRecordId);
  const forecast = EFFECT_FORECASTS.find((record) => record.forecastId === feedback?.forecastId);
  const deviation = DEVIATION_RECORDS.find((record) => record.deviationRecordId === feedback?.deviationRecordId);
  const calibration = CALIBRATION_SUGGESTIONS.find((record) => record.deviationRecordId === deviation?.deviationRecordId);

  if (!task || !warning || !rec || !execution || !feedback || !forecast || !deviation || !calibration) {
    return (
      <div className="dl dl-page">
        <header className="dl-head">
          <div>
            <div className="dl-head-crumb">预警与处置 / 处置任务</div>
            <h1 className="dl-h1">处置任务详情</h1>
          </div>
        </header>
        <Section title="本处置任务尚无完整闭环数据">
          <div className="dl-sm dl-muted">本处置任务尚未走完预警、建议、执行、反馈与校准各环，暂无可展示的闭环内容。</div>
        </Section>
      </div>
    );
  }

  const level = warningLevelById(task.highestWarningLevel);
  const statusIndex = WARNING_TASK_STATUSES.findIndex((s) => s.id === task.status);
  const validations: readonly (readonly [ValidationKey, boolean])[] = [
    ['triggerConsistencyValidation', rec.triggerConsistencyValidation.passed],
    ['standardsComplianceValidation', rec.standardsComplianceValidation.passed],
    ['siteFeasibilityValidation', rec.siteFeasibilityValidation.passed],
  ];

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">预警与处置 / 处置任务 / 任务详情</div>
          <h1 className="dl-h1">{task.title}</h1>
          <div className="dl-head-meta">
            <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />
            <Tag>{taskStatusById(task.status).label}</Tag>
            <span className="dl-xs dl-faint">
              开立 {task.openedAt} · 责任角色{' '}
              {task.ownerRole === 'project-risk-manager' ? '项目风险负责人' : '现场处置员'} ·
              确认 {task.acknowledgedBy ? `${task.acknowledgedBy.actorLabel} ${task.acknowledgedBy.at}` : '未确认'}
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn" type="button">登记执行</button>
          <button className="dl-btn" type="button">登记反馈</button>
          <button className="dl-btn dl-btn--primary" type="button">人工确认校准</button>
        </div>
      </header>

      <div style={{ display: 'flex', gap: 'var(--dl-s2)', flexWrap: 'wrap' }}>
        <a className="dl-btn dl-btn--sm" href="#ring-warning">预警</a>
        <a className="dl-btn dl-btn--sm" href="#ring-plan">处置建议</a>
        <a className="dl-btn dl-btn--sm" href="#ring-decision">人工决定</a>
        <a className="dl-btn dl-btn--sm" href="#ring-forecast">效果预测</a>
        <a className="dl-btn dl-btn--sm" href="#ring-execution">执行记录</a>
        <a className="dl-btn dl-btn--sm" href="#ring-feedback">处置反馈</a>
        <a className="dl-btn dl-btn--sm dl-btn--primary" href="#ring-calibration">校准建议</a>
      </div>

      <Section title="本页的语义红线">
        <ul className="dl-sm dl-muted" style={{ margin: 0, paddingLeft: 18, lineHeight: '20px' }}>
          <li>三项校验通过只使处置建议成为正式建议；采纳与执行由人决定。</li>
          <li>本域页面不呈现任何自动生效语义：系统不代替人做采纳、执行与关闭的决定。</li>
          <li>校准生效必须人工确认；Agent 增量逐项接受或拒绝，不会自动写入生效规则。</li>
        </ul>
      </Section>

      <AgentNote
        why="偏差超限后校准建议是必经的 Agent 任务；它把增量摆出来，你逐项决定。"
        actions={
          <button className="dl-btn dl-btn--sm" type="button">查看偏差明细</button>
        }
      >
        处置后实测回落 {forecast.predictedIndicators[0]?.predictedValue} → 实际{' '}
        {feedback.observedIndicators.find((i) => i.indicatorItem === '地表沉降短期斜率')?.value} mm/d，
        偏差值 {deviation.deviationValue} 超过冻结阈值 {deviation.deviationThresholdValue}，判定偏差超限。
        校准建议 {calibration.calibrationSuggestionId} 已生成并挂在复核任务{' '}
        {calibration.reviewTaskRef.entityId} 上，等你逐项决定。
      </AgentNote>

      <Section title="处置闭环" flush>
        <div style={{ padding: 'var(--dl-s4)' }}>
          <Timeline
            items={[
              {
                at: warning.openedAt,
                state: 'done',
                title: '预警',
                meta: (
                  <>
                    <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />
                    <span className="dl-xs dl-faint">{warning.riskEventSummary}</span>
                  </>
                ),
                body: (
                  <>
                    <div className="dl-sm dl-muted">
                      触发类型 {warning.triggerType} · 建议处置方向 {warning.recommendedResponseDirection}
                    </div>
                    <table className="dl-table" style={{ marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th>触发指标</th>
                          <th className="is-right">实测</th>
                          <th>阈值</th>
                          <th>越限方向</th>
                        </tr>
                      </thead>
                      <tbody>
                        {warning.triggerIndicators.map((indicator) => (
                          <tr key={indicator.indicatorItem}>
                            <td>{indicator.indicatorItem}</td>
                            <td className="is-right is-num">
                              {indicator.actualValue} {indicator.unit}
                            </td>
                            <td className="is-num">{indicator.threshold}</td>
                            <td>{indicator.exceedDirection === 'above' ? '高于阈值' : '低于阈值'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="dl-xs dl-faint" style={{ marginTop: 4 }}>
                      触发事实取自评估记录 {warning.assessmentRecordId} 的已冻结事实与监测截止点前的已冻结监测数据。
                    </div>
                  </>
                ),
              },
              {
                at: rec.version.systemTime.recordedAt.slice(0, 16).replace('T', ' '),
                state: 'done',
                title: '处置建议',
                meta: <Tag>{REVIEW_STATUS_LABELS[rec.reviewStatus]}</Tag>,
                body: (
                  <>
                    <table className="dl-table">
                      <thead>
                        <tr>
                          <th style={{ width: 28 }}>序</th>
                          <th>措施步骤</th>
                          <th>内容</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rec.implementationOrder.map((measureId, index) => (
                          <tr key={measureId}>
                            <td className="is-num dl-faint">{index + 1}</td>
                            <td className="dl-mono dl-xs">{measureId}</td>
                            <td>
                              {rec.measureItems.find((m) => m.measureId === measureId)?.content}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="dl-sm dl-muted" style={{ marginTop: 4 }}>
                      排序依据：{rec.orderingBasis}
                    </div>
                    <div className="dl-xs dl-faint">目标指标</div>
                    <table className="dl-table" style={{ marginTop: 2 }}>
                      <tbody>
                        {rec.targetIndicators.map((target) => (
                          <tr key={target.indicatorItem}>
                            <td>{target.indicatorItem}</td>
                            <td className="dl-muted">{target.targetValue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="dl-xs dl-faint" style={{ marginTop: 6 }}>
                      三项校验（通过只使建议成为正式建议）
                    </div>
                    <table className="dl-table" style={{ marginTop: 2 }}>
                      <tbody>
                        {validations.map(([key, passed]) => (
                          <tr key={key}>
                            <td>{VALIDATION_LABELS[key]}</td>
                            <td>{passed ? '通过' : '未通过'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="dl-xs dl-faint" style={{ marginTop: 4 }}>
                      现场资源与工序约束：{rec.resourceRequirements.join('、')}
                    </div>
                  </>
                ),
              },
              {
                at: rec.adoptionDecision?.decidedAt ?? '—',
                state: 'done',
                title: '人工决定',
                meta: <Tag>{rec.adoptionDecision?.decision === 'adopted' ? '采纳' : '未采纳'}</Tag>,
                body: (
                  <KeyValue
                    items={[
                      ['决定人', rec.adoptionDecision?.decidedByLabel ?? '—'],
                      ['决定时间', rec.adoptionDecision?.decidedAt ?? '—'],
                      ['理由', rec.adoptionDecision?.reasonCode ?? '—'],
                    ]}
                  />
                ),
              },
              {
                at: forecast.audit.recordedAt.slice(0, 16).replace('T', ' '),
                state: 'done',
                title: '效果预测',
                meta: <span className="dl-xs dl-faint">{forecast.predictionWindow}</span>,
                body: (
                  <>
                    <table className="dl-table">
                      <thead>
                        <tr>
                          <th>指标</th>
                          <th className="is-right">处置前</th>
                          <th className="is-right">预测值</th>
                          <th>目标口径</th>
                        </tr>
                      </thead>
                      <tbody>
                        {forecast.predictedIndicators.map((indicator) => (
                          <tr key={indicator.indicatorItem}>
                            <td>{indicator.indicatorItem}</td>
                            <td className="is-right is-num">
                              {indicator.beforeValue} {indicator.unit}
                            </td>
                            <td className="is-right is-num">
                              {indicator.predictedValue} {indicator.unit}
                            </td>
                            <td className="dl-muted">{indicator.targetValue}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="dl-sm dl-muted" style={{ marginTop: 4 }}>
                      预测风险变化：可能性 {forecast.predictedRiskChange.likelihoodScore} · 后果{' '}
                      {forecast.predictedRiskChange.consequenceScore} ·{' '}
                      <RiskLevelChip levelKey={forecast.predictedRiskChange.riskLevel} />
                    </div>
                    <div className="dl-xs dl-faint" style={{ marginTop: 4 }}>
                      依据：冻结评估依据 {forecast.frozenAssessmentBasisRef.entityId} ·{' '}
                      {forecast.frozenAssessmentBasisRef.versionId} 与处置前监测数据联合重估；目标口径取自处置建议{' '}
                      {forecast.responseRecommendationId}。
                    </div>
                    <div className="dl-xs dl-faint">
                      {forecast.basisNotes.filter((note) => note.includes('类比案例')).join('；')}
                    </div>
                  </>
                ),
              },
              {
                at: execution.occurredAt.slice(0, 16).replace('T', ' '),
                state: 'done',
                title: '执行记录',
                meta: <Tag>{ACTION_SOURCE_LABELS[execution.actionSource.kind]}</Tag>,
                body: (
                  <>
                    <KeyValue
                      items={[
                        ['执行人', execution.executedByLabel],
                        ['已执行措施', execution.executedMeasureIds.join('、')],
                        [
                          '未执行措施',
                          execution.skippedMeasureNote ?? '无',
                        ],
                        [
                          '证据',
                          execution.evidenceReferences.map((ref) => ref.locator.sourceSegmentId).join('、'),
                        ],
                      ]}
                    />
                  </>
                ),
              },
              {
                at: feedback.occurredAt.slice(0, 16).replace('T', ' '),
                state: 'done',
                title: '处置反馈',
                meta: (
                  <Tag>
                    偏差 {deviation.deviationValue} / 阈值 {deviation.deviationThresholdValue} · 超限
                  </Tag>
                ),
                body: (
                  <>
                    <div className="dl-sm dl-muted">{feedback.summary}</div>
                    <table className="dl-table" style={{ marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th>指标</th>
                          <th className="is-right">预测值</th>
                          <th className="is-right">实测值</th>
                          <th className="is-right">偏差</th>
                          <th>实测说明</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feedback.observedIndicators.map((observed) => {
                          const predicted = forecast.predictedIndicators.find(
                            (p) => p.indicatorItem === observed.indicatorItem,
                          );
                          return (
                            <tr key={observed.indicatorItem}>
                              <td>{observed.indicatorItem}</td>
                              <td className="is-right is-num">
                                {predicted ? predicted.predictedValue : '—'} {observed.unit}
                              </td>
                              <td className="is-right is-num">
                                {observed.value} {observed.unit}
                              </td>
                              <td className="is-right is-num">
                                {predicted ? (observed.value - predicted.predictedValue).toFixed(2) : '—'}
                              </td>
                              <td className="dl-muted">{observed.note}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="dl-sm dl-muted" style={{ marginTop: 4 }}>
                      偏差口径：{deviation.deviationBasis}
                    </div>
                    <div className="dl-xs dl-faint">
                      预测风险变化 <RiskLevelChip levelKey={deviation.predictedRiskChange.riskLevel} />
                      {' → '}
                      实际风险变化 <RiskLevelChip levelKey={deviation.actualRiskChange.riskLevel} />
                      {' · '}偏差记录 {deviation.deviationRecordId} · {REVIEW_STATUS_LABELS[deviation.reviewStatus]}
                    </div>
                  </>
                ),
              },
              {
                at: calibration.version.systemTime.recordedAt.slice(0, 16).replace('T', ' '),
                state: 'current',
                title: '校准建议',
                meta: <Tag>{REVIEW_STATUS_LABELS[calibration.reviewStatus]} · 待人工确认生效</Tag>,
                body: (
                  <>
                    <div className="dl-sm">
                      偏差超限后由{calibration.agentTask.taskTypeLabel} Agent 任务产出校准候选：
                      {calibration.targetKnowledge
                        .map((target) => `${target.label} ${target.ref.entityId} · ${target.ref.versionId} — ${target.change}`)
                        .join('；')}
                      。该调整随适用规则集下一版本复核发布，生效必须人工确认。
                    </div>
                    <table className="dl-table" style={{ marginTop: 6 }}>
                      <thead>
                        <tr>
                          <th>校准目标</th>
                          <th>知识对象</th>
                          <th>建议调整内容</th>
                        </tr>
                      </thead>
                      <tbody>
                        {calibration.targetKnowledge.map((target) => (
                          <tr key={target.ref.entityId}>
                            <td>{target.label}</td>
                            <td className="dl-mono dl-xs">
                              {target.ref.entityId} · {target.ref.versionId}
                            </td>
                            <td>{target.change}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ marginTop: 'var(--dl-s3)' }}>
                      <AgentNote
                        why={`校准建议 Agent 任务 ${calibration.agentTask.agentTaskRef.entityId}（${calibration.agentTask.taskTypeLabel} · ${calibration.agentTask.triggerModeLabel}）产出候选，确定性校验${calibration.validationResult.passed ? '通过' : '未通过'}，复核任务 ${calibration.reviewTaskRef.entityId} 已创建。`}
                      >
                        生效与否是你的决定。下面每一项都可以单独接受或拒绝，拒绝不影响其余项；
                        全部处理完之前，系统不会把它写入生效规则。
                      </AgentNote>
                    </div>
                    <div style={{ marginTop: 'var(--dl-s3)' }}>
                      <AgentDelta
                        rows={calibration.targetKnowledge.map((target) => ({
                          target: `${target.label} ${target.ref.entityId} · ${target.ref.versionId}`,
                          to: target.change,
                          basis: `偏差记录 ${deviation.deviationRecordId}：${deviation.deviationBasis}`,
                        }))}
                      />
                    </div>
                    <div className="dl-xs dl-faint" style={{ marginTop: 4 }}>
                      人工确认路径：复核任务 {calibration.reviewTaskRef.entityId} → 逐项决定 → 随适用规则集下一版本复核发布。本页不呈现自动生效语义。
                    </div>
                  </>
                ),
              },
              {
                at: '待定',
                state: 'pending',
                title: '任务闭环',
                body: (
                  <div className="dl-sm dl-muted">
                    校准建议逐项处理并由你确认生效后，处置任务才可推进到「
                    {WARNING_TASK_STATUSES[WARNING_TASK_STATUSES.length - 1]?.label}」。确认与关闭都是人的决定。
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Section>

      <Section title="任务进程">
        <table className="dl-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>主体</th>
              <th>动作</th>
              <th className="is-right">状态序</th>
            </tr>
          </thead>
          <tbody>
            {task.timeline.map((event) => (
              <tr key={event.at + event.action}>
                <td className="dl-mono dl-xs dl-num">{event.at}</td>
                <td className="dl-muted">{event.actorLabel}</td>
                <td>{event.action}</td>
                <td className="is-right dl-faint dl-xs">{statusIndex + 1}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Ids
        pairs={[
          ['处置任务', task.warningResponseTaskId],
          ['预警', warning.warningRecordId],
          ['评估记录', warning.assessmentRecordId],
          ['风险记录', task.riskRecordId],
          ['处置建议', rec.responseRecommendationId],
          ['采纳决定', rec.adoptionDecision?.decisionRef.entityId ?? ''],
          ['执行记录', execution.executionRecordId],
          ['效果预测', forecast.forecastId],
          ['处置反馈', feedback.feedbackId],
          ['偏差记录', deviation.deviationRecordId],
          ['校准建议', calibration.calibrationSuggestionId],
          ['复核任务', calibration.reviewTaskRef.entityId],
          ['资料段', warning.evidenceReferences[0]?.locator.sourceSegmentId ?? ''],
          ['监测数据', warning.evidenceReferences[1]?.locator.sourceSegmentId ?? ''],
        ]}
      />
    </div>
  );
}
