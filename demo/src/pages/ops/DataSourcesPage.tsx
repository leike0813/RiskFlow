/**
 * 数据源与适配器连接（v2 P-OP-02 的 A+B 两分区）。
 *
 * 两个分区彼此独立，不互相顶替：
 *
 * (a) 已登记资料与监测系列走工程侧 context-read / source-catalog /
 *     monitoring-catalog，另需工程成员的原业务权限；纯系统管理员在这里得到
 *     "未获该工程业务权限"，不会因为系统管理身份而获得工程资料访问。
 * (b) 当前部署实际提供的连接定义事实。现有登记读取没有返回 deliveryKind 与
 *     connectionDefinitionRef，本部署也没有连接生命周期端口，因此这里只呈现
 *     缺席事实，不造连接状态、不提供检查或停用动作、不读连接秘密。
 */
import { useSearchParams } from 'react-router-dom'
import { Card } from '../../components/Card'
import { VersionTag } from '../../components/VersionTag'
import {
  listMonitoringSeries,
  listSourceCatalog,
  type MonitoringSeriesItemView,
  type SourceCatalogItemView,
} from '../../api/operations'
import {
  CLEANING_AVAILABILITY_LABEL,
  SOURCE_PARSE_STATUS_LABEL,
  SystemReadView,
  OpsPage,
  useSystemRead,
} from './opsShared'
import './ops.css'

export default function DataSourcesPage() {
  // 已登记来源是工程侧事实，工程标识直接取自 URL 选择器：
  // 系统管理路由本身不经过工程门，工程参数只在这一分区生效。
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')

  const sources = useSystemRead<readonly SourceCatalogItemView[]>(
    async (signal) =>
      projectId === null ? [] : (await listSourceCatalog(projectId, {}, signal)).items,
    [projectId],
  )
  const series = useSystemRead<readonly MonitoringSeriesItemView[]>(
    async (signal) =>
      projectId === null ? [] : (await listMonitoringSeries(projectId, {}, signal)).items,
    [projectId],
  )

  return (
    <OpsPage
      title="数据源与适配器连接"
      subtitle="工程内已登记来源与当前部署提供的连接定义"
    >
      <p className="op-context">
        {[
          '接入通路语义：实时多源监测数据 → 指标实际取值',
          projectId === null ? '未选择工程' : `当前工程 ${projectId}`,
        ].join(' · ')}
      </p>

      {projectId === null ? (
        <Card title="已登记资料与监测系列" style={{ marginBottom: 16 }}>
          <p className="op-muted">
            已登记资料与监测系列属于工程业务事实，需要另行选择工程。系统管理本身不需要工程上下文。
          </p>
        </Card>
      ) : (
        <>
          <SystemReadView
            state={sources.state}
            title="已登记资料"
            emptyMessage="该工程当前没有已登记资料。"
            forbiddenHint="未获该工程业务权限；系统管理身份不等于工程资料访问权限"
            onRetry={sources.reload}
          >
            {(items) => (
              <Card title="已登记资料" style={{ marginBottom: 16 }}>
                <div className="op-table-wrap">
                  <table className="op-table">
                    <thead>
                      <tr>
                        <th scope="col">资料标识</th>
                        <th scope="col">版本</th>
                        <th scope="col">文档类型</th>
                        <th scope="col">形成时间</th>
                        <th scope="col">来源单位</th>
                        <th scope="col">解析状态</th>
                        <th scope="col">清洗可用性</th>
                        <th scope="col">资料段集</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.sourceVersionRef.reference.entityId}>
                          <td className="mono">{item.sourceId}</td>
                          <td>
                            <VersionTag>
                              {item.sourceVersionRef.reference.versionId}
                            </VersionTag>
                          </td>
                          <td>{item.documentType ?? '—'}</td>
                          <td className="mono">{item.formedAt ?? '—'}</td>
                          <td>{item.sourceOrganization ?? '—'}</td>
                          <td>
                            {SOURCE_PARSE_STATUS_LABEL[item.parseStatus] ?? item.parseStatus}
                          </td>
                          <td>
                            {item.cleaningAvailability === undefined
                              ? '—'
                              : (CLEANING_AVAILABILITY_LABEL[item.cleaningAvailability] ??
                                item.cleaningAvailability)}
                          </td>
                          <td className="mono">
                            {item.sourceSegmentSetRef === undefined
                              ? '—'
                              : item.sourceSegmentSetRef.reference.entityId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="op-note">
                  本区只呈现资料版本标识与解析/清洗登记事实，不含资料正文、模型正文或思维链。
                </p>
              </Card>
            )}
          </SystemReadView>

          <SystemReadView
            state={series.state}
            title="监测系列"
            emptyMessage="该工程当前没有已登记监测系列。"
            forbiddenHint="未获该工程业务权限；系统管理身份不等于工程资料访问权限"
            onRetry={series.reload}
          >
            {(items) => (
              <Card title="监测系列" style={{ marginBottom: 16 }}>
                <div className="op-table-wrap">
                  <table className="op-table">
                    <thead>
                      <tr>
                        <th scope="col">系列引用</th>
                        <th scope="col">监测指标</th>
                        <th scope="col">监测对象</th>
                        <th scope="col">标准单位</th>
                        <th scope="col">空间范围</th>
                        <th scope="col">批次数</th>
                        <th scope="col">最新快照</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.monitoringSeriesRef.reference.entityId}>
                          <td className="mono">
                            {item.monitoringSeriesRef.reference.entityId}
                          </td>
                          <td>{item.monitoringIndicator}</td>
                          <td>{item.monitoringObject}</td>
                          <td className="mono">{item.canonicalUnit}</td>
                          <td className="mono">
                            {item.spatialScopeRef.reference.entityId}
                          </td>
                          <td className="mono">{item.batchCount}</td>
                          <td className="mono">
                            {item.latestSnapshotRef === undefined
                              ? '—'
                              : item.latestSnapshotRef.reference.entityId}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </SystemReadView>
        </>
      )}

      <Card title="连接定义">
        <p className="op-muted">
          当前部署没有提供连接定义事实：资料与监测系列的登记读取只返回版本引用、解析与清洗状态，
          未返回交付通道或连接定义引用，因此本页不呈现连接状态，也不提供连接检查或停用入口。
        </p>
        <p className="op-note">
          连接生命周期与连接秘密不在本轮接入范围；一旦部署提供已登记的连接定义引用，此处才显示对应事实。
        </p>
      </Card>
    </OpsPage>
  )
}