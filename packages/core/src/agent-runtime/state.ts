import {
  AgentTaskRefV1Schema,
  AgentTaskResultRefV1Schema,
  AgentTaskStatusV1Schema,
  type AgentTaskResultRefV1,
  type AgentTaskStatusV1,
} from "@riskflow/contracts/ports";
import { IdentifierSchema, IsoDateTimeSchema } from "@riskflow/contracts/common";
import { z } from "zod";

import {
  AgentInternalStatusV1Schema,
  AgentStructuredErrorV1Schema,
  AgentTaskEnvelopeV1Schema,
  type AgentInternalStatusV1,
  type AgentStructuredErrorV1,
} from "./schema.js";

const positiveInteger = z.number().int().positive().refine(Number.isSafeInteger);

export const AgentTaskStateV1Schema = z
  .strictObject({
    schemaVersion: z.literal("1"),
    agentTaskRef: AgentTaskRefV1Schema,
    status: AgentInternalStatusV1Schema,
    taskVersion: positiveInteger,
    cancelRequested: z.boolean(),
    cancelReasonCode: IdentifierSchema.optional(),
    resultRef: AgentTaskResultRefV1Schema.optional(),
    error: AgentStructuredErrorV1Schema.optional(),
    currentProposalRef: z
      .strictObject({
        kind: z.literal("command-proposal"),
        reference: z.strictObject({ entityId: IdentifierSchema, versionId: IdentifierSchema }),
      })
      .optional(),
    latestCandidateVersion: z.number().int().nonnegative().refine(Number.isSafeInteger).optional(),
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((state, context) => {
    const terminal =
      state.status === "completed" ||
      state.status === "terminal-failure" ||
      state.status === "cancelled";
    if (terminal && state.status === "completed" && state.resultRef === undefined)
      context.addIssue({
        code: "custom",
        path: ["resultRef"],
        message: "completed state requires result",
      });
    if (terminal && state.status === "terminal-failure" && state.error === undefined)
      context.addIssue({
        code: "custom",
        path: ["error"],
        message: "terminal failure requires error",
      });
    if (state.status === "cancelled" && state.cancelRequested !== true)
      context.addIssue({
        code: "custom",
        path: ["cancelRequested"],
        message: "cancelled state requires cancellation",
      });
  });
export type AgentTaskStateV1 = z.infer<typeof AgentTaskStateV1Schema>;

export class AgentStateTransitionError extends Error {
  readonly code: "AGENT_STALE_VERSION" | "AGENT_INPUT_INVALID";

  constructor(code: "AGENT_STALE_VERSION" | "AGENT_INPUT_INVALID") {
    super(code);
    this.name = "AgentStateTransitionError";
    this.code = code;
  }
}

const STATUS_MAP: Readonly<Record<AgentInternalStatusV1, AgentTaskStatusV1>> = {
  pending: "pending",
  running: "running",
  "waiting-user-confirmation": "waiting",
  "retryable-failure": "failed",
  completed: "completed",
  "terminal-failure": "failed",
  cancelled: "cancelled",
};

export const mapAgentInternalStatus = (status: AgentInternalStatusV1): AgentTaskStatusV1 =>
  AgentTaskStatusV1Schema.parse(STATUS_MAP[status]);

const AGENT_INTERNAL_STATUS_V1_VALUES = AgentInternalStatusV1Schema.options;

/**
 * 公共状态是内部状态的收窄视图，`failed` 同时覆盖 `retryable-failure` 与 `terminal-failure`。
 * 目录按公共状态筛选时必须回落到这个全集，不能把其中一个内部状态当成该公共状态的同义词。
 */
export const agentInternalStatusesForPublicStatus = (
  status: AgentTaskStatusV1,
): readonly AgentInternalStatusV1[] => {
  const publicStatus = AgentTaskStatusV1Schema.parse(status);
  return AGENT_INTERNAL_STATUS_V1_VALUES.filter(
    (internal) => STATUS_MAP[internal] === publicStatus,
  );
};

const TRANSITIONS: Readonly<Record<AgentInternalStatusV1, readonly AgentInternalStatusV1[]>> = {
  pending: ["running", "cancelled"],
  running: [
    "waiting-user-confirmation",
    "retryable-failure",
    "completed",
    "terminal-failure",
    "cancelled",
  ],
  "waiting-user-confirmation": ["pending", "completed", "terminal-failure", "cancelled"],
  "retryable-failure": ["pending", "terminal-failure", "cancelled"],
  completed: [],
  "terminal-failure": [],
  cancelled: [],
};

export const canTransitionAgentTask = (
  from: AgentInternalStatusV1,
  to: AgentInternalStatusV1,
): boolean => TRANSITIONS[from].includes(to);

export const assertAgentTaskTransition = (
  from: AgentInternalStatusV1,
  to: AgentInternalStatusV1,
): void => {
  if (!canTransitionAgentTask(from, to)) throw new AgentStateTransitionError("AGENT_INPUT_INVALID");
};

export const createAgentTaskState = (input: {
  readonly envelope: unknown;
  readonly now: string;
}): AgentTaskStateV1 => {
  const envelope = AgentTaskEnvelopeV1Schema.parse(input.envelope);
  return AgentTaskStateV1Schema.parse({
    schemaVersion: "1",
    agentTaskRef: envelope.agentTaskRef,
    status: "pending",
    taskVersion: 1,
    cancelRequested: false,
    latestCandidateVersion: 0,
    updatedAt: input.now,
  });
};

export const transitionAgentTask = (
  state: AgentTaskStateV1,
  to: AgentInternalStatusV1,
  expectedTaskVersion: number,
  now: string,
  extra: {
    readonly resultRef?: AgentTaskResultRefV1;
    readonly error?: AgentStructuredErrorV1;
    readonly currentProposalRef?: AgentTaskStateV1["currentProposalRef"];
    readonly latestCandidateVersion?: number;
    readonly cancelReasonCode?: string;
  } = {},
): AgentTaskStateV1 => {
  const current = AgentTaskStateV1Schema.parse(state);
  if (current.taskVersion !== expectedTaskVersion)
    throw new AgentStateTransitionError("AGENT_STALE_VERSION");
  assertAgentTaskTransition(current.status, to);
  const next = {
    ...current,
    status: to,
    taskVersion: current.taskVersion + 1,
    updatedAt: IsoDateTimeSchema.parse(now),
    ...(extra.resultRef === undefined
      ? {}
      : { resultRef: AgentTaskResultRefV1Schema.parse(extra.resultRef) }),
    ...(extra.error === undefined
      ? {}
      : { error: AgentStructuredErrorV1Schema.parse(extra.error) }),
    ...(extra.currentProposalRef === undefined
      ? {}
      : { currentProposalRef: extra.currentProposalRef }),
    ...(extra.latestCandidateVersion === undefined
      ? {}
      : { latestCandidateVersion: extra.latestCandidateVersion }),
    ...(extra.cancelReasonCode === undefined ? {} : { cancelReasonCode: extra.cancelReasonCode }),
    ...(to === "cancelled" ? { cancelRequested: true } : {}),
  };
  return AgentTaskStateV1Schema.parse(next);
};

export const requestAgentTaskCancellation = (
  state: AgentTaskStateV1,
  expectedTaskVersion: number,
  reasonCode: string,
  now: string,
): AgentTaskStateV1 => {
  if (
    state.status === "completed" ||
    state.status === "terminal-failure" ||
    state.status === "cancelled"
  ) {
    if (state.taskVersion !== expectedTaskVersion)
      throw new AgentStateTransitionError("AGENT_STALE_VERSION");
    return state;
  }
  return transitionAgentTask(state, "cancelled", expectedTaskVersion, now, {
    cancelReasonCode: reasonCode,
  });
};

export const canResumeAgentTask = (status: AgentInternalStatusV1): boolean =>
  status === "pending" || status === "retryable-failure" || status === "waiting-user-confirmation";

export const publicAgentTaskStatus = (state: AgentTaskStateV1): AgentTaskStatusV1 =>
  mapAgentInternalStatus(state.status);
