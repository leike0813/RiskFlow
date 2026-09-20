// P-RA-02 启动评估向导（B 详情骨架）。
// 骨架：B 详情（标题区 + 字段分组卡 + 底部业务事件时间线）。
// 数据 branch：risk-assessment.initial；页面级能力位：risk-assessment.prepare。
// 动作级：「提交并启动评估」需 risk-assessment.prepare。
// 七态：非 ready 态由 PageFrame 承载；向导始终有可用风险输入，empty 态给提示文案。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  ASSESSMENT_BASIS_VERSIONS,
  BASIS_VERSION_LABELS,
  ENTRY_MODE_LABELS,
  LINKS,
  PENDING_RISKS,
  TRIGGER_REASON_LABELS,
} from '../../content/assessment';
import { CapabilityAction, EventTimeline, FieldCard, FieldRow, VersionRefText } from './widgets';

const BASIS_ORDER = [
  'indicatorSystem',
  'applicableRuleSet',
  'weightSet',
  'riskMatrix',
  'riskAcceptanceThreshold',
  'monitoringWarningThreshold',
] as const;

const DEFAULT_RISK = PENDING_RISKS[0];

export function StartAssessmentPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="启动评估向导"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前没有可发起评估的风险输入"
      content={
        <div className="ra-page">
          <p className="ra-context-subtitle">
            以冻结的评估准备快照启动一次有限评估运行（A0–A9）；评估依据版本在提交时锁定，运行全程不变。
          </p>

          <FieldCard title="风险输入">
            <div className="ra-form-section">
              <label className="ra-radio-row">
                <input type="radio" name="risk-input" defaultChecked />
                <span>
                  标准化风险记录{' '}
                  <a className="mono" href={LINKS.identificationRecord(DEFAULT_RISK.riskRecordId)}>
                    {DEFAULT_RISK.riskRecordId}
                  </a>{' '}
                  · {DEFAULT_RISK.riskEvent}
                </span>
              </label>
              <p className="ra-form-note">
                风险输入为「标准化风险记录 / 外部风险事件」二选一；本工程当前无已登记的外部风险事件。
              </p>
            </div>
          </FieldCard>

          <FieldCard title="适用性元数据快照">
            <dl className="ra-field-grid">
              <FieldRow label="施工工法">变径盾构法</FieldRow>
              <FieldRow label="地层条件">富水软弱地层</FieldRow>
              <FieldRow label="工程阶段">变径空间扩挖与支护</FieldRow>
            </dl>
            <p className="ra-form-note">
              三个维度为最小覆盖集；适用性筛选不匹配的评分规则将在 A4 前筛除并记录原因。
            </p>
          </FieldCard>

          <FieldCard title="监测快照引用（可选）">
            <label className="ra-check-row">
              <input type="checkbox" defaultChecked />
              <span>
                使用已冻结监测快照 <span className="mono">SRC-MON-003 · v2026.08.27</span>
              </span>
            </label>
            <p className="ra-form-note">未勾选表示本次评估不使用监测输入。</p>
          </FieldCard>

          <FieldCard title="评估依据版本（提交时锁定）">
            <div className="ra-version-list">
              {BASIS_ORDER.map((key) => (
                <VersionRefText
                  key={key}
                  label={BASIS_VERSION_LABELS[key]}
                  reference={ASSESSMENT_BASIS_VERSIONS[key]}
                />
              ))}
            </div>
          </FieldCard>

          <FieldCard title="入口与幂等">
            <dl className="ra-field-grid">
              <FieldRow label="入口模式">{ENTRY_MODE_LABELS.assess}（assess）</FieldRow>
              <FieldRow label="触发原因">{TRIGGER_REASON_LABELS['initial-assessment']}</FieldRow>
              <FieldRow label="幂等键">
                <span className="mono">IDEMP-A-20260918-0002</span>
              </FieldRow>
            </dl>
          </FieldCard>

          <div className="ra-form-footer">
            <CapabilityAction
              capabilities={input.capabilities}
              capability="risk-assessment.prepare"
              href={LINKS.assessmentRun('RUN-A-2026-001')}
            >
              提交并启动评估
            </CapabilityAction>
          </div>

          <EventTimeline
            events={[
              {
                at: '2026-08-27 08:47',
                label: '识别运行 RUN-20260827-001 完成',
                href: LINKS.identificationRun('RUN-20260827-001'),
              },
              {
                at: '2026-08-27 08:52',
                label: '标准化风险记录 RISK-2026-001 入库',
                href: LINKS.identificationRecord('RISK-2026-001'),
              },
              { at: '2026-08-27 09:02', label: '评估依据版本集就绪确认' },
              {
                at: '2026-08-27 09:04',
                label: '评估运行 RUN-A-2026-001 启动',
                href: LINKS.assessmentRun('RUN-A-2026-001'),
              },
            ]}
          />
        </div>
      }
    />
  );
}
