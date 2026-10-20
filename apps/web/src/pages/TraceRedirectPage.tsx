import { clientError } from "../api/client";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AppShell from "../components/AppShell";
import { PageStateView } from "../components/PageStateView";
import { usePageQuery, useProjectPath } from "../api/engineering";
import { readRiskRecord } from "../api/operations";

type TraceRedirectResult =
  { readonly kind: "list" } | { readonly kind: "record"; readonly versionId: string };

/**
 * 旧证据追溯地址的永久解析入口（design D-07）。
 *
 * `subject` 只表示风险记录 ID：给定版本保持该版本，无版本由所属读面按当前权限窄解析到
 * 唯一登记版本；解析成功后 replace 到规范风险记录详情的 `tab=trace`，不扫描目录首页，
 * 也不猜测任何其它对象。无主体只到同工程风险列表。
 */
export default function TraceRedirectPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const projectPath = useProjectPath();
  const subjects = searchParams.getAll("subject");
  const versions = searchParams.getAll("version");
  const subject = subjects.length === 1 ? (subjects[0] ?? "") : "";
  const version = versions.length === 1 ? versions[0] : undefined;

  const { state, retry } = usePageQuery<TraceRedirectResult>(
    async (projectId, signal) => {
      if (subjects.length === 0) return { kind: "list" };
      // 空值、重复主体与冲突版本都不能猜对象：与无权、错版同形拒绝。
      if (subjects.length > 1 || subject.trim().length === 0 || versions.length > 1) {
        throw clientError("NOT_FOUND");
      }
      const detail =
        version === undefined
          ? await readRiskRecord(projectId, { riskRecordId: subject }, signal)
          : await readRiskRecord(
              projectId,
              {
                riskRecordRef: {
                  kind: "standardized-risk-record",
                  reference: { entityId: subject, versionId: version },
                },
              },
              signal,
            );
      return { kind: "record", versionId: detail.riskRecordRef.reference.versionId };
    },
    [subjects.join(","), versions.join(",")],
  );

  useEffect(() => {
    if (state.kind !== "ready") return;
    if (state.value.kind === "list") {
      navigate(projectPath("/identification/records"), { replace: true });
      return;
    }
    navigate(
      projectPath(
        `/identification/records/${encodeURIComponent(subject)}?version=${encodeURIComponent(
          state.value.versionId,
        )}&tab=trace`,
      ),
      { replace: true },
    );
  }, [state, navigate, projectPath, subject]);

  return (
    <AppShell activeNav="review" agentContext={subject === "" ? [] : [subject]}>
      <div className="page">
        <header className="page-header">
          <div>
            <h1 className="page-title">证据追溯</h1>
            <p className="page-subtitle">旧追溯地址正在解析到规范风险记录详情</p>
          </div>
        </header>
        <PageStateView
          state={state.kind === "ready" ? { kind: "empty" } : state}
          title="证据追溯"
          emptyMessage="正在跳转到风险记录详情…"
          forbiddenHint="追溯主体不存在，或当前角色不具备该风险记录的读取权限"
          onRetry={retry}
        >
          {() => null}
        </PageStateView>
      </div>
    </AppShell>
  );
}
