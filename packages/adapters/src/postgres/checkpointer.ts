import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { ContractReferenceV1Schema } from "@riskflow/contracts/ports";
import {
  CHECKPOINT_RUNTIME_CONTEXT_KEY_V1,
  CheckpointRuntimeContextV1Schema,
  isJsonValue,
  type CheckpointRuntimeContextV1,
} from "@riskflow/core/persistence";
import { IdentifierSchema, VersionReferenceSchema } from "@riskflow/contracts/common";
import {
  AssessmentGraphStateV1Schema,
  IdentificationGraphStateV1Schema,
  RiskFlowGraphStateV1Schema,
} from "@riskflow/contracts/workflows";

import {
  createPostgresPool,
  makePersistenceError,
  mapPostgresError,
  type PostgresConnectionConfig,
} from "./pool.js";

export const CHECKPOINTER_SCHEMA = "langgraph_checkpoint" as const;
const schemaSetupStatement = `CREATE SCHEMA IF NOT EXISTS "${CHECKPOINTER_SCHEMA}"`;

export type CheckpointStateValidatorV1 = (
  context: CheckpointStateValidationContextV1,
) => boolean | Promise<boolean>;

export interface CheckpointStateValidationContextV1 {
  readonly operation: "put" | "put-writes" | "get" | "list";
  readonly state: ReturnType<typeof parseGraphState>["state"];
  readonly runtimeContext?: CheckpointRuntimeContextV1;
}

export interface PostgresCheckpointerConfig extends PostgresConnectionConfig {
  schema?: typeof CHECKPOINTER_SCHEMA;
  validateState?: CheckpointStateValidatorV1;
}

type SaverPutArguments = Parameters<PostgresSaver["put"]>;
type SaverPutWritesArguments = Parameters<PostgresSaver["putWrites"]>;
type SaverGetTupleArgument = Parameters<PostgresSaver["getTuple"]>[0];
type SaverListArguments = Parameters<PostgresSaver["list"]>;
type SaverListResult = ReturnType<PostgresSaver["list"]>;
type SaverListItem = SaverListResult extends AsyncGenerator<infer Item> ? Item : never;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const graphStateSchemas = [
  IdentificationGraphStateV1Schema,
  AssessmentGraphStateV1Schema,
  RiskFlowGraphStateV1Schema,
] as const;

const langGraphProtocolChannels = new Set([
  "__error__",
  "__scheduled__",
  "__interrupt__",
  "__resume__",
  "__pregel_tasks",
  // 真实 StateGraph 的首个输入检查点把整份输入先写入 START 通道（LangGraph 固定
  // `inputChannels: START`），随后才由 START 节点按 outputKeys 过滤写入状态字段。
  "__start__",
]);

/**
 * LangGraph 按节点名动态派生控制通道：条件边为 `branch:to:<node>`，屏障聚合为
 * `join:<a>+<b>:<node>`。这些通道只承载调度信息、不承载业务事实，因此与上面的固定协议通道
 * 同等对待；它们无法被静态枚举，只能按前缀识别。
 */
const langGraphControlChannelPrefixes = ["branch:", "join:"] as const;

const isLangGraphControlChannel = (channel: string): boolean =>
  langGraphProtocolChannels.has(channel) ||
  langGraphControlChannelPrefixes.some((prefix) => channel.startsWith(prefix));

const withoutProtocolChannels = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([channel]) => !isLangGraphControlChannel(channel)),
  );

const parseGraphState = (value: unknown) => {
  const filtered = isRecord(value) ? withoutProtocolChannels(value) : value;
  for (const schema of graphStateSchemas) {
    const parsed = schema.safeParse(filtered);
    if (parsed.success) return { state: parsed.data, schema };
  }
  // 输入检查点尚未物化状态：LangGraph 先把调用方输入写入 START 通道，此时剔除协议/控制通道后
  // 为空对象。该情形下状态就是 START 通道的值，仍 MUST 严格解析为同一批 Schema 之一，因此这里
  // 只增加一个取值位置，不放宽任何校验；解析失败仍按 checkpointer.graph-state 拒绝。
  if (isRecord(value) && isRecord(filtered) && Object.keys(filtered).length === 0) {
    const startValue = value["__start__"];
    for (const schema of graphStateSchemas) {
      const parsed = schema.safeParse(startValue);
      if (parsed.success) return { state: parsed.data, schema };
    }
  }
  throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.graph-state");
};

type GraphStateSchema = (typeof graphStateSchemas)[number];

const validateGraphStateWrites = (writes: unknown, schema: GraphStateSchema): void => {
  if (!Array.isArray(writes)) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
  }
  for (const write of writes) {
    if (!Array.isArray(write) || typeof write[0] !== "string") {
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
    }
    if (isLangGraphControlChannel(write[0])) continue;
    const shape = schema.shape as Record<
      string,
      { safeParse(value: unknown): { success: boolean } }
    >;
    const accepted = shape[write[0]]?.safeParse(write[1]).success === true;
    if (!accepted) {
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
    }
  }
};

const referenceValidationContext = (
  config: SaverGetTupleArgument,
  state: ReturnType<typeof parseGraphState>["state"],
  operation: CheckpointStateValidationContextV1["operation"],
): CheckpointStateValidationContextV1 => {
  const raw = config.configurable?.[CHECKPOINT_RUNTIME_CONTEXT_KEY_V1];
  if (raw === undefined) return { operation, state };
  const parsed = CheckpointRuntimeContextV1Schema.safeParse(raw);
  if (
    !parsed.success ||
    parsed.data.threadId !== config.configurable?.thread_id ||
    parsed.data.threadId !== state.threadId ||
    parsed.data.runRef.reference.entityId !== state.runRef.reference.entityId ||
    parsed.data.runRef.reference.versionId !== state.runRef.reference.versionId
  ) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.runtime-context");
  }
  return { operation, state, runtimeContext: parsed.data };
};

const validateMetadata = (metadata: unknown): metadata is Record<string, unknown> => {
  if (!isRecord(metadata) || !isJsonValue(metadata)) return false;
  if (metadata.schemaVersion !== undefined && metadata.schemaVersion !== "1") return false;
  for (const key of ["runId", "threadId", "commandId", "eventId"]) {
    if (metadata[key] !== undefined && !IdentifierSchema.safeParse(metadata[key]).success)
      return false;
  }
  if (
    metadata.graphVersion !== undefined &&
    !VersionReferenceSchema.safeParse(metadata.graphVersion).success
  ) {
    return false;
  }
  if (
    metadata.routeDecisionRef !== undefined &&
    !ContractReferenceV1Schema.safeParse(metadata.routeDecisionRef).success
  ) {
    return false;
  }
  return (
    metadata.resultRef === undefined ||
    ContractReferenceV1Schema.safeParse(metadata.resultRef).success
  );
};

const validateCheckpointWrite = (
  config: SaverPutArguments[0],
  checkpoint: SaverPutArguments[1],
  metadata: unknown,
): ReturnType<typeof parseGraphState> => {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || !IdentifierSchema.safeParse(threadId).success) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.thread");
  }
  if (!validateMetadata(metadata)) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.metadata");
  }
  const graphState = parseGraphState(checkpoint.channel_values);
  if (
    graphState.state.threadId !== threadId ||
    (metadata.threadId !== undefined && metadata.threadId !== threadId)
  ) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.thread");
  }
  return graphState;
};

const validateConfig = (config: SaverGetTupleArgument): void => {
  const threadId = config.configurable?.thread_id;
  if (typeof threadId !== "string" || !IdentifierSchema.safeParse(threadId).success) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.thread");
  }
};

const checkpointKey = (
  config: SaverGetTupleArgument,
  checkpointId = config.configurable?.checkpoint_id,
): string | undefined => {
  const threadId = config.configurable?.thread_id;
  const checkpointNamespace = config.configurable?.checkpoint_ns ?? "";
  return typeof threadId === "string" &&
    typeof checkpointNamespace === "string" &&
    typeof checkpointId === "string"
    ? `${threadId}\u0000${checkpointNamespace}\u0000${checkpointId}`
    : undefined;
};

export class PostgresCheckpointer extends PostgresSaver {
  readonly #validateState: CheckpointStateValidatorV1 | undefined;
  readonly #pendingPuts = new Map<string, Promise<unknown>>();

  constructor(
    pool: ConstructorParameters<typeof PostgresSaver>[0],
    validateState?: CheckpointStateValidatorV1,
  ) {
    super(pool, undefined, { schema: CHECKPOINTER_SCHEMA });
    this.#validateState = validateState;
  }

  override async setup(): Promise<void> {
    try {
      await super.setup();
    } catch (error) {
      const code =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : undefined;
      if (code === "3F000" || code === "42P01") {
        throw makePersistenceError("CHECKPOINTER_SETUP_REQUIRED", "checkpointer.setup");
      }
      throw mapPostgresError(error, "checkpointer.setup");
    }
  }

  override async put(
    ...args: SaverPutArguments
  ): Promise<Awaited<ReturnType<PostgresSaver["put"]>>> {
    const graphState = validateCheckpointWrite(args[0], args[1], args[2]);
    const key = checkpointKey(args[0], args[1].id);
    const pending = (async () => {
      await this.#checkState(referenceValidationContext(args[0], graphState.state, "put"));
      const saved = await super.put(...args);
      const runtimeContext = args[0].configurable?.[CHECKPOINT_RUNTIME_CONTEXT_KEY_V1];
      return runtimeContext === undefined
        ? saved
        : {
            ...saved,
            configurable: {
              ...saved.configurable,
              [CHECKPOINT_RUNTIME_CONTEXT_KEY_V1]: runtimeContext,
            },
          };
    })();
    if (key !== undefined) this.#pendingPuts.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.put");
    } finally {
      if (key !== undefined && this.#pendingPuts.get(key) === pending) {
        this.#pendingPuts.delete(key);
      }
    }
  }

  override async putWrites(...args: SaverPutWritesArguments): Promise<void> {
    validateConfig(args[0]);
    try {
      const pending = this.#pendingPuts.get(checkpointKey(args[0]) ?? "");
      if (pending !== undefined) await pending;
      const tuple = await super.getTuple(args[0]);
      if (tuple === undefined) {
        throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
      }
      const graphState = validateCheckpointWrite(tuple.config, tuple.checkpoint, tuple.metadata);
      validateGraphStateWrites(args[1], graphState.schema);
      await this.#checkState(referenceValidationContext(args[0], graphState.state, "put-writes"));
      await super.putWrites(...args);
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.put-writes");
    }
  }

  override async getTuple(
    config: SaverGetTupleArgument,
  ): Promise<Awaited<ReturnType<PostgresSaver["getTuple"]>>> {
    validateConfig(config);
    try {
      const tuple = await super.getTuple(config);
      if (tuple !== undefined) {
        const graphState = validateCheckpointWrite(tuple.config, tuple.checkpoint, tuple.metadata);
        const pendingWrites = tuple.pendingWrites?.map(([, channel, value]) => [channel, value]);
        if (pendingWrites !== undefined) validateGraphStateWrites(pendingWrites, graphState.schema);
        await this.#checkState(referenceValidationContext(config, graphState.state, "get"));
      }
      return tuple;
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.get");
    }
  }

  override async *list(...args: SaverListArguments): AsyncGenerator<SaverListItem> {
    validateConfig(args[0]);
    try {
      for await (const tuple of super.list(...args)) {
        const graphState = validateCheckpointWrite(tuple.config, tuple.checkpoint, tuple.metadata);
        const pendingWrites = tuple.pendingWrites?.map(([, channel, value]) => [channel, value]);
        if (pendingWrites !== undefined) validateGraphStateWrites(pendingWrites, graphState.schema);
        await this.#checkState(referenceValidationContext(args[0], graphState.state, "list"));
        yield tuple;
      }
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.list");
    }
  }

  override async deleteThread(threadId: string): Promise<void> {
    if (!IdentifierSchema.safeParse(threadId).success) {
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.thread");
    }
    try {
      await super.deleteThread(threadId);
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.delete-thread");
    }
  }

  override async end(): Promise<void> {
    try {
      await super.end();
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.close");
    }
  }

  async #checkState(context: CheckpointStateValidationContextV1): Promise<void> {
    if (this.#validateState !== undefined && !(await this.#validateState(context)))
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.runtime-context");
  }

  #mapCheckpointerError(error: unknown, stage: string) {
    const code =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : undefined;
    if (code === "3F000" || code === "42P01") {
      return makePersistenceError("CHECKPOINTER_SETUP_REQUIRED", stage);
    }
    return mapPostgresError(error, stage);
  }
}

const suppressRedundantSchemaCreate = <T extends object>(pool: T): T =>
  new Proxy(pool, {
    get(target, property, receiver) {
      if (property !== "connect") {
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async () => {
        const connect = Reflect.get(target, property, receiver);
        if (typeof connect !== "function") throw new TypeError("pool.connect is unavailable");
        const client = await Reflect.apply(connect, target, []);
        return new Proxy(client, {
          get(clientTarget, clientProperty, clientReceiver) {
            if (clientProperty !== "query") {
              const value = Reflect.get(clientTarget, clientProperty, clientReceiver);
              return typeof value === "function" ? value.bind(clientTarget) : value;
            }
            const query = Reflect.get(clientTarget, clientProperty, clientReceiver);
            if (typeof query !== "function") return query;
            return (...args: unknown[]) => {
              if (typeof args[0] === "string" && args[0].trim() === schemaSetupStatement) {
                return Promise.resolve({ rows: [] });
              }
              return Reflect.apply(query, clientTarget, args);
            };
          },
        });
      };
    },
  });

const createSaver = (config: PostgresCheckpointerConfig): PostgresCheckpointer => {
  if (config.schema !== undefined && config.schema !== CHECKPOINTER_SCHEMA) {
    throw makePersistenceError("CHECKPOINTER_SETUP_REQUIRED", "checkpointer.schema");
  }
  const { validateState: _validateState, schema: _schema, ...connection } = config;
  void _validateState;
  void _schema;
  const pool = createPostgresPool(connection, "riskflow_checkpointer");
  return new PostgresCheckpointer(suppressRedundantSchemaCreate(pool), config.validateState);
};

export const createPostgresCheckpointer = (
  config: PostgresCheckpointerConfig,
): PostgresCheckpointer => createSaver(config);

export const setupPostgresCheckpointer = async (
  config: PostgresCheckpointerConfig,
): Promise<PostgresCheckpointer> => {
  const checkpointer = createPostgresCheckpointer(config);
  try {
    await checkpointer.setup();
    return checkpointer;
  } catch (error) {
    await checkpointer.end().catch(() => undefined);
    throw error;
  }
};
