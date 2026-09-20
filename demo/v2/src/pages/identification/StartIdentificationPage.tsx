// P-RI-02 启动识别向导（B 详情骨架）。
// 骨架：B 详情（标题区 + 字段分组卡 + 底部业务事件时间线）。
// 数据 branch：risk-identification.plan；页面级能力位：risk-identification.run（框架层门控）。
// 动作级：「提交并启动识别」需 risk-identification.run。
// 七态：非 ready 态由 PageFrame 承载；向导始终有可用识别范围，empty 态给提示文案。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  IDENTIFICATION_BASIS_LABELS,
  IDENTIFICATION_BASIS_VERSIONS,
  IDENTIFICATION_TRIGGER_REASON_LABELS,
  LINKS,
  RUN_TRIGGER_TYPE_LABELS,
} from '../../content/identification';
import { CapabilityAction, EventTimeline, FieldCard, FieldRow, VersionRefText } from './widgets';

const BASIS_ORDER = [
  'processModelRelease',
  'riskMechanismRelease',
  'retrievalEvidenceBaseRelease',
  'identificationPolicySet',
  'promptTemplate',
  'modelDeployment',
] as const;

/** 识别范围内的资料版本集（与 content/project.ts 资料登记一致）。 */
const SOURCE_VERSIONS: readonly { readonly sourceId: string; readonly versionId: string; readonly name: string }[] = [
  { sourceId: 'DOC2026001', versionId: 'v2026.06', name: '变径空间扩挖与支护专项施工方案' },
  { sourceId: 'DOC2026002', versionId: 'v2026.03', name: '工程地质勘察报告' },
  { sourceId: 'DOC2026003', versionId: 'v2026.08', name: '站隧一体化试验区段监测数据集' },
];

export function StartIdentificationPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="启动识别向导"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前没有可用于识别的资料版本"
      content={
        <div className="ri-page">
          <p className="ri-context-subtitle">
            以识别准备快照启动一次识别运行（I0–I9）；识别依据版本在提交时锁定，运行全程不变。
          </p>

          <FieldCard title="识别范围">
            <div className="ri-form-section">
              <label className="ri-check-row">
                <input type="checkbox" defaultChecked />
                <span>区段一 · 始发井至换乘段（当前修订 rev-2）</span>
              </label>
              <label className="ri-check-row">
                <input type="checkbox" defaultChecked />
                <span>区段二 · 换乘段至接收井（当前修订 rev-1）</span>
              </label>
              <p className="ri-form-note">资料段集与部分可用判断在 I0 准备快照中冻结，运行中途不可变更。</p>
            </div>
          </FieldCard>

          <FieldCard title="资料版本集">
            <div className="ri-form-section">
              {SOURCE_VERSIONS.map((source) => (
                <label key={source.sourceId} className="ri-check-row">
                  <input type="checkbox" defaultChecked />
                  <span>
                    <a href={LINKS.projectSource(source.sourceId)}>{source.name}</a>{' '}
                    <span className="mono">
                      {source.sourceId} · {source.versionId}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </FieldCard>

          <FieldCard title="识别依据版本（提交时锁定）">
            <div className="ri-version-list">
              {BASIS_ORDER.map((key) => (
                <VersionRefText
                  key={key}
                  label={IDENTIFICATION_BASIS_LABELS[key]}
                  reference={IDENTIFICATION_BASIS_VERSIONS[key]}
                />
              ))}
            </div>
            <p className="ri-form-note">
              工序模型见 <a href={LINKS.knowledgeProcessModels}>项目工序模型治理</a>
              {'；'}机理条目见 <a href={LINKS.knowledgeMechanisms}>风险机理库</a>
              {'；'}识别侧视图见 <a href={LINKS.identificationProcessModel}>项目工序模型视图</a>。
            </p>
          </FieldCard>

          <FieldCard title="入口与幂等">
            <dl className="ri-field-grid">
              <FieldRow label="触发方式">{RUN_TRIGGER_TYPE_LABELS.manual}（manual）</FieldRow>
              <FieldRow label="触发原因">
                {IDENTIFICATION_TRIGGER_REASON_LABELS['initial-identification']}
              </FieldRow>
              <FieldRow label="幂等键">
                <span className="mono">IDEMP-I-20260918-0003</span>
              </FieldRow>
            </dl>
          </FieldCard>

          <div className="ri-form-footer">
            <CapabilityAction
              capabilities={input.capabilities}
              capability="risk-identification.run"
              href={LINKS.identificationRun('RUN-20260827-001')}
            >
              提交并启动识别
            </CapabilityAction>
          </div>

          <EventTimeline
            events={[
              {
                at: '2026-06-15 16:42',
                label: '专项施工方案 DOC2026001 交付登记',
                href: LINKS.projectSource('DOC2026001'),
              },
              {
                at: '2026-08-20 10:00',
                label: '工序模型 PM-VDS · v2026.08 发布',
                href: LINKS.knowledgeProcessModels,
              },
              {
                at: '2026-08-27 08:31',
                label: '识别运行 RUN-20260827-001 启动',
                href: LINKS.identificationRun('RUN-20260827-001'),
              },
              { at: '2026-08-27 09:18', label: '识别运行 RUN-20260827-001 完成，4 条记录入库' },
            ]}
          />
        </div>
      }
    />
  );
}
