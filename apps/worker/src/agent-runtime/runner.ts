import {
  AgentTaskDefinitionRegistry,
  AgentRuntimeError,
  AgentCandidateVersionV1Schema,
  AgentValidationResultV1Schema,
  buildCompletedAgentTaskResult,
  classifyValidationFailure,
  completeAgentStructured,
  emptyAgentBudgetUsage,
  makeAgentError,
  normalizeAgentActionUsage,
  type AgentBudgetUsageV1,
  type AgentCandidateVersionV1,
  type AgentDomainToolResultV1,
  type AgentTaskActionV1,
  type AgentTaskDefinitionV1,
  type AgentTaskSnapshotV1,
  type AgentStructuredErrorV1,
} from "@riskflow/core/agent-runtime";
import type { ArtifactStoreV1 } from "@riskflow/core/artifacts";
import type { ModelGatewayPortV1, StructuredCompletionResultV1 } from "@riskflow/core/model";
import { type ContractReferenceV1, type AgentTaskRefV1 } from "@riskflow/contracts/ports";
import {
  IsoDateTimeSchema,
  VersionReferenceSchema,
  type VersionReference,
} from "@riskflow/contracts/common";

import type {
  AgentTaskActionReservationV1,
  AgentTaskClaimV1,
  AgentTaskExecutionStoreV1,
} from "@riskflow/adapters/agent-runtime";

export interface AgentModelStepRequestV1 {
  readonly messages: import("@riskflow/core/model").StructuredCompletionRequestV1["messages"];
  readonly maxOutputTokens: number;
  readonly outputSchemaRef?: VersionReference;
  readonly reservationAmount?: Partial<AgentBudgetUsageV1>;
  readonly domainTool?: {
    readonly toolRef: VersionReference;
    readonly input: unknown;
  };
}

export interface AgentStepOutcomeV1 {
  readonly kind: "completed" | "waiting" | "failed" | "uncertain";
  readonly resultRef?: ContractReferenceV1;
  readonly resultArtifactRef?: import("@riskflow/core/artifacts").ArtifactRefV1;
  readonly candidate?: AgentCandidateVersionV1;
  readonly candidatePayload?: unknown;
  readonly increment?: unknown;
  readonly proposalRef?: ContractReferenceV1;
  readonly proposalArtifactRef?: import("@riskflow/core/artifacts").ArtifactRefV1;
  readonly usage?: AgentBudgetUsageV1;
  readonly error?: AgentStructuredErrorV1;
}

export interface AgentRuntimeRunnerOptionsV1 {
  readonly store: AgentTaskExecutionStoreV1;
  readonly registry: AgentTaskDefinitionRegistry;
  readonly workerId: string;
  readonly leaseDurationMs: number;
  readonly maxConcurrentTasks: number;
  readonly modelGateway?: ModelGatewayPortV1;
  readonly artifactStore?: ArtifactStoreV1;
  readonly now?: () => string;
  readonly renderModelStep?: (
    task: AgentTaskSnapshotV1,
    definition: AgentTaskDefinitionV1,
  ) => Promise<AgentModelStepRequestV1> | AgentModelStepRequestV1;
  readonly interpretModelStep?: (
    response: StructuredCompletionResultV1<unknown>,
    task: AgentTaskSnapshotV1,
    definition: AgentTaskDefinitionV1,
  ) => Promise<AgentStepOutcomeV1> | AgentStepOutcomeV1;
  readonly persistArtifact?: (input: {
    readonly task: AgentTaskSnapshotV1;
    readonly actionId: string;
    readonly purposeCode: string;
    readonly value: unknown;
    readonly signal: AbortSignal;
  }) => Promise<import("@riskflow/core/artifacts").ArtifactRefV1>;
}

const nowIso = (): string => new Date().toISOString();
const actionIdFor = (taskRef: AgentTaskRefV1, sequence: number): string =>
  `${taskRef.reference.entityId}:action:${sequence}`;
const actionKeyFor = (taskRef: AgentTaskRefV1, sequence: number): string =>
  `${taskRef.reference.entityId}:action-idempotency:${sequence}`;
const asError = (
  error: unknown,
  taskRef: AgentTaskRefV1,
  actionId: string,
): AgentStructuredErrorV1 => {
  if (error instanceof AgentRuntimeError) return error.details;
  if (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      (("name" in error && error.name === "AbortError") ||
        ("code" in error && error.code === "MODEL_ABORTED")))
  )
    return makeAgentError({
      code: "AGENT_CANCELLED",
      category: "cancelled",
      retryable: false,
      stage: "worker.abort",
      taskRef,
      actionId,
    });
  return makeAgentError({
    code: "AGENT_MODEL_FAILURE",
    category: "model",
    retryable: true,
    stage: "worker.step",
    taskRef,
    actionId,
  });
};
const usageFromModel = (response: StructuredCompletionResultV1<unknown>): AgentBudgetUsageV1 => ({
  ...emptyAgentBudgetUsage(),
  modelInvocations: 1,
  inputTokens: response.usage.inputTokens ?? 0,
  outputTokens: response.usage.outputTokens ?? 0,
});
const outcomeFromDomainTool = (
  result: AgentDomainToolResultV1,
  taskRef: AgentTaskRefV1,
  actionId: string,
): AgentStepOutcomeV1 => {
  const usage = normalizeAgentActionUsage("domain-tool", result.usage);
  if (result.effect === "uncertain")
    return {
      kind: "uncertain",
      ...(result.resultRef === undefined ? {} : { resultRef: result.resultRef }),
      resultArtifactRef: result.observationArtifactRef,
      usage,
      error: makeAgentError({
        code: "AGENT_ACTION_UNCERTAIN",
        category: "action",
        retryable: false,
        stage: "worker.tool.uncertain",
        taskRef,
        actionId,
      }),
    };
  if (result.effect === "committed" && result.resultRef !== undefined)
    return {
      kind: "completed",
      resultRef: result.resultRef,
      resultArtifactRef: result.observationArtifactRef,
      usage,
    };
  return {
    kind: "failed",
    resultArtifactRef: result.observationArtifactRef,
    usage,
    error: makeAgentError({
      code: "AGENT_TOOL_FAILURE",
      category: "tool",
      retryable: true,
      stage: "worker.tool.no-effect",
      taskRef,
      actionId,
    }),
  };
};
const oneChunk = (value: Uint8Array): AsyncIterable<Uint8Array> =>
  (async function* () {
    yield value;
  })();

interface LeaseMonitorV1 {
  stop(): Promise<void>;
  failure(): unknown;
}

const startLeaseMonitor = (input: {
  readonly store: AgentTaskExecutionStoreV1;
  readonly claim: AgentTaskClaimV1;
  readonly controller: AbortController;
  readonly leaseDurationMs: number;
  readonly intervalMs: number;
  readonly now: () => string;
}): LeaseMonitorV1 => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  let failure: unknown;
  const taskRef = input.claim.task.envelope.agentTaskRef;
  const tick = async (): Promise<void> => {
    if (stopped || input.controller.signal.aborted) return;
    try {
      if (input.store.getTask !== undefined) {
        const current = await input.store.getTask(taskRef);
        if (current === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_TASK_NOT_FOUND",
              category: "not-found",
              stage: "worker.lease.task",
              taskRef,
            }),
          );
        if (current.state.cancelRequested || current.state.status === "cancelled")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_CANCELLED",
              category: "cancelled",
              retryable: false,
              stage: "worker.lease.cancelled",
              taskRef,
            }),
          );
        if (current.state.status !== "running")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_STALE_VERSION",
              category: "concurrency",
              retryable: false,
              stage: "worker.lease.state",
              taskRef,
            }),
          );
      }
      await input.store.heartbeat({
        taskRef,
        workerId: input.claim.workerId,
        leaseToken: input.claim.leaseToken,
        leaseDurationMs: input.leaseDurationMs,
        now: input.now(),
      });
    } catch (error) {
      if (stopped || input.controller.signal.aborted) return;
      failure = error;
      input.controller.abort();
      return;
    }
    if (!stopped && !input.controller.signal.aborted)
      timer = setTimeout(() => {
        inFlight = tick();
      }, input.intervalMs);
  };
  timer = setTimeout(() => {
    inFlight = tick();
  }, input.intervalMs);
  return {
    async stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      if (inFlight !== undefined) await inFlight;
    },
    failure: () => failure,
  };
};

export class AgentRuntimeRunner {
  readonly #options: AgentRuntimeRunnerOptionsV1;
  readonly #now: () => string;

  constructor(options: AgentRuntimeRunnerOptionsV1) {
    if (!Number.isSafeInteger(options.maxConcurrentTasks) || options.maxConcurrentTasks < 1)
      throw new RangeError("maxConcurrentTasks must be positive");
    if (!Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1)
      throw new RangeError("leaseDurationMs must be positive");
    this.#options = options;
    this.#now = options.now ?? nowIso;
  }

  async runOnce(signal: AbortSignal = new AbortController().signal): Promise<number> {
    let processed = 0;
    for (let index = 0; index < this.#options.maxConcurrentTasks && !signal.aborted; index += 1) {
      const claim = await this.#options.store.claim({
        workerId: this.#options.workerId,
        leaseDurationMs: this.#options.leaseDurationMs,
        now: this.#now(),
      });
      if (claim === undefined) break;
      processed += 1;
      await this.#runClaim(claim, signal);
    }
    return processed;
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      if ((await this.runOnce(signal)) === 0) return;
    }
  }

  async #persistJson(
    task: AgentTaskSnapshotV1,
    actionId: string,
    purposeCode: string,
    value: unknown,
    signal: AbortSignal,
  ): Promise<import("@riskflow/core/artifacts").ArtifactRefV1> {
    if (this.#options.persistArtifact !== undefined)
      return this.#options.persistArtifact({ task, actionId, purposeCode, value, signal });
    const store = this.#options.artifactStore;
    if (store === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_ARTIFACT_FAILURE",
          category: "artifact",
          retryable: false,
          stage: "worker.artifact.store",
          taskRef: task.envelope.agentTaskRef,
          actionId,
        }),
      );
    const now = IsoDateTimeSchema.parse(this.#now());
    const body = new TextEncoder().encode(JSON.stringify(value));
    const requiredCapability = task.envelope.authorization.grantedCapabilities[0];
    if (requiredCapability === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_AUTHORIZATION_DENIED",
          category: "authorization",
          retryable: false,
          stage: "worker.artifact.authorization",
          taskRef: task.envelope.agentTaskRef,
          actionId,
        }),
      );
    const result = await store.put(
      {
        schemaVersion: "1",
        commandId: `${actionId}:${purposeCode}:put`,
        idempotencyKey: `${actionId}:${purposeCode}:put`,
        projectId: task.envelope.projectId,
        actorId: task.envelope.actorId,
        issuedAt: now,
        authorization: task.envelope.authorization,
        requiredCapability,
        artifactId: `${actionId}:${purposeCode}`,
        artifactKind: "diagnostic",
        purposeCode,
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      },
      oneChunk(body),
    );
    return result.artifactRef;
  }

  async #executeModel(
    task: AgentTaskSnapshotV1,
    definition: AgentTaskDefinitionV1,
    actionId: string,
    signal: AbortSignal,
    rendered?: AgentModelStepRequestV1,
  ): Promise<{
    readonly outcome: AgentStepOutcomeV1;
    readonly raw: StructuredCompletionResultV1<unknown>;
  }> {
    const gateway = this.#options.modelGateway;
    const render = this.#options.renderModelStep;
    const interpret = this.#options.interpretModelStep;
    if (gateway === undefined || render === undefined || interpret === undefined)
      throw new AgentRuntimeError(
        makeAgentError({
          code: "AGENT_INPUT_INVALID",
          category: "input",
          stage: "worker.model.configuration",
          taskRef: task.envelope.agentTaskRef,
        }),
      );
    const request = rendered ?? (await render(task, definition));
    const outputSchemaRef = VersionReferenceSchema.parse(
      request.outputSchemaRef ?? definition.metadata.incrementSchemaRef,
    );
    const inputArtifactRef = await this.#persistJson(
      task,
      actionId,
      "agent-model-input",
      {
        schemaVersion: "1",
        taskRef: task.envelope.agentTaskRef,
        actionId,
        messages: request.messages,
        outputSchemaRef,
        maxOutputTokens: request.maxOutputTokens,
      },
      signal,
    );
    const raw = await completeAgentStructured({
      gateway,
      task,
      actionId,
      parentArtifactRefs: [inputArtifactRef],
      promptTemplateRef: task.envelope.promptTemplateRef,
      outputSchemaRef,
      messages: request.messages,
      outputSchema: definition.actionSchema,
      maxOutputTokens: request.maxOutputTokens,
      remainingWallClockMs: task.budgetPolicy.maxWallClockMs - task.budgetLedger.activeWallClockMs,
      now: this.#now(),
      signal,
    });
    this.#options.registry.parseAction(task.envelope.taskType, raw.value);
    return { raw, outcome: await interpret(raw, task, definition) };
  }

  async #runClaim(claim: AgentTaskClaimV1, signal: AbortSignal): Promise<void> {
    const taskRef = claim.task.envelope.agentTaskRef;
    let sequence = (claim.task.state.latestCandidateVersion ?? 0) + 1;
    let actionId = actionIdFor(taskRef, sequence);
    let idempotencyKey = actionKeyFor(taskRef, sequence);
    let definition: AgentTaskDefinitionV1;
    let intentRecorded = false;
    const operationController = new AbortController();
    const abortOperation = () => operationController.abort();
    if (signal.aborted) operationController.abort();
    else signal.addEventListener("abort", abortOperation, { once: true });
    let leaseMonitor: LeaseMonitorV1 | undefined;
    let actionStartedAt: number | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let wallClockExceeded = false;
    const activeActionWallClockMs = () =>
      actionStartedAt === undefined ? 0 : Math.max(0, Date.now() - actionStartedAt);
    const throwLeaseFailure = () => {
      if (wallClockExceeded)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_WALL_CLOCK_EXCEEDED",
            category: "budget",
            retryable: false,
            stage: "worker.wall-clock",
            taskRef,
            actionId,
          }),
        );
      const failure = leaseMonitor?.failure();
      if (failure !== undefined) throw failure;
      if (operationController.signal.aborted && signal.aborted)
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_CANCELLED",
            category: "cancelled",
            retryable: false,
            stage: "worker.cancelled",
            taskRef,
            actionId,
          }),
        );
    };
    try {
      definition = this.#options.registry.get(taskRef.taskType);
      await this.#options.store.verifyWorker(claim.task, claim.task.envelope.commandId);
      if (operationController.signal.aborted || claim.task.state.cancelRequested) {
        await this.#options.store.releaseLease({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          status: claim.task.state.cancelRequested ? "cancelled" : "released",
          now: this.#now(),
        });
        return;
      }
      let completed = await this.#options.store.findAction(taskRef, actionId);
      while (completed?.status === "completed" && completed.resultRef === undefined) {
        sequence += 1;
        actionId = actionIdFor(taskRef, sequence);
        idempotencyKey = actionKeyFor(taskRef, sequence);
        completed = await this.#options.store.findAction(taskRef, actionId);
      }
      if (completed?.status === "completed") {
        if (completed.resultRef !== undefined) {
          const result = buildCompletedAgentTaskResult(
            taskRef,
            completed.resultRef,
            undefined,
            definition.metadata.resultFamilies,
          );
          await this.#options.store.completeTask({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            resultRef: result,
            now: this.#now(),
          });
        } else {
          await this.#options.store.releaseLease({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            status: "released",
            now: this.#now(),
          });
        }
        return;
      }
      leaseMonitor = startLeaseMonitor({
        store: this.#options.store,
        claim,
        controller: operationController,
        leaseDurationMs: this.#options.leaseDurationMs,
        intervalMs: Math.max(1, Math.floor(this.#options.leaseDurationMs / 3)),
        now: this.#now,
      });
      let rendered: AgentModelStepRequestV1 | undefined;
      let reservation: AgentTaskActionReservationV1;
      let outcome: AgentStepOutcomeV1;
      let modelRaw: StructuredCompletionResultV1<unknown> | undefined;
      let actionType: AgentTaskActionV1["actionType"];
      let typedToolInput: unknown;
      let toolRef: VersionReference | undefined;
      const startDeadline = (task: AgentTaskSnapshotV1): void => {
        const remaining = task.budgetPolicy.maxWallClockMs - task.budgetLedger.activeWallClockMs;
        if (!Number.isSafeInteger(remaining) || remaining <= 0)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_WALL_CLOCK_EXCEEDED",
              category: "budget",
              retryable: false,
              stage: "worker.wall-clock.reserve",
              taskRef,
              actionId,
            }),
          );
        deadlineTimer = setTimeout(() => {
          wallClockExceeded = true;
          operationController.abort();
        }, remaining);
      };
      if (completed?.status === "started") {
        actionType = completed.actionType;
        if (actionType !== "domain-tool")
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_ACTION_UNCERTAIN",
              category: "action",
              retryable: false,
              stage: "worker.recovery.started-model",
              taskRef,
              actionId,
            }),
          );
        const allowedToolRef = definition.metadata.allowedToolRefs[0];
        if (allowedToolRef === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_ACTION_UNCERTAIN",
              category: "action",
              retryable: false,
              stage: "worker.recovery.tool-not-registered",
              taskRef,
              actionId,
            }),
          );
        const tool = this.#options.registry.assertToolAllowed(
          taskRef.taskType,
          allowedToolRef,
          taskRef.toolPolicyRef,
        );
        if (tool.recover === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_ACTION_UNCERTAIN",
              category: "action",
              retryable: false,
              stage: "worker.recovery.configuration",
              taskRef,
              actionId,
            }),
          );
        reservation = { task: claim.task, reservation: completed.reservation };
        intentRecorded = true;
        await this.#options.store.heartbeat({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          leaseDurationMs: this.#options.leaseDurationMs,
          now: this.#now(),
        });
        await this.#options.store.verifyWorker(claim.task, claim.task.envelope.commandId);
        throwLeaseFailure();
        startDeadline(reservation.task);
        actionStartedAt = Date.now();
        const recovered = await tool.recover({
          task: reservation.task,
          taskRef,
          actionId,
          signal: operationController.signal,
        });
        if (recovered === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_ACTION_UNCERTAIN",
              category: "action",
              retryable: false,
              stage: "worker.recovery.unresolved",
              taskRef,
              actionId,
            }),
          );
        outcome = outcomeFromDomainTool(recovered, taskRef, actionId);
        throwLeaseFailure();
      } else {
        if (this.#options.renderModelStep === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "worker.action.configuration",
              taskRef,
            }),
          );
        rendered = await this.#options.renderModelStep(claim.task, definition);
        toolRef =
          rendered.domainTool === undefined
            ? undefined
            : VersionReferenceSchema.parse(rendered.domainTool.toolRef);
        if (toolRef !== undefined) {
          typedToolInput = this.#options.registry.parseAction(
            taskRef.taskType,
            rendered.domainTool?.input,
          );
          this.#options.registry.assertToolAllowed(
            taskRef.taskType,
            toolRef,
            taskRef.toolPolicyRef,
          );
          actionType = "domain-tool";
        } else {
          actionType = "model-invocation";
          if (
            this.#options.modelGateway === undefined ||
            this.#options.interpretModelStep === undefined
          )
            throw new AgentRuntimeError(
              makeAgentError({
                code: "AGENT_INPUT_INVALID",
                category: "input",
                stage: "worker.model.configuration",
                taskRef,
              }),
            );
        }
        throwLeaseFailure();
        if (operationController.signal.aborted) {
          await this.#options.store.releaseLease({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            status: "released",
            now: this.#now(),
          });
          return;
        }
        await this.#options.store.verifyWorker(claim.task, claim.task.envelope.commandId);
        const intentArtifactRef = await this.#persistJson(
          claim.task,
          actionId,
          "agent-action-intent",
          {
            schemaVersion: "1",
            taskRef,
            actionId,
            sequence,
            actionType,
            modelDeploymentRef: taskRef.modelDeploymentRef,
            promptTemplateRef: taskRef.promptTemplateRef,
            toolPolicyRef: taskRef.toolPolicyRef,
            ...(toolRef === undefined ? {} : { toolRef, input: typedToolInput }),
          },
          operationController.signal,
        );
        throwLeaseFailure();
        reservation = await this.#options.store.reserveAction({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          actionId,
          reservationId: `${actionId}:reservation:${claim.attemptNumber}`,
          actionType,
          sequence,
          idempotencyKey,
          intentArtifactRef,
          amount: {
            ...rendered.reservationAmount,
            ...(claim.task.budgetPolicy.maxInputTokens === undefined
              ? {}
              : { inputTokens: claim.task.budgetPolicy.maxInputTokens }),
            outputTokens: Math.max(
              rendered.reservationAmount?.outputTokens ?? 0,
              rendered.maxOutputTokens,
            ),
          },
          now: this.#now(),
        });
        intentRecorded = true;
        throwLeaseFailure();
        startDeadline(reservation.task);
        await this.#options.store.heartbeat({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          leaseDurationMs: this.#options.leaseDurationMs,
          now: this.#now(),
        });
        await this.#options.store.verifyWorker(claim.task, claim.task.envelope.commandId);
        throwLeaseFailure();
        actionStartedAt = Date.now();
        if (toolRef !== undefined) {
          const tool = this.#options.registry.assertToolAllowed(
            taskRef.taskType,
            toolRef,
            taskRef.toolPolicyRef,
          );
          outcome = outcomeFromDomainTool(
            await tool.execute(typedToolInput, {
              task: reservation.task,
              taskRef,
              actionId,
              signal: operationController.signal,
            }),
            taskRef,
            actionId,
          );
        } else {
          const model = await this.#executeModel(
            reservation.task,
            definition,
            actionId,
            operationController.signal,
            rendered,
          );
          outcome = model.outcome;
          modelRaw = model.raw;
        }
      }
      await this.#options.store.heartbeat({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        leaseDurationMs: this.#options.leaseDurationMs,
        now: this.#now(),
      });
      throwLeaseFailure();
      if (operationController.signal.aborted && outcome.kind === "completed")
        throw new AgentRuntimeError(
          makeAgentError({
            code: "AGENT_CANCELLED",
            category: "cancelled",
            retryable: false,
            stage: "worker.cancelled",
            taskRef,
            actionId,
          }),
        );
      const evidenceRef = await this.#persistJson(
        reservation.task,
        actionId,
        "agent-action-result",
        {
          schemaVersion: "1",
          taskRef,
          actionId,
          disposition: outcome.kind,
          ...(modelRaw === undefined ? {} : { rawResponseRef: modelRaw.rawResponseRef }),
          ...(outcome.candidate === undefined
            ? {}
            : { candidateVersion: outcome.candidate.candidateVersion }),
          ...(outcome.proposalRef === undefined ? {} : { proposalRef: outcome.proposalRef }),
          ...(outcome.resultArtifactRef === undefined
            ? {}
            : { observationArtifactRef: outcome.resultArtifactRef }),
        },
        operationController.signal,
      );
      throwLeaseFailure();
      const usage = normalizeAgentActionUsage(
        actionType,
        outcome.usage ?? (modelRaw === undefined ? undefined : usageFromModel(modelRaw)),
      );
      if (outcome.candidate !== undefined) {
        let candidate: AgentCandidateVersionV1;
        try {
          candidate = AgentCandidateVersionV1Schema.parse(outcome.candidate);
        } catch {
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "worker.candidate.schema",
              taskRef,
              actionId,
            }),
          );
        }
        const candidatePayload = this.#options.registry.parseCandidate(
          taskRef.taskType,
          outcome.candidatePayload ?? candidate,
        );
        this.#options.registry.parseIncrement(
          taskRef.taskType,
          outcome.increment ?? candidatePayload,
        );
        const validation = AgentValidationResultV1Schema.parse(
          await definition.validateCandidate(candidatePayload as never, reservation.task),
        );
        throwLeaseFailure();
        const rejected = validation.items.find((item) => item.disposition === "rejected");
        const rejectionClass =
          validation.rejectionClass ??
          (rejected === undefined
            ? undefined
            : classifyValidationFailure({ reasonCode: rejected.reasonCode }));
        candidate = {
          ...candidate,
          validation,
          disposition:
            validation.disposition === "rejected"
              ? "rejected"
              : candidate.disposition === "completed"
                ? "completed"
                : "accepted",
          ...(rejectionClass === undefined ? {} : { rejectionClass }),
        };
        throwLeaseFailure();
        await this.#options.store.recordCandidate({
          candidate,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
        });
        throwLeaseFailure();
        if (validation.disposition === "rejected") {
          const failure = makeAgentError({
            code: "AGENT_VALIDATION_REJECTED",
            category: "validation",
            retryable: rejectionClass === "repairable",
            stage: "worker.candidate.validation",
            taskRef,
            actionId,
            reasonCode: rejected?.reasonCode ?? "validation-rejected",
          });
          await this.#options.store.failAction({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            actionId,
            error: failure,
            resultArtifactRef: evidenceRef,
            usage,
            activeWallClockMs: activeActionWallClockMs(),
            now: this.#now(),
          });
          await this.#options.store.releaseLease({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            status: "released",
            now: this.#now(),
          });
          return;
        }
      }
      if (outcome.kind === "waiting") {
        if (outcome.proposalRef === undefined || outcome.proposalArtifactRef === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "worker.proposal",
              taskRef,
              actionId,
            }),
          );
        throwLeaseFailure();
        await this.#options.store.completeAction({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          actionId,
          resultArtifactRef: outcome.resultArtifactRef ?? evidenceRef,
          usage,
          activeWallClockMs: activeActionWallClockMs(),
          now: this.#now(),
        });
        await this.#options.store.markWaiting({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          proposalRef: outcome.proposalRef,
          proposalArtifactRef: outcome.proposalArtifactRef,
          now: this.#now(),
        });
        return;
      }
      if (outcome.kind === "completed") {
        if (outcome.resultRef === undefined)
          throw new AgentRuntimeError(
            makeAgentError({
              code: "AGENT_INPUT_INVALID",
              category: "input",
              stage: "worker.result",
              taskRef,
              actionId,
            }),
          );
        throwLeaseFailure();
        await this.#options.store.completeAction({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          actionId,
          resultRef: outcome.resultRef,
          resultArtifactRef: outcome.resultArtifactRef ?? evidenceRef,
          usage,
          activeWallClockMs: activeActionWallClockMs(),
          now: this.#now(),
        });
        const result = buildCompletedAgentTaskResult(
          taskRef,
          outcome.resultRef,
          undefined,
          definition.metadata.resultFamilies,
        );
        await this.#options.store.completeTask({
          taskRef,
          workerId: claim.workerId,
          leaseToken: claim.leaseToken,
          resultRef: result,
          now: this.#now(),
        });
        return;
      }
      const failure =
        outcome.error ??
        makeAgentError({
          code: outcome.kind === "uncertain" ? "AGENT_ACTION_UNCERTAIN" : "AGENT_MODEL_FAILURE",
          category: outcome.kind === "uncertain" ? "action" : "model",
          retryable: outcome.kind !== "uncertain",
          stage: "worker.outcome",
          taskRef,
          actionId,
        });
      throwLeaseFailure();
      await this.#options.store.failAction({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        actionId,
        error: failure,
        resultArtifactRef: evidenceRef,
        usage,
        activeWallClockMs: activeActionWallClockMs(),
        now: this.#now(),
      });
      await this.#options.store.releaseLease({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        status: "released",
        now: this.#now(),
      });
    } catch (error) {
      if (leaseMonitor !== undefined) await leaseMonitor.stop().catch(() => undefined);
      const failure = wallClockExceeded
        ? makeAgentError({
            code: "AGENT_WALL_CLOCK_EXCEEDED",
            category: "budget",
            retryable: false,
            stage: "worker.wall-clock",
            taskRef,
            actionId,
          })
        : asError(leaseMonitor?.failure() ?? error, taskRef, actionId);
      if (!intentRecorded) {
        if (!failure.retryable && this.#options.store.failTask !== undefined)
          await this.#options.store.failTask({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            error: failure,
            now: this.#now(),
          });
        else
          await this.#options.store.releaseLease({
            taskRef,
            workerId: claim.workerId,
            leaseToken: claim.leaseToken,
            status: failure.code === "AGENT_CANCELLED" ? "cancelled" : "released",
            now: this.#now(),
          });
        return;
      }
      await this.#options.store.failAction({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        actionId,
        error: failure,
        uncertain: failure.code === "AGENT_ACTION_UNCERTAIN",
        activeWallClockMs: activeActionWallClockMs(),
        now: this.#now(),
      });
      await this.#options.store.releaseLease({
        taskRef,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
        status: failure.code === "AGENT_CANCELLED" ? "cancelled" : "released",
        now: this.#now(),
      });
    } finally {
      signal.removeEventListener("abort", abortOperation);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      if (leaseMonitor !== undefined) await leaseMonitor.stop().catch(() => undefined);
    }
  }
}

export const createAgentRuntimeRunner = (
  options: AgentRuntimeRunnerOptionsV1,
): AgentRuntimeRunner => new AgentRuntimeRunner(options);
