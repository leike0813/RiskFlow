import {
  MonitoringAvailabilityPolicyV1Schema,
  MonitoringBatchV1Schema,
  MonitoringSnapshotQueryV1Schema,
  MonitoringSnapshotV1Schema,
  MonitoringSeriesRevisionV1Schema,
  MonitoringSampleVersionV1Schema,
  MonitoringResultV1Schema,
  type MonitoringAvailabilityPolicyV1,
  type MonitoringBatchV1,
  type MonitoringResultV1,
  type MonitoringSnapshotQueryV1,
  type MonitoringSnapshotV1,
  type MonitoringSeriesRevisionV1,
  type MonitoringSampleVersionV1,
  type RegisterMonitoringAvailabilityPolicyCommandV1,
  type ResolveMonitoringSnapshotQueryV1,
  type ReviseMonitoringSeriesCommandV1,
} from "./schema.js";

import { ModuleErrorV1Schema, type ModuleErrorV1 } from "@riskflow/contracts/ports";

export interface MonitoringRegistryV1 {
  reviseSeries(command: ReviseMonitoringSeriesCommandV1): Promise<MonitoringResultV1>;
  registerAvailabilityPolicy(
    command: RegisterMonitoringAvailabilityPolicyCommandV1,
  ): Promise<MonitoringResultV1>;
  resolveSnapshotQuery(query: ResolveMonitoringSnapshotQueryV1): Promise<MonitoringResultV1>;
}

export const parseMonitoringSeriesRevision = (value: unknown): MonitoringSeriesRevisionV1 =>
  MonitoringSeriesRevisionV1Schema.parse(value);

export const parseMonitoringBatch = (value: unknown): MonitoringBatchV1 =>
  MonitoringBatchV1Schema.parse(value);

export const parseMonitoringSampleVersion = (value: unknown): MonitoringSampleVersionV1 =>
  MonitoringSampleVersionV1Schema.parse(value);

export const parseMonitoringAvailabilityPolicy = (value: unknown): MonitoringAvailabilityPolicyV1 =>
  MonitoringAvailabilityPolicyV1Schema.parse(value);

export const parseMonitoringSnapshot = (value: unknown): MonitoringSnapshotV1 =>
  MonitoringSnapshotV1Schema.parse(value);

export const parseMonitoringSnapshotQuery = (value: unknown): MonitoringSnapshotQueryV1 =>
  MonitoringSnapshotQueryV1Schema.parse(value);

export const parseMonitoringResult = (value: unknown): MonitoringResultV1 =>
  MonitoringResultV1Schema.parse(value);

export const monitoringFailure = (error: ModuleErrorV1): MonitoringResultV1 =>
  MonitoringResultV1Schema.parse({ kind: "failed", error: ModuleErrorV1Schema.parse(error) });
