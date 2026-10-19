import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEngineering } from "../api/engineering.js";
import { useSession } from "../api/session.js";

import type { WebActionAvailabilityV1, WebActionPermissionV1 } from "../shared/actions.js";
import {
  createConfirmationController,
  type CommandConfirmationPlanV1,
  type CommandConfirmationResultV1,
  type CommandConfirmationScopeV1,
  type ConfirmationStateV1,
} from "../shared/confirmation.js";
import { CommandConfirmationDialog } from "../shared/CommandConfirmationDialog.js";
import { Icon } from "./icons.js";
import "./ConfirmButton.css";

export type ConfirmButtonPropsV1<TRequest> = Readonly<{
  label: string;
  tone?: "primary" | "danger";
  availability: WebActionAvailabilityV1;
  /** 唯一权限描述：业务 capability 或系统管理动作，由调用方声明。 */
  requiredPermission: WebActionPermissionV1;
  /** 打开确认时构造一次完整计划；请求在此时已定型。 */
  createPlan: () => CommandConfirmationPlanV1<TRequest>;
  /** 提交只消费冻结计划，不再读取页面输入或重新生成命令身份。 */
  submit: (plan: CommandConfirmationPlanV1<TRequest>) => Promise<CommandConfirmationResultV1>;
  /** 当前作用域；pathname 与 intentRevision 变化由调用方更新。 */
  scope: CommandConfirmationScopeV1 | undefined;
  /** 调用方在输入变化时更新，使旧计划失效并要求重新确认。 */
  intentRevision: string;
  onSucceeded?: (result: CommandConfirmationResultV1) => void;
}>;

/**
 * CH-2 D-09：真实"触发按钮 + 现有控制器 + 唯一原生 Dialog"的组合组件。
 *
 * 它不持有第二套确认／提交／错误／焦点状态机：所有状态归 `createConfirmationController`，
 * 组件只负责桥接 React 刷新。scope、pathname 与 intentRevision 变化时旧计划失效；
 * 编辑输入必须重新构造计划并取得新命令身份。
 */
export function ConfirmButton<TRequest>({
  label,
  tone = "primary",
  availability,
  requiredPermission,
  createPlan,
  submit,
  scope,
  intentRevision,
  onSucceeded,
}: ConfirmButtonPropsV1<TRequest>) {
  const [controller] = useState(() => createConfirmationController<TRequest>());
  const [state, setState] = useState<ConfirmationStateV1<TRequest>>(() => controller.getState());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sync = useCallback(() => setState(controller.getState()), [controller]);

  // 作用域或调用方输入变化即失效：旧计划不能再提交，也不能再重试。
  useEffect(() => {
    controller.invalidate(scope);
    sync();
  }, [controller, scope, intentRevision, sync]);
  useEffect(() => () => controller.invalidate(undefined), [controller]);

  if (availability.kind === "hidden") return null;

  const open = (): void => {
    if (availability.kind !== "allowed") return;
    if (!controller.open(createPlan(), availability)) return;
    sync();
  };

  // 首次提交与重试共用同一条成功出口：业务事实只关心成功与否，不关心第几次送达。
  const finishSubmit = (ok: boolean): void => {
    sync();
    if (!ok) return;
    const next = controller.getState();
    if (next.kind === "succeeded") onSucceeded?.(next.result);
  };

  const confirm = async (): Promise<void> => {
    if (state.kind !== "reviewing") return;
    // 逐项推进：开始提交后立即同步，提交中重复点击由控制器单在途拒绝。
    void controller.confirm(async (plan) => submit(plan)).then(finishSubmit);
    sync();
  };

  const retry = async (): Promise<void> => {
    void controller.retry(async (plan) => submit(plan)).then(finishSubmit);
    sync();
  };

  const cancel = (): void => {
    controller.cancel();
    sync();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`confirm-btn confirm-btn--${tone}`}
        disabled={availability.kind !== "allowed"}
        aria-disabled={availability.kind === "allowed" ? undefined : true}
        onClick={open}
      >
        <Icon name="check" />
        {label}
      </button>
      <CommandConfirmationDialog
        state={state}
        availability={availability}
        requiredPermission={requiredPermission}
        openerRef={triggerRef}
        onAcknowledge={() => {
          controller.acknowledge();
          sync();
        }}
        onConfirm={() => confirm()}
        onRetry={() => retry()}
        onCancel={cancel}
      />
    </>
  );
}

/**
 * 当前确认作用域：工程命令取工程标识、上下文修订与会话引用。
 *
 * 未选工程、检查中、匿名或受限时返回 undefined——确认层据此不生成任何计划，
 * 而不是伪造一个空工程。系统管理用 `useSystemConfirmationScope`。
 */
export const useProjectConfirmationScope = (): CommandConfirmationScopeV1 | undefined => {
  const { context } = useEngineering();
  const session = useSession();
  const metadata = session.metadata;
  return useMemo(() => {
    if (context.projectId === null || metadata === null || session.state.kind !== "authenticated")
      return undefined;
    return Object.freeze({
      kind: "project" as const,
      projectId: context.projectId,
      contextRevision: context.revision,
      sessionRef: Object.freeze({ ...metadata.sessionRef }),
    });
  }, [context.projectId, context.revision, metadata, session.state.kind]);
};

/**
 * 系统管理确认作用域：只用真实账号与会话引用。
 *
 * 未选择工程不影响系统管理；反过来也绝不因为已选工程就获得资料或业务权限。
 */
export const useSystemConfirmationScope = (): CommandConfirmationScopeV1 | undefined => {
  const session = useSession();
  const metadata = session.metadata;
  return useMemo(() => {
    if (metadata === null || session.state.kind !== "authenticated") return undefined;
    return Object.freeze({
      kind: "system" as const,
      accountRef: Object.freeze({ ...metadata.accountRef }),
      sessionRef: Object.freeze({ ...metadata.sessionRef }),
    });
  }, [metadata, session.state.kind]);
};
