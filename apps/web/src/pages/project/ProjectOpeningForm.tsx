import { useState } from "react";

/**
 * 工程开通表单（design D-04）。
 *
 * 系统管理页与工程开通页共用同一实现：工程标识在新建时生成一次并作为可复制值，
 * 初始工程风险负责人从既有系统账号目录选择，不要求用户手输既有账号引用。
 * 开通只写入访问与成员事实；业务修订、资料授权与评估配置仍由各自所有者登记。
 */

export interface ProjectOpeningAccountOptionV1 {
  readonly accountRef: { readonly entityId: string; readonly versionId: string };
  readonly displayName: string;
  readonly status: string;
}

export interface ProjectOpeningInputV1 {
  readonly projectId: string;
  readonly initialRiskManagerAccountId: string;
}

export interface ProjectOpeningFormPropsV1 {
  readonly accounts: readonly ProjectOpeningAccountOptionV1[];
  readonly disabled?: boolean;
  readonly disabledHint?: string | undefined;
  readonly onSubmit: (input: ProjectOpeningInputV1) => void;
}

/** 新身份生成一次即可：工程标识由服务端按同一标识建档，不接受手输既有工程。 */
const newProjectId = (): string => {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `project-${random}`;
};

export function ProjectOpeningForm({
  accounts,
  disabled = false,
  disabledHint,
  onSubmit,
}: ProjectOpeningFormPropsV1) {
  const [projectId, setProjectId] = useState(newProjectId);
  const [initialRiskManagerAccountId, setInitialRiskManagerAccountId] = useState("");
  const active = accounts.filter((account) => account.status === "active");
  const incomplete = projectId.trim() === "" || initialRiskManagerAccountId === "";
  return (
    <div className="pjwf-form">
      <div className="pjwf-field">
        <label htmlFor="pjwf-project-id">工程标识</label>
        <input
          id="pjwf-project-id"
          className="mono"
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          readOnly={false}
        />
        <p className="pjwf-note">新建时生成一次，可复制后用于其它配置。</p>
      </div>
      <div className="pjwf-field">
        <label htmlFor="pjwf-initial-manager">初始工程风险负责人</label>
        <select
          id="pjwf-initial-manager"
          value={initialRiskManagerAccountId}
          onChange={(event) => setInitialRiskManagerAccountId(event.target.value)}
        >
          <option value="">请选择系统账号</option>
          {active.map((account) => (
            <option key={account.accountRef.entityId} value={account.accountRef.entityId}>
              {account.displayName}（{account.accountRef.entityId}）
            </option>
          ))}
        </select>
        {active.length === 0 && (
          <p className="pjwf-note">当前没有可用系统账号；先在系统管理中创建账号。</p>
        )}
      </div>
      <button
        type="button"
        className="pjwf-primary"
        disabled={disabled || incomplete}
        title={disabled ? disabledHint : undefined}
        onClick={() =>
          onSubmit({
            projectId: projectId.trim(),
            initialRiskManagerAccountId,
          })
        }
      >
        开通工程
      </button>
    </div>
  );
}
