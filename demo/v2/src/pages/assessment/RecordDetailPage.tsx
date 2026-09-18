// P-RA-05 风险评估记录详情（B 详情骨架）。
// 骨架：B 详情（标题区 + 字段分组卡 + 底部业务事件时间线）。
// 数据 branch：risk-assessment.evaluate；页面级能力位：risk-assessment.read。
// 七态：非 ready 态由 PageFrame 承载；路由参数未命中时给出自然「未找到」卡片。
// 可重放叙事：适用规则集 / 矩阵 / 权重版本与适用性元数据快照全部显式呈现。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ASSESSMENT_BASIS_VERSIONS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  LINKS,
  assessmentRecordById,
  assessmentRunById,
  indicatorMeta,
  matrixLevelAt,
  type AssessmentRecordFixture,
} from '../../content/assessment';
import {
  EventTimeline,
  FieldCard,
  FieldRow,
  NotFoundCard,
  RiskLevelBadge,
  StatusBadge,
  VersionRefText,
} from './widgets';

function RecordContent({ record }: { readonly record: AssessmentRecordFixture }) {
  const plotLevel = matrixLevelAt(record.matrixPlot.p, record.matrixPlot.c);
  const producedByRun = assessmentRunById(record.producedByRunId);
  const previousRecord =
    record.previousAssessmentRecordId === undefined
      ? undefined
      : assessmentRecordById(record.previousAssessmentRecordId);
  return (
    <div className="ra-page">
      <div className="ra-trace-row">
        <RiskLevelBadge levelKey={record.riskLevel} />
        <StatusBadge tone={record.entryMode === 'assess' ? 'neutral' : 'waiting'}>
          {ENTRY_MODE_LABELS[record.entryMode]}
        </StatusBadge>
        <span className="ra-form-note">风险输入类别：标准化风险记录</span>
      </div>

      <FieldCard title="风险输入与追溯">
        <dl className="ra-field-grid">
          <FieldRow label="标准化风险记录">
            <a className="mono" href={LINKS.identificationRecord(record.riskRecordId)}>
              {record.riskRecordId}
            </a>
          </FieldRow>
          <FieldRow label="工序节点">
            <a href={LINKS.identificationProcessModel}>
              变径空间扩挖（<span className="mono">PN-VDS-04</span>）
            </a>
          </FieldRow>
          <FieldRow label="风险机理条目">
            <a className="mono" href={LINKS.knowledgeMechanisms}>
              MEC-VDS-017
            </a>
          </FieldRow>
          <FieldRow label="来源识别运行">
            <a className="mono" href={LINKS.identificationRun('RUN-20260827-001')}>
              RUN-20260827-001
            </a>
          </FieldRow>
        </dl>
      </FieldCard>

      <FieldCard title="适用性元数据快照">
        <dl className="ra-field-grid">
          <FieldRow label="施工工法">{record.applicabilityMetadataSnapshot.constructionMethod}</FieldRow>
          <FieldRow label="地层条件">{record.applicabilityMetadataSnapshot.stratumCondition}</FieldRow>
          <FieldRow label="工程阶段">{record.applicabilityMetadataSnapshot.engineeringStage}</FieldRow>
        </dl>
      </FieldCard>

      <FieldCard title="评分结果">
        <dl className="ra-field-grid">
          <FieldRow label="发生可能性 P">
            <span className="mono">{record.likelihoodScore}</span>
          </FieldRow>
          <FieldRow label="后果严重度 C">
            <span className="mono">{record.consequenceScore}</span>
          </FieldRow>
          <FieldRow label="风险等级（矩阵映射）">
            <RiskLevelBadge levelKey={record.riskLevel} />
          </FieldRow>
          <FieldRow label="矩阵落点">
            <span className="mono">
              {record.matrixPlot.p} × {record.matrixPlot.c}
            </span>
            {plotLevel === undefined ? null : <span>（{plotLevel.label}）</span>}{' '}
            <a href={LINKS.assessmentMatrix}>在矩阵视图中查看</a>
          </FieldRow>
        </dl>
      </FieldCard>

      <FieldCard title="逐指标结果">
        <div className="ra-table-wrap">
          <table className="ra-table">
            <thead>
              <tr>
                <th>指标</th>
                <th>归属</th>
                <th>实际取值</th>
                <th>基础得分</th>
                <th>加权得分</th>
                <th>评分规则版本</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              {record.indicatorResults.map((result) => {
                const meta = indicatorMeta(result.indicatorItem);
                return (
                  <tr key={result.indicatorItem}>
                    <td>{meta?.label ?? result.indicatorItem}</td>
                    <td className="mono">{meta?.side ?? '—'}</td>
                    <td>
                      {result.actualValue}
                      {meta?.unit === null || meta?.unit === undefined ? null : (
                        <span className="ra-form-note">（{meta.unit}）</span>
                      )}
                    </td>
                    <td className="mono">{result.baseScore}</td>
                    <td className="mono">{result.weightedScore}</td>
                    <td className="mono">
                      {result.ruleVersion.entityId} · {result.ruleVersion.versionId}
                    </td>
                    <td>
                      <div className="ra-cell-stack">
                        {result.evidenceReferences.map((evidence) => (
                          <a
                            key={evidence.locator.sourceSegmentId}
                            className="mono"
                            href={LINKS.evidenceTrace}
                          >
                            {evidence.locator.sourceSegmentId}
                          </a>
                        ))}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="触发指标">
        {record.triggerIndicators.length === 0 ? (
          <p className="ra-form-note">未命中任何触发类型，不进入预警流程。</p>
        ) : (
          <>
            <div className="ra-table-wrap">
              <table className="ra-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th>触发类型</th>
                    <th>实际取值</th>
                  </tr>
                </thead>
                <tbody>
                  {record.triggerIndicators.map((trigger) => (
                    <tr key={`${trigger.indicatorItem}-${trigger.triggerType}`}>
                      <td>{trigger.indicatorItem}</td>
                      <td>{trigger.triggerType}</td>
                      <td className="mono">{trigger.actualValue ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {record.warningRecordId === null ? null : (
              <p className="ra-form-note">
                已触发预警{' '}
                <a className="mono" href={LINKS.warning(record.warningRecordId)}>
                  {record.warningRecordId}
                </a>
              </p>
            )}
          </>
        )}
      </FieldCard>

      <FieldCard title="版本引用（可重放）">
        <div className="ra-version-list">
          <VersionRefText
            label={BASIS_VERSION_LABELS.applicableRuleSet}
            reference={record.applicableRuleSetVersion}
          />
          <VersionRefText
            label={BASIS_VERSION_LABELS.riskMatrix}
            reference={record.riskMatrixVersion}
          />
          <VersionRefText label={BASIS_VERSION_LABELS.weightSet} reference={record.weightVersion} />
          <VersionRefText
            label={BASIS_VERSION_LABELS.indicatorSystem}
            reference={ASSESSMENT_BASIS_VERSIONS.indicatorSystem}
          />
          <VersionRefText
            label={BASIS_VERSION_LABELS.riskAcceptanceThreshold}
            reference={ASSESSMENT_BASIS_VERSIONS.riskAcceptanceThreshold}
          />
          <VersionRefText
            label={BASIS_VERSION_LABELS.monitoringWarningThreshold}
            reference={ASSESSMENT_BASIS_VERSIONS.monitoringWarningThreshold}
          />
        </div>
        <p className="ra-form-note">
          任意历史评分可按上述不可变版本快照与适用性元数据快照重放。
        </p>
      </FieldCard>

      <FieldCard title="证据引用">
        <div className="ra-version-list">
          {record.evidenceReferences.map((evidence) => (
            <span key={evidence.locator.sourceSegmentId}>
              <a className="mono" href={LINKS.evidenceTrace}>
                {evidence.locator.sourceSegmentId}
              </a>{' '}
              <span className="mono ra-form-note">
                {evidence.sourceVersion.entityId} · {evidence.sourceVersion.versionId}
              </span>
            </span>
          ))}
        </div>
      </FieldCard>

      <FieldCard title="审计">
        <dl className="ra-field-grid">
          <FieldRow label="操作者">
            <span className="mono">{record.audit.actorId}</span>
          </FieldRow>
          <FieldRow label="动作">
            <span className="mono">{record.audit.action}</span>
          </FieldRow>
          <FieldRow label="记录时间">
            <span className="mono">{record.audit.recordedAt}</span>
          </FieldRow>
          {record.audit.reason === undefined ? null : (
            <FieldRow label="原因">{record.audit.reason}</FieldRow>
          )}
        </dl>
      </FieldCard>

      <EventTimeline
        events={[
          {
            at: '2026-08-27 08:52',
            label: `标准化风险记录 ${record.riskRecordId} 入库`,
            href: LINKS.identificationRecord(record.riskRecordId),
          },
          ...(previousRecord === undefined
            ? []
            : [
                {
                  at: previousRecord.audit.recordedAt.slice(0, 16).replace('T', ' '),
                  label: `前次评估记录 ${previousRecord.assessmentRecordId} 入库（版本链）`,
                  href: LINKS.assessmentRecord(previousRecord.assessmentRecordId),
                },
              ]),
          {
            at: (producedByRun?.startedAt ?? record.audit.recordedAt).slice(0, 16).replace('T', ' '),
            label: `评估运行 ${record.producedByRunId} 启动`,
            href: LINKS.assessmentRun(record.producedByRunId),
          },
          {
            at: record.audit.recordedAt.slice(0, 16).replace('T', ' '),
            label: `评估记录 ${record.assessmentRecordId} 入库`,
          },
          ...(record.warningRecordId === null
            ? []
            : [
                {
                  at: record.audit.recordedAt.slice(0, 16).replace('T', ' '),
                  label:
                    record.entryMode === 'reassess'
                      ? `归集至预警 ${record.warningRecordId}`
                      : `预警 ${record.warningRecordId} 开立`,
                  href: LINKS.warning(record.warningRecordId),
                },
              ]),
          ...(producedByRun?.outputs.responseRecommendationId === null ||
          producedByRun?.outputs.responseRecommendationId === undefined
            ? []
            : [
                {
                  at: record.audit.recordedAt.slice(0, 16).replace('T', ' '),
                  label: `处置建议 ${producedByRun.outputs.responseRecommendationId} 入库`,
                  href: LINKS.responseRecommendation(producedByRun.outputs.responseRecommendationId),
                },
              ]),
        ]}
      />
    </div>
  );
}

export function RecordDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const recordId = input.params['recordId'] ?? '';
  const record = assessmentRecordById(recordId);
  return (
    <PageFrame
      title="风险评估记录详情"
      state={input.pageState}
      skeleton="B"
      emptyMessage="暂无风险评估记录"
      content={
        record === undefined ? (
          <NotFoundCard
            kind="风险评估记录"
            id={recordId}
            backHref={LINKS.assessmentRecords}
            backLabel="返回风险评估记录列表"
          />
        ) : (
          <RecordContent record={record} />
        )
      }
    />
  );
}
