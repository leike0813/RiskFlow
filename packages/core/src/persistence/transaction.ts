import type { AtomicCommitReceiptV1, AtomicCommitV1, AtomicCommandV1 } from "./schema.js";

declare const transactionContextBrand: unique symbol;

export type TransactionContextV1 = {
  readonly [transactionContextBrand]: true;
};

export type TransactionHandlerV1 = (context: TransactionContextV1) => Promise<AtomicCommitV1>;

export type TransactionIsolationLevelV1 = "read committed" | "repeatable read" | "serializable";

export interface TransactionOptionsV1 {
  readonly isolationLevel?: TransactionIsolationLevelV1;
}

export interface TransactionUnitV1 {
  execute(
    command: AtomicCommandV1,
    handler: TransactionHandlerV1,
    options?: TransactionOptionsV1,
  ): Promise<AtomicCommitReceiptV1>;
}
