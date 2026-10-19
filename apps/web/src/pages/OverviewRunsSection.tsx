/**
 * 总览的历史运行承载（design D-10）。
 *
 * 识别运行与评估/处置链运行两组各自查询、各自游标续页，保留原精确引用与 C31 投影口径；
 * 两组互不阻塞，也不以仪表盘摘要成功为前提。
 */
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ProjectRevisionRefV1Schema, type ProjectRevisionRefV1 } from "@riskflow/contracts/ports";

import { Card } from "../components/Card";
import { DataTable, type DataTableColumn } from "../components/DataTable";
import { PageStateView } from "../components/PageStateView";
import { StatusTag } from "../components/StatusTag";
import { useEngineering, usePageQuery, useProjectPath } from "../api/engineering";
import {
  listIdentificationRuns,
  readRiskOverviewRunPage,
  type IdentificationRunListItemView,
  type IdentificationRunListPageView,
  type QueryResultRefView,
  type RiskOverviewRunPageView,
  type RunSummaryItemView,
} from "../api/operations";
import { NextPageButton, VersionRefText, tableRow } from "./assessmentResponseShared";
import { RunStatusTag, STAGE_LABEL } from "./identificationShared";

/** 识别运行表：行可跳识别运行详情；触发原因仅在服务端返回登记事实时呈现。 */
function IdentificationRunsSection() {
  const projectPath = useProjectPath();
  const { selector } = useEngineering();
  const [paged, setPaged] = useState<{ readonly key: string; readonly cursor?: string }>();
  const key = `${selector.projectId ?? ""}|${selector.revisionId ?? ""}`;
  const cursor = paged?.key === key ? paged.cursor : undefined;

  const { state, retry } = usePageQuery<IdentificationRunListPageView>(
    (projectId, signal) =>
      listIdentificationRuns(projectId, cursor === undefined ? {} : { cursor }, signal),
    [cursor],
  );

  const columns: DataTableColumn[] = [
    {
      key: "runRef",
      title: "运行标识",
      width: 210,
      render: (row) => {
        const item = tableRow<IdentificationRunListItemView>(row);
        return (
          <Link
            to={projectPath(
              `/identification/runs/${encodeURIComponent(item.runRef.reference.entityId)}`,
            )}
            className="mono"
          >
            {item.runRef.reference.entityId}
          </Link>
        );
      },
    },
    {
      key: "type",
      title: "类型",
      width: 80,
      render: () => <StatusTag tone="neutral">识别</StatusTag>,
    },
    {
      key: "status",
      title: "状态",
      width: 110,
      render: (row) => (
        <RunStatusTag status={tableRow<IdentificationRunListItemView>(row).status} />
      ),
    },
    {
      key: "stage",
      title: "阶段",
      width: 190,
      render: (row) => {
        const { stage } = tableRow<IdentificationRunListItemView>(row);
        const label = STAGE_LABEL[stage];
        return (
          <span>
            <span className="mono">{stage}</span>
            {label !== undefined && <span className="rr-dim"> · {label}</span>}
          </span>
        );
      },
    },
    { key: "startedBy", title: "启动者", width: 130 },
    {
      key: "startedAt",
      title: "启动时间",
      width: 200,
      render: (row) => (
        <span className="mono">{tableRow<IdentificationRunListItemView>(row).startedAt}</span>
      ),
    },
    {
      key: "triggerReason",
      title: "触发原因",
      render: (row) => {
        const { triggerReason } = tableRow<IdentificationRunListItemView>(row);
        return triggerReason === undefined ? (
          <span className="rr-dim">—</span>
        ) : (
          <span>{triggerReason}</span>
        );
      },
    },
  ];

  return (
    <PageStateView
      state={state}
      title="识别运行"
      emptyMessage="当前工程暂无识别运行"
      forbiddenHint="当前角色不具备识别运行的读取权限"
      onRetry={retry}
    >
      {(page) => (
        <Card
          title="识别运行"
          extra={<span>来源：risk-identification.run-list · 行点击进入详情</span>}
        >
          {page.items.length === 0 ? (
            <div className="rr-dim">当前工程暂无识别运行</div>
          ) : (
            <DataTable columns={columns} rows={page.items.map((item) => ({ ...item }))} />
          )}
          <NextPageButton
            nextCursor={page.nextCursor}
            label="继续读取识别运行"
            onContinue={(next) => setPaged({ key, cursor: next })}
          />
        </Card>
      )}
    </PageStateView>
  );
}

type ChainRunsResult =
  | { readonly kind: "no-revision" }
  | { readonly kind: "page"; readonly page: RiskOverviewRunPageView };

export type RunRevisionChoiceV1 =
  | { readonly kind: "current" }
  | { readonly kind: "revision"; readonly ref: ProjectRevisionRefV1 }
  | { readonly kind: "unlocatable" };

/**
 * URL 历史修订优先：完整 `<projectId>@<versionId>` 必须与所选工程一致；裸
 * `<versionId>` 按既有 project-revision 实体等于工程标识的身份规则解释。
 * 空值、多段、矛盾或属于别的工程的值一律不可定位，不回落当前修订。
 * 完全未给修订时才由调用方消费已有工程上下文的当前修订。
 */
export const resolveRunRevisionV1 = (
  rawRevisions: readonly string[],
  projectId: string | null,
): RunRevisionChoiceV1 => {
  if (rawRevisions.length === 0) return { kind: "current" };
  if (projectId === null) return { kind: "unlocatable" };
  const unique = [...new Set(rawRevisions)];
  if (unique.length !== 1) return { kind: "unlocatable" };
  const parts = unique[0]!.split("@");
  let versionId: string;
  if (parts.length === 1) {
    versionId = parts[0]!;
  } else if (parts.length === 2) {
    if (parts[0] !== projectId) return { kind: "unlocatable" };
    versionId = parts[1]!;
  } else {
    return { kind: "unlocatable" };
  }
  if (versionId.trim() === "") return { kind: "unlocatable" };
  const parsed = ProjectRevisionRefV1Schema.safeParse({
    kind: "project-revision",
    reference: { entityId: projectId, versionId },
  });
  return parsed.success ? { kind: "revision", ref: parsed.data } : { kind: "unlocatable" };
};

type ChainBlockedV1 = "unlocatable" | "context-loading" | "context-error" | null;

/** 评估/处置链运行表：原 C31 投影 run-summary 条目；条目不含启动时间/操作者，不编造。 */
function ChainRunsSection({
  revision,
  blocked,
  onRetryContext,
}: {
  revision: ProjectRevisionRefV1 | null;
  blocked: ChainBlockedV1;
  onRetryContext: () => void;
}) {
  const revisionKey =
    revision === null ? null : `${revision.reference.entityId}@${revision.reference.versionId}`;
  // 投影查询身份与游标绑定精确修订：工程/修订一变即作废，不拿旧投影读新修订。
  const [paged, setPaged] = useState<{
    readonly key: string;
    readonly cursor?: string;
    readonly queryRef?: QueryResultRefView;
  }>();
  const bound =
    revisionKey !== null && paged?.key === revisionKey
      ? paged
      : revisionKey === null
        ? undefined
        : { key: revisionKey };

  const { state, retry } = usePageQuery<ChainRunsResult>(
    async (projectId, signal) => {
      if (revision === null) return { kind: "no-revision" };
      return {
        kind: "page",
        page: await readRiskOverviewRunPage(
          projectId,
          revision,
          {
            ...(bound?.queryRef === undefined ? {} : { queryResultRef: bound.queryRef }),
            ...(bound?.cursor === undefined ? {} : { cursor: bound.cursor }),
          },
          signal,
        ),
      };
    },
    [revisionKey, bound?.queryRef, bound?.cursor],
  );

  if (
    state.kind === "ready" &&
    state.value.kind === "page" &&
    bound?.queryRef === undefined &&
    revisionKey !== null
  ) {
    // 首页登记查询身份后固定该投影，续页与原页共用同一 queryResultRef。
    setPaged({
      key: revisionKey,
      ...(bound?.cursor === undefined ? {} : { cursor: bound.cursor }),
      queryRef: state.value.page.queryResultRef,
    });
  }

  if (blocked === "unlocatable") {
    return (
      <Card title="评估与处置链运行">
        <div className="rr-dim">
          地址中的工程修订无法定位到当前工程，请检查链接中的 revision 参数。
        </div>
      </Card>
    );
  }
  if (blocked === "context-loading") {
    return (
      <Card title="评估与处置链运行">
        <div className="rr-dim">工程修订读取中…</div>
      </Card>
    );
  }
  if (blocked === "context-error") {
    return (
      <Card title="评估与处置链运行">
        <div className="rr-dim">
          工程修订当前不可用，链运行摘要暂不能定位。
          <button type="button" className="ar-chip" onClick={onRetryContext}>
            重试
          </button>
        </div>
      </Card>
    );
  }

  const columns: DataTableColumn[] = [
    {
      key: "workflowRunRef",
      title: "运行标识",
      width: 210,
      render: (row) => (
        <span className="mono">
          {tableRow<RunSummaryItemView>(row).workflowRunRef.reference.entityId}
        </span>
      ),
    },
    {
      key: "type",
      title: "类型",
      width: 80,
      render: () => <StatusTag tone="neutral">链运行</StatusTag>,
    },
    {
      key: "status",
      title: "状态",
      width: 110,
      render: (row) => <RunStatusTag status={tableRow<RunSummaryItemView>(row).status} />,
    },
    {
      key: "entryIdentity",
      title: "入口身份",
      render: (row) => (
        // 入口身份是精确版本引用：实体与版本都呈现，迁移不得丢掉版本维度。
        <VersionRefText reference={tableRow<RunSummaryItemView>(row).entryIdentity} />
      ),
    },
    {
      key: "parentRunRef",
      title: "父运行",
      width: 210,
      render: (row) => {
        const { parentRunRef } = tableRow<RunSummaryItemView>(row);
        return parentRunRef === undefined ? (
          <span className="rr-dim">—</span>
        ) : (
          <span className="mono">{parentRunRef.reference.entityId}</span>
        );
      },
    },
  ];

  return (
    <PageStateView
      state={state}
      title="评估与处置链运行"
      emptyMessage="当前工程修订暂无链运行投影"
      forbiddenHint="暂无可证明的链运行摘要，或当前角色不具备投影读取权限"
      onRetry={retry}
    >
      {(result) => (
        <Card title="评估与处置链运行" extra={<span>来源：risk-overview 投影 · 只读</span>}>
          {result.kind === "no-revision" ? (
            <div className="rr-dim">工程修订尚未就绪，链运行摘要暂不可用</div>
          ) : result.page.items.length === 0 ? (
            <div className="rr-dim">当前工程修订暂无链运行投影</div>
          ) : (
            <DataTable columns={columns} rows={result.page.items.map((item) => ({ ...item }))} />
          )}
          <NextPageButton
            nextCursor={result.kind === "page" ? result.page.nextCursor : undefined}
            onContinue={(next) => {
              if (revisionKey === null) return;
              setPaged({
                key: revisionKey,
                cursor: next,
                ...(bound?.queryRef === undefined ? {} : { queryRef: bound.queryRef }),
              });
            }}
          />
          {result.kind === "page" && (
            <p className="ar-note">
              投影结果引用：
              <VersionRefText reference={result.page.queryResultRef.reference} />
            </p>
          )}
        </Card>
      )}
    </PageStateView>
  );
}

/** 总览的运行承载：页签解析出的精确修订只作用于链运行；识别运行按自己的来源读权独立。 */
export function OverviewRunsSection() {
  const { selector, state: engineeringState, reload } = useEngineering();
  const [searchParams] = useSearchParams();
  const choice = resolveRunRevisionV1(searchParams.getAll("revision"), selector.projectId);
  // 上下文给出的当前修订是通用引用；按 project-revision Schema 复核后才可作为投影输入。
  const contextRevision =
    engineeringState.kind === "ready" &&
    engineeringState.value.currentProjectRevisionRef !== undefined
      ? ProjectRevisionRefV1Schema.safeParse(engineeringState.value.currentProjectRevisionRef)
      : undefined;
  const currentRevision = contextRevision?.success === true ? contextRevision.data : null;

  if (choice.kind === "revision") {
    return (
      <div className="ov-runs">
        <IdentificationRunsSection />
        <ChainRunsSection revision={choice.ref} blocked={null} onRetryContext={reload} />
      </div>
    );
  }

  const blocked: ChainBlockedV1 =
    choice.kind === "unlocatable"
      ? "unlocatable"
      : engineeringState.kind === "loading" ||
          engineeringState.kind === "idle" ||
          engineeringState.kind === "empty"
        ? "context-loading"
        : engineeringState.kind === "ready"
          ? null
          : "context-error";

  return (
    <div className="ov-runs">
      <IdentificationRunsSection />
      <ChainRunsSection revision={currentRevision} blocked={blocked} onRetryContext={reload} />
    </div>
  );
}
