import { useState } from "react";

import AppShell from "../../components/AppShell";
import { Card } from "../../components/Card";
import { ConfirmButton, useSystemConfirmationScope } from "../../components/ConfirmButton";
import { SectionTabs } from "../../components/SectionTabs";
import {
  listSystemAccounts,
  prepareOpenSystemProject,
  readSystemIdentity,
  sendAdministrationCommand,
  type PreparedAdministrationCommandV1,
  type SystemAccountView,
} from "../../api/agentAuditOperations";
import { clientError } from "../../api/client";
import type { CommandConfirmationPlanV1 } from "../../shared/confirmation";
import { SystemReadView, useSystemRead } from "../ops/opsShared";
import { ProjectOpeningForm, type ProjectOpeningInputV1 } from "./ProjectOpeningForm";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import "./ProjectWorkspace.css";

/**
 * 工程开通页（design D-04）。
 *
 * 开通沿原系统管理命令与六动作确认路径：工程开通不要求当前工程，也不因开通取得
 * 任何工程业务读权。表单与系统管理页共用同一实现，不复制第二套确认。
 */
export default function ProjectOpeningPage() {
  const identity = useSystemRead((signal) => readSystemIdentity(signal), []);
  const authorized = identity.state.kind === "ready" && identity.state.value.isSystemAdministrator;
  const accounts = useSystemRead<readonly SystemAccountView[]>(
    async (signal) => (authorized ? await listSystemAccounts(signal) : []),
    [authorized],
  );
  const [pending, setPending] = useState<ProjectOpeningInputV1 | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const sessionScope = useSystemConfirmationScope();
  const scope = authorized ? sessionScope : undefined;

  const plan = (
    input: ProjectOpeningInputV1,
  ): CommandConfirmationPlanV1<PreparedAdministrationCommandV1> => {
    if (scope === undefined || scope.kind !== "system") throw clientError("CONTRACT_INVALID");
    const request = prepareOpenSystemProject({
      projectId: input.projectId,
      initialRiskManagerAccountId: input.initialRiskManagerAccountId,
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "system-administration.execute",
      scope,
      targets: [],
      inputVersions: [],
      expectedFacts: [
        `对象：新工程 ${input.projectId}`,
        `初始工程风险负责人：${input.initialRiskManagerAccountId}`,
        "预计结果：工程访问进入开通状态",
        "副作用：只建立访问与成员事实，不代为登记业务修订或评估配置",
      ],
      externalEffects: ["开通工程"],
      impact: "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  return (
    <AppShell activeNav="project" agentContext={[]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">工程开通</h1>
            <p className="page-subtitle">开通只写入访问与成员事实；业务上下文另行登记</p>
          </div>
        </header>

        <SectionTabs items={[...PROJECT_NAVIGATION_ITEMS_V1]} />

        <SystemReadView
          state={identity.state}
          title="系统管理身份"
          forbiddenHint="当前会话不是系统管理员，工程开通入口不予披露"
          onRetry={identity.reload}
        >
          {(me) =>
            me.isSystemAdministrator ? (
              <>
                <p className="pjwf-context">
                  开通入口按系统管理身份决定，不要求当前工程；系统管理员不因此获得工程业务读取权。
                </p>
                {outcome !== null && (
                  <Card title="最近一次开通结果" style={{ marginBottom: 16 }}>
                    <p className="pjwf-note">已登记工程 {outcome}</p>
                  </Card>
                )}
                <Card title="开通工程" style={{ marginBottom: 16 }}>
                  <SystemReadView
                    state={accounts.state}
                    title="系统账号目录"
                    forbiddenHint="账号目录只向系统管理员披露"
                    onRetry={accounts.reload}
                  >
                    {(list) => (
                      <ProjectOpeningForm
                        accounts={list.map((account) => ({
                          accountRef: account.accountRef,
                          displayName: account.displayName,
                          status: account.status,
                        }))}
                        onSubmit={(input) => setPending(input)}
                      />
                    )}
                  </SystemReadView>
                </Card>
                {pending !== null && (
                  <ConfirmButton
                    label="确认开通工程"
                    tone="primary"
                    availability={{ kind: "allowed" }}
                    requiredPermission={{ kind: "system", action: "open-project" }}
                    scope={scope}
                    intentRevision={JSON.stringify([
                      pending.projectId,
                      pending.initialRiskManagerAccountId,
                    ])}
                    createPlan={() => plan(pending)}
                    submit={async (frozen) => {
                      const result = await sendAdministrationCommand(frozen.request);
                      return {
                        kind: "command-result",
                        result: {
                          kind: "system-administration",
                          resultRef: {
                            kind: "authorization-context",
                            reference: result.resultRef,
                          },
                        },
                      };
                    }}
                    onSucceeded={() => {
                      setOutcome(pending.projectId);
                      setPending(null);
                    }}
                    onClosed={() => setPending(null)}
                  />
                )}
              </>
            ) : (
              <Card title="当前会话不具备系统管理身份">
                <p className="pjwf-note">
                  账号、成员与工程访问目录只向服务端确认的系统管理员披露；普通会话在此不显示任何系统对象。
                </p>
              </Card>
            )
          }
        </SystemReadView>
      </div>
    </AppShell>
  );
}
