import type { TransactionContextV1, TransactionUnitV1 } from "../persistence/index.js";

import type {
  ArtifactHashManifestCommandV1,
  ArtifactManifestV1,
  ArtifactPutCommandV1,
  ArtifactPutResultV1,
  ArtifactReadReceiptV1,
  ArtifactReadRequestV1,
  ArtifactReconcileFindingV1,
  ArtifactReconcileRequestV1,
  ArtifactReconcileSummaryV1,
  ArtifactReferenceCheckRequestV1,
  ArtifactReferenceCheckResultV1,
  ArtifactSweepCommandV1,
  ArtifactSweepResultV1,
} from "./schema.js";

export interface ArtifactReadHandleV1 {
  readonly manifest: ArtifactManifestV1;
  readonly content: AsyncIterable<Uint8Array>;
  readonly completed: Promise<ArtifactReadReceiptV1>;
}

export interface ArtifactReconcileHandleV1 {
  readonly findings: AsyncIterable<ArtifactReconcileFindingV1>;
  readonly summary: Promise<ArtifactReconcileSummaryV1>;
}

export interface ArtifactStoreV1 {
  put(
    command: ArtifactPutCommandV1,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ArtifactPutResultV1>;
  open(request: ArtifactReadRequestV1): Promise<ArtifactReadHandleV1>;
  verifyContent?(
    request: ArtifactReadRequestV1,
    maxBytes: number,
    validate: (bytes: Uint8Array) => boolean,
  ): Promise<boolean>;
}

export interface ArtifactReferenceGuardV1 {
  assertUsable(
    context: TransactionContextV1,
    request: ArtifactReferenceCheckRequestV1,
  ): Promise<ArtifactReferenceCheckResultV1>;
}

export interface ArtifactMaintenanceV1 {
  createHashManifest(command: ArtifactHashManifestCommandV1): Promise<ArtifactPutResultV1>;
  reconcile(
    request: ArtifactReconcileRequestV1,
    manifestContent?: AsyncIterable<Uint8Array>,
  ): ArtifactReconcileHandleV1;
  sweepOrphans(command: ArtifactSweepCommandV1): Promise<ArtifactSweepResultV1>;
}

export interface ArtifactStoreCompositionV1 {
  readonly store: ArtifactStoreV1;
  readonly referenceGuard: ArtifactReferenceGuardV1;
  readonly maintenance: ArtifactMaintenanceV1;
  close(): Promise<void>;
}

export type ArtifactManifestReaderV1 = (
  projectId: string,
  artifactRef: ArtifactPutResultV1["artifactRef"],
) => Promise<ArtifactManifestV1 | undefined>;

export type ArtifactTransactionUnitV1 = TransactionUnitV1;
