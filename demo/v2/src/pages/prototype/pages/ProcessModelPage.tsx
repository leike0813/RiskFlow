// PROTOTYPE · THROWAWAY — 票 05 第 12 页：工序模型
// 工序节点名用甲方词（扩径准备 / 变径空间扩挖 / 刀盘扩径 / 盾体扩径 / 缩径转换），来自契约枚举。
// 版本发布与审核是人的决定，本页只呈现版本现状与差异，不代为发布。

import {
  KNOWLEDGE_LIFECYCLE_LABELS,
  PROCESS_MODEL_OBJECTS,
  PROCESS_MODEL_RELEASE_REF,
} from '../../../content/knowledge';
import { PROCESS_NODE_DEPENDENCIES } from '../../../content/project';
import { Ids, KeyValue, Section, Stats, Tag } from '../parts';

export function ProcessModelPage() {
  const model = PROCESS_MODEL_OBJECTS[0];
  const detail = model.detail;
  const publishedVersion = model.versions.find((v) => v.lifecycle === 'published');
  const inReviewVersion = model.versions.find((v) => v.lifecycle === 'in-review');
  const coveredNames = new Set(detail.nodes.map((n) => n.name));

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">
            识别 / 工序模型 · 治理侧为
            <a href="#/knowledge/process-models"> 风险源清单</a>
          </div>
          <h1 className="dl-h1">工序模型</h1>
          <div className="dl-head-meta">
            <Tag>现行版本 {PROCESS_MODEL_RELEASE_REF.versionId}</Tag>
            {inReviewVersion ? <Tag accent>审核中 {inReviewVersion.versionId}</Tag> : null}
            <span className="dl-xs dl-faint">
              必含工序节点 {detail.requiredNodeNames.length} 项，模型已定义 {detail.nodes.length} 项
            </span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--sm" type="button">查看风险源清单</button>
          <button className="dl-btn dl-btn--sm dl-btn--primary" type="button">发布新版本</button>
        </div>
      </header>

      <Stats
        items={[
          { label: '工序节点', value: detail.nodes.length },
          { label: '节点间依赖', value: detail.dependencies.length },
          { label: '必含节点覆盖', value: `${detail.requiredNodeNames.filter((n) => coveredNames.has(n)).length}/${detail.requiredNodeNames.length}` },
          { label: '模型版本', value: model.versions.length },
        ]}
      />

      <Section title="工序节点" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>工序节点</th>
              <th>输入</th>
              <th>输出</th>
              <th>装备构件</th>
              <th>结构构件</th>
              <th>状态参数</th>
              <th>监测量测</th>
            </tr>
          </thead>
          <tbody>
            {detail.nodes.map((node) => (
              <tr key={node.nodeId}>
                <td>
                  <div className="dl-sm" style={{ fontWeight: 600 }}>{node.name}</div>
                  {PROCESS_NODE_DEPENDENCIES.some((d) => d.processNodeId === node.nodeId) ? (
                    <div className="dl-xs dl-faint">本工程在用</div>
                  ) : (
                    <div className="dl-xs dl-faint">本工程未登记使用</div>
                  )}
                </td>
                <td className="dl-sm dl-muted">{node.input}</td>
                <td className="dl-sm dl-muted">{node.output}</td>
                <td className="dl-sm dl-muted">{node.equipmentComponents.join('、') || '—'}</td>
                <td className="dl-sm dl-muted">{node.structuralComponents.join('、') || '—'}</td>
                <td className="dl-sm dl-muted">{node.stateParameters.join('、')}</td>
                <td className="dl-sm dl-muted">{node.monitoringIndicators.join('、')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="本工程在用工序节点" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>工序节点</th>
              <th>适用区段</th>
              <th>依赖的工序模型版本</th>
            </tr>
          </thead>
          <tbody>
            {PROCESS_NODE_DEPENDENCIES.map((dep) => (
              <tr key={dep.processNodeId}>
                <td className="dl-sm">{dep.name}</td>
                <td className="dl-sm dl-muted dl-mono">
                  {dep.spatialScopeRef.reference.entityId} · {dep.spatialScopeRef.reference.versionId}
                </td>
                <td className="dl-sm dl-muted">
                  {dep.processModelReleaseRef.reference.versionId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="节点依赖" flush>
        <table className="dl-table">
          <thead>
            <tr>
              <th>上游工序节点</th>
              <th>依赖类型</th>
              <th>下游工序节点</th>
            </tr>
          </thead>
          <tbody>
            {detail.dependencies.map((dep) => (
              <tr key={`${dep.sourceNodeId}->${dep.targetNodeId}`}>
                <td className="dl-sm">
                  {detail.nodes.find((n) => n.nodeId === dep.sourceNodeId)?.name ?? dep.sourceNodeId}
                </td>
                <td className="dl-sm dl-muted">{dep.relationType}</td>
                <td className="dl-sm">
                  {detail.nodes.find((n) => n.nodeId === dep.targetNodeId)?.name ?? dep.targetNodeId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="模型版本">
        <KeyValue
          items={[
            ['模型名称', model.name],
            ['现行版本', PROCESS_MODEL_RELEASE_REF.versionId],
            ['已发布版本说明', publishedVersion?.note ?? '—'],
            ['审核中版本说明', inReviewVersion ? `${inReviewVersion.versionId} · ${inReviewVersion.note}` : '无审核中版本'],
          ]}
        />
        <hr className="dl-rule" />
        <table className="dl-table">
          <thead>
            <tr>
              <th>版本</th>
              <th>状态</th>
              <th>记录时间</th>
              <th>记录人</th>
              <th>相对上一版的改动</th>
            </tr>
          </thead>
          <tbody>
            {model.versions.map((v) => (
              <tr key={v.versionId}>
                <td className="dl-sm">{v.versionId}</td>
                <td>
                  <span className={`dl-tag${v.lifecycle === 'in-review' ? ' dl-tag--accent' : ''}`}>
                    {KNOWLEDGE_LIFECYCLE_LABELS[v.lifecycle]}
                  </span>
                </td>
                <td className="dl-sm dl-num dl-muted">{v.recordedAt.slice(0, 10)}</td>
                <td className="dl-sm dl-muted">{v.actor}</td>
                <td className="dl-sm dl-muted">
                  {v.diffs.length === 0 ? (
                    <span className="dl-faint">—</span>
                  ) : (
                    v.diffs.map((d) => (
                      <div key={d.field}>
                        <span className="dl-xs dl-faint">{d.field}：</span>
                        <span className="dl-delta-old">{d.before}</span> → {d.after}
                      </div>
                    ))
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Ids
          pairs={[
            ['模型', model.objectId],
            ['现行版本', `${model.currentVersion.entityId} · ${model.currentVersion.versionId}`],
            ['在用节点', PROCESS_NODE_DEPENDENCIES.map((d) => d.processNodeId).join(' ')],
          ]}
        />
      </Section>
    </div>
  );
}
