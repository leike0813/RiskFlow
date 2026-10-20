import { useEffect, useState } from "react";

import AppShell from "../../components/AppShell";
import { Card } from "../../components/Card";
import { ConfirmButton, useProjectConfirmationScope } from "../../components/ConfirmButton";
import { PageStateView } from "../../components/PageStateView";
import { SectionTabs } from "../../components/SectionTabs";
import { StatusTag } from "../../components/StatusTag";
import { useEngineering, usePageQuery } from "../../api/engineering";
import {
  listWorkspaceSpatialScopes,
  prepareEngineeringWorkspaceRevision,
  readEngineeringWorkspaceContext,
  sendEngineeringWorkspaceRevision,
  type EngineeringWorkspaceContextView,
  type PreparedEngineeringWorkspaceRevisionV1,
  type WorkspaceSpatialScopeView,
} from "../../api/engineeringWorkspace";
import { clientError } from "../../api/client";
import type { CommandConfirmationPlanV1 } from "../../shared/confirmation";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import "./ProjectWorkspace.css";

/**
 * 工程上下文维护页（design D-04）。
 *
 * 读取当前工程业务修订与空间区段业务修订；写入只追加原领域修订，预期版本取自
 * 服务端返回的 C11 引用，绝不把 C06 授权版本当成业务版本。历史修订只读。
 */
const LIFECYCLE_OPTIONS = ["preparing", "active", "ended", "archived"] as const;
const LIFECYCLE_LABEL: Record<string, string> = {
  preparing: "准备中",
  active: "进行中",
  ended: "已结束",
  archived: "已归档",
};

export default function ProjectContextPage() {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const scope = useProjectConfirmationScope();

  const context = usePageQuery<EngineeringWorkspaceContextView>(
    (id, signal) => readEngineeringWorkspaceContext(id, {}, signal),
    [projectId],
  );
  const scopes = usePageQuery<readonly WorkspaceSpatialScopeView[]>(
    (id, signal) => listWorkspaceSpatialScopes(id, signal),
    [projectId],
  );

  const [name, setName] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("preparing");
  const [constructionMethod, setConstructionMethod] = useState("");
  const [stratumCondition, setStratumCondition] = useState("");
  const [engineeringStage, setEngineeringStage] = useState("");

  const [scopeId, setScopeId] = useState("");
  const [scopeName, setScopeName] = useState("");
  const [worksiteLocation, setWorksiteLocation] = useState("");
  const [chainageStart, setChainageStart] = useState("");
  const [chainageEnd, setChainageEnd] = useState("");
  const [spatialStatus, setSpatialStatus] = useState("active");

  // 选中的空间范围按稳定身份读取当前业务修订：预期版本来自该修订，不来自授权树。
  const [selectedScope, setSelectedScope] = useState("");
  const spatial = usePageQuery<EngineeringWorkspaceContextView>(
    (id, signal) => readEngineeringWorkspaceContext(id, { scopeId: selectedScope }, signal),
    [projectId, selectedScope],
  );

  useEffect(() => {
    if (scopeId !== "" || scopes.state.kind !== "ready") return;
    const first = scopes.state.value[0];
    if (first !== undefined) setScopeId(first.scopeRef.entityId);
  }, [scopes.state, scopeId]);

  const projectPlan = (): CommandConfirmationPlanV1<PreparedEngineeringWorkspaceRevisionV1> => {
    if (scope === undefined || scope.kind !== "project") throw clientError("CONTRACT_INVALID");
    const current = context.state.kind === "ready" ? context.state.value.project : null;
    const request = prepareEngineeringWorkspaceRevision(projectId ?? "", {
      kind: "project",
      expectedVersion:
        current === null
          ? "none"
          : {
              entityId: current.projectRevisionRef.reference.entityId,
              versionId: current.projectRevisionRef.reference.versionId,
            },
      name: name.trim(),
      lifecycle,
      applicabilityMetadata: {
        constructionMethod: constructionMethod.trim(),
        stratumCondition: stratumCondition.trim(),
        engineeringStage: engineeringStage.trim(),
      },
      effectivePeriod: { validFrom: new Date().toISOString() },
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "engineering-workspace.revise",
      scope,
      targets: [],
      inputVersions: [],
      expectedFacts: [
        `对象：工程业务修订 ${name.trim()}`,
        `生命周期：${LIFECYCLE_LABEL[lifecycle] ?? lifecycle}`,
        "适用范围：施工方法、地层条件与工序阶段三项逐项给出",
        "预计结果：新版本用于后续业务，历史引用保留",
      ],
      externalEffects: ["追加工程业务修订"],
      impact: "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  const spatialPlan = (): CommandConfirmationPlanV1<PreparedEngineeringWorkspaceRevisionV1> => {
    if (scope === undefined || scope.kind !== "project") throw clientError("CONTRACT_INVALID");
    const current = spatial.state.kind === "ready" ? spatial.state.value.spatial : null;
    const request = prepareEngineeringWorkspaceRevision(projectId ?? "", {
      kind: "spatial",
      spatialScopeRef: {
        kind: "spatial-scope",
        reference: {
          entityId: scopeId,
          versionId: current?.spatialScopeRef.reference.versionId ?? "1",
        },
      },
      projectRevisionRef: {
        kind: "project-revision",
        reference: {
          entityId: projectId ?? "",
          versionId:
            context.state.kind === "ready" && context.state.value.project !== null
              ? context.state.value.project.projectRevisionRef.reference.versionId
              : "1",
        },
      },
      expectedVersion:
        current === null
          ? "none"
          : {
              entityId: current.spatialScopeRef.reference.entityId,
              versionId: current.spatialScopeRef.reference.versionId,
            },
      name: scopeName.trim(),
      worksiteLocation: worksiteLocation.trim(),
      ...(chainageStart.trim() === "" || chainageEnd.trim() === ""
        ? {}
        : {
            chainage: {
              start: Number(chainageStart),
              end: Number(chainageEnd),
            },
          }),
      applicabilityOverrides: {},
      status: spatialStatus,
      effectivePeriod: { validFrom: new Date().toISOString() },
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "engineering-workspace.revise",
      scope,
      targets: [],
      inputVersions: [],
      expectedFacts: [
        `对象：空间区段业务修订 ${scopeName.trim()}`,
        `所属空间：${scopeId}`,
        "预计结果：新版本用于后续业务，历史引用保留",
      ],
      externalEffects: ["追加空间区段业务修订"],
      impact: "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  return (
    <AppShell activeNav="project" agentContext={projectId === null ? [] : [projectId]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">工程上下文</h1>
            <p className="page-subtitle">工程业务修订与空间区段修订的真实追加与历史读取</p>
          </div>
        </header>

        <SectionTabs items={[...PROJECT_NAVIGATION_ITEMS_V1]} />

        <PageStateView
          state={context.state}
          title="当前工程上下文"
          emptyMessage="当前工程尚无业务修订"
          onRetry={context.retry}
        >
          {(current) => (
            <div className="pjwf-regions">
              <Card title="工程业务修订">
                {current.project === null ? (
                  <p className="pjwf-note">
                    尚未建立工程业务修订。可在下方按施工方法、地层条件与工序阶段逐项给出。
                  </p>
                ) : (
                  <dl className="pjwf-facts">
                    <dt>工程名称</dt>
                    <dd>{current.project.name}</dd>
                    <dt>生命周期</dt>
                    <dd>
                      <StatusTag tone="neutral">
                        {LIFECYCLE_LABEL[current.project.lifecycle] ?? current.project.lifecycle}
                      </StatusTag>
                    </dd>
                    <dt>施工方法</dt>
                    <dd>{current.project.applicabilityMetadata.constructionMethod}</dd>
                    <dt>地层条件</dt>
                    <dd>{current.project.applicabilityMetadata.stratumCondition}</dd>
                    <dt>工序阶段</dt>
                    <dd>{current.project.applicabilityMetadata.engineeringStage}</dd>
                    <dt>当前版本</dt>
                    <dd className="mono">
                      {current.project.projectRevisionRef.reference.entityId}@
                      {current.project.projectRevisionRef.reference.versionId}
                    </dd>
                  </dl>
                )}
              </Card>

              <Card title="追加工程业务修订">
                <div className="pjwf-form">
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-project-name">工程名称</label>
                    <input
                      id="pjwf-project-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-lifecycle">生命周期</label>
                    <select
                      id="pjwf-lifecycle"
                      value={lifecycle}
                      onChange={(event) => setLifecycle(event.target.value)}
                    >
                      {LIFECYCLE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {LIFECYCLE_LABEL[option]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-method">施工方法</label>
                    <input
                      id="pjwf-method"
                      value={constructionMethod}
                      onChange={(event) => setConstructionMethod(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-stratum">地层条件</label>
                    <input
                      id="pjwf-stratum"
                      value={stratumCondition}
                      onChange={(event) => setStratumCondition(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-stage">工序阶段</label>
                    <input
                      id="pjwf-stage"
                      value={engineeringStage}
                      onChange={(event) => setEngineeringStage(event.target.value)}
                    />
                  </div>
                </div>
                <p className="pjwf-note">新版本用于后续业务，历史引用保留；缺失维度不补默认值。</p>
                <ConfirmButton
                  label="确认追加工程业务修订"
                  tone="primary"
                  availability={{
                    kind:
                      name.trim() !== "" &&
                      constructionMethod.trim() !== "" &&
                      stratumCondition.trim() !== "" &&
                      engineeringStage.trim() !== ""
                        ? "allowed"
                        : "unavailable",
                    reason: "context-incomplete",
                  }}
                  requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
                  scope={scope}
                  intentRevision={JSON.stringify([
                    name,
                    lifecycle,
                    constructionMethod,
                    stratumCondition,
                    engineeringStage,
                  ])}
                  createPlan={projectPlan}
                  submit={async (frozen) => {
                    await sendEngineeringWorkspaceRevision(frozen.request);
                    return { kind: "command-result", result: { kind: "engineering-workspace" } };
                  }}
                  onSucceeded={() => context.retry()}
                />
              </Card>

              <Card title="空间区段业务修订">
                <div className="pjwf-form">
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-scope">空间范围</label>
                    <select
                      id="pjwf-scope"
                      value={scopeId}
                      onChange={(event) => {
                        setScopeId(event.target.value);
                        setSelectedScope(event.target.value);
                      }}
                    >
                      {scopes.state.kind === "ready" &&
                        scopes.state.value.map((item) => (
                          <option key={item.scopeRef.entityId} value={item.scopeRef.entityId}>
                            {item.scopeRef.entityId}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-scope-name">区段名称</label>
                    <input
                      id="pjwf-scope-name"
                      value={scopeName}
                      onChange={(event) => setScopeName(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-worksite">工点位置</label>
                    <input
                      id="pjwf-worksite"
                      value={worksiteLocation}
                      onChange={(event) => setWorksiteLocation(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-chainage-start">起始里程</label>
                    <input
                      id="pjwf-chainage-start"
                      value={chainageStart}
                      onChange={(event) => setChainageStart(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-chainage-end">终止里程</label>
                    <input
                      id="pjwf-chainage-end"
                      value={chainageEnd}
                      onChange={(event) => setChainageEnd(event.target.value)}
                    />
                  </div>
                  <div className="pjwf-field">
                    <label htmlFor="pjwf-spatial-status">区段状态</label>
                    <select
                      id="pjwf-spatial-status"
                      value={spatialStatus}
                      onChange={(event) => setSpatialStatus(event.target.value)}
                    >
                      <option value="active">进行中</option>
                      <option value="inactive">已停用</option>
                    </select>
                  </div>
                </div>
                {spatial.state.kind === "ready" && spatial.state.value.spatial !== null && (
                  <p className="pjwf-note">
                    当前区段业务版本：
                    <span className="mono">
                      {spatial.state.value.spatial.spatialScopeRef.reference.entityId}@
                      {spatial.state.value.spatial.spatialScopeRef.reference.versionId}
                    </span>
                  </p>
                )}
                <ConfirmButton
                  label="确认追加空间区段修订"
                  tone="primary"
                  availability={{
                    kind:
                      scopeId !== "" && scopeName.trim() !== "" && worksiteLocation.trim() !== ""
                        ? "allowed"
                        : "unavailable",
                    reason: "context-incomplete",
                  }}
                  requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
                  scope={scope}
                  intentRevision={JSON.stringify([
                    scopeId,
                    scopeName,
                    worksiteLocation,
                    chainageStart,
                    chainageEnd,
                    spatialStatus,
                  ])}
                  createPlan={spatialPlan}
                  submit={async (frozen) => {
                    await sendEngineeringWorkspaceRevision(frozen.request);
                    return { kind: "command-result", result: { kind: "engineering-workspace" } };
                  }}
                  onSucceeded={() => {
                    context.retry();
                    spatial.retry();
                  }}
                />
              </Card>
            </div>
          )}
        </PageStateView>
      </div>
    </AppShell>
  );
}
