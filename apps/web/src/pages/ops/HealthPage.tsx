/**
 * 运行与设施健康（v2 P-OP-03 的 A 骨架分区）。
 *
 * 只呈现 D-11 健康提供者实际返回的安全组件标识、状态与稳定原因码：
 * 不渲染 URL、文件路径、堆栈或队列正文，也不补造可用率曲线。
 * 整个运维接缝未注入时，本次读取以结构化失败收口，不显示"正常"。
 */
import { Card } from "../../components/Card";
import { StatusTag } from "../../components/StatusTag";
import {
  readSystemHealth,
  readSystemIdentity,
  type SystemHealthView,
} from "../../api/agentAuditOperations";
import {
  HEALTH_STATUS_LABEL,
  STATUS_TONE,
  SystemReadView,
  OpsPage,
  formatDateTime,
  useSystemRead,
} from "./opsShared";
import "./ops.css";

export default function HealthPage() {
  const identity = useSystemRead((signal) => readSystemIdentity(signal), []);
  const authorized = identity.state.kind === "ready" && identity.state.value.isSystemAdministrator;
  const health = useSystemRead<SystemHealthView>(
    // 无系统管理身份时根本不发请求：目录与运维输出都在读目标之前拒绝。
    async (signal) => {
      if (!authorized) throw new Error("not-authorized");
      return await readSystemHealth(signal);
    },
    [authorized],
  );

  return (
    <OpsPage title="运行与设施健康" subtitle="当前部署登记的安全组件状态与稳定原因码">
      <SystemReadView
        state={identity.state}
        title="系统管理身份"
        forbiddenHint="当前会话不是系统管理员，运维输出不予披露"
        onRetry={identity.reload}
      >
        {(me) =>
          me.isSystemAdministrator ? (
            <SystemReadView
              state={health.state}
              title="组件状态"
              emptyMessage="当前部署未提供组件健康状态。"
              forbiddenHint="当前会话不具备查看该系统对象的权限"
              onRetry={health.reload}
            >
              {(view) => (
                <>
                  <p className="op-context">
                    {[
                      `组件 ${view.components.length} 项`,
                      `采集时点 ${formatDateTime(view.capturedAt)}`,
                    ].join(" · ")}
                  </p>
                  <Card title="组件状态">
                    {view.components.length === 0 ? (
                      <p className="op-muted">当前部署未提供组件健康状态。</p>
                    ) : (
                      <div className="op-table-wrap">
                        <table className="op-table">
                          <thead>
                            <tr>
                              <th scope="col">组件标识</th>
                              <th scope="col">状态</th>
                              <th scope="col">原因码</th>
                            </tr>
                          </thead>
                          <tbody>
                            {view.components.map((component) => (
                              <tr key={component.componentId}>
                                <td className="mono">{component.componentId}</td>
                                <td>
                                  <StatusTag tone={STATUS_TONE[component.status] ?? "neutral"}>
                                    {HEALTH_STATUS_LABEL[component.status] ?? component.status}
                                  </StatusTag>
                                </td>
                                <td className="mono">
                                  {component.reasonCode === undefined ? "—" : component.reasonCode}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="op-note">
                      本区只呈现服务端登记的组件标识、状态与原因码；连接地址、文件路径与队列正文不在此披露。
                    </p>
                  </Card>
                </>
              )}
            </SystemReadView>
          ) : (
            <Card title="当前会话不具备系统管理身份">
              <p className="op-muted">
                运维输出只向服务端确认的系统管理员披露；当前会话在此不显示任何组件状态。
              </p>
            </Card>
          )
        }
      </SystemReadView>
    </OpsPage>
  );
}
