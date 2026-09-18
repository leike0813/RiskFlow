// P-RI-06 标准化风险记录详情（B 详情骨架）。
// 骨架：B 详情（标题区 + 字段分组卡 + 底部业务事件时间线）。
// 数据 branch：risk-identification.merge-run-candidates；页面级能力位：risk-identification.read。
// 本页只呈现识别事实（风险要素、三元组、置信度、证据、版本与审计）；
// 预警与处置内容沿追溯链深链到预警处置任务（P-WR-04）与处置建议（P-RS-01）。
// 七态：非 ready 态由 PageFrame 承载；路由参数未命中时给出自然「未找到」卡片。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ACCEPTANCE_ROUTE_LABELS,
  LINKS,
  riskRecordById,
  riskRecordKey,
  type RiskRecordView,
} from '../../content/identification';
import {
  EventTimeline,
  FieldCard,
  FieldRow,
  NotFoundCard,
  StatusBadge,
} from './widgets';

function DownstreamCard({ view }: { readonly view: RiskRecordView }) {
  const { downstream } = view;
  const hasAssessment =
    downstream.assessmentRecordIds.length > 0 || downstream.activeAssessmentRunId !== null;
  return (
    <FieldCard title="下游（沿追溯链）">
      <div className="ri-cell-stack">
        {downstream.assessmentRecordIds.map((assessmentId) => (
          <span key={assessmentId}>
            风险评估记录{' '}
            <a className="mono" href={LINKS.assessmentRecord(assessmentId)}>
              {assessmentId}
            </a>
          </span>
        ))}
        {downstream.activeAssessmentRunId === null ? null : (
          <span>
            评估运行{' '}
            <a className="mono" href={LINKS.assessmentRun(downstream.activeAssessmentRunId)}>
              {downstream.activeAssessmentRunId}
            </a>{' '}
            进行中
          </span>
        )}
        {hasAssessment ? null : (
          <span>
            尚未评估，见 <a href={LINKS.assessmentRoot}>待评估风险</a>
          </span>
        )}
        {downstream.warningResponseTaskId === null ? null : (
          <span>
            预警处置任务{' '}
            <a className="mono" href={LINKS.warningTask(downstream.warningResponseTaskId)}>
              {downstream.warningResponseTaskId}
            </a>
          </span>
        )}
        {downstream.responseRecommendationId === null ? null : (
          <span>
            处置建议{' '}
            <a
              className="mono"
              href={LINKS.responseRecommendation(downstream.responseRecommendationId)}
            >
              {downstream.responseRecommendationId}
            </a>
          </span>
        )}
      </div>
    </FieldCard>
  );
}

function RecordContent({ view }: { readonly view: RiskRecordView }) {
  const recordId = riskRecordKey(view);
  const { record } = view;
  return (
    <div className="ri-page">
      <div className="ri-trace-row">
        <StatusBadge tone="neutral">
          {view.identity.kind === 'standardized-risk-record' ? '标准化风险记录' : '外部风险事件'}
        </StatusBadge>
        <StatusBadge tone={view.acceptanceRoute === 'review' ? 'waiting' : 'done'}>
          {ACCEPTANCE_ROUTE_LABELS[view.acceptanceRoute]}
        </StatusBadge>
        <span className="ri-form-note">
          综合置信度 <span className="mono">{view.compositeConfidence.value.toFixed(2)}</span>
        </span>
      </div>

      <FieldCard title="追溯链">
        <p className="ri-trace-row">
          资料段{' '}
          <a className="mono" href={LINKS.evidenceTrace}>
            {record.evidenceLocator.sourceSegmentId}
          </a>
          {' → '}工序节点{' '}
          <a href={LINKS.identificationProcessModel}>
            {view.processNodeName}（<span className="mono">{record.processNodeId}</span>）
          </a>
          {' → '}机理条目{' '}
          {view.riskMechanismEntryIds.map((mechanismId) => (
            <a key={mechanismId} className="mono" href={LINKS.knowledgeMechanisms}>
              {mechanismId}
            </a>
          ))}
          {' → '}标准化风险记录 <span className="mono">{recordId}</span>
        </p>
        <p className="ri-form-note">
          来源识别运行{' '}
          <a className="mono" href={LINKS.identificationRun(view.producedByRunId)}>
            {view.producedByRunId}
          </a>
          {'；'}图谱视图见 <a href={LINKS.graph}>工序风险关联图谱</a>。
        </p>
      </FieldCard>

      <FieldCard title="风险要素">
        <dl className="ri-field-grid">
          <FieldRow label="风险源">{record.riskSource}</FieldRow>
          <FieldRow label="风险因素">{record.riskFactor}</FieldRow>
          <FieldRow label="风险事件">{record.riskEvent}</FieldRow>
        </dl>
      </FieldCard>

      <FieldCard title="风险要素关系（三元组）">
        <div className="ri-table-wrap">
          <table className="ri-table">
            <thead>
              <tr>
                <th>源要素</th>
                <th>关系</th>
                <th>目标要素</th>
              </tr>
            </thead>
            <tbody>
              {record.riskElementRelations.map((relation) => (
                <tr
                  key={`${relation.sourceElement}-${relation.relation}-${relation.targetElement}`}
                >
                  <td>{relation.sourceElement}</td>
                  <td className="mono">{relation.relation}</td>
                  <td>{relation.targetElement}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </FieldCard>

      <FieldCard title="置信度">
        <dl className="ri-field-grid">
          <FieldRow label="模型置信度">
            <span className="mono">{record.modelConfidence.toFixed(2)}</span>
          </FieldRow>
          <FieldRow label="综合置信度">
            <span className="mono">{view.compositeConfidence.value.toFixed(2)}</span>
          </FieldRow>
        </dl>
        <p className="ri-form-note">
          综合置信度依据构成：{view.compositeConfidence.basis.join('；')}
        </p>
      </FieldCard>

      <FieldCard title="证据引用">
        <div className="ri-version-list">
          {view.evidenceReferences.map((evidence) => (
            <span key={evidence.locator.sourceSegmentId}>
              <a className="mono" href={LINKS.evidenceTrace}>
                {evidence.locator.sourceSegmentId}
              </a>{' '}
              <span className="mono ri-form-note">
                {evidence.sourceVersion.entityId} · {evidence.sourceVersion.versionId}
              </span>
            </span>
          ))}
        </div>
        <p className="ri-form-note">
          来源资料：
          {view.sourceIds.map((sourceId, index) => (
            <span key={sourceId}>
              {index > 0 ? '、' : ''}
              <a className="mono" href={LINKS.projectSource(sourceId)}>
                {sourceId}
              </a>
            </span>
          ))}
        </p>
      </FieldCard>

      <FieldCard title="版本与审计">
        <dl className="ri-field-grid">
          <FieldRow label="记录版本">
            <span className="mono">
              {view.version.reference.entityId} · {view.version.reference.versionId}
            </span>
          </FieldRow>
          <FieldRow label="生效起点">
            <span className="mono">{view.version.effectivePeriod.validFrom}</span>
          </FieldRow>
          <FieldRow label="操作者">
            <span className="mono">{view.audit.actorId}</span>
          </FieldRow>
          <FieldRow label="动作">
            <span className="mono">{view.audit.action}</span>
          </FieldRow>
          <FieldRow label="记录时间">
            <span className="mono">{view.audit.recordedAt}</span>
          </FieldRow>
          {view.audit.reason === undefined ? null : (
            <FieldRow label="原因">{view.audit.reason}</FieldRow>
          )}
        </dl>
      </FieldCard>

      <DownstreamCard view={view} />

      <EventTimeline
        events={[
          {
            at: '2026-08-27 08:31',
            label: `识别运行 ${view.producedByRunId} 启动`,
            href: LINKS.identificationRun(view.producedByRunId),
          },
          {
            at: view.audit.recordedAt.slice(0, 16).replace('T', ' '),
            label: `标准化风险记录 ${recordId} 入库`,
          },
          ...view.downstream.assessmentRecordIds.map((assessmentId) => ({
            at: assessmentId === 'ASSESS-2026-001' ? '2026-08-27 09:21' : '2026-09-10 10:05',
            label: `风险评估记录 ${assessmentId} 入库`,
            href: LINKS.assessmentRecord(assessmentId),
          })),
          ...(view.downstream.warningResponseTaskId === null
            ? []
            : [
                {
                  at: '2026-08-27 09:22',
                  label: `预警处置任务 ${view.downstream.warningResponseTaskId} 开立`,
                  href: LINKS.warningTask(view.downstream.warningResponseTaskId),
                },
              ]),
          ...(view.downstream.responseRecommendationId === null
            ? []
            : [
                {
                  at: '2026-08-27 09:48',
                  label: `处置建议 ${view.downstream.responseRecommendationId} 入库`,
                  href: LINKS.responseRecommendation(view.downstream.responseRecommendationId),
                },
              ]),
        ]}
      />
    </div>
  );
}

export function RecordDetailPage({ input }: { readonly input: RouteRenderInput }) {
  const recordId = input.params['recordId'] ?? '';
  const view = riskRecordById(recordId);
  return (
    <PageFrame
      title="标准化风险记录详情"
      state={input.pageState}
      skeleton="B"
      emptyMessage="暂无标准化风险记录"
      content={
        view === undefined ? (
          <NotFoundCard
            kind="标准化风险记录"
            id={recordId}
            backHref={LINKS.identificationRecords}
            backLabel="返回标准化风险记录列表"
          />
        ) : (
          <RecordContent view={view} />
        )
      }
    />
  );
}
