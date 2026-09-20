// P-RI-04 项目工序模型视图（B 详情骨架）。
// 骨架：B 详情（标题区 + 字段分组卡 + 底部业务事件时间线）。
// 数据 branch：knowledge-modeling.identification-basis；页面级能力位：risk-identification.read。
// 工序数据与 P-KM-02 工序治理页同源（content/knowledge.ts 的已发布工序模型），
// 本页为识别侧只读视图，呈现「必含 5 项」最小覆盖集并沿追溯链深链互跳。
// 七态：非 ready 态由 PageFrame 承载。

import type { RouteRenderInput } from '../../app/routes';
import { PageFrame } from '../../shared/PageFrame';
import {
  PROCESS_MODEL_OBJECTS,
  PROCESS_MODEL_RELEASE_REF,
} from '../../content/knowledge';
import {
  IDENTIFICATION_BASIS_LABELS,
  IDENTIFICATION_BASIS_VERSIONS,
  LINKS,
  riskRecordKey,
  riskRecordsByProcessNode,
} from '../../content/identification';
import { EventTimeline, FieldCard, VersionRefText } from './widgets';

const PROCESS_MODEL = PROCESS_MODEL_OBJECTS[0];

export function ProcessModelViewPage({ input }: { readonly input: RouteRenderInput }) {
  const detail = PROCESS_MODEL.detail;
  const covered = detail.requiredNodeNames.filter((name) =>
    detail.nodes.some((node) => node.name === name),
  );

  return (
    <PageFrame
      title="项目工序模型视图"
      state={input.pageState}
      skeleton="B"
      emptyMessage="当前没有已发布的工序模型"
      content={
        <div className="ri-page">
          <p className="ri-context-subtitle">
            工序模型来自知识域已发布版本，识别运行按工序节点枚举识别工作项；治理与版本演进见{' '}
            <a href={LINKS.knowledgeProcessModels}>项目工序模型治理</a>。
          </p>

          <FieldCard title="必含 5 项最小覆盖集">
            <p className="ri-form-note">
              已覆盖 {covered.length} / {detail.requiredNodeNames.length}
              项；最小覆盖集可扩展、不可删减。
            </p>
            <ul className="ri-coverage">
              {detail.requiredNodeNames.map((name) => {
                const node = detail.nodes.find((entry) => entry.name === name);
                return (
                  <li key={name}>
                    <span className={node === undefined ? 'ri-cover-miss' : 'ri-cover-ok'} aria-hidden="true" />
                    {name}
                    {node === undefined ? null : (
                      <span className="mono ri-form-note">（{node.nodeId}）</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </FieldCard>

          <FieldCard title="工序节点">
            <div className="ri-table-wrap">
              <table className="ri-table">
                <thead>
                  <tr>
                    <th>节点</th>
                    <th>输入描述</th>
                    <th>输出描述</th>
                    <th>装备部件 / 构件</th>
                    <th>状态参数</th>
                    <th>监测指标</th>
                    <th>关联风险记录</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.nodes.map((node) => {
                    const records = riskRecordsByProcessNode(node.nodeId);
                    return (
                      <tr key={node.nodeId}>
                        <td>
                          <span className="mono">{node.nodeId}</span>
                          <br />
                          {node.name}
                        </td>
                        <td>{node.input}</td>
                        <td>{node.output}</td>
                        <td>
                          {[...node.equipmentComponents, ...node.structuralComponents].join('、') ||
                            '—'}
                        </td>
                        <td>{node.stateParameters.join('、')}</td>
                        <td>{node.monitoringIndicators.join('、')}</td>
                        <td>
                          {records.length === 0 ? (
                            <span className="ri-form-note">—</span>
                          ) : (
                            <div className="ri-cell-stack">
                              {records.map((record) => {
                                const recordId = riskRecordKey(record);
                                return (
                                  <a
                                    key={recordId}
                                    className="mono"
                                    href={LINKS.identificationRecord(recordId)}
                                  >
                                    {recordId}
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </FieldCard>

          <FieldCard title="工序依赖关系">
            <div className="ri-table-wrap">
              <table className="ri-table">
                <thead>
                  <tr>
                    <th>前序节点</th>
                    <th>后续节点</th>
                    <th>关系类型</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.dependencies.map((dependency) => (
                    <tr
                      key={`${dependency.sourceNodeId}-${dependency.targetNodeId}-${dependency.relationType}`}
                    >
                      <td className="mono">{dependency.sourceNodeId}</td>
                      <td className="mono">{dependency.targetNodeId}</td>
                      <td>{dependency.relationType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ri-form-note">
              工序与机理、风险记录的关联见{' '}
              <a href={LINKS.graph}>工序风险关联图谱</a>。
            </p>
          </FieldCard>

          <FieldCard title="版本引用">
            <div className="ri-version-list">
              <VersionRefText
                label={IDENTIFICATION_BASIS_LABELS.processModelRelease}
                reference={IDENTIFICATION_BASIS_VERSIONS.processModelRelease}
              />
            </div>
            <p className="ri-form-note">
              当前生效版本{' '}
              <span className="mono">
                {PROCESS_MODEL_RELEASE_REF.entityId} · {PROCESS_MODEL_RELEASE_REF.versionId}
              </span>
              ；治理视图见 <a href={LINKS.knowledgeProcessModels}>项目工序模型治理</a>。
            </p>
          </FieldCard>

          <EventTimeline
            events={[
              {
                at: '2026-08-20 10:00',
                label: '工序模型 PM-VDS · v2026.08 发布（必含 5 项全覆盖）',
                href: LINKS.knowledgeProcessModels,
              },
              {
                at: '2026-08-27 08:31',
                label: '识别运行 RUN-20260827-001 引用本版本启动',
                href: LINKS.identificationRun('RUN-20260827-001'),
              },
              {
                at: '2026-09-14 11:00',
                label: 'v2026.09-review 提请审核（缩径转换节点状态参数补充）',
                href: LINKS.knowledgeProcessModels,
              },
            ]}
          />
        </div>
      }
    />
  );
}
