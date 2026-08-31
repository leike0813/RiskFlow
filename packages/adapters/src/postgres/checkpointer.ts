import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

import { isJsonValue } from "@riskflow/core/persistence";
import { ContractReferenceV1Schema, type ContractReferenceV1 } from "@riskflow/contracts/ports";
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
  PostgresPersistenceError,
  type PostgresConnectionConfig,
} from "./pool.js";

export const CHECKPOINTER_SCHEMA = "langgraph_checkpoint" as const;
const schemaSetupStatement = `CREATE SCHEMA IF NOT EXISTS "${CHECKPOINTER_SCHEMA}"`;

export type ContractReferenceValidator = (
  reference: ContractReferenceV1,
) => boolean | Promise<boolean>;

export interface PostgresCheckpointerConfig extends PostgresConnectionConfig {
  schema?: typeof CHECKPOINTER_SCHEMA;
  validateReference: ContractReferenceValidator;
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

const parseGraphState = (value: unknown) => {
  for (const schema of graphStateSchemas) {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.graph-state");
};

const validateGraphStateWrites = (writes: unknown): void => {
  if (!Array.isArray(writes)) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
  }
  for (const write of writes) {
    if (!Array.isArray(write) || typeof write[0] !== "string") {
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
    }
    const accepted = graphStateSchemas.some((schema) => {
      const shape = schema.shape as Record<
        string,
        { safeParse(value: unknown): { success: boolean } }
      >;
      return shape[write[0]]?.safeParse(write[1]).success === true;
    });
    if (!accepted) {
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.writes");
    }
  }
};

const collectContractReferences = (
  value: unknown,
  references: ContractReferenceV1[] = [],
): ContractReferenceV1[] => {
  const parsed = ContractReferenceV1Schema.safeParse(value);
  if (parsed.success) {
    references.push(parsed.data);
    return references;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectContractReferences(item, references);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) collectContractReferences(item, references);
  }
  return references;
};

const validateReferences = async (
  validator: ContractReferenceValidator,
  ...values: readonly unknown[]
): Promise<void> => {
  try {
    for (const reference of values.flatMap((value) => collectContractReferences(value))) {
      if (!(await validator(reference))) {
        throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.reference");
      }
    }
  } catch (error) {
    if (error instanceof PostgresPersistenceError) throw error;
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.reference");
  }
};

const validateMetadata = (metadata: unknown): metadata is Record<string, unknown> => {
  if (!isRecord(metadata) || !isJsonValue(metadata)) return false;
  const allowed = new Set([
    "source",
    "step",
    "parents",
    "counters_since_delta_snapshot",
    "schemaVersion",
    "runId",
    "threadId",
    "commandId",
    "eventId",
    "graphVersion",
    "routeDecisionRef",
    "resultRef",
  ]);
  if (Object.keys(metadata).some((key) => !allowed.has(key))) return false;
  if (
    metadata.source !== undefined &&
    !["input", "loop", "update", "fork"].includes(metadata.source as string)
  ) {
    return false;
  }
  if (
    metadata.step !== undefined &&
    (!Number.isInteger(metadata.step) || typeof metadata.step !== "number")
  ) {
    return false;
  }
  if (
    metadata.parents !== undefined &&
    (!isRecord(metadata.parents) ||
      Object.values(metadata.parents).some((value) => typeof value !== "string"))
  ) {
    return false;
  }
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
  if (typeof checkpoint !== "object" || checkpoint === null || typeof checkpoint.id !== "string") {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.checkpoint");
  }
  if (!validateMetadata(metadata)) {
    throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.metadata");
  }
  const graphState = parseGraphState(checkpoint.channel_values);
  if (
    graphState.threadId !== threadId ||
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

export class PostgresCheckpointer {
  readonly #saver: PostgresSaver;
  readonly #validateReference: ContractReferenceValidator;

  constructor(saver: PostgresSaver, validateReference: ContractReferenceValidator) {
    this.#saver = saver;
    this.#validateReference = validateReference;
  }

  async setup(): Promise<void> {
    try {
      await this.#saver.setup();
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

  async put(...args: SaverPutArguments): Promise<Awaited<ReturnType<PostgresSaver["put"]>>> {
    const graphState = validateCheckpointWrite(args[0], args[1], args[2]);
    await validateReferences(this.#validateReference, graphState, args[2]);
    try {
      return await this.#saver.put(...args);
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.put");
    }
  }

  async putWrites(...args: SaverPutWritesArguments): Promise<void> {
    validateConfig(args[0]);
    validateGraphStateWrites(args[1]);
    await validateReferences(this.#validateReference, args[1]);
    try {
      await this.#saver.putWrites(...args);
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.put-writes");
    }
  }

  async getTuple(
    config: SaverGetTupleArgument,
  ): Promise<Awaited<ReturnType<PostgresSaver["getTuple"]>>> {
    validateConfig(config);
    try {
      const tuple = await this.#saver.getTuple(config);
      if (tuple !== undefined) {
        const graphState = validateCheckpointWrite(tuple.config, tuple.checkpoint, tuple.metadata);
        await validateReferences(this.#validateReference, graphState, tuple.metadata);
      }
      return tuple;
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.get");
    }
  }

  async *list(...args: SaverListArguments): AsyncGenerator<SaverListItem> {
    validateConfig(args[0]);
    try {
      for await (const tuple of this.#saver.list(...args)) {
        const graphState = validateCheckpointWrite(tuple.config, tuple.checkpoint, tuple.metadata);
        await validateReferences(this.#validateReference, graphState, tuple.metadata);
        yield tuple;
      }
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.list");
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    if (!IdentifierSchema.safeParse(threadId).success) {
      throw makePersistenceError("CHECKPOINT_INCONSISTENT", "checkpointer.thread");
    }
    try {
      await this.#saver.deleteThread(threadId);
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.delete-thread");
    }
  }

  async end(): Promise<void> {
    try {
      await this.#saver.end();
    } catch (error) {
      throw this.#mapCheckpointerError(error, "checkpointer.close");
    }
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

const createSaver = (config: PostgresCheckpointerConfig): PostgresSaver => {
  if (config.schema !== undefined && config.schema !== CHECKPOINTER_SCHEMA) {
    throw makePersistenceError("CHECKPOINTER_SETUP_REQUIRED", "checkpointer.schema");
  }
  const { validateReference: _validateReference, schema: _schema, ...connection } = config;
  void _validateReference;
  void _schema;
  const pool = createPostgresPool(connection, "riskflow_checkpointer");
  return new PostgresSaver(suppressRedundantSchemaCreate(pool), undefined, {
    schema: CHECKPOINTER_SCHEMA,
  });
};

export const createPostgresCheckpointer = (
  config: PostgresCheckpointerConfig,
): PostgresCheckpointer => new PostgresCheckpointer(createSaver(config), config.validateReference);

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
