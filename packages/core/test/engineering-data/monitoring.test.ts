import { describe, expect, it } from "vitest";

import {
  MonitoringAvailabilityPolicyV1Schema,
  MonitoringSeriesRevisionV1Schema,
  alignMonitoringSamples,
  computeMonitoringFeatures,
  convertMonitoringValue,
} from "../../src/engineering-data/monitoring/index.js";

const seriesRef = {
  kind: "monitoring-series" as const,
  reference: { entityId: "series-1", versionId: "1" },
};
const scopeRef = {
  kind: "spatial-scope" as const,
  reference: { entityId: "scope-1", versionId: "1" },
};

const policy = MonitoringAvailabilityPolicyV1Schema.parse({
  availabilityPolicyRef: { entityId: "monitoring-policy", versionId: "1" },
  projectId: "project-1",
  monitoringSeriesRef: seriesRef,
  windowDurationMs: 10_000,
  intervalMs: 1_000,
  maxInterpolationGapMs: 2_000,
  slopeWindowSize: 5,
  accelerationWindowSize: 5,
  frequencyWindowSize: 5,
  anomalyBaselineSize: 2,
  anomalyScaleFloor: 0.1,
  frequencyPowerFloor: 0,
  minimumCoverageRatio: 0.5,
  maxFrequencySamples: 32,
  algorithmVersions: {
    alignment: "alignment-v1",
    slope: "slope-v1",
    acceleration: "acceleration-v1",
    frequency: "frequency-v1",
    anomaly: "anomaly-v1",
  },
  recordedAt: "2030-01-01T00:00:00.000Z",
  audit: { actorId: "actor-1", action: "policy", recordedAt: "2030-01-01T00:00:00.000Z" },
});

const sampleAt = (second: number, value: number) => ({
  sourceSampleKey: `sample-${second}`,
  sampledAt: `2030-01-01T00:00:${String(second).padStart(2, "0")}.000Z`,
  value,
  unit: "mm",
  evidenceReferences: [
    {
      locator: { sourceSegmentId: "source-1-1-1" },
      sourceVersion: { entityId: "source-1", versionId: "1" },
    },
  ],
});

describe("C14 monitoring features", () => {
  it("keeps the series schema strict and applies explicit affine units", () => {
    expect(
      MonitoringSeriesRevisionV1Schema.safeParse({
        monitoringSeriesRef: seriesRef,
        seriesId: "series-1",
        projectId: "project-1",
        projectRevisionRef: {
          kind: "project-revision",
          reference: { entityId: "project-1", versionId: "1" },
        },
        spatialScopeRef: scopeRef,
        monitoringObject: "settlement sensor",
        monitoringIndicator: "地表沉降",
        parameterCode: "settlement",
        canonicalUnit: "mm",
        unitConversions: [],
        effectivePeriod: { validFrom: "2030-01-01T00:00:00.000Z" },
        recordedAt: "2030-01-01T00:00:00.000Z",
        audit: { actorId: "actor-1", action: "series", recordedAt: "2030-01-01T00:00:00.000Z" },
        unexpected: true,
      }).success,
    ).toBe(false);
    expect(convertMonitoringValue(2, "cm", "mm", [{ fromUnit: "cm", scale: 10, offset: 0 }])).toBe(
      20,
    );
  });

  it.each([
    ["slopeWindowSize", 1],
    ["accelerationWindowSize", 2],
    ["frequencyWindowSize", 1],
  ] as const)("rejects an uncomputable %s", (field, value) => {
    expect(
      MonitoringAvailabilityPolicyV1Schema.safeParse({ ...policy, [field]: value }).success,
    ).toBe(false);
  });

  it("aligns with bounded interpolation and computes deterministic features", () => {
    const samples = Array.from({ length: 10 }, (_, index) => sampleAt(index + 1, (index + 1) * 2));
    const computed = computeMonitoringFeatures({
      samples,
      cutoff: "2030-01-01T00:00:10.000Z",
      canonicalUnit: "mm",
      policy,
    });
    expect(computed.alignedPoints.every((point) => point.status === "available")).toBe(true);
    expect(computed.features.shortTermSlope.value).toBeCloseTo(2, 10);
    expect(computed.features.acceleration.value).toBeCloseTo(0, 10);
    expect(computed.features.dominantFrequency.status).toBe("available");
    expect(computed.features.anomalyScore.status).toBe("available");
    expect(computed.availability).toBe("available");

    const interpolated = alignMonitoringSamples(
      [sampleAt(9, 18), sampleAt(11, 22)],
      "2030-01-01T00:00:10.000Z",
      "mm",
      MonitoringAvailabilityPolicyV1Schema.parse({ ...policy, windowDurationMs: 2_000 }),
    );
    expect(interpolated.at(-1)?.status).toBe("interpolated");
    expect(interpolated.at(-1)?.value).toBe(20);
  });

  it("retains missing grid points and marks a feature unavailable", () => {
    const computed = computeMonitoringFeatures({
      samples: [sampleAt(10, 20)],
      cutoff: "2030-01-01T00:00:10.000Z",
      canonicalUnit: "mm",
      policy: MonitoringAvailabilityPolicyV1Schema.parse({ ...policy, minimumCoverageRatio: 0.9 }),
    });
    expect(computed.alignedPoints.some((point) => point.status === "missing")).toBe(true);
    expect(computed.availability).toBe("unavailable");
    expect(computed.features.shortTermSlope.status).toBe("unavailable");
  });
});
