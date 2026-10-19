import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

import type { ContractReferenceV1 } from "@riskflow/contracts/ports";

import type { SafeHttpErrorV1 } from "../api/errors.js";
import { shouldCloseOnEscape, focusElement } from "./focus.js";
import {
  permissionLabel,
  type WebActionAvailabilityV1,
  type WebActionPermissionV1,
} from "./actions.js";
import type { CommandConfirmationPlanV1, ConfirmationStateV1 } from "./confirmation.js";
import { safeErrorFields } from "./page-shells/PageFrame.js";
import "./CommandConfirmationDialog.css";

export type CommandConfirmationDialogPropsV1<TRequest> = Readonly<{
  state: ConfirmationStateV1<TRequest>;
  availability?: WebActionAvailabilityV1;
  /** 唯一权限描述：业务 capability 或系统管理动作，两者不在界面混同。 */
  requiredPermission: WebActionPermissionV1;
  openerRef?: RefObject<HTMLElement | null>;
  onAcknowledge?: () => void;
  onConfirm?: (plan: CommandConfirmationPlanV1<TRequest>) => void | Promise<void>;
  onRetry?: (plan: CommandConfirmationPlanV1<TRequest>) => void | Promise<void>;
  onCancel: () => void;
}>;

const referenceLabel = (reference: ContractReferenceV1): string => {
  if ("reference" in reference)
    return `${reference.kind}:${reference.reference.entityId}@${reference.reference.versionId}`;
  return `${reference.kind}:${reference.eventId}`;
};

const SafeError = ({ error }: { error: SafeHttpErrorV1 }): ReactNode => (
  <p data-confirmation-state="error">{safeErrorFields(error)}</p>
);

export const CommandConfirmationDialog = <TRequest,>({
  state,
  availability,
  requiredPermission,
  openerRef,
  onAcknowledge,
  onConfirm,
  onRetry,
  onCancel,
}: CommandConfirmationDialogPropsV1<TRequest>): ReactNode => {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const open = state.kind !== "closed";
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open) {
      if (dialog?.open) dialog.close();
      focusElement(openerRef?.current ?? null);
      return;
    }
    if (dialog !== null && !dialog.open) {
      // 真实原生模态：showModal 失败必须暴露，不能降级成非模态而丢掉焦点约束。
      dialog.showModal();
    }
    cancelRef.current?.focus();
  }, [open, openerRef, state.kind]);
  if (!open) return null;
  const plan =
    state.kind === "reviewing" || state.kind === "submitting" || state.kind === "retryable-failure"
      ? state.plan
      : undefined;
  const submitting = state.kind === "submitting";
  const canConfirm =
    plan !== undefined &&
    !submitting &&
    (availability === undefined || availability.kind === "allowed") &&
    (plan.impact !== "high" || (state.kind === "reviewing" && state.acknowledged));
  const canRetry =
    plan !== undefined &&
    !submitting &&
    (availability === undefined || availability.kind === "allowed");
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>): void => {
    if (shouldCloseOnEscape(event.key, submitting)) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    );
    if (focusable.length < 1) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };
  return (
    <dialog
      ref={dialogRef}
      aria-modal="true"
      aria-labelledby="confirmation-title"
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        if (submitting) event.preventDefault();
        else onCancel();
      }}
    >
      <h2 id="confirmation-title">确认命令</h2>
      {plan === undefined ? null : (
        <div className="confirmation-summary">
          <dl>
            <div>
              <dt>作用域</dt>
              {/* 系统管理命令没有工程上下文，如实呈现而不伪造工程。 */}
              <dd>{plan.scope.kind === "project" ? plan.scope.projectId : "系统管理"}</dd>
            </div>
            <div>
              <dt>命令</dt>
              <dd>{plan.operationId}</dd>
            </div>
            <div>
              <dt>命令标识</dt>
              <dd>{plan.commandId}</dd>
            </div>
            <div>
              <dt>幂等键</dt>
              <dd>{plan.idempotencyKey}</dd>
            </div>
          </dl>
          <section aria-label="目标对象">
            <h3>目标对象</h3>
            <ul>
              {plan.targets.map((target) => (
                <li key={referenceLabel(target)}>{referenceLabel(target)}</li>
              ))}
            </ul>
          </section>
          <section aria-label="输入版本">
            <h3>精确输入版本</h3>
            <ul>
              {plan.inputVersions.map((version) => (
                <li key={`${version.entityId}:${version.versionId}`}>
                  {version.entityId}@{version.versionId}
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="预计事实">
            <h3>预计生成的事实</h3>
            <ul>
              {plan.expectedFacts.map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
          </section>
          <section aria-label="外部副作用">
            <h3>外部副作用</h3>
            <ul>
              {plan.externalEffects.map((effect) => (
                <li key={effect}>{effect}</li>
              ))}
            </ul>
          </section>
          <p>
            所需权限：<code>{permissionLabel(requiredPermission)}</code>
          </p>
          {plan.impact === "high" && state.kind === "reviewing" ? (
            <label>
              <input
                type="checkbox"
                checked={state.acknowledged}
                onChange={onAcknowledge}
                disabled={submitting}
              />
              我已确认高影响操作
            </label>
          ) : null}
        </div>
      )}
      {state.kind === "retryable-failure" ? <SafeError error={state.error} /> : null}
      {state.kind === "terminal-failure" ? <SafeError error={state.error} /> : null}
      {state.kind === "succeeded" ? <p data-confirmation-state="succeeded">命令已提交</p> : null}
      <div className="dialog-actions">
        <button ref={cancelRef} type="button" onClick={onCancel} disabled={submitting}>
          取消
        </button>
        {state.kind === "retryable-failure" && plan !== undefined ? (
          <button type="button" onClick={() => onRetry?.(plan)} disabled={!canRetry}>
            重试
          </button>
        ) : null}
        {plan !== undefined && state.kind !== "retryable-failure" ? (
          <button type="button" onClick={() => onConfirm?.(plan)} disabled={!canConfirm}>
            {submitting ? "提交中" : "确认提交"}
          </button>
        ) : null}
      </div>
    </dialog>
  );
};

export default CommandConfirmationDialog;
