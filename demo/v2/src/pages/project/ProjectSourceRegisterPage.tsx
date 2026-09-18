// P-PJ-06 资料登记表单：B 详情骨架（表单形态）。
// 数据：engineering-data.register-source-delivery；页面级能力位 engineering-data.write（框架层门控）。
// 表单字段对齐 RegisterSourceDeliveryPayloadV1 与 SourceDeliveryMetadataEnvelopeV1。

import { useState } from 'react';
import type { RouteRenderInput } from '../../app/routes';
import {
  CURRENT_PROJECT_REVISION,
  CURRENT_SPATIAL_REVISIONS,
  type SourceDeliveryKind,
} from '../../content/project';
import { PageFrame } from '../../shared/PageFrame';
import { GatedAction, VersionedRefText } from './widgets';

const DELIVERY_KIND_OPTIONS: readonly { readonly value: SourceDeliveryKind; readonly label: string }[] = [
  { value: 'file-upload', label: '文件上传' },
  { value: 'database-snapshot', label: '数据库快照' },
  { value: 'api-snapshot', label: '接口快照' },
];

function RegisterForm({ input }: { readonly input: RouteRenderInput }) {
  const [kind, setKind] = useState<SourceDeliveryKind>('file-upload');
  return (
    <form onSubmit={(event) => event.preventDefault()} aria-label="资料登记表单">
      <section className="pj-card pj-form-section">
        <h3>交付信息</h3>
        <div className="pj-form-grid">
          <div className="pj-form-field">
            <label htmlFor="pj-src-connection">数据源连接</label>
            <select id="pj-src-connection" defaultValue="CONN-FILE-01">
              <option value="CONN-FILE-01">CONN-FILE-01 · v2026.06（本地上传通道）</option>
              <option value="CONN-MON-01">CONN-MON-01 · v2026.08（监测接口）</option>
            </select>
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-delivery-key">交付键（幂等）</label>
            <input id="pj-src-delivery-key" defaultValue="delivery-20260918-001" />
            <span className="pj-form-note">同一交付键重复提交不会产生第二条交付记录。</span>
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-occurred-at">交付发生时间</label>
            <input id="pj-src-occurred-at" type="datetime-local" defaultValue="2026-09-18T09:00" />
          </div>
        </div>
      </section>
      <section className="pj-card pj-form-section">
        <h3>交付方式</h3>
        <div className="pj-radio-row" role="radiogroup" aria-label="交付方式">
          {DELIVERY_KIND_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="delivery-kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
              />
              {option.label}
            </label>
          ))}
        </div>
        <div className="pj-form-grid" style={{ marginTop: 'var(--space-3)' }}>
          {kind === 'file-upload' ? (
            <div className="pj-form-field">
              <label htmlFor="pj-src-fingerprint">内容指纹</label>
              <input id="pj-src-fingerprint" defaultValue="sha256:" />
            </div>
          ) : null}
          {kind === 'database-snapshot' ? (
            <div className="pj-form-field">
              <label htmlFor="pj-src-query-fingerprint">查询指纹</label>
              <input id="pj-src-query-fingerprint" defaultValue="query:" />
            </div>
          ) : null}
          {kind === 'api-snapshot' ? (
            <>
              <div className="pj-form-field">
                <label htmlFor="pj-src-request-fingerprint">请求指纹</label>
                <input id="pj-src-request-fingerprint" defaultValue="req:" />
              </div>
              <div className="pj-form-field">
                <label htmlFor="pj-src-response-fingerprint">响应指纹</label>
                <input id="pj-src-response-fingerprint" defaultValue="resp:" />
              </div>
            </>
          ) : null}
        </div>
      </section>
      <section className="pj-card pj-form-section">
        <h3>资料元数据</h3>
        <div className="pj-form-grid">
          <div className="pj-form-field">
            <label htmlFor="pj-src-name">资料名称</label>
            <input id="pj-src-name" defaultValue="" />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-category">资料类别</label>
            <input id="pj-src-category" defaultValue="" />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-doctype">文件类型</label>
            <input id="pj-src-doctype" defaultValue="" />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-formed-at">形成时间</label>
            <input id="pj-src-formed-at" type="date" />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-org">形成单位</label>
            <input id="pj-src-org" defaultValue="" />
          </div>
          <div className="pj-form-field">
            <label htmlFor="pj-src-external-version">外部版本</label>
            <input id="pj-src-external-version" defaultValue="" />
          </div>
        </div>
      </section>
      <section className="pj-card pj-form-section">
        <h3>关联上下文</h3>
        <div className="pj-form-grid">
          <div className="pj-form-field">
            <span className="pj-form-label">工程修订（当前生效）</span>
            <VersionedRefText label="工程修订" reference={CURRENT_PROJECT_REVISION.projectRevisionRef} />
          </div>
          {CURRENT_SPATIAL_REVISIONS.map((scope) => (
            <label key={scope.spatialScopeRef.reference.entityId} className="pj-form-field">
              <span className="pj-form-label">空间区段</span>
              <span>
                <input type="checkbox" defaultChecked /> {scope.name}{' '}
                <span className="mono pj-form-note">{scope.spatialScopeRef.reference.entityId}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="pj-form-note">
          登记后生成资料版本并进入「待授权」；授予访问后状态转为「可访问」，见{' '}
          <a href="#/projects/members">工程成员与资料访问</a>。
        </p>
      </section>
      <div className="pj-actions">
        <GatedAction
          capability="engineering-data.write"
          capabilities={input.capabilities}
          label="提交登记"
          primary
        />
        <a className="pj-btn" href="#/projects/sources">
          返回资料目录
        </a>
      </div>
    </form>
  );
}

export function ProjectSourceRegisterPage({ input }: { readonly input: RouteRenderInput }) {
  return (
    <PageFrame
      title="资料登记表单"
      state={input.pageState}
      skeleton="B"
      emptyMessage="登记表单当前不可用。"
      content={<RegisterForm input={input} />}
    />
  );
}
