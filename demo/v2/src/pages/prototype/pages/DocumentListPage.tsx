// PROTOTYPE · THROWAWAY — 票 05 第 3 页：资料目录。

import {
  INGESTION_TASKS,
  SOURCE_RECORDS,
  type IngestionTaskStatus,
  type SourceAccessStatus,
  type SourceRecordFixture,
} from '../../../content/project';
import { AgentNote, Ids, Section, StateTag, Stats, Tag } from '../parts';

const ACCESS_LABELS: Readonly<Record<SourceAccessStatus, string>> = {
  ready: '已授权可读',
  'pending-access': '待授权',
};

const TASK_STATUS_LABELS: Readonly<Record<IngestionTaskStatus, string>> = {
  queued: '排队中',
  running: '接入中',
  succeeded: '已入库',
  failed: '失败',
};

const DELIVERY_LABELS: Readonly<Record<SourceRecordFixture['descriptor']['kind'], string>> = {
  'file-upload': '文件上传',
  'database-snapshot': '数据库取数',
  'api-snapshot': '接口取数',
};

const taskState = (status: IngestionTaskStatus) =>
  status === 'succeeded' ? 'done' : status === 'failed' ? 'pending' : 'current';

function goto(pageKey: string) {
  window.location.hash = `#/prototype/ui?p=${pageKey}`;
}

export function DocumentListPage() {
  const readable = SOURCE_RECORDS.filter((record) => record.evidenceAccess === 'full');
  const pendingAccess = SOURCE_RECORDS.filter((record) => record.accessStatus === 'pending-access');
  const runningTasks = INGESTION_TASKS.filter((task) => task.status === 'running' || task.status === 'queued');

  return (
    <div className="dl dl-page">
      <header className="dl-head">
        <div>
          <div className="dl-head-crumb">工程 / 资料</div>
          <h1 className="dl-h1">资料目录</h1>
          <div className="dl-head-meta dl-sm dl-faint">
            <span>本工程已登记 {SOURCE_RECORDS.length} 份资料</span>
            <span>·</span>
            <span>可读全文 {readable.length} 份，其余仅可看定位信息</span>
          </div>
        </div>
        <div className="dl-head-actions">
          <button className="dl-btn dl-btn--primary" type="button">上传资料</button>
          <button className="dl-btn" type="button">投送监测批次</button>
        </div>
      </header>

      <AgentNote
        why={`依据 ${SOURCE_RECORDS.length} 份资料记录与 ${INGESTION_TASKS.length} 个接入任务；授权与入库均由人登记，助手不代为放行。`}
        actions={
          <button className="dl-btn dl-btn--sm" type="button" onClick={() => goto('documentDetail')}>
            看主路径那份
          </button>
        }
      >
        助手看到：{pendingAccess.length > 0
          ? `「${pendingAccess[0].name}」已登记但未授权，全文尚不可读，是否放行由你决定。`
          : '全部资料均已授权。'}
        {runningTasks.length > 0 ? `另有 ${runningTasks.length} 个接入任务未完成，最新一个卡在「${runningTasks[runningTasks.length - 1].subjectLabel}」。` : ''}
      </AgentNote>

      <Stats
        items={[
          { label: '资料', value: SOURCE_RECORDS.length },
          { label: '全文可读', value: readable.length },
          { label: '待授权', value: pendingAccess.length },
          { label: '资料段', value: SOURCE_RECORDS.reduce((sum, record) => sum + record.segments.length, 0) },
          { label: '接入未完成', value: runningTasks.length },
        ]}
      />

      <Section title="资料清单" flush action={<span className="dl-xs dl-faint">点击行进入详情</span>}>
        <table className="dl-table">
          <thead>
            <tr>
              <th>资料名称</th>
              <th style={{ width: 96 }}>类别</th>
              <th style={{ width: 88 }}>交付方式</th>
              <th style={{ width: 64 }} className="is-right">资料段</th>
              <th style={{ width: 132 }}>覆盖区段</th>
              <th style={{ width: 92 }}>授权</th>
              <th style={{ width: 92 }}>可读范围</th>
              <th style={{ width: 96 }}>发生时间</th>
            </tr>
          </thead>
          <tbody>
            {SOURCE_RECORDS.map((record) => (
              <tr
                key={record.sourceItemId}
                onClick={() => goto('documentDetail')}
                style={{ cursor: 'pointer' }}
              >
                <td>
                  <div>{record.name}</div>
                  <div className="dl-xs dl-faint">
                    {record.metadata.externalVersion ?? '—'}
                    {record.metadata.sourceOrganization ? ` · ${record.metadata.sourceOrganization}` : ''}
                    {record.metadata.worksiteLocation ? ` · ${record.metadata.worksiteLocation}` : ''}
                  </div>
                </td>
                <td><Tag>{record.category}</Tag></td>
                <td className="dl-sm dl-faint">{DELIVERY_LABELS[record.descriptor.kind]}</td>
                <td className="is-num is-right">{record.segments.length}</td>
                <td className="dl-sm dl-faint">{record.spatialScopeRefs.length} 个区段</td>
                <td>
                  <StateTag state={record.accessStatus === 'ready' ? 'done' : 'current'}>
                    {ACCESS_LABELS[record.accessStatus]}
                  </StateTag>
                </td>
                <td className="dl-sm">
                  {record.evidenceAccess === 'full' ? '全文可读' : <span className="dl-faint">仅定位信息</span>}
                </td>
                <td className="dl-sm dl-faint">{record.occurredAt.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="接入任务" flush action={<span className="dl-xs dl-faint">资料与监测批次的入库过程</span>}>
        <table className="dl-table">
          <thead>
            <tr>
              <th style={{ width: 148 }}>接入对象</th>
              <th style={{ width: 76 }}>类型</th>
              <th>触发原因</th>
              <th>环节</th>
              <th style={{ width: 84 }}>状态</th>
              <th style={{ width: 120 }}>入库产出</th>
            </tr>
          </thead>
          <tbody>
            {INGESTION_TASKS.map((task) => (
              <tr key={task.taskId}>
                <td>{task.subjectLabel}</td>
                <td className="dl-sm dl-faint">
                  {task.kind === 'source-delivery' ? '资料交付' : '监测批次'}
                </td>
                <td className="dl-sm">{task.triggerReason}</td>
                <td>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {task.stages.map((stage) => (
                      <span
                        key={stage.code}
                        title={`第 ${task.stages.indexOf(stage) + 1} 环节：${stage.status === 'succeeded' ? '通过' : stage.status === 'failed' ? '未通过' : stage.status === 'running' ? '进行中' : '未开始'}`}
                        style={{
                          width: 22,
                          height: 4,
                          borderRadius: 2,
                          background:
                            stage.status === 'succeeded'
                              ? 'var(--dl-border-strong)'
                              : stage.status === 'running'
                                ? 'var(--dl-accent)'
                                : stage.status === 'failed'
                                  ? 'var(--dl-text-3)'
                                  : 'var(--dl-border)',
                        }}
                      />
                    ))}
                  </div>
                  <div className="dl-xs dl-faint" style={{ marginTop: 2 }}>
                    {task.stages.filter((stage) => stage.status === 'succeeded').length} / {task.stages.length} 环节通过
                    {task.stages.find((stage) => stage.status === 'running')
                      ? ` · 进行中：${task.stages.find((stage) => stage.status === 'running')!.label}`
                      : ''}
                    {task.stages.find((stage) => stage.status === 'failed')
                      ? ` · 未通过：${task.stages.find((stage) => stage.status === 'failed')!.label}`
                      : ''}
                  </div>
                </td>
                <td>
                  <StateTag state={taskState(task.status)}>{TASK_STATUS_LABELS[task.status]}</StateTag>
                </td>
                <td className="dl-sm dl-faint">
                  {task.summary ? `${task.summary.outputCount} 项产出` : '尚未产出'}
                  {task.stages.find((stage) => stage.status === 'failed')
                    ? ` · ${task.stages.find((stage) => stage.status === 'failed')?.errorCode ?? '环节未通过'}`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Ids
        pairs={[
          ...SOURCE_RECORDS.map((record) => [
            record.name,
            `${record.sourceId} ${record.sourceVersionRef.reference.versionId}`,
          ] as const),
          ...INGESTION_TASKS.map((task) => [task.subjectLabel, task.taskId] as const),
        ]}
      />
    </div>
  );
}
