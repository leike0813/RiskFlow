/**
 * 模型与提示模板版本（v2 P-OP-04 的左列表 + 右详情分区）。
 *
 * 只呈现当前部署与注册定义元数据里的安全 pick：部署引用、模型版本引用、
 * 提示模板引用、任务类型与支持模式。不返回也不推断 baseUrl、模型别名、
 * 权重路径或提示正文；没有基础/微调关系事实就不显示该关系。
 *
 * 本页没有发布、回退或微调动作：版本状态就是实际部署与引用本身，
 * 不套知识治理的草稿/审核中/已发布枚举。
 */
import { useState } from "react";
import { Card } from "../../components/Card";
import { VersionTag } from "../../components/VersionTag";
import {
  readSystemIdentity,
  readSystemModelVersions,
  type SystemModelVersionView,
} from "../../api/agentAuditOperations";
import { Field, SystemReadView, OpsPage, useSystemRead } from "./opsShared";
import "./ops.css";

/** 触发模式按注册定义原值呈现，不归并也不推断支持范围。 */
const TRIGGER_MODE_LABEL: Record<string, string> = {
  embedded: "内嵌执行",
  interactive: "交互执行",
};

export default function ModelVersionsPage() {
  const identity = useSystemRead((signal) => readSystemIdentity(signal), []);
  const authorized = identity.state.kind === "ready" && identity.state.value.isSystemAdministrator;
  const versions = useSystemRead<readonly SystemModelVersionView[]>(
    async (signal) => {
      if (!authorized) throw new Error("not-authorized");
      return await readSystemModelVersions(signal);
    },
    [authorized],
  );
  const [selectedTaskType, setSelectedTaskType] = useState<string | null>(null);

  return (
    <OpsPage title="模型与提示模板版本" subtitle="当前部署与任务注册定义中的安全版本引用">
      <SystemReadView
        state={identity.state}
        title="系统管理身份"
        forbiddenHint="当前会话不是系统管理员，部署元数据不予披露"
        onRetry={identity.reload}
      >
        {(me) =>
          me.isSystemAdministrator ? (
            <SystemReadView
              state={versions.state}
              title="模型版本"
              emptyMessage="当前部署未登记模型版本元数据。"
              forbiddenHint="当前会话不具备查看该系统对象的权限"
              onRetry={versions.reload}
            >
              {(list) => {
                const selected =
                  list.find((item) => item.taskType === selectedTaskType) ?? list[0] ?? null;
                return (
                  <>
                    <p className="op-context">
                      {[`任务类型 ${list.length} 项`, "版本引用为不可变快照语义"].join(" · ")}
                    </p>
                    {list.length === 0 ? (
                      <Card title="模型版本">
                        <p className="op-muted">当前部署未登记模型版本元数据。</p>
                      </Card>
                    ) : (
                      <div className="op-master-detail">
                        <aside>
                          <ul className="op-object-list">
                            {list.map((item) => (
                              <li key={item.taskType}>
                                <button
                                  type="button"
                                  className={`op-object${
                                    selected !== null && item.taskType === selected.taskType
                                      ? " is-active"
                                      : ""
                                  }`}
                                  aria-current={
                                    selected !== null && item.taskType === selected.taskType
                                  }
                                  onClick={() => setSelectedTaskType(item.taskType)}
                                >
                                  <span className="op-object-name">{item.taskType}</span>
                                  <span className="op-object-meta">
                                    <span className="mono">{item.modelVersionRef.versionId}</span>
                                  </span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </aside>
                        <div>
                          {selected === null ? null : (
                            <>
                              <Card title={selected.taskType}>
                                <dl className="op-field-grid">
                                  <Field label="任务类型">
                                    <span className="mono">{selected.taskType}</span>
                                  </Field>
                                  <Field label="部署引用">
                                    <span className="mono">{selected.deploymentRef.entityId}</span>{" "}
                                    <VersionTag>{selected.deploymentRef.versionId}</VersionTag>
                                  </Field>
                                  <Field label="模型版本引用">
                                    <span className="mono">
                                      {selected.modelVersionRef.entityId}
                                    </span>{" "}
                                    <VersionTag>{selected.modelVersionRef.versionId}</VersionTag>
                                  </Field>
                                  <Field label="提示模板引用">
                                    <span className="mono">
                                      {selected.promptTemplateRef.entityId}
                                    </span>{" "}
                                    <VersionTag>{selected.promptTemplateRef.versionId}</VersionTag>
                                  </Field>
                                  <Field label="支持模式">
                                    {selected.supportedTriggerModes.length === 0
                                      ? "未登记"
                                      : selected.supportedTriggerModes
                                          .map((mode) => TRIGGER_MODE_LABEL[mode] ?? mode)
                                          .join("、")}
                                  </Field>
                                </dl>
                                <p className="op-note">
                                  本页只显示实际部署与引用；服务地址、模型别名、权重路径与提示正文不在此披露，
                                  版本切换由部署配置决定。
                                </p>
                              </Card>
                            </>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              }}
            </SystemReadView>
          ) : (
            <Card title="当前会话不具备系统管理身份">
              <p className="op-muted">
                部署元数据只向服务端确认的系统管理员披露；当前会话在此不显示任何模型版本。
              </p>
            </Card>
          )
        }
      </SystemReadView>
    </OpsPage>
  );
}
