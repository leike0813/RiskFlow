import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

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
  type KindRefView,
  type PreparedEngineeringWorkspaceRevisionV1,
  type ProjectBusinessRevisionView,
  type WorkspaceSpatialScopeView,
} from "../../api/engineeringWorkspace";
import { clientError } from "../../api/client";
import type {
  CommandConfirmationPlanV1,
  CommandConfirmationScopeV1,
} from "../../shared/confirmation";
import {
  WorkspacePageMore,
  useWorkspaceDirectory,
  type WorkspaceDirectoryV1,
} from "./ProjectMembershipForm";
import { PROJECT_NAVIGATION_ITEMS_V1 } from "./projectNavigation";
import "./ProjectWorkspace.css";

/**
 * 工程上下文维护页（design D-02、D-03）。
 *
 * 读取当前工程业务修订与空间区段业务修订；URL 的 `revision`（工程精确修订）以及
 * `scope`/`scopeVersion`（空间精确修订）直接决定读取目标，历史模式只读，绝不回退当前。
 * 写入只追加原领域修订：预期版本取自所属读面，读取未成功或历史模式不构造命令。
 */
const LIFECYCLE_OPTIONS = ["preparing", "active", "ended", "archived"] as const;
const LIFECYCLE_LABEL: Record<string, string> = {
  preparing: "准备中",
  active: "进行中",
  ended: "已结束",
  archived: "已归档",
};
const SPATIAL_STATUS_LABEL: Record<string, string> = {
  active: "进行中",
  inactive: "已停用",
};

const toLocalInput = (iso: string | undefined): string => {
  if (iso === undefined) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
};

/** 本地时间输入转 ISO；空串表示未填，非法值返回 null 以便给出字段错误。 */
const toIso = (local: string): string | undefined | null => {
  const trimmed = local.trim();
  if (trimmed === "") return undefined;
  const time = Date.parse(trimmed);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
};

const scopeRef = (entityId: string, versionId: string): KindRefView => ({
  kind: "spatial-scope",
  reference: { entityId, versionId },
});

/** 单个 URL 参数：重复或空值视为不可定位，不猜测其中一项。 */
const singleParam = (
  params: URLSearchParams,
  name: string,
): { readonly value: string | null; readonly invalid: boolean } => {
  const values = params.getAll(name).map((value) => value.trim());
  if (values.length > 1 || values.some((value) => value === ""))
    return { value: null, invalid: true };
  return { value: values[0] ?? null, invalid: false };
};

export default function ProjectContextPage() {
  const { selector } = useEngineering();
  const projectId = selector.projectId;
  const [searchParams] = useSearchParams();
  const revision = singleParam(searchParams, "revision");
  const scope = singleParam(searchParams, "scope");
  const scopeVersion = singleParam(searchParams, "scopeVersion");

  // 选择器只在完整 `<工程>@<版本>` 属于当前工程时给出修订；解析不出的 URL 绝不回落当前。
  const revisionUnresolved =
    revision.invalid || (revision.value !== null && selector.revisionId === null);
  // scope/scopeVersion 是成套参数：只有 scopeVersion 没有 scope 时拒绝，不读当前。
  const spatialUnresolved =
    scope.invalid || scopeVersion.invalid || (scopeVersion.value !== null && scope.value === null);

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

        {revisionUnresolved ? (
          <Card title="工程上下文">
            <p className="pjwf-error" role="alert">
              无法定位地址中的工程修订；请检查 revision 是否为当前工程的完整
              「工程标识@版本」，本页不回退到当前修订。
            </p>
          </Card>
        ) : spatialUnresolved ? (
          <Card title="工程上下文">
            <p className="pjwf-error" role="alert">
              空间范围参数不完整：scope 与 scopeVersion 必须成套给出；本页不回落其它空间。
            </p>
          </Card>
        ) : (
          <ContextBody
            key={`${projectId ?? ""}:${selector.revisionId ?? ""}:${scope.value ?? ""}:${scopeVersion.value ?? ""}`}
            projectId={projectId ?? ""}
            revisionId={selector.revisionId}
            scopeId={scope.value}
            scopeVersionId={scopeVersion.value}
          />
        )}
      </div>
    </AppShell>
  );
}

function ContextBody({
  projectId,
  revisionId,
  scopeId,
  scopeVersionId,
}: {
  readonly projectId: string;
  readonly revisionId: string | null;
  readonly scopeId: string | null;
  readonly scopeVersionId: string | null;
}) {
  const confirmationScope = useProjectConfirmationScope();
  const historicalProject = revisionId !== null;

  const projectRead = usePageQuery<EngineeringWorkspaceContextView>(
    (id, signal) =>
      readEngineeringWorkspaceContext(
        id,
        revisionId === null
          ? {}
          : {
              projectRevisionRef: {
                kind: "project-revision",
                reference: { entityId: id, versionId: revisionId },
              },
            },
        signal,
      ),
    [projectId, revisionId],
  );
  const scopes = useWorkspaceDirectory<WorkspaceSpatialScopeView>(
    (id, signal, cursor) =>
      listWorkspaceSpatialScopes(id, signal, cursor === undefined ? {} : { cursor }),
    [projectId],
  );

  const [chosenScopeId, setChosenScopeId] = useState("");
  const firstScopeId =
    scopes.state.kind === "ready" ? (scopes.state.value[0]?.scopeRef.entityId ?? "") : "";
  const scopePinned = scopeId !== null;
  const effectiveScopeId = scopeId ?? (chosenScopeId !== "" ? chosenScopeId : firstScopeId);
  const historicalSpatial = scopeId !== null && scopeVersionId !== null;
  const currentProject =
    projectRead.state.kind === "ready" ? projectRead.state.value.project : null;
  const projectReadFailed =
    projectRead.state.kind === "error" || projectRead.state.kind === "forbidden";

  return (
    <PageStateView
      state={projectRead.state}
      title="工程上下文"
      emptyMessage="当前工程尚无业务修订"
      onRetry={projectRead.retry}
    >
      {(contextView) => (
        <div className="pjwf-regions">
          <Card
            title="工程业务修订"
            extra={historicalProject ? <StatusTag tone="neutral">历史版本 · 只读</StatusTag> : null}
          >
            {contextView.project === null ? (
              <p className="pjwf-note">
                尚未建立工程业务修订。可在下方按施工方法、地层条件与工序阶段逐项给出。
              </p>
            ) : (
              <ProjectRevisionFacts revision={contextView.project} />
            )}
          </Card>

          {historicalProject ? (
            <Card title="追加工程业务修订">
              <p className="pjwf-note">
                地址指定了历史工程修订，本页保持只读；当前修订请移除 revision 参数后打开。
              </p>
            </Card>
          ) : projectReadFailed ? (
            <Card title="追加工程业务修订">
              <p className="pjwf-note">当前工程业务修订读取失败；读取成功前不构造命令。</p>
            </Card>
          ) : (
            <ProjectRevisionForm
              projectId={projectId}
              current={contextView.project}
              confirmationScope={confirmationScope}
              onSucceeded={() => projectRead.retry()}
            />
          )}

          <SpatialSection
            projectId={projectId}
            scopeId={effectiveScopeId}
            scopeVersionId={historicalSpatial ? scopeVersionId : null}
            scopePinned={scopePinned}
            readOnly={historicalProject || historicalSpatial}
            projectCurrent={currentProject}
            scopes={scopes}
            confirmationScope={confirmationScope}
            onScopeChange={setChosenScopeId}
          />

          <WorkspacePageMore
            nextCursor={scopes.nextCursor}
            loading={scopes.loadingMore}
            error={scopes.moreError}
            label="加载更多空间范围"
            onLoad={scopes.loadMore}
          />
        </div>
      )}
    </PageStateView>
  );
}

function ProjectRevisionFacts({ revision }: { readonly revision: ProjectBusinessRevisionView }) {
  return (
    <dl className="pjwf-facts">
      <dt>工程名称</dt>
      <dd data-fact="工程名称">{revision.name}</dd>
      <dt>生命周期</dt>
      <dd>
        <StatusTag tone="neutral">
          {LIFECYCLE_LABEL[revision.lifecycle] ?? revision.lifecycle}
        </StatusTag>
      </dd>
      <dt>施工方法</dt>
      <dd>{revision.applicabilityMetadata.constructionMethod}</dd>
      <dt>地层条件</dt>
      <dd>{revision.applicabilityMetadata.stratumCondition}</dd>
      <dt>工序阶段</dt>
      <dd>{revision.applicabilityMetadata.engineeringStage}</dd>
      <dt>生效时间</dt>
      <dd>{revision.effectivePeriod.validFrom}</dd>
      <dt>失效时间</dt>
      <dd>{revision.effectivePeriod.validTo ?? "—"}</dd>
      <dt>登记时间</dt>
      <dd>{revision.recordedAt}</dd>
      <dt>业务版本</dt>
      <dd className="mono" data-fact="业务版本">
        {revision.projectRevisionRef.reference.entityId}@
        {revision.projectRevisionRef.reference.versionId}
      </dd>
    </dl>
  );
}

function ProjectRevisionForm({
  projectId,
  current,
  confirmationScope,
  onSucceeded,
}: {
  readonly projectId: string;
  readonly current: ProjectBusinessRevisionView | null;
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
  readonly onSucceeded: () => void;
}) {
  const [name, setName] = useState("");
  const [lifecycle, setLifecycle] = useState<string>("preparing");
  const [constructionMethod, setConstructionMethod] = useState("");
  const [stratumCondition, setStratumCondition] = useState("");
  const [engineeringStage, setEngineeringStage] = useState("");
  const [validFrom, setValidFrom] = useState(() => toLocalInput(new Date().toISOString()));
  const [validTo, setValidTo] = useState("");
  const [touched, setTouched] = useState(false);

  // 当前修订变化（含追加后的刷新）时以真实值重填，避免用空白输入覆盖既有事实。
  useEffect(() => {
    setName(current?.name ?? "");
    setLifecycle(current?.lifecycle ?? "preparing");
    setConstructionMethod(current?.applicabilityMetadata.constructionMethod ?? "");
    setStratumCondition(current?.applicabilityMetadata.stratumCondition ?? "");
    setEngineeringStage(current?.applicabilityMetadata.engineeringStage ?? "");
    setValidFrom(
      current === null
        ? toLocalInput(new Date().toISOString())
        : toLocalInput(current.effectivePeriod.validFrom),
    );
    setValidTo(toLocalInput(current?.effectivePeriod.validTo));
  }, [current]);

  const from = toIso(validFrom);
  const to = toIso(validTo);
  const issues: string[] = [];
  if (name.trim() === "") issues.push("请填写工程名称");
  if (constructionMethod.trim() === "") issues.push("请填写施工方法");
  if (stratumCondition.trim() === "") issues.push("请填写地层条件");
  if (engineeringStage.trim() === "") issues.push("请填写工序阶段");
  if (from === null) issues.push("生效时间格式不正确");
  if (from === undefined) issues.push("请填写生效时间");
  if (to === null) issues.push("失效时间格式不正确");
  if (typeof from === "string" && typeof to === "string" && Date.parse(to) <= Date.parse(from))
    issues.push("失效时间必须晚于生效时间");

  const plan = (): CommandConfirmationPlanV1<PreparedEngineeringWorkspaceRevisionV1> => {
    if (confirmationScope === undefined || confirmationScope.kind !== "project")
      throw clientError("CONTRACT_INVALID");
    if (issues.length > 0 || typeof from !== "string") throw clientError("CONTRACT_INVALID");
    const request = prepareEngineeringWorkspaceRevision(projectId, {
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
      effectivePeriod: { validFrom: from, ...(typeof to === "string" ? { validTo: to } : {}) },
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "engineering-workspace.revise",
      scope: confirmationScope,
      targets: [],
      inputVersions:
        current === null
          ? []
          : [
              {
                entityId: current.projectRevisionRef.reference.entityId,
                versionId: current.projectRevisionRef.reference.versionId,
              },
            ],
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

  return (
    <Card title="追加工程业务修订">
      <div className="pjwf-form" data-form="project-revision">
        <div className="pjwf-field">
          <label htmlFor="pjwf-project-name">工程名称</label>
          <input
            id="pjwf-project-name"
            value={name}
            aria-invalid={touched && name.trim() === ""}
            onChange={(event) => {
              setTouched(true);
              setName(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-lifecycle">生命周期</label>
          <select
            id="pjwf-lifecycle"
            value={lifecycle}
            onChange={(event) => {
              setTouched(true);
              setLifecycle(event.target.value);
            }}
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
            aria-invalid={touched && constructionMethod.trim() === ""}
            onChange={(event) => {
              setTouched(true);
              setConstructionMethod(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-stratum">地层条件</label>
          <input
            id="pjwf-stratum"
            value={stratumCondition}
            aria-invalid={touched && stratumCondition.trim() === ""}
            onChange={(event) => {
              setTouched(true);
              setStratumCondition(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-stage">工序阶段</label>
          <input
            id="pjwf-stage"
            value={engineeringStage}
            aria-invalid={touched && engineeringStage.trim() === ""}
            onChange={(event) => {
              setTouched(true);
              setEngineeringStage(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-valid-from">生效时间</label>
          <input
            id="pjwf-valid-from"
            type="datetime-local"
            value={validFrom}
            aria-invalid={touched && from === null}
            onChange={(event) => {
              setTouched(true);
              setValidFrom(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-valid-to">失效时间（可选）</label>
          <input
            id="pjwf-valid-to"
            type="datetime-local"
            value={validTo}
            aria-invalid={touched && to === null}
            onChange={(event) => {
              setTouched(true);
              setValidTo(event.target.value);
            }}
          />
        </div>
      </div>
      <p className="pjwf-note">新版本用于后续业务，历史引用保留；缺失维度不补默认值。</p>
      {touched && issues.length > 0 ? (
        <ul className="pjwf-error-summary" role="alert">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}
      <ConfirmButton
        label="确认追加工程业务修订"
        tone="primary"
        availability={
          issues.length === 0 && confirmationScope !== undefined
            ? { kind: "allowed" }
            : { kind: "unavailable", reason: "context-incomplete" }
        }
        requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
        scope={confirmationScope}
        intentRevision={JSON.stringify([
          projectId,
          current?.projectRevisionRef.reference.versionId ?? "none",
          name,
          lifecycle,
          constructionMethod,
          stratumCondition,
          engineeringStage,
          validFrom,
          validTo,
        ])}
        createPlan={plan}
        submit={async (frozen) => {
          await sendEngineeringWorkspaceRevision(frozen.request);
          return { kind: "command-result", result: { kind: "engineering-workspace" } };
        }}
        onSucceeded={onSucceeded}
      />
    </Card>
  );
}

function SpatialSection({
  projectId,
  scopeId,
  scopeVersionId,
  scopePinned,
  readOnly,
  projectCurrent,
  scopes,
  confirmationScope,
  onScopeChange,
}: {
  readonly projectId: string;
  readonly scopeId: string;
  readonly scopeVersionId: string | null;
  readonly scopePinned: boolean;
  readonly readOnly: boolean;
  readonly projectCurrent: ProjectBusinessRevisionView | null;
  readonly scopes: WorkspaceDirectoryV1<WorkspaceSpatialScopeView>;
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
  readonly onScopeChange: (scopeId: string) => void;
}) {
  return (
    <Card title="空间区段业务修订">
      {scopes.state.kind === "ready" ? null : (
        <PageStateView
          state={scopes.state}
          title="授权空间范围"
          emptyMessage="当前工程尚无授权空间"
          onRetry={scopes.retry}
        >
          {() => null}
        </PageStateView>
      )}
      {scopeId === "" ? (
        <p className="pjwf-note">当前工程尚无可选空间范围；空间业务修订必须从已授权空间选择。</p>
      ) : (
        <>
          <div className="pjwf-form">
            <div className="pjwf-field">
              <label htmlFor="pjwf-scope-select">空间范围</label>
              <select
                id="pjwf-scope-select"
                value={scopeId}
                disabled={scopePinned || scopes.state.kind !== "ready"}
                onChange={(event) => onScopeChange(event.target.value)}
              >
                {scopes.state.kind === "ready" &&
                  scopes.state.value.map((item) => (
                    <option key={item.scopeRef.entityId} value={item.scopeRef.entityId}>
                      {item.scopeRef.entityId}
                    </option>
                  ))}
                {(scopes.state.kind !== "ready" ||
                  !scopes.state.value.some((item) => item.scopeRef.entityId === scopeId)) && (
                  <option value={scopeId}>{scopeId}</option>
                )}
              </select>
            </div>
          </div>
          <SpatialRevision
            projectId={projectId}
            scopeId={scopeId}
            scopeVersionId={scopeVersionId}
            readOnly={readOnly}
            projectCurrent={projectCurrent}
            scopes={scopes}
            confirmationScope={confirmationScope}
          />
        </>
      )}
    </Card>
  );
}

function SpatialRevision({
  projectId,
  scopeId,
  scopeVersionId,
  readOnly,
  projectCurrent,
  scopes,
  confirmationScope,
}: {
  readonly projectId: string;
  readonly scopeId: string;
  readonly scopeVersionId: string | null;
  readonly readOnly: boolean;
  readonly projectCurrent: ProjectBusinessRevisionView | null;
  readonly scopes: WorkspaceDirectoryV1<WorkspaceSpatialScopeView>;
  readonly confirmationScope: CommandConfirmationScopeV1 | undefined;
}) {
  const spatialRead = usePageQuery<EngineeringWorkspaceContextView>(
    (id, signal) =>
      readEngineeringWorkspaceContext(
        id,
        scopeVersionId === null
          ? { scopeId }
          : { spatialScopeRef: scopeRef(scopeId, scopeVersionId) },
        signal,
      ),
    [projectId, scopeId, scopeVersionId],
  );
  const current = spatialRead.state.kind === "ready" ? spatialRead.state.value.spatial : null;

  const [name, setName] = useState("");
  const [worksiteLocation, setWorksiteLocation] = useState("");
  const [chainageStart, setChainageStart] = useState("");
  const [chainageEnd, setChainageEnd] = useState("");
  const [status, setStatus] = useState<string>("active");
  const [constructionMethod, setConstructionMethod] = useState("");
  const [stratumCondition, setStratumCondition] = useState("");
  const [engineeringStage, setEngineeringStage] = useState("");
  const [validFrom, setValidFrom] = useState(() => toLocalInput(new Date().toISOString()));
  const [validTo, setValidTo] = useState("");
  const [parentScopeId, setParentScopeId] = useState("");
  const [touched, setTouched] = useState(false);

  const [parentRef, setParentRef] = useState<KindRefView | null>(null);
  const [parentReading, setParentReading] = useState(false);
  const [parentError, setParentError] = useState<string | null>(null);

  // 当前业务修订变化（切换空间或追加成功）时以真实事实重填。
  useEffect(() => {
    const spatial = spatialRead.state.kind === "ready" ? spatialRead.state.value.spatial : null;
    setName(spatial?.name ?? "");
    setWorksiteLocation(spatial?.worksiteLocation ?? "");
    setChainageStart(spatial?.chainage === undefined ? "" : String(spatial.chainage.start));
    setChainageEnd(spatial?.chainage === undefined ? "" : String(spatial.chainage.end));
    setStatus(spatial?.status ?? "active");
    setConstructionMethod(spatial?.applicabilityOverrides.constructionMethod ?? "");
    setStratumCondition(spatial?.applicabilityOverrides.stratumCondition ?? "");
    setEngineeringStage(spatial?.applicabilityOverrides.engineeringStage ?? "");
    setValidFrom(
      spatial === null
        ? toLocalInput(new Date().toISOString())
        : toLocalInput(spatial.effectivePeriod.validFrom),
    );
    setValidTo(toLocalInput(spatial?.effectivePeriod.validTo));
    setParentScopeId(spatial?.parentScopeRef?.reference.entityId ?? "");
    setTouched(false);
  }, [spatialRead.state]);

  // 父范围必须是真实存在且当前有效的 C11 业务修订：选择后按精确身份读取，不复用授权版本。
  useEffect(() => {
    setParentRef(null);
    setParentError(null);
    if (parentScopeId === "") {
      setParentReading(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setParentReading(true);
    readEngineeringWorkspaceContext(projectId, { scopeId: parentScopeId }, controller.signal)
      .then(
        (view) => {
          if (!active) return;
          if (view.spatial === null) {
            setParentError("该空间尚无业务修订，不能作为父范围");
            return;
          }
          setParentRef(view.spatial.spatialScopeRef);
        },
        () => {
          if (active && !controller.signal.aborted) setParentError("父范围读取失败");
        },
      )
      .finally(() => {
        if (active) setParentReading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [projectId, parentScopeId]);

  const from = toIso(validFrom);
  const to = toIso(validTo);
  const start = chainageStart.trim() === "" ? undefined : Number(chainageStart);
  const end = chainageEnd.trim() === "" ? undefined : Number(chainageEnd);
  const issues: string[] = [];
  if (name.trim() === "") issues.push("请填写区段名称");
  if (worksiteLocation.trim() === "") issues.push("请填写工点位置");
  if ((start === undefined) !== (end === undefined)) issues.push("里程起止必须同时填写");
  if (start !== undefined && (!Number.isFinite(start) || !Number.isFinite(end ?? Number.NaN)))
    issues.push("里程必须是数字");
  else if (start !== undefined && end !== undefined && end <= start)
    issues.push("终止里程必须大于起始里程");
  if (from === null) issues.push("生效时间格式不正确");
  if (from === undefined) issues.push("请填写生效时间");
  if (to === null) issues.push("失效时间格式不正确");
  if (typeof from === "string" && typeof to === "string" && Date.parse(to) <= Date.parse(from))
    issues.push("失效时间必须晚于生效时间");
  if (parentScopeId !== "" && parentError !== null) issues.push(parentError);
  if (parentScopeId !== "" && parentRef === null && parentError === null)
    issues.push("父范围尚未读取完成");

  const ready =
    !readOnly &&
    spatialRead.state.kind === "ready" &&
    projectCurrent !== null &&
    parentReading === false;
  const canWrite =
    ready &&
    confirmationScope !== undefined &&
    confirmationScope.kind === "project" &&
    issues.length === 0;

  const plan = (): CommandConfirmationPlanV1<PreparedEngineeringWorkspaceRevisionV1> => {
    if (confirmationScope === undefined || confirmationScope.kind !== "project")
      throw clientError("CONTRACT_INVALID");
    if (!canWrite || projectCurrent === null || typeof from !== "string")
      throw clientError("CONTRACT_INVALID");
    const request = prepareEngineeringWorkspaceRevision(projectId, {
      kind: "spatial",
      spatialScopeRef: scopeRef(
        scopeId,
        current === null ? "1" : current.spatialScopeRef.reference.versionId,
      ),
      projectRevisionRef: {
        kind: "project-revision",
        reference: {
          entityId: projectCurrent.projectRevisionRef.reference.entityId,
          versionId: projectCurrent.projectRevisionRef.reference.versionId,
        },
      },
      expectedVersion:
        current === null
          ? "none"
          : {
              entityId: current.spatialScopeRef.reference.entityId,
              versionId: current.spatialScopeRef.reference.versionId,
            },
      ...(parentRef === null ? {} : { parentScopeRef: parentRef }),
      name: name.trim(),
      worksiteLocation: worksiteLocation.trim(),
      ...(start === undefined || end === undefined ? {} : { chainage: { start, end } }),
      applicabilityOverrides: {
        ...(constructionMethod.trim() === ""
          ? {}
          : { constructionMethod: constructionMethod.trim() }),
        ...(stratumCondition.trim() === "" ? {} : { stratumCondition: stratumCondition.trim() }),
        ...(engineeringStage.trim() === "" ? {} : { engineeringStage: engineeringStage.trim() }),
      },
      status,
      effectivePeriod: { validFrom: from, ...(typeof to === "string" ? { validTo: to } : {}) },
    });
    return {
      confirmationId: `confirm-${request.commandId}`,
      operationId: "engineering-workspace.revise",
      scope: confirmationScope,
      targets: [],
      inputVersions:
        current === null
          ? [
              {
                entityId: projectCurrent.projectRevisionRef.reference.entityId,
                versionId: projectCurrent.projectRevisionRef.reference.versionId,
              },
            ]
          : [
              {
                entityId: current.spatialScopeRef.reference.entityId,
                versionId: current.spatialScopeRef.reference.versionId,
              },
              {
                entityId: projectCurrent.projectRevisionRef.reference.entityId,
                versionId: projectCurrent.projectRevisionRef.reference.versionId,
              },
            ],
      expectedFacts: [
        `对象：空间区段业务修订 ${name.trim()}`,
        `所属空间：${scopeId}`,
        `区段状态：${SPATIAL_STATUS_LABEL[status] ?? status}`,
        "预计结果：新版本用于后续业务，历史引用保留",
      ],
      externalEffects: ["追加空间区段业务修订"],
      impact: "standard",
      commandId: request.commandId,
      idempotencyKey: request.idempotencyKey,
      request,
    };
  };

  const parentOptions =
    scopes.state.kind === "ready"
      ? scopes.state.value.filter((item) => item.scopeRef.entityId !== scopeId)
      : [];
  const parentOptionKnown = parentOptions.some((item) => item.scopeRef.entityId === parentScopeId);

  return (
    <div data-form="spatial-revision">
      <div className="pjwf-form">
        <div className="pjwf-field">
          <label htmlFor="pjwf-scope-name">区段名称</label>
          <input
            id="pjwf-scope-name"
            value={name}
            aria-invalid={touched && name.trim() === ""}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setName(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-worksite">工点位置</label>
          <input
            id="pjwf-worksite"
            value={worksiteLocation}
            aria-invalid={touched && worksiteLocation.trim() === ""}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setWorksiteLocation(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-chainage-start">起始里程</label>
          <input
            id="pjwf-chainage-start"
            value={chainageStart}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setChainageStart(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-chainage-end">终止里程</label>
          <input
            id="pjwf-chainage-end"
            value={chainageEnd}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setChainageEnd(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-status">区段状态</label>
          <select
            id="pjwf-spatial-status"
            value={status}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setStatus(event.target.value);
            }}
          >
            <option value="active">进行中</option>
            <option value="inactive">已停用</option>
          </select>
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-parent">父范围（可选）</label>
          <select
            id="pjwf-spatial-parent"
            value={parentScopeId}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setParentScopeId(event.target.value);
            }}
          >
            <option value="">不设父范围</option>
            {parentOptions.map((item) => (
              <option key={item.scopeRef.entityId} value={item.scopeRef.entityId}>
                {item.scopeRef.entityId}
              </option>
            ))}
            {parentScopeId !== "" && !parentOptionKnown ? (
              <option value={parentScopeId}>{parentScopeId}</option>
            ) : null}
          </select>
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-method">施工方法（覆盖）</label>
          <input
            id="pjwf-spatial-method"
            value={constructionMethod}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setConstructionMethod(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-stratum">地层条件（覆盖）</label>
          <input
            id="pjwf-spatial-stratum"
            value={stratumCondition}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setStratumCondition(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-stage">工序阶段（覆盖）</label>
          <input
            id="pjwf-spatial-stage"
            value={engineeringStage}
            disabled={readOnly}
            onChange={(event) => {
              setTouched(true);
              setEngineeringStage(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-valid-from">生效时间</label>
          <input
            id="pjwf-spatial-valid-from"
            type="datetime-local"
            value={validFrom}
            disabled={readOnly}
            aria-invalid={touched && from === null}
            onChange={(event) => {
              setTouched(true);
              setValidFrom(event.target.value);
            }}
          />
        </div>
        <div className="pjwf-field">
          <label htmlFor="pjwf-spatial-valid-to">失效时间（可选）</label>
          <input
            id="pjwf-spatial-valid-to"
            type="datetime-local"
            value={validTo}
            disabled={readOnly}
            aria-invalid={touched && to === null}
            onChange={(event) => {
              setTouched(true);
              setValidTo(event.target.value);
            }}
          />
        </div>
      </div>

      {spatialRead.state.kind === "ready" ? (
        current === null ? (
          <p className="pjwf-note">该空间尚未建立业务修订；读取成功且无修订时按首修订追加。</p>
        ) : (
          <dl className="pjwf-facts">
            <dt>当前区段业务版本</dt>
            <dd className="mono" data-fact="当前区段业务版本">
              {current.spatialScopeRef.reference.entityId}@
              {current.spatialScopeRef.reference.versionId}
            </dd>
            <dt>登记时间</dt>
            <dd>{current.recordedAt}</dd>
            {current.parentScopeRef === undefined ? null : (
              <>
                <dt>业务父范围</dt>
                <dd className="mono">
                  {current.parentScopeRef.reference.entityId}@
                  {current.parentScopeRef.reference.versionId}
                </dd>
              </>
            )}
          </dl>
        )
      ) : (
        <PageStateView
          state={spatialRead.state}
          title="空间区段业务修订"
          emptyMessage="该空间尚无业务修订"
          onRetry={spatialRead.retry}
        >
          {() => null}
        </PageStateView>
      )}

      {parentError !== null ? (
        <p className="pjwf-error" role="alert">
          {parentError}
        </p>
      ) : null}

      {readOnly ? (
        <p className="pjwf-note">
          地址指定了历史工程或空间修订，本节保持只读；当前修订请移除对应版本参数后打开。
        </p>
      ) : (
        <>
          {touched && issues.length > 0 ? (
            <ul className="pjwf-error-summary" role="alert">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          ) : null}
          <ConfirmButton
            label="确认追加空间区段修订"
            tone="primary"
            availability={
              canWrite
                ? { kind: "allowed" }
                : {
                    kind: "unavailable",
                    reason: "context-incomplete",
                  }
            }
            requiredPermission={{ kind: "business", capability: "engineering-data.write" }}
            scope={confirmationScope}
            intentRevision={JSON.stringify([
              scopeId,
              scopeVersionId,
              current?.spatialScopeRef.reference.versionId ?? "none",
              projectCurrent?.projectRevisionRef.reference.versionId ?? "none",
              name,
              worksiteLocation,
              chainageStart,
              chainageEnd,
              status,
              constructionMethod,
              stratumCondition,
              engineeringStage,
              validFrom,
              validTo,
              parentScopeId,
              parentRef?.reference.versionId ?? "",
            ])}
            createPlan={plan}
            submit={async (frozen) => {
              await sendEngineeringWorkspaceRevision(frozen.request);
              return { kind: "command-result", result: { kind: "engineering-workspace" } };
            }}
            onSucceeded={() => spatialRead.retry()}
          />
        </>
      )}
    </div>
  );
}
