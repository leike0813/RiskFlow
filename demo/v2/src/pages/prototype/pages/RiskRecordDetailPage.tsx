// PROTOTYPE · THROWAWAY — 票 05 第 10 页：风险记录详情
// 票 01 的落点页：七字段 + 风险要素关系 + 证据可读形态，一眼看清「为什么是这个等级」。
// 等级由评估矩阵算出，页面只呈现等级与算它的评估记录，不手工填等级。

import {
  ASSESSMENT_RECORDS,
  ENTRY_MODE_LABELS,
  RISK_MATRIX_CONFIG,
  indicatorMeta,
} from '../../../content/assessment';
import {
  riskRecordById,
  riskRecordKey,
} from '../../../content/identification';
import { PROCESS_NODE_DEPENDENCIES, SOURCE_RECORDS } from '../../../content/project';
import {
  WARNING_RECORDS,
  warningLevelById,
  warningTaskById,
} from '../../../content/warning';
import { AgentNote, Ids, KeyValue, RiskBadge, Section, Stats, Tag } from '../parts';

const RECORD_NUMBER = 'RISK-2026-001';

/** 资料段 → 可读定位：资料名 · 资料目录 · 资料段标识。技术 ID 由 Ids 沉底。 */
const EVIDENCE_LOCATIONS = SOURCE_RECORDS.flatMap((source) =>
  source.segments.map((segment) => ({
    sourceName: source.name,
    segmentId: segment.sourceSegmentId,
    where:
      segment.locator.kind === 'document'
        ? `${segment.locator.headingPath.join(' / ')}（第 ${segment.locator.pageNumber} 页）`
        : segment.locator.kind === 'table'
          ? `${segment.locator.sheet} · ${segment.locator.table} 第 ${segment.locator.rowRange.start}–${segment.locator.rowRange.end} 行`
          : segment.locator.kind === 'time-window'
            ? `${segment.locator.from.slice(0, 10)} 至 ${segment.locator.to.slice(0, 10)}`
            : `${segment.locator.dataset} · ${segment.locator.stableRecordKey}`,
    summary: segment.summary,
  })),
);

const PROCESS_NODE_NAME = new Map(
  PROCESS_NODE_DEPENDENCIES.map((node) => [node.processNodeId, node.name]),
);

/** 等级序号由矩阵配置派生，不硬编码；四级色只经 RiskBadge 出口。 */
function levelBadge(levelKey: string) {
  const index = RISK_MATRIX_CONFIG.levels.findIndex((level) => level.key === levelKey);
  const level = RISK_MATRIX_CONFIG.levels[index];
  if (!level) return <Tag>{levelKey}</Tag>;
  return <RiskBadge levelId={`level-${index + 1}`} label={level.label} />;
}

export function RiskRecordDetailPage() {
  const view = riskRecordById(RECORD_NUMBER);
  if (!view) {
    return (
      <div className="dl dl-page">
        <Section title="风险记录">本工程尚无风险记录</Section>
      </div>
    );
  }

  const record = view.record;
  const assessments = ASSESSMENT_RECORDS.filter((a) => a.riskRecordId === RECORD_NUMBER);
  const latest = assessments[assessments.length - 1];
  const warnings = WARNING_RECORDS.filter((w) => w.riskRecordId === RECORD_NUMBER);
  const task = view.downstream.warningResponseTaskId
    ? warningTaskById(view.downstream.warningResponseTaskId)
    : undefined;

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">
            识别 / 风险记录 / <a href="#/identification/records">{RECORD_NUMBER}</a>
          </div>
          <h1 className="dl-h1">{record.riskEvent}</h1>
          <div className="dl-head-meta">
            {latest ? levelBadge(latest.riskLevel) : <Tag>尚未评估</Tag>}
            <Tag accent={view.acceptanceRoute === 'review'}>
              {view.acceptanceRoute === 'review' ? '复核后验收入库' : '自动验收入库'}
            </Tag>
            <span className="dl-xs dl-faint">
              {PROCESS_NODE_NAME.get(record.processNodeId) ?? view.processNodeName}
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">查看识别任务</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">启动评估</button>
        </div>
      </header>

      <AgentNote
        why="等级不是这条记录上的一个字段，而是评估矩阵按发生可能性与后果严重度算出来的。页面把算它的评估记录一并摆出，改判走重新评估，不在记录上手改。"
        actions={
          <button className="dl-btn dl-btn--sm" type="button">查看评估任务</button>
        }
      >
        {assessments.length > 1
          ? `这条记录已有 ${assessments.length} 次评估，最近一次由 ${latest?.audit.actorId} 于 ${latest?.audit.recordedAt.slice(0, 10)} 记为 ${latest?.riskLevel} 级（发生可能性 ${latest?.likelihoodScore} · 后果严重度 ${latest?.consequenceScore}）。`
          : assessments.length === 1
            ? `本条只有一次评估，等级 ${latest?.riskLevel}，落点 发生可能性 ${latest?.likelihoodScore} · 后果严重度 ${latest?.consequenceScore}。`
            : '本条尚未评估，还没有等级。等级由评估算出，本页不预填。'}
        {' '}记录成立时的综合置信度 {view.compositeConfidence.value.toFixed(2)}，
        依据 {view.compositeConfidence.basis.join('、')}。
      </AgentNote>

      <Stats
        items={[
          { label: '风险要素关系', value: record.riskElementRelations.length },
          { label: '证据条数', value: view.evidenceReferences.length },
          { label: '评估记录', value: assessments.length },
          { label: '预警', value: warnings.length },
          { label: '模型置信度', value: record.modelConfidence.toFixed(2) },
        ]}
      />

      <Section title="为什么是这个等级">
        <div className="dl-kv">
          <dt>风险源</dt>
          <dd>{record.riskSource}</dd>
          <dt>风险因素</dt>
          <dd>{record.riskFactor}</dd>
          <dt>风险事件</dt>
          <dd>{record.riskEvent}</dd>
          <dt>工序节点</dt>
          <dd>{PROCESS_NODE_NAME.get(record.processNodeId) ?? view.processNodeName}</dd>
          <dt>风险要素关系</dt>
          <dd>
            {record.riskElementRelations.map((rel) => (
              <div key={`${rel.sourceElement}-${rel.relation}-${rel.targetElement}`}>
                <span className="dl-sm">{rel.sourceElement}</span>
                <span className="dl-xs dl-faint"> —{rel.relation}→ </span>
                <span className="dl-sm">{rel.targetElement}</span>
              </div>
            ))}
          </dd>
          <dt>证据定位</dt>
          <dd>
            {view.evidenceReferences.map((ref) => {
              const found = EVIDENCE_LOCATIONS.find(
                (item) => item.segmentId === ref.locator.sourceSegmentId,
              );
              return (
                <div key={ref.locator.sourceSegmentId} style={{ marginBottom: 4 }}>
                  <div className="dl-sm">
                    {found?.sourceName ?? '本工程资料'}
                    <span className="dl-xs dl-faint">
                      {' '}· {found?.where ?? '资料目录见追溯链'}
                    </span>
                  </div>
                  <div className="dl-xs dl-faint">
                    资料段 {ref.locator.sourceSegmentId.replace(/^[A-Z0-9]+-/, '')}
                    {found ? ` · ${found.summary}` : ''}
                  </div>
                </div>
              );
            })}
          </dd>
          <dt>模型置信度</dt>
          <dd>
            <span className="dl-num">{record.modelConfidence.toFixed(2)}</span>
            <span className="dl-xs dl-faint"> （模型推理置信度，入库综合置信度按多项依据合成）</span>
          </dd>
          <dt>综合置信度</dt>
          <dd>
            <span className="dl-num">{view.compositeConfidence.value.toFixed(2)}</span>
            <div className="dl-xs dl-faint">{view.compositeConfidence.basis.join(' · ')}</div>
          </dd>
        </div>

        <hr className="dl-rule" />

        {assessments.length > 0 ? (
          <table className="dl-table">
            <thead>
              <tr>
                <th>评估记录</th>
                <th>入口</th>
                <th className="is-right">发生可能性 P</th>
                <th className="is-right">后果严重度 C</th>
                <th>等级</th>
                <th>触发的预警触发类型</th>
                <th>评估时间</th>
              </tr>
            </thead>
            <tbody>
              {assessments.map((a) => (
                <tr key={a.assessmentRecordId}>
                  <td className="dl-sm">{a.assessmentRecordId}</td>
                  <td className="dl-sm dl-muted">{ENTRY_MODE_LABELS[a.entryMode]}</td>
                  <td className="is-right is-num dl-sm">{a.likelihoodScore}</td>
                  <td className="is-right is-num dl-sm">{a.consequenceScore}</td>
                  <td>{levelBadge(a.riskLevel)}</td>
                  <td className="dl-sm dl-muted">
                    {[...new Set(a.triggerIndicators.map((t) => t.triggerType))].join('、') || '未触发'}
                  </td>
                  <td className="dl-sm dl-num dl-muted">{a.audit.recordedAt.slice(0, 10)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="dl-sm dl-muted">本工程尚无可用于评估的数据，启动评估后此处显示等级与算它的指标。</div>
        )}

        {latest && latest.triggerIndicators.length > 0 ? (
          <div style={{ marginTop: 12 }}>
            <div className="dl-h3 dl-faint" style={{ marginBottom: 6 }}>最近一次评估的指标实际取值</div>
            <table className="dl-table">
              <thead>
                <tr>
                  <th>指标</th>
                  <th>实际取值</th>
                  <th className="is-right">基础分</th>
                  <th className="is-right">权重</th>
                  <th className="is-right">加权分</th>
                </tr>
              </thead>
              <tbody>
                {latest.indicatorResults.map((r) => (
                  <tr key={r.indicatorItem}>
                    <td className="dl-sm">{indicatorMeta(r.indicatorItem)?.label ?? r.indicatorItem}</td>
                    <td className="dl-sm dl-muted">{r.actualValue}</td>
                    <td className="is-right is-num dl-sm">{r.baseScore}</td>
                    <td className="is-right is-num dl-sm">{r.weightedScore.toFixed(2)}</td>
                    <td className="is-right is-num dl-sm">{(r.baseScore * r.weightedScore).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Section>

      <Section title="关联预警与处置任务" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>预警</th>
              <th>预警等级</th>
              <th>触发类型</th>
              <th>处置方向</th>
              <th>任务</th>
              <th>开立时间</th>
            </tr>
          </thead>
          <tbody>
            {warnings.map((w) => {
              const level = warningLevelById(w.warningLevel);
              return (
                <tr key={w.warningRecordId}>
                  <td className="dl-sm">{w.warningRecordId}</td>
                  <td>
                    <RiskBadge levelId={`level-${level.riskLevel}`} label={level.label} />
                  </td>
                  <td className="dl-sm dl-muted">{w.triggerType}</td>
                  <td className="dl-sm dl-muted">{w.recommendedResponseDirection}</td>
                  <td className="dl-sm dl-muted">{task?.title ?? '尚未开立'}</td>
                  <td className="dl-sm dl-num dl-muted">{w.openedAt.slice(0, 16).replace('T', ' ')}</td>
                </tr>
              );
            })}
            {warnings.length === 0 ? (
              <tr>
                <td colSpan={6} className="dl-sm dl-muted">本条尚未触发预警</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Section>

      <Section title="记录信息">
        <KeyValue
          items={[
            ['验收方式', view.acceptanceRoute === 'review' ? '复核后验收入库' : '自动验收入库'],
            ['记录人', view.audit.actorId],
            ['记录时间', view.audit.recordedAt.slice(0, 16).replace('T', ' ')],
            ['生效时间', view.version.effectivePeriod.validFrom.slice(0, 10)],
            ['命中风险机理', view.riskMechanismEntryIds.join('、') || '未命中'],
          ]}
        />
        <Ids
          pairs={[
            ['记录号', riskRecordKey(view)],
            ['工序节点号', record.processNodeId],
            ['产出任务号', view.producedByRunId],
            ['版本', `${view.version.reference.entityId} · ${view.version.reference.versionId}`],
            ['风险机理', view.riskMechanismEntryIds.join(' ')],
            ['下游评估', view.downstream.assessmentRecordIds.join(' ')],
            ['处置任务', view.downstream.warningResponseTaskId ?? '—'],
            ['正式建议', view.downstream.responseRecommendationId ?? '—'],
          ]}
        />
      </Section>
    </div>
  );
}
