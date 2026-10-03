import { describe, expect, it } from "vitest";

import {
  AssessmentEntryContextReadQueryV1Schema,
  AssessmentEntryContextReadResultV1Schema,
  AssessmentEntrySourceVersionsReadQueryV1Schema,
  AssessmentEntrySourceVersionsReadResultV1Schema,
  RiskAssessmentReadQueryV1Schema,
} from "../src/ports/index.js";

const ref = (kind: string, entityId = "entity-1") => ({
  kind,
  reference: { entityId, versionId: "v1" },
});
const spatialScopeRef = ref("spatial-scope");
const projectRevisionRef = ref("project-revision");
const query = (kind: string, capability: string, payload: object) => ({
  queryId: "query-1",
  projectId: "project-1",
  actorId: "actor-1",
  requestedAt: "2026-10-03T00:00:00.000Z",
  kind,
  payload,
  authorization: {
    schemaVersion: "1",
    authorizationContextRef: ref("authorization-context"),
    actorId: "actor-1",
    projectId: "project-1",
    grantedCapabilities: [capability],
    spatialScopeRefs: [spatialScopeRef],
    sourceAccessGrantRefs: [],
    authorizationPolicyRef: { entityId: "policy-1", versionId: "v1" },
    decidedAt: "2026-10-03T00:00:00.000Z",
    invocation: { kind: "human" },
  },
});

describe("C34 评估候选输入接缝", () => {
  it.each([
    [{ operation: "applicability-catalog", projectRevisionRef, spatialScopeRef }, true],
    [{ operation: "applicability-catalog", spatialScopeRef }, false],
    [{ operation: "external-event-catalog", spatialScopeRef }, true],
    [{ operation: "external-event-catalog", spatialScopeRef, projectRevisionRef }, false],
    [{ operation: "external-event-catalog" }, false],
  ])("按目录拥有的事实校验输入 %#", (payload, accepted) => {
    expect(
      AssessmentEntryContextReadQueryV1Schema.safeParse(
        query("read-assessment-entry-context", "engineering-data.read", payload),
      ).success,
    ).toBe(accepted);
  });

  it.each([
    [{ riskInputKind: "risk-record" }, true],
    [{ riskInputKind: "risk-record", spatialScopeRef }, true],
    [{ riskInputKind: "risk-record", projectRevisionRef }, false],
    [{ riskInputKind: "external-risk-event", spatialScopeRef }, true],
    [{ riskInputKind: "external-risk-event" }, false],
    [{ riskInputKind: "external-risk-event", spatialScopeRef, projectRevisionRef }, false],
  ])("外部事件候选要求空间，风险记录可选空间 %#", (payload, accepted) => {
    expect(
      RiskAssessmentReadQueryV1Schema.safeParse(
        query("read", "risk-assessment.read", { operation: "pending-catalog", ...payload }),
      ).success,
    ).toBe(accepted);
  });

  it("入口组合保留独立游标及合法长工程标识", () => {
    const value = query("read", "risk-assessment.read", {
      operation: "entry-context",
      projectRevisionRef: ref("project-revision", "p".repeat(600)),
      spatialScopeRef,
      applicabilityCursor: "applicability-cursor",
      externalEventCursor: "external-cursor",
      pageSize: 50,
    });
    expect(RiskAssessmentReadQueryV1Schema.safeParse(value).success).toBe(true);
    expect(
      RiskAssessmentReadQueryV1Schema.safeParse({
        ...value,
        payload: { ...value.payload, pageSize: 51 },
      }).success,
    ).toBe(false);
  });

  it("目录结果保持 512 字符游标上限", () => {
    const result = { kind: "external-event-catalog", items: [], nextCursor: "c".repeat(512) };
    expect(
      AssessmentEntryContextReadResultV1Schema.safeParse({ kind: "succeeded", result }).success,
    ).toBe(true);
    expect(
      AssessmentEntryContextReadResultV1Schema.safeParse({
        kind: "succeeded",
        result: { ...result, nextCursor: "c".repeat(513) },
      }).success,
    ).toBe(false);
  });

  it("来源定位复用原评估读授权，只接受空间且结果最多 256 项", () => {
    const input = query("read-assessment-entry-source-versions", "risk-assessment.read", {
      spatialScopeRef,
    });
    expect(AssessmentEntrySourceVersionsReadQueryV1Schema.safeParse(input).success).toBe(true);
    expect(
      AssessmentEntrySourceVersionsReadQueryV1Schema.safeParse({
        ...input,
        payload: { spatialScopeRef, sourceVersionRefs: [ref("source-version")] },
      }).success,
    ).toBe(false);
    for (const count of [0, 256, 257]) {
      expect(
        AssessmentEntrySourceVersionsReadResultV1Schema.safeParse({
          kind: "succeeded",
          result: {
            sourceVersionRefs: Array.from({ length: count }, (_, index) =>
              ref("source-version", `source-${index}`),
            ),
          },
        }).success,
      ).toBe(count <= 256);
    }
  });
});
