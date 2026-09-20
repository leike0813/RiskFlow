// P-RS-02 现场处置执行登记表单（骨架 B 详情；branch warning-response.record-execution；
// 能力位 warning-response.record）。登记字段与证据引用对齐 record-execution /
// record-feedback 命令 payload；动作级门控：提交执行登记 → warning-response.record-execution，
// 登记处置反馈 → warning-response.record-feedback。页面顶部展示已登记的执行记录
// EXE-2026-001，表单用于追加登记。七态经 input.pageState 由 PageFrame 承载。

import type { RouteRenderInput } from '../../app/routes';
import {
  ACTION_SOURCE_LABELS,
  EXECUTION_RECORDS,
  EXECUTION_REGISTER_FORM,
  LINKS,
  MEASURE_LIBRARY_REF,
  recommendationById,
} from '../../content/response';
import { PageFrame } from '../../shared/PageFrame';
import {
  BusinessTimeline,
  EvidenceLinks,
  Field,
  FieldCard,
  GatedAction,
  TraceCard,
  VersionRefLine,
} from './response-shared';
import './response.css';

const EXISTING_EXECUTION = EXECUTION_RECORDS[0];

export function ExecutionRegisterPage({ input }: { readonly input: RouteRenderInput }) {
  const form = EXECUTION_REGISTER_FORM;
  const recommendation = recommendationById(form.recommendationId);

  return (
    <PageFrame
      title="现场处置执行登记"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前没有已采纳且待登记的处置建议"
      content={
        <div>
          <FieldCard title="处置上下文">
            <dl className="rs-fields">
              <Field label="处置任务">
                <a className="mono" href={LINKS.warningTask(form.warningResponseTaskId)}>
                  {form.warningResponseTaskId}
                </a>
              </Field>
              <Field label="处置建议">
                <a className="mono" href={LINKS.responseRecommendation(form.recommendationId)}>
                  {form.recommendationId}
                </a>
                <span className="rs-muted">（已采纳，决定 RD-2026-001）</span>
              </Field>
              <Field label="关联预警">
                <a className="mono" href={LINKS.warning('WARN-2026-001')}>
                  WARN-2026-001
                </a>
              </Field>
            </dl>
          </FieldCard>

          <FieldCard title="执行登记">
            <div className="rs-form-section">
              <fieldset className="rs-form-section" style={{ border: 'none', margin: 0, padding: 0 }}>
                <legend className="rs-muted">执行来源（二选一）</legend>
                <label className="rs-radio-row">
                  <input type="radio" name="action-source" defaultChecked />
                  <span>
                    {ACTION_SOURCE_LABELS['adopted-recommendation']}{' '}
                    <span className="mono">RESP-2026-001 · v1.0</span>
                  </span>
                </label>
                <label className="rs-radio-row">
                  <input type="radio" name="action-source" />
                  <span>{ACTION_SOURCE_LABELS['independent-action']}（引用措施库版本）</span>
                </label>
              </fieldset>

              <dl className="rs-fields">
                <Field label="执行时间">
                  <span className="mono">{form.defaultOccurredAt}</span>
                </Field>
                <Field label="执行人">
                  {form.executedByLabel}（<span className="mono">{form.executedByActorId}</span>）
                </Field>
                <Field label="登记人">
                  现场处置员（<span className="mono">{form.recordedByActorId}</span>）
                </Field>
              </dl>

              {recommendation === undefined ? null : (
                <fieldset className="rs-form-section" style={{ border: 'none', margin: 0, padding: 0 }}>
                  <legend className="rs-muted">执行措施（按建议排序）</legend>
                  {recommendation.implementationOrder.map((measureId) => {
                    const item = recommendation.measureItems.find(
                      (measure) => measure.measureId === measureId,
                    );
                    if (item === undefined) return null;
                    return (
                      <label key={item.measureId} className="rs-check-row">
                        <input type="checkbox" defaultChecked />
                        <span>
                          <span className="mono">{item.measureId}</span> · {item.content}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              )}

              <fieldset className="rs-form-section" style={{ border: 'none', margin: 0, padding: 0 }}>
                <legend className="rs-muted">证据引用（至少一项）</legend>
                {form.evidenceOptions.map((item) => (
                  <label key={item.locator.sourceSegmentId} className="rs-check-row">
                    <input type="checkbox" defaultChecked />
                    <span>
                      <a className="mono" href={LINKS.evidenceTrace}>
                        {item.locator.sourceSegmentId}
                      </a>{' '}
                      <span className="mono rs-muted">
                        {item.sourceVersion.entityId} · {item.sourceVersion.versionId}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>

              <div className="rs-btn-row" style={{ marginTop: 0 }}>
                <GatedAction
                  label="提交执行登记"
                  branch="warning-response.record-execution"
                  capabilities={input.capabilities}
                />
                <GatedAction
                  label="登记处置反馈"
                  branch="warning-response.record-feedback"
                  capabilities={input.capabilities}
                />
              </div>
            </div>
          </FieldCard>

          {EXISTING_EXECUTION === undefined ? null : (
            <FieldCard title="已登记执行记录">
              <dl className="rs-fields">
                <Field label="执行记录标识">
                  <span className="mono">{EXISTING_EXECUTION.executionRecordId}</span>
                </Field>
                <Field label="执行来源">
                  {ACTION_SOURCE_LABELS[EXISTING_EXECUTION.actionSource.kind]}（
                  <span className="mono">
                    {EXISTING_EXECUTION.actionSource.kind === 'adopted-recommendation'
                      ? `${EXISTING_EXECUTION.actionSource.responseRecommendationRef.entityId} · ${EXISTING_EXECUTION.actionSource.responseRecommendationRef.versionId}`
                      : EXISTING_EXECUTION.actionSource.measureReleaseRefs
                          .map((ref) => `${ref.entityId} · ${ref.versionId}`)
                          .join('、')}
                  </span>
                  ）
                </Field>
                <Field label="执行人">
                  {EXISTING_EXECUTION.executedByLabel}（
                  <span className="mono">{EXISTING_EXECUTION.executedByActorId}</span>）
                </Field>
                <Field label="执行时间">
                  <span className="mono">{EXISTING_EXECUTION.occurredAt}</span>
                </Field>
                <Field label="已执行措施">
                  <span className="mono">{EXISTING_EXECUTION.executedMeasureIds.join('、')}</span>
                </Field>
                <Field label="登记审计">
                  <span className="mono">{EXISTING_EXECUTION.audit.action}</span> ·{' '}
                  <span className="mono">{EXISTING_EXECUTION.audit.recordedAt}</span>
                </Field>
              </dl>
              {EXISTING_EXECUTION.skippedMeasureNote === null ? null : (
                <p className="rs-note">{EXISTING_EXECUTION.skippedMeasureNote}</p>
              )}
              <Field label="证据引用">
                <EvidenceLinks evidence={EXISTING_EXECUTION.evidenceReferences} />
              </Field>
            </FieldCard>
          )}

          <FieldCard title="版本引用">
            <VersionRefLine kind="措施库" reference={MEASURE_LIBRARY_REF} />
            <VersionRefLine
              kind="处置后监测快照"
              reference={{ entityId: 'SNAP-MON-20260829-1600', versionId: 'v1' }}
            />
          </FieldCard>

          <TraceCard
            items={[
              {
                label: '标准化风险记录',
                id: 'RISK-2026-001',
                href: LINKS.identificationRecord('RISK-2026-001'),
              },
              { label: '预警信息', id: 'WARN-2026-001', href: LINKS.warning('WARN-2026-001') },
              {
                label: '处置建议',
                id: 'RESP-2026-001',
                href: LINKS.responseRecommendation('RESP-2026-001'),
              },
              { label: '执行登记', id: 'EXE-2026-001', current: true },
              {
                label: '反馈与偏差',
                id: 'FBK-2026-001',
                href: LINKS.responseFeedback('FBK-2026-001'),
              },
            ]}
          />

          <BusinessTimeline events={form.timeline} />
        </div>
      }
    />
  );
}
