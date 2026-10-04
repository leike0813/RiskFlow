/**
 * IP-04 生产接缝夹具：在同一真实数据库上把两个 owning reader 组合起来，同时注入 C11 准备冻结
 * 与 C25 正式评估所消费的接缝。夹具只存在于测试：它不新建第二套存储、不复制 Schema，
 * 也不把记录、事件或事实以任何形式内联进生产代码。
 *
 * 组合后的 reader 满足 design D-01 的构造顺序：两个 owning factories 都只依赖 `runtime.db`、
 * C06 当前授权复验与 C04/C22 自身能力，彼此都不持有对方实例；组合根最后把它们合成一个
 * XOR reader，同一实例同时交给 C11 与 C25，因此不存在构造循环。
 */
import { c25ConfigurationDocuments } from "../../../core/test/risk-assessment/fixture.js";
import {
  createRiskInputFactsReader,
  type RiskInputFactsReaderV1,
} from "@riskflow/core/risk-assessment/engine";
import { createPostgresExternalRiskInputFactsReader } from "../../src/engineering-data/context-source/postgres-external-risk-input-facts-reader.js";
import { createPostgresStandardizedRiskInputFactsReader } from "../../src/identification/read/postgres-standardized-risk-input-facts-reader.js";
import { startRiskAssessmentEngineFixture, type RiskAssessmentEngineFixtureV1 } from "./fixture.js";

/** 标准记录 owning reader 投影的六个正式标量中参与评分的两个可能性指标来源。 */
const RECORD_FACT_MAPPINGS_V1 = [
  {
    mappingId: "mapping-possibility-document",
    targetIndicatorId: "indicator-possibility-1",
    origin: {
      kind: "source-field" as const,
      documentType: "standardized-risk-record",
      fieldPath: ["record", "modelConfidence"],
    },
    sourceUnit: "1",
    targetUnit: "1",
    conversion: { kind: "identity" as const },
  },
  {
    mappingId: "mapping-possibility-numeric",
    targetIndicatorId: "indicator-possibility-2",
    origin: {
      kind: "source-field" as const,
      documentType: "standardized-risk-record",
      fieldPath: ["compositeConfidence", "value"],
    },
    sourceUnit: "1",
    targetUnit: "1",
    conversion: { kind: "identity" as const },
  },
];

/** 外部事件分支的等价映射：来源文档由外部事件正文自己声明，形状与标准记录分支对齐。 */
const EVENT_FACT_MAPPINGS_V1 = [
  {
    mappingId: "mapping-possibility-document",
    targetIndicatorId: "indicator-possibility-1",
    origin: {
      kind: "source-field" as const,
      documentType: "external-risk-event",
      fieldPath: ["probability", "modelConfidence"],
    },
    sourceUnit: "1",
    targetUnit: "1",
    conversion: { kind: "identity" as const },
  },
  {
    mappingId: "mapping-possibility-numeric",
    targetIndicatorId: "indicator-possibility-2",
    origin: {
      kind: "source-field" as const,
      documentType: "external-risk-event",
      fieldPath: ["probability", "compositeConfidence"],
    },
    sourceUnit: "1",
    targetUnit: "1",
    conversion: { kind: "identity" as const },
  },
];

/**
 * 指标体系与字段映射是甲方审核的业务配置：合成配置的来源字段指向外部文档类型，因此这里按
 * 风险输入的实际形状提供相容映射，而不是改动引擎的取值规则或 standard risk record 投影。
 * 监测类映射原样保留——后果指标的值只能来自真实监测，不允许被来源字段映射顶替。
 */
const configurationDocumentsFor = (mappings: readonly unknown[]): Record<string, unknown> => {
  const base = c25ConfigurationDocuments() as Record<
    string,
    { content: { mappings?: readonly { origin: { kind: string } }[] } }
  >;
  const fieldMapping = base["indicator-field-mapping"];
  const current = fieldMapping?.content.mappings;
  if (fieldMapping === undefined || current === undefined) {
    throw new Error("合成配置缺少 indicator-field-mapping 映射");
  }
  return {
    ...base,
    "indicator-field-mapping": {
      ...fieldMapping,
      content: {
        mappings: [
          ...current.filter((mapping) => mapping.origin.kind !== "source-field"),
          ...mappings,
        ],
      },
    },
  };
};

export interface ProductionAssessmentSeamsFixtureV1 extends RiskAssessmentEngineFixtureV1 {
  /** 组合后的 XOR reader：标准化风险记录分支与外部风险事件分支各由其所有者实现。 */
  readonly riskInputFacts: RiskInputFactsReaderV1;
  readonly standardizedRiskRecordFacts: RiskInputFactsReaderV1;
  readonly externalRiskEventFacts: RiskInputFactsReaderV1;
  /** 重新安装组合 reader（会话被吊销后用于恢复证据链）。 */
  restoreProductionFactsReader(): void;
}

export const startProductionAssessmentSeamsFixture = async (
  options: {
    /**
     * 风险输入形状：决定指标体系字段映射指向标准记录六标量还是外部事件正文。
     * 缺省按标准化风险记录装配。
     */
    readonly riskInputShape?: "standardized-risk-record" | "external-risk-event";
  } = {},
): Promise<ProductionAssessmentSeamsFixtureV1> => {
  const shape = options.riskInputShape ?? "standardized-risk-record";
  const fixture = await startRiskAssessmentEngineFixture({
    configurationDocuments: configurationDocumentsFor(
      (shape === "external-risk-event" ? EVENT_FACT_MAPPINGS_V1 : RECORD_FACT_MAPPINGS_V1) as never,
    ) as never,
  });

  const standardizedRiskRecordFacts = createPostgresStandardizedRiskInputFactsReader({
    db: fixture.postgres.runtime.db,
    authorization: fixture.postgres.access,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
  const externalRiskEventFacts = createPostgresExternalRiskInputFactsReader({
    db: fixture.postgres.runtime.db,
    authorization: fixture.postgres.access,
    artifactStore: fixture.postgres.artifactStore,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
  });
  const riskInputFacts = createRiskInputFactsReader({
    standardizedRiskRecord: standardizedRiskRecordFacts,
    externalRiskEvent: externalRiskEventFacts,
  });

  // 组合根一次性安装：C11 准备冻结与 C25 正式评估消费同一 reader 实例。
  fixture.useFactsReader(riskInputFacts);

  return {
    ...fixture,
    riskInputFacts,
    standardizedRiskRecordFacts,
    externalRiskEventFacts,
    restoreProductionFactsReader() {
      fixture.useFactsReader(riskInputFacts);
    },
  };
};
