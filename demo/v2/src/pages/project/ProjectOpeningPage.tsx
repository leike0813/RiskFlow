// P-PJ-02 工程开通与业务上下文表单：B 详情骨架（表单形态）。
// 数据：engineering-data.register-source-delivery 所属工程数据写通路；
// 页面级能力位 engineering-data.write（框架层门控），提交动作同位门控。
// 表单字段对齐 EngineeringContextRevisionCommandV1（kind: project）与 open-project 命令形状。

import type { RouteRenderInput } from '../../app/routes';
import { CURRENT_PROJECT_REVISION, PROJECT_BUSINESS_REVISIONS } from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import { BusinessTimeline, GatedAction, VersionedRefText } from './widgets';

const LIFECYCLE_OPTIONS: readonly { readonly value: string; readonly label: string }[] = [
  { value: 'preparing', label: '筹备中' },
  { value: 'active', label: '在建' },
  { value: 'ended', label: '已完工' },
  { value: 'archived', label: '已归档' },
];

function OpeningForm({ input }: { readonly input: RouteRenderInput }) {
  const revision = CURRENT_PROJECT_REVISION;
  return (
    <form
      onSubmit={(event) => event.preventDefault()}
      aria-label="工程开通与业务上下文表单"
    >
      <section className="pj-card pj-form-section">
        <h3>开通信息</h3>
        <div className="pj-form-grid">
          <div className="pj-form-field">
            <label htmlFor="pj-open-project-id">工程标识</label>
            <input id="pj-open-project-id" defaultValue={revision.projectId} />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-open-project-name">工程名称</label>
            <input id="pj-open-project-name" defaultValue={revision.name} />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-open-manager">初始风险负责人账号</label>
            <input id="pj-open-manager" defaultValue="ACCT-001" />
            <span className="pj-form-note">开通后默认授予项目风险负责人角色。</span>
          </div>
        </div>
      </section>
      <section className="pj-card pj-form-section">
        <h3>业务上下文（适用性元数据三维度）</h3>
        <div className="pj-form-grid">
          <div className="pj-form-field">
            <label htmlFor="pj-open-lifecycle">生命周期</label>
            <select id="pj-open-lifecycle" defaultValue={revision.lifecycle}>
              {LIFECYCLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-open-method">施工工法</label>
            <input id="pj-open-method" defaultValue={revision.applicabilityMetadata.constructionMethod} />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-open-stratum">地层条件</label>
            <input id="pj-open-stratum" defaultValue={revision.applicabilityMetadata.stratumCondition} />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-open-stage">工程阶段</label>
            <input id="pj-open-stage" defaultValue={revision.applicabilityMetadata.engineeringStage} />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-open-valid-from">生效时间（自）</label>
            <input id="pj-open-valid-from" type="datetime-local" defaultValue="2026-09-18T09:00" />
          </div>
        </div>
        <p className="pj-form-note">
          当前生效修订为 <VersionedRefText label="工程修订" reference={revision.projectRevisionRef} />
          ；提交后按期望版本校验生成下一单调递增修订，历史修订不被覆盖。
        </p>
      </section>
      <div className="pj-actions">
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="开通工程并登记业务上下文"
          primary
        />
      </div>
      <BusinessTimeline
        events={PROJECT_BUSINESS_REVISIONS.map((item) => ({
          time: item.audit.recordedAt,
          title: `业务上下文 ${item.projectRevisionRef.reference.versionId} 生效（${item.audit.reason ?? '修订'}）`,
          actor: item.audit.actorId,
        }))}
      />
    </form>
  );
}

export function ProjectOpeningPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="工程开通与业务上下文表单"
      state={input.pageState}
      skeleton="B"
      emptyMessage="尚未选择待开通工程。"
      content={<OpeningForm input={input} />}
    />
  );
}
