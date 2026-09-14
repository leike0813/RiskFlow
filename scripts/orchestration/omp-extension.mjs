import {
  ControlError,
  canCompleteGoal,
  riskflowDispatch,
  riskflowIntegrate,
  riskflowSettle,
  riskflowStatus,
  riskflowWait,
} from "./control.mjs";

const CONTROLLED_TOOLS = new Set([
  "riskflow_dispatch",
  "riskflow_integrate",
  "riskflow_settle",
  "riskflow_status",
  "riskflow_wait",
]);

export function formatCurrentState(snapshot) {
  const next = snapshot.resumeQueue.slice(0, 5);
  return [
    "[RISKFLOW ORCHESTRATION STATE]",
    `revision: ${snapshot.revision}`,
    `frontier: ${next.length ? next.map((item) => `${item.workItemId}:${item.category}`).join(", ") : "empty"}`,
    ...next.map((item) => `${item.workItemId}: ${item.nextAction}`),
    "编排写操作必须使用 riskflow_* 工具；先读取状态并携带当前 revision。",
  ].join("\n");
}

export function shouldBlockDirectCommand(command) {
  if (typeof command !== "string") return false;
  return [
    /\borca(?:-ide)?\s+(?:orchestration\s+(?:task-create|task-update|dispatch|worker-start)|worktree\s+(?:create|rm))\b/,
    /\bgit\s+(?:merge|commit|rebase|cherry-pick)\b/,
    /\bopenspec\s+archive\b/,
    /\bnode\s+scripts\/orchestration\/control\.mjs\s+(?:dispatch|settle|integrate|reconcile)\b/,
  ].some((pattern) => pattern.test(command));
}

function result(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    details: value,
  };
}

function failure(error) {
  const value = {
    ok: false,
    code: error instanceof ControlError ? error.code : "orchestration_error",
    reason: error instanceof Error ? error.message : String(error),
    nextActions: error instanceof ControlError ? error.nextActions : [],
  };
  return { ...result(value), isError: true };
}

function register(pi, definition, run) {
  pi.registerTool({
    ...definition,
    loadMode: "essential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        return result(await run(params, { rootDir: ctx.cwd }));
      } catch (error) {
        return failure(error);
      }
    },
  });
}

export default function riskflowOrchestrationExtension(pi) {
  const z = pi.zod;
  const workItem = z.string().min(1).describe("Manifest node ID，例如 C26 或 AUX:change-name");
  const mutation = {
    workItemId: workItem,
    expectedRevision: z.string().min(1),
    idempotencyKey: z.string().min(1),
  };

  register(
    pi,
    {
      name: "riskflow_status",
      label: "RiskFlow Status",
      description: "读取由 Git、OpenSpec 与 Orca 实时生成的编排状态和恢复队列。",
      parameters: z.object({}),
      approval: "read",
    },
    (_params, options) => riskflowStatus(options),
  );
  register(
    pi,
    {
      name: "riskflow_dispatch",
      label: "RiskFlow Dispatch",
      description: "按当前阶段和固定模型策略创建或启动唯一合法的下一任务。",
      parameters: z.object(mutation),
      approval: "write",
    },
    riskflowDispatch,
  );
  register(
    pi,
    {
      name: "riskflow_wait",
      label: "RiskFlow Wait",
      description: "等待当前工作项的 worker_done、escalation 或 question，最长 60 秒。",
      parameters: z.object({
        workItemId: workItem,
        timeoutMs: z.number().int().min(1000).max(60000).optional(),
      }),
      approval: "read",
    },
    riskflowWait,
  );
  register(
    pi,
    {
      name: "riskflow_settle",
      label: "RiskFlow Settle",
      description: "以证据收口当前任务；普通收尾失败保持 Finalizer 责任。",
      parameters: z.object({
        ...mutation,
        outcome: z.enum(["succeeded", "failed", "blocked", "paused"]),
        evidenceRefs: z.array(z.string()).default([]),
        issueRefs: z.array(z.string()).default([]),
        riskTags: z.array(z.string()).default([]),
      }),
      approval: "write",
    },
    riskflowSettle,
  );
  register(
    pi,
    {
      name: "riskflow_integrate",
      label: "RiskFlow Integrate",
      description: "仅在最终产物和证据匹配时执行 merge、main 门禁、归档与回收。",
      parameters: z.object(mutation),
      approval: "exec",
    },
    riskflowIntegrate,
  );

  let cached;
  let cachedAt = 0;
  const current = async (cwd) => {
    if (!cached || Date.now() - cachedAt > 5_000) {
      cached = await riskflowStatus({ rootDir: cwd });
      cachedAt = Date.now();
    }
    return cached;
  };

  pi.on("context", async (event, ctx) => {
    try {
      return {
        messages: [
          ...event.messages,
          {
            role: "user",
            content: formatCurrentState(await current(ctx.cwd)),
            synthetic: true,
            timestamp: Date.now(),
          },
        ],
      };
    } catch (error) {
      pi.logger.warn("RiskFlow 状态注入失败", { error: String(error) });
      return undefined;
    }
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "goal" && event.input?.op === "complete") {
      try {
        const completion = canCompleteGoal(await current(ctx.cwd));
        if (!completion.allowed) {
          return {
            block: true,
            reason: `RiskFlow 目标尚未完成。${completion.nextActions
              .map((item) => `${item.workItemId}: ${item.nextAction}`)
              .join("；")}`,
          };
        }
      } catch (error) {
        return { block: true, reason: `无法验证 RiskFlow 完成条件：${String(error)}` };
      }
    }
    if (event.toolName === "bash" && shouldBlockDirectCommand(event.input?.command)) {
      return {
        block: true,
        reason: "该操作会绕过 RiskFlow 状态机；请使用对应的 riskflow_* 受控工具。",
      };
    }
    return undefined;
  });

  pi.on("tool_result", (event) => {
    if (CONTROLLED_TOOLS.has(event.toolName)) cachedAt = 0;
  });

  pi.on("session_stop", async (_event, ctx) => {
    try {
      const next = (await current(ctx.cwd)).resumeQueue[0];
      if (!next) return undefined;
      return {
        continue: true,
        additionalContext: `仍有合法下一步：${next.workItemId}: ${next.nextAction}。请继续推进或明确进入 paused/blocked。`,
      };
    } catch {
      return undefined;
    }
  });
}
