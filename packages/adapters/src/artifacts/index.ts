import type {
  ArtifactMaintenanceV1,
  ArtifactReferenceGuardV1,
  ArtifactStoreV1,
  ArtifactStorePolicyV1,
} from "@riskflow/core/artifacts";
import { ArtifactStorePolicyV1Schema } from "@riskflow/core/artifacts";

import { createPostgresRuntime, type PostgresConnectionConfig } from "../postgres/pool.js";
import { PostgresTransactionUnit } from "../postgres/transaction-unit.js";
import { ArtifactMaintenance } from "./maintenance.js";
import { createFilesystemArtifactStore } from "./filesystem-artifact-store.js";
import { PostgresArtifactRegistry } from "./postgres-artifact-registry.js";

export interface ContentAddressedArtifactStoreConfigV1 extends PostgresConnectionConfig {
  readonly rootDirectory: string;
  readonly policy: ArtifactStorePolicyV1;
}

export interface ContentAddressedArtifactStoreHandleV1 extends ArtifactStoreV1 {
  readonly referenceGuard: ArtifactReferenceGuardV1;
  readonly maintenance: ArtifactMaintenanceV1;
  close(): Promise<void>;
}

export const createContentAddressedArtifactStore = async (
  config: ContentAddressedArtifactStoreConfigV1,
): Promise<ContentAddressedArtifactStoreHandleV1> => {
  const { rootDirectory, policy: configuredPolicy, ...connection } = config;
  const policy = ArtifactStorePolicyV1Schema.parse(configuredPolicy);
  const runtime = createPostgresRuntime(connection, "riskflow_app");
  const transactionUnit = new PostgresTransactionUnit(runtime.db);
  const registry = new PostgresArtifactRegistry({
    db: runtime.db,
    transactionUnit,
    pool: runtime.pool,
  });
  try {
    const store = await createFilesystemArtifactStore({
      rootDirectory,
      policy,
      registry,
      transactionUnit,
    });
    const maintenance = new ArtifactMaintenance({
      rootDirectory,
      policy,
      store,
      registry,
    });
    return {
      put: store.put.bind(store),
      open: store.open.bind(store),
      referenceGuard: registry,
      maintenance,
      async close() {
        await store.close();
        await runtime.close();
      },
    };
  } catch (error) {
    await runtime.close().catch(() => undefined);
    throw error;
  }
};

export const createArtifactStore = createContentAddressedArtifactStore;
