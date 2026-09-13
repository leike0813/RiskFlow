import { Workbook } from "exceljs";
import { strToU8, zipSync } from "fflate";

import {
  AgentTaskDefinitionRegistry,
  buildCompletedAgentTaskResult,
  type AgentTaskSnapshotV1,
} from "@riskflow/core/agent-runtime";
import {
  ArtifactPutCommandV1Schema,
  ArtifactReadRequestV1Schema,
  type ArtifactRefV1,
} from "@riskflow/core/artifacts";
import {
  DataCleaningPolicyV1Schema,
  type DataCleaningPolicyV1,
} from "@riskflow/core/engineering-data/cleaning";
import {
  ParsedDocumentV1Schema,
  type DocumentInputKindV1,
} from "@riskflow/core/engineering-data/document-conversion";
import type { TransactionUnitV1 } from "@riskflow/core/persistence";
import type { VersionReference } from "@riskflow/contracts/common";
import type {
  AgentTaskRefV1,
  AgentTaskResultRefV1,
  AuthorizationContextV1,
  ContentArtifactRefV1,
  EngineeringDataCommandV1,
  EngineeringFreezeCommandV1,
  EngineeringFreezeResultV1,
  MonitoringBatchRefV1,
  MonitoringSeriesRefV1,
  ProjectRevisionRefV1,
  SourceSegmentSetRefV1,
  SourceVersionRefV1,
  SpatialScopeRefV1,
  StructuredDocumentConversionCommandV1,
  StructuredDocumentConversionRefV1,
} from "@riskflow/contracts/ports";
import {
  StartAgentTaskCommandV1Schema,
  StructuredDocumentConversionCommandV1Schema,
} from "@riskflow/contracts/ports";

import { PostgresAgentTaskAdapter } from "../../../src/agent-runtime/index.js";
import { bootstrapInitialSystemAdministrator } from "../../../src/auth/index.js";
import {
  createPostgresDataCleaningStore,
  type DataCleaningAgentTaskStartRequestV1,
  type PostgresDataCleaningStore,
} from "../../../src/engineering-data/cleaning/postgres-data-cleaning-store.js";
import {
  StructuredDocumentConversionAdapter,
  type OcrLayoutParserV1,
} from "../../../src/engineering-data/document-conversion/structured-document-converter.js";
import {
  startEngineeringContextSourceFixture,
  type EngineeringContextSourcePostgresFixture,
} from "../context-source/fixture.js";

export const CLEANING_TEST_TIMESTAMP = "2030-01-01T00:00:00.000Z";

const ref = (entityId: string, versionId = "1"): VersionReference => ({ entityId, versionId });

export const cleaningTimestamp = (seconds: number): string =>
  new Date(Date.parse(CLEANING_TEST_TIMESTAMP) + seconds * 1_000).toISOString();
const at = cleaningTimestamp;

/**
 * The C12 adapter rejects any conversion whose `conversionPolicyRef` differs from the resource
 * policy it was constructed with, so every fixture conversion carries this single ref.
 */
export const CLEANING_CONVERSION_POLICY_REF = ref("document-conversion-policy");
export const CLEANING_QUALITY_POLICY_REF = ref("c15-quality-policy");
export const CLEANING_CONVERTER_DEPLOYMENT_REF = ref("c15-converter");
export const CLEANING_DATA_PROCESSING_POLICY_REF = ref("c15-data-processing-policy");
export const CLEANING_BUDGET_POLICY_REF = ref("c15-cleaning-budget");

const DOCX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const NDJSON_MEDIA_TYPE = "application/x-ndjson";
const UPLOAD_CAPABILITY = "engineering-data.write" as const;

// --------------------------------------------------------------- document inputs

const docxContent = (): Uint8Array =>
  zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
    "_rels/.rels": strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
        <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Shield tunnel construction plan</w:t></w:r></w:p>
        <w:p><w:r><w:t>Settlement monitoring runs once per day.</w:t></w:r></w:p>
        <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Monitoring item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Limit value</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      </w:body></w:document>`,
    ),
  });

/** Minimal single-page PDF with a real text layer; byte offsets are computed, never guessed. */
const textPdfContent = (text: string): Uint8Array => {
  const content = `BT\n/F1 12 Tf\n72 120 Td\n(${text}) Tj\nET`;
  const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
};

const xlsxContent = async (): Promise<Uint8Array> => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet("settlement");
  sheet.addRow(["indicator", "value"]);
  sheet.addRow(["settlement", { formula: "1+1", result: 2 }]);
  sheet.addRow(["rate", 1.2]);
  return new Uint8Array(await workbook.xlsx.writeBuffer());
};

const csvContent = (): Uint8Array => strToU8("indicator,value\nsettlement,12.5\n");

const ocrContent = (): Uint8Array =>
  strToU8(
    JSON.stringify({
      schemaVersion: "1",
      mediaType: "application/vnd.riskflow.ocr-layout+json",
      pages: [{ pageNumber: 1, width: 640, height: 480 }],
      regions: [{ regionId: "r1", kind: "paragraph", text: "Settlement record 12.5" }],
    }),
  );

export interface CleaningDocumentInputV1 {
  readonly inputKind: DocumentInputKindV1;
  readonly mediaType: string;
  readonly content: Uint8Array;
}

/** The four native document inputs plus one OCR-compatible input, in freeze order. */
export const cleaningDocumentInputs = async (): Promise<readonly CleaningDocumentInputV1[]> => [
  { inputKind: "docx", mediaType: DOCX_MEDIA_TYPE, content: docxContent() },
  {
    inputKind: "text-pdf",
    mediaType: "application/pdf",
    content: textPdfContent("C15 cleaning fixture settlement record"),
  },
  { inputKind: "xlsx", mediaType: XLSX_MEDIA_TYPE, content: await xlsxContent() },
  { inputKind: "csv", mediaType: "text/csv", content: csvContent() },
  { inputKind: "ocr-layout", mediaType: "application/json", content: ocrContent() },
];

// ------------------------------------------------------------------- C15 policy

const cleaningBudgetPolicy = () => ({
  schemaVersion: "1" as const,
  policyRef: CLEANING_BUDGET_POLICY_REF,
  modelDeploymentRef: ref("c15-cleaning-model"),
  promptTemplateRef: ref("c15-cleaning-prompt"),
  toolPolicyRef: ref("c15-cleaning-tools"),
  maxModelInvocations: 4,
  maxToolInvocations: 8,
  maxContextTokens: 4_096,
  maxInputBytes: 262_144,
  maxOutputBytes: 262_144,
  maxCandidates: 2,
  maxObjects: 32,
  maxSupplementarySearches: 2,
  maxCorrections: 2,
  maxTransientRetries: 1,
  maxConcurrentActions: 1,
  maxWallClockMs: 600_000,
});

export interface CleaningPolicyOverridesV1 {
  readonly policyRef?: VersionReference;
  readonly allowedConversionPolicyRefs?: readonly VersionReference[];
  readonly allowedQualityPolicyRefs?: readonly VersionReference[];
  readonly allowedConverterDeploymentRefs?: readonly VersionReference[];
  readonly allowedExclusionReasonCodes?: readonly string[];
  readonly protectedSegmentKinds?: readonly string[];
  readonly requiredSegmentKinds?: readonly string[];
  readonly protectedMonitoringSelectionReasons?: readonly string[];
  readonly minimumRetainedSegmentRatio?: number;
  readonly minimumRetainedSampleRatio?: number;
  readonly minimumDocumentCoverageRatio?: number;
  readonly monitoring?:
    | {
        readonly monitoringSeriesRef: MonitoringSeriesRefV1;
        readonly availabilityPolicyRef: VersionReference;
      }
    | undefined;
  readonly tools?: Record<string, unknown>;
  readonly agent?: Record<string, unknown>;
}

/**
 * C15 policy whose allowed refs are exactly the refs the fixture conversions write.
 * `requiredSegmentKinds` defaults to the one segment kind every non-PDF document produces.
 */
export const cleaningPolicy = (overrides: CleaningPolicyOverridesV1 = {}): DataCleaningPolicyV1 =>
  DataCleaningPolicyV1Schema.parse({
    schemaVersion: "1",
    policyRef: CLEANING_DATA_PROCESSING_POLICY_REF,
    allowedConversionPolicyRefs: [CLEANING_CONVERSION_POLICY_REF],
    allowedQualityPolicyRefs: [CLEANING_QUALITY_POLICY_REF],
    allowedConverterDeploymentRefs: [CLEANING_CONVERTER_DEPLOYMENT_REF],
    allowedExclusionReasonCodes: ["c15-manual-exclusion"],
    protectedSegmentKinds: ["table"],
    requiredSegmentKinds: ["table"],
    protectedMonitoringSelectionReasons: ["latest-valid", "correction"],
    minimumRetainedSegmentRatio: 0.5,
    minimumRetainedSampleRatio: 0.5,
    minimumDocumentCoverageRatio: 0.5,
    tools: {
      documentSegmentToolRef: ref("c15-document-segment-tool"),
      monitoringSnapshotToolRef: ref("c15-monitoring-snapshot-tool"),
      maxSegmentsPerRead: 2,
      maxMonitoringItemsPerRead: 2,
    },
    agent: {
      definitionRef: ref("c15-cleaning-definition"),
      modelDeploymentRef: ref("c15-cleaning-model"),
      promptTemplateRef: ref("c15-cleaning-prompt"),
      toolPolicyRef: ref("c15-cleaning-tools"),
      budgetPolicyRef: CLEANING_BUDGET_POLICY_REF,
      incrementSchemaRef: ref("c15-cleaning-increment"),
      validationPolicyRef: ref("c15-cleaning-validation"),
      budgetPolicy: cleaningBudgetPolicy(),
    },
    ...overrides,
  });

// -------------------------------------------------------------- conversion seam

/**
 * Public C12 parser seam for `ocr-layout`: this environment has no PaddleX deployment wired,
 * so the fixture returns a parsed document expressed purely in the published C12 schema and
 * lets the real adapter normalize, register segments and persist the conversion record.
 */
const ocrLayoutParser = (): OcrLayoutParserV1 => ({
  async parse({ command, source, bytes }) {
    const parsedDocument = ParsedDocumentV1Schema.parse({
      schemaVersion: "1",
      inputKind: "ocr-layout",
      sourceVersionRef: source.sourceVersionRef,
      sourceArtifactRef: source.sourceArtifactRef,
      sourceId: source.sourceId,
      spatialScopeRefs: source.spatialScopeRefs,
      metadata: {
        projectId: source.projectId,
        sourceId: source.sourceId,
        sourceItemId: source.sourceItemId,
        mediaType: command.mediaType,
      },
      blocks: [
        {
          blockId: "ocr-heading-1",
          kind: "heading",
          text: "Scanned settlement record",
          headingPath: ["Scanned settlement record"],
          locator: {
            kind: "document",
            pageNumber: 1,
            headingPath: ["Scanned settlement record"],
          },
          chapterId: "ocr_chapter_1",
          segmentId: "ocr_segment_1",
        },
        {
          blockId: "ocr-table-1",
          kind: "table",
          text: "",
          headingPath: ["Scanned settlement record"],
          locator: {
            kind: "table",
            sheet: "ocr",
            table: "ocr_table_1",
            rowRange: { start: 1, end: 1 },
            columnRange: { start: 1, end: 1 },
          },
          tableId: "ocr_table_1",
          sheet: "ocr",
          chapterId: "ocr_table_1",
          segmentId: "ocr_table_1",
        },
        {
          blockId: "ocr-cell-1",
          kind: "cell",
          text: "12.5",
          value: 12.5,
          headingPath: ["Scanned settlement record"],
          locator: {
            kind: "table",
            sheet: "ocr",
            table: "ocr_table_1",
            rowRange: { start: 1, end: 1 },
            columnRange: { start: 1, end: 1 },
          },
          coordinate: {
            kind: "cell",
            sheet: "ocr",
            row: 1,
            column: 1,
            rowSpan: 1,
            columnSpan: 1,
          },
          tableId: "ocr_table_1",
          sheet: "ocr",
          row: 1,
          column: 1,
          rowSpan: 1,
          columnSpan: 1,
          chapterId: "ocr_table_1",
          segmentId: "ocr_table_1",
          confidence: 0.93,
        },
      ],
      inputBytes: bytes.byteLength,
    });
    return {
      parsedDocument,
      additionalParentArtifactRefs: [],
      additionalEvidenceReferences: [],
      diagnostic: { parser: "c15-fixture-ocr-layout", outputBytes: bytes.byteLength },
    };
  },
});

// ------------------------------------------------------------------ fixture API

export interface CleaningPipelineV1 {
  readonly policy: DataCleaningPolicyV1;
  readonly store: PostgresDataCleaningStore;
  readonly agentTaskAdapter: PostgresAgentTaskAdapter;
}

export interface ConvertedCleaningDocumentV1 {
  readonly inputKind: DocumentInputKindV1;
  readonly mediaType: string;
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly conversionRef: StructuredDocumentConversionRefV1;
  readonly jsonLdArtifactRef: ContentArtifactRefV1;
  readonly sourceSegmentSetRef: SourceSegmentSetRefV1;
  readonly conversionCommand: StructuredDocumentConversionCommandV1;
}

export interface CleaningMonitoringSetV1 {
  readonly seriesRef: MonitoringSeriesRefV1;
  readonly availabilityPolicyRef: VersionReference;
  readonly monitoringBatchRef: MonitoringBatchRefV1;
  readonly sourceVersionRef: SourceVersionRefV1;
  readonly sourceSegmentSetRef: SourceSegmentSetRefV1;
  readonly samples: readonly {
    readonly sourceSampleKey: string;
    readonly sampledAt: string;
    readonly value: number;
    readonly unit: string;
    readonly canonicalValue: number;
    readonly canonicalUnit: string;
    readonly sourceSegmentId: string;
  }[];
}

export interface CleaningWorldOptionsV1 {
  readonly suffix: string;
  readonly documentKinds?: readonly DocumentInputKindV1[];
  /** Overrides the shared synthetic document set (used by C19's real-standard source). */
  readonly documents?: readonly CleaningDocumentInputV1[];
  readonly monitoring?: boolean;
  /** Input kinds whose delivery is registered but whose C12 conversion is never run. */
  readonly unconverted?: readonly DocumentInputKindV1[];
  /** Input kinds that additionally receive a second conversion record for the same version. */
  readonly duplicateConversions?: readonly DocumentInputKindV1[];
}

export interface CleaningWorldV1 {
  readonly projectId: string;
  readonly projectRevisionRef: ProjectRevisionRefV1;
  readonly spatialScopeRef: SpatialScopeRefV1;
  readonly applicabilitySnapshotRef: {
    readonly kind: "applicability-metadata-snapshot";
    readonly reference: VersionReference;
  };
  readonly documents: readonly ConvertedCleaningDocumentV1[];
  readonly monitoring: CleaningMonitoringSetV1 | undefined;
  readonly uploaderId: string;
  readonly freezerId: string;
  /** Store, task adapter and policy bound to this world's monitoring series. */
  readonly pipeline: CleaningPipelineV1;
  policy(overrides?: CleaningPolicyOverridesV1): DataCleaningPolicyV1;
  sourceVersionRefs(): readonly SourceVersionRefV1[];
  authorizeUploader(
    invocationId: string,
    branch:
      "engineering-data.register-source-delivery" | "engineering-data.register-monitoring-batch",
    sourceVersionRefs?: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationContextV1>;
  authorizeFreezer(
    invocationId: string,
    sourceVersionRefs?: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationContextV1>;
  /** 任意 C06 分支的真实会话授权（测试组合根用）。 */
  authorizeBranch(
    invocationId: string,
    branch:
      | "engineering-data.evidence-access"
      | "knowledge-modeling.assessment-basis"
      | "knowledge-modeling.submit-revision",
    sourceVersionRefs?: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationContextV1>;
  /** C15 精确准备与清洗结果读取接缝共用的 `engineering-data.evidence-access` 分支授权。 */
  authorizeEvidenceAccess(
    invocationId: string,
    sourceVersionRefs?: readonly SourceVersionRefV1[],
  ): Promise<AuthorizationContextV1>;
  freezeCommand(
    commandId: string,
    overrides?: {
      readonly policyRef?: VersionReference;
      readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
      readonly monitoringCutoff?: string | undefined;
      readonly projectRevisionRef?: ProjectRevisionRefV1;
      readonly actor?: "freezer" | "uploader";
    },
  ): Promise<Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>>;
}

export interface DataCleaningPostgresFixture {
  readonly postgres: EngineeringContextSourcePostgresFixture["postgres"];
  readonly rootDirectory: string;
  readonly runtime: EngineeringContextSourcePostgresFixture["runtime"];
  readonly transactionUnit: EngineeringContextSourcePostgresFixture["transactionUnit"];
  readonly artifactRegistry: EngineeringContextSourcePostgresFixture["artifactRegistry"];
  readonly artifactStore: EngineeringContextSourcePostgresFixture["artifactStore"];
  readonly access: EngineeringContextSourcePostgresFixture["access"];
  readonly registry: EngineeringContextSourcePostgresFixture["registry"];
  readonly monitoringStore: EngineeringContextSourcePostgresFixture["monitoringStore"];
  readonly administrationContextRef: {
    readonly kind: "authorization-context";
    readonly reference: VersionReference;
  };
  readonly policy: DataCleaningPolicyV1;
  readonly store: PostgresDataCleaningStore;
  readonly agentTaskAdapter: PostgresAgentTaskAdapter;
  /** Raw start-seam requests C15 handed to the composition, oldest first. */
  readonly recordedStartCommands: readonly DataCleaningAgentTaskStartRequestV1[];
  createPipeline(options?: {
    readonly policy?: DataCleaningPolicyV1;
    readonly transactionUnit?: TransactionUnitV1;
  }): CleaningPipelineV1;
  createWorld(options: CleaningWorldOptionsV1): Promise<CleaningWorldV1>;
  /**
   * The C08 `claim` scan is database-wide, so a test that drives one project's task first
   * retires every other active task instead of claiming a stranger's task.
   */
  quiesceOtherActiveTasks(projectId: string): Promise<void>;
  /** Copies an existing conversion row under a new conversion id (no C12 replay possible). */
  duplicateConversionRow(
    projectId: string,
    sourceConversionId: string,
    duplicateConversionId: string,
  ): Promise<void>;
  readArtifact(
    artifactRef: ArtifactRefV1,
    authorization: AuthorizationContextV1,
    purposeCode: string,
  ): Promise<unknown>;
  close(): Promise<void>;
}

export const startDataCleaningFixture = async (
  options: {
    readonly policy?: DataCleaningPolicyV1;
  } = {},
): Promise<DataCleaningPostgresFixture> => {
  const base = await startEngineeringContextSourceFixture({
    now: () => new Date(CLEANING_TEST_TIMESTAMP),
  });
  const policy = options.policy ?? cleaningPolicy();
  const admin = await bootstrapInitialSystemAdministrator({
    connection: base.postgres.migrator,
    loginName: "c15-admin",
    displayName: "C15 Administrator",
    password: "c15-admin-password",
    accountId: "c15-admin-account",
    now: () => new Date(CLEANING_TEST_TIMESTAMP),
  });
  if (admin.kind !== "account") throw new Error("C15 administrator bootstrap failed");
  const adminLogin = await base.access.login({
    kind: "login",
    loginAttemptId: "c15-admin-login",
    loginName: "c15-admin",
    password: "c15-admin-password",
  });
  const adminChanged = await base.access.changePassword({
    kind: "change-password",
    sessionToken: adminLogin.sessionToken,
    newPassword: "c15-admin-password-changed",
  });
  const administrationContextRef = adminChanged.systemAdministrationContextRef;
  if (administrationContextRef === undefined)
    throw new Error("C15 administrator has no system administration context");

  const createManager = async (loginName: string) => {
    const created = await base.access.administerIdentity({
      kind: "create-account",
      commandId: `c15-create-${loginName}`,
      idempotencyKey: `c15-create-${loginName}`,
      expectedVersion: "none",
      authorizationContextRef: administrationContextRef,
      loginName,
      displayName: loginName,
      password: `${loginName}-password`,
    });
    if (created.kind !== "account") throw new Error(`C15 account ${loginName} was not created`);
    const login = await base.access.login({
      kind: "login",
      loginAttemptId: `${loginName}-login`,
      loginName,
      password: `${loginName}-password`,
    });
    const changed = await base.access.changePassword({
      kind: "change-password",
      sessionToken: login.sessionToken,
      newPassword: `${loginName}-password-changed`,
    });
    return { accountId: created.resultRef.entityId, sessionToken: changed.sessionToken };
  };

  const uploader = await createManager("c15-uploader");
  const freezer = await createManager("c15-freezer");
  /** 启动接缝的受信调用来源：按启动命令的 actor 取该成员的 C06 会话，token 不出现在接缝输入里。 */
  const sessionTokenFor = (accountId: string): string | undefined =>
    [uploader, freezer].find((member) => member.accountId === accountId)?.sessionToken;

  const recordedStartCommands: DataCleaningAgentTaskStartRequestV1[] = [];
  const createAgentTaskAdapter = (values: {
    readonly store: PostgresDataCleaningStore;
    readonly transactionUnit: TransactionUnitV1;
  }) =>
    new PostgresAgentTaskAdapter({
      db: base.runtime.db,
      registry: new AgentTaskDefinitionRegistry([values.store.createTaskDefinition()]),
      transactionUnit: values.transactionUnit,
      referenceGuard: base.artifactRegistry,
      artifactStore: base.artifactStore,
      // C08 必须用同一个 C06 verifier 在创建和执行时复验授权，否则冻结上下文无从校验。
      authorization: base.access,
      now: () => CLEANING_TEST_TIMESTAMP,
    });

  const createPipeline = (
    pipelineOptions: {
      readonly policy?: DataCleaningPolicyV1;
      readonly transactionUnit?: TransactionUnitV1;
    } = {},
  ): CleaningPipelineV1 => {
    const pipelinePolicy = pipelineOptions.policy ?? policy;
    const transactionUnit = pipelineOptions.transactionUnit ?? base.transactionUnit;
    const holder: { adapter?: PostgresAgentTaskAdapter } = {};
    const pipelineStore = createPostgresDataCleaningStore({
      db: base.runtime.db,
      transactionUnit,
      access: base.access,
      artifactStore: base.artifactStore,
      artifactReferenceGuard: base.artifactRegistry,
      monitoringStore: base.monitoringStore,
      // 生产组合根（apps/worker/src/engineering-data/cleaning/composition.ts）按 D-13 用服务端
      // 受信来源经 C06 的 `agent-task.start-task` exact branch 签发独立上下文；这里用同一个
      // C06 会话授权和同一个 C08 adapter 走同一条路径，不再扩写冻结命令的 capability。
      startAgentTask: async (request) => {
        recordedStartCommands.push(request);
        const sessionToken = sessionTokenFor(request.command.actorId);
        if (sessionToken === undefined)
          throw new Error("the C15 fixture has no C06 session for the start actor");
        const decision = await base.access.authorize({
          invocation: { kind: "human-session", sessionToken },
          invocationId: request.command.commandId,
          projectId: request.command.projectId,
          branch: "agent-task.start-task",
          requestedSpatialScopeRefs: [...request.requestedSpatialScopeRefs],
          requestedSourceVersionRefs: [...request.requestedSourceVersionRefs],
          requestedAt: request.command.issuedAt,
        });
        return holder.adapter!.startTask(
          StartAgentTaskCommandV1Schema.parse({
            ...request.command,
            authorization: decision.context,
          }),
        );
      },
      policy: pipelinePolicy,
      now: () => new Date(CLEANING_TEST_TIMESTAMP),
    });
    holder.adapter = createAgentTaskAdapter({ store: pipelineStore, transactionUnit });
    return {
      policy: pipelinePolicy,
      store: pipelineStore,
      agentTaskAdapter: holder.adapter,
    };
  };

  const defaultPipeline = createPipeline();
  let artifactReadSequence = 0;

  const createWorld = async (worldOptions: CleaningWorldOptionsV1): Promise<CleaningWorldV1> => {
    const suffix = worldOptions.suffix;
    const projectId = `project-c15-${suffix}`;
    const now = CLEANING_TEST_TIMESTAMP;
    const seriesRef: MonitoringSeriesRefV1 = {
      kind: "monitoring-series",
      reference: ref(`c15-monitoring-series-${suffix}`),
    };
    const availabilityPolicyRef = ref(`c15-monitoring-availability-${suffix}`);
    const opened = await base.access.administerProject({
      kind: "open-project",
      projectId,
      commandId: `c15-open-${suffix}`,
      idempotencyKey: `c15-open-${suffix}`,
      expectedVersion: "none",
      authorizationContextRef: administrationContextRef,
      initialRiskManagerAccountId: uploader.accountId,
    });
    if (opened.kind !== "project")
      throw new Error(`C15 open project failed for ${suffix}: ${JSON.stringify(opened)}`);
    const root = await base.postgres.adminPool.query<{ scope_id: string; revision_id: string }>(
      "SELECT scope_id, current_revision_id AS revision_id FROM business.access_spatial_scopes WHERE project_id = $1",
      [projectId],
    );
    const rootScopeRef: SpatialScopeRefV1 = {
      kind: "spatial-scope",
      reference: { entityId: root.rows[0]!.scope_id, versionId: root.rows[0]!.revision_id },
    };
    const membership = await base.access.administerProject({
      kind: "revise-membership",
      projectId,
      commandId: `c15-member-${suffix}`,
      idempotencyKey: `c15-member-${suffix}`,
      expectedVersion: "none",
      authorizationContextRef: administrationContextRef,
      membershipId: `membership-${suffix}`,
      accountId: freezer.accountId,
      roles: ["project-risk-manager"],
      spatialScopeRefs: [rootScopeRef],
      status: "active",
    });
    if (membership.kind !== "membership")
      throw new Error(`C15 membership failed for ${suffix}: ${JSON.stringify(membership)}`);

    const authorizeFor = async (
      credential: { readonly accountId: string; readonly sessionToken: string },
      invocationId: string,
      branch:
        | "engineering-data.register-source-delivery"
        | "engineering-data.register-monitoring-batch"
        | "engineering-data.identification-preparation"
        | "engineering-data.evidence-access",
      spatialScopeRefs: readonly SpatialScopeRefV1[],
      sourceVersionRefs: readonly SourceVersionRefV1[],
    ) =>
      (
        await base.access.authorize({
          invocation: { kind: "human-session", sessionToken: credential.sessionToken },
          invocationId,
          projectId,
          branch,
          requestedSpatialScopeRefs: [...spatialScopeRefs],
          requestedSourceVersionRefs: [...sourceVersionRefs],
        })
      ).context;

    const projectCommandId = `c15-project-${suffix}`;
    const projectAuthorization = await authorizeFor(
      uploader,
      projectCommandId,
      "engineering-data.register-source-delivery",
      [rootScopeRef],
      [],
    );
    const projectResult = await base.registry.reviseContext({
      commandId: projectCommandId,
      idempotencyKey: projectCommandId,
      projectId,
      actorId: uploader.accountId,
      issuedAt: now,
      authorization: projectAuthorization,
      kind: "project",
      expectedVersion: "none",
      name: `C15 ${suffix}`,
      lifecycle: "preparing",
      applicabilityMetadata: {
        constructionMethod: "variable-diameter-shield",
        stratumCondition: "soft-soil",
        engineeringStage: "expansion-preparation",
      },
      effectivePeriod: { validFrom: now },
    });
    if (projectResult.kind !== "succeeded" || projectResult.result.kind !== "project-revision")
      throw new Error(`C15 project context failed for ${suffix}: ${JSON.stringify(projectResult)}`);
    const projectRevisionRef = projectResult.result.revision.projectRevisionRef;
    const spatialCommandId = `c15-spatial-${suffix}`;
    const spatialAuthorization = await authorizeFor(
      uploader,
      spatialCommandId,
      "engineering-data.register-source-delivery",
      [rootScopeRef],
      [],
    );
    const spatialResult = await base.registry.reviseContext({
      commandId: spatialCommandId,
      idempotencyKey: spatialCommandId,
      projectId,
      actorId: uploader.accountId,
      issuedAt: now,
      authorization: spatialAuthorization,
      kind: "spatial",
      spatialScopeRef: rootScopeRef,
      projectRevisionRef,
      expectedVersion: "none",
      name: `C15 ${suffix} scope`,
      worksiteLocation: "left line",
      applicabilityOverrides: {},
      status: "active",
      effectivePeriod: { validFrom: now },
    });
    if (spatialResult.kind !== "succeeded" || spatialResult.result.kind !== "spatial-revision")
      throw new Error(`C15 spatial context failed for ${suffix}: ${JSON.stringify(spatialResult)}`);
    const spatialScopeRef = spatialResult.result.revision.spatialScopeRef;
    const snapshotCommandId = `c15-applicability-${suffix}`;
    const snapshotAuthorization = await authorizeFor(
      uploader,
      snapshotCommandId,
      "engineering-data.register-source-delivery",
      [spatialScopeRef],
      [],
    );
    const snapshotResult = await base.registry.createApplicabilitySnapshot({
      commandId: snapshotCommandId,
      idempotencyKey: snapshotCommandId,
      projectId,
      actorId: uploader.accountId,
      issuedAt: now,
      authorization: snapshotAuthorization,
      projectRevisionRef,
      spatialScopeRef,
      formedAt: now,
    });
    if (
      snapshotResult.kind !== "succeeded" ||
      snapshotResult.result.kind !== "applicability-snapshot"
    )
      throw new Error(
        `C15 applicability snapshot failed for ${suffix}: ${JSON.stringify(snapshotResult)}`,
      );

    const put = async (
      artifactId: string,
      content: Uint8Array,
      mediaType: string,
      authorization: AuthorizationContextV1,
      requiredCapability: typeof UPLOAD_CAPABILITY | "engineering-data.freeze",
      purposeCode: string,
    ) =>
      base.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c15-put-${artifactId}`,
          idempotencyKey: `c15-put-${artifactId}`,
          projectId,
          actorId: authorization.actorId,
          issuedAt: now,
          authorization,
          requiredCapability,
          artifactId: `c15-${artifactId}`,
          artifactKind: "content",
          purposeCode,
          mediaType,
          parentArtifactRefs: [],
          evidenceReferences: [],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield content;
        })(),
      );

    const converter = new StructuredDocumentConversionAdapter({
      db: base.runtime.db,
      transactionUnit: base.transactionUnit,
      contextSource: base.registry,
      artifactStore: base.artifactStore,
      qualityPolicyRef: CLEANING_QUALITY_POLICY_REF,
      converterDeploymentRef: CLEANING_CONVERTER_DEPLOYMENT_REF,
      ocrLayoutParser: ocrLayoutParser(),
      now: () => new Date(CLEANING_TEST_TIMESTAMP),
    });

    const availableDocuments = worldOptions.documents ?? (await cleaningDocumentInputs());
    const requestedKinds =
      worldOptions.documentKinds ?? availableDocuments.map((input) => input.inputKind);
    const inputs = availableDocuments.filter((input) => requestedKinds.includes(input.inputKind));
    const documents: ConvertedCleaningDocumentV1[] = [];
    const allSourceVersionRefs: SourceVersionRefV1[] = [];
    for (const input of inputs) {
      const deliveryCommandId = `c15-delivery-${suffix}-${input.inputKind}`;
      const deliveryAuthorization = await authorizeFor(
        uploader,
        deliveryCommandId,
        "engineering-data.register-source-delivery",
        [spatialScopeRef],
        [],
      );
      const sourceArtifact = await put(
        `source-${suffix}-${input.inputKind}`,
        input.content,
        input.mediaType,
        deliveryAuthorization,
        UPLOAD_CAPABILITY,
        "engineering-data.register-source-delivery",
      );
      const metadataArtifact = await put(
        `metadata-${suffix}-${input.inputKind}`,
        strToU8(
          JSON.stringify({
            schemaVersion: "1",
            projectRevisionRef,
            spatialScopeRefs: [spatialScopeRef],
            registeredByAccountId: uploader.accountId,
            sourceItemId: `c15-source-item-${suffix}-${input.inputKind}`,
            sourceItemName: `C15 ${input.inputKind} source`,
            sourceCategory: "engineering-document",
            sourceMetadata: {
              documentType: input.inputKind,
              formedAt: now,
              sourceOrganization: "owner",
            },
            descriptor: { kind: "file-upload", contentFingerprint: input.inputKind },
            applicabilityMetadataSnapshotRef: snapshotResult.result.snapshot.snapshotRef,
          }),
        ),
        "application/json",
        deliveryAuthorization,
        UPLOAD_CAPABILITY,
        "engineering-data.register-source-delivery",
      );
      const delivery = await base.registry.apply({
        commandId: deliveryCommandId,
        idempotencyKey: deliveryCommandId,
        projectId,
        actorId: uploader.accountId,
        issuedAt: now,
        authorization: deliveryAuthorization,
        kind: "register-source-delivery",
        payload: {
          sourceConnectionRef: ref("file-upload"),
          deliveryKey: deliveryCommandId,
          sourceArtifactRef: sourceArtifact.artifactRef,
          metadataArtifactRef: metadataArtifact.artifactRef,
          occurredAt: now,
        },
      } satisfies Extract<EngineeringDataCommandV1, { kind: "register-source-delivery" }>);
      if (delivery.kind !== "succeeded" || delivery.result.kind !== "register-source-delivery")
        throw new Error(
          `C15 source delivery failed for ${suffix}/${input.inputKind}: ${JSON.stringify(delivery)}`,
        );
      const sourceVersionRef = delivery.result.sourceVersionRef;
      allSourceVersionRefs.push(sourceVersionRef);
      if (worldOptions.unconverted?.includes(input.inputKind) === true) continue;
      const conversionId = `c15-conversion-${suffix}-${input.inputKind}`;
      const conversionAuthorization = await authorizeFor(
        uploader,
        conversionId,
        "engineering-data.register-source-delivery",
        [spatialScopeRef],
        [sourceVersionRef],
      );
      const conversionCommand = StructuredDocumentConversionCommandV1Schema.parse({
        schemaVersion: "1",
        conversionId,
        idempotencyKey: conversionId,
        runId: `c15-run-${suffix}`,
        threadId: `c15-thread-${suffix}`,
        issuedAt: now,
        deadlineAt: at(3_600),
        projectId,
        actorId: uploader.accountId,
        authorization: conversionAuthorization,
        sourceVersionRef,
        sourceArtifactRef: sourceArtifact.artifactRef,
        mediaType: input.mediaType,
        input: { kind: input.inputKind },
        conversionPolicyRef: CLEANING_CONVERSION_POLICY_REF,
        qualityPolicyRef: CLEANING_QUALITY_POLICY_REF,
        converterDeploymentRef: CLEANING_CONVERTER_DEPLOYMENT_REF,
      } satisfies StructuredDocumentConversionCommandV1);
      const conversion = await converter.convert(conversionCommand);
      if (conversion.kind !== "succeeded")
        throw new Error(
          `C15 conversion failed for ${suffix}/${input.inputKind}: ${JSON.stringify(conversion)}`,
        );
      documents.push({
        inputKind: input.inputKind,
        mediaType: input.mediaType,
        sourceVersionRef,
        conversionRef: conversion.result.conversionRef,
        jsonLdArtifactRef: conversion.result.jsonLdArtifactRef,
        sourceSegmentSetRef: conversion.result.sourceSegmentSetRef,
        conversionCommand,
      });
    }

    const segmentRowsFor = async (document: ConvertedCleaningDocumentV1) =>
      (
        await base.postgres.adminPool.query<{ source_segment_id: string; kind: string }>(
          "SELECT source_segment_id, kind FROM business.source_segments WHERE project_id = $1 AND source_version_id = $2 ORDER BY source_segment_id",
          [projectId, document.sourceVersionRef.reference.entityId],
        )
      ).rows;

    let monitoring: CleaningMonitoringSetV1 | undefined;
    if (worldOptions.monitoring !== false && documents.length > 0) {
      const monitoringDocument = documents.at(-1)!;
      const seriesCommandId = `c15-series-${suffix}`;
      const revision = await base.monitoringStore.reviseSeries({
        commandId: seriesCommandId,
        idempotencyKey: seriesCommandId,
        projectId,
        actorId: uploader.accountId,
        issuedAt: now,
        authorization: await authorizeFor(
          uploader,
          seriesCommandId,
          "engineering-data.register-monitoring-batch",
          [spatialScopeRef],
          [],
        ),
        monitoringSeriesRef: seriesRef,
        expectedVersion: "none",
        projectRevisionRef,
        spatialScopeRef,
        monitoringObject: "settlement sensor",
        monitoringIndicator: "地表沉降",
        parameterCode: "settlement",
        canonicalUnit: "mm",
        unitConversions: [{ fromUnit: "cm", scale: 10, offset: 0 }],
        effectivePeriod: { validFrom: now },
      });
      if (revision.kind !== "succeeded")
        throw new Error(`C15 monitoring series failed for ${suffix}: ${JSON.stringify(revision)}`);
      const policyCommandId = `c15-availability-${suffix}`;
      const policyResult = await base.monitoringStore.registerAvailabilityPolicy({
        commandId: policyCommandId,
        idempotencyKey: policyCommandId,
        projectId,
        actorId: uploader.accountId,
        issuedAt: now,
        authorization: await authorizeFor(
          uploader,
          policyCommandId,
          "engineering-data.register-monitoring-batch",
          [spatialScopeRef],
          [],
        ),
        policy: {
          availabilityPolicyRef,
          projectId,
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
            alignment: "a1",
            slope: "s1",
            acceleration: "g1",
            frequency: "f1",
            anomaly: "n1",
          },
          recordedAt: now,
          audit: { actorId: uploader.accountId, action: policyCommandId, recordedAt: now },
        },
      });
      if (policyResult.kind !== "succeeded")
        throw new Error(
          `C15 monitoring availability policy failed for ${suffix}: ${JSON.stringify(policyResult)}`,
        );
      const segments = await segmentRowsFor(monitoringDocument);
      const evidenceSegmentId =
        segments.find((segment) => segment.kind === "table")?.source_segment_id ??
        segments[0]!.source_segment_id;
      const samples = [
        { second: 5, centimetres: 1.5 },
        { second: 6, centimetres: 1.6 },
        { second: 7, centimetres: 1.7 },
        { second: 8, centimetres: 1.8 },
        { second: 9, centimetres: 1.9 },
      ].map((sample) => ({
        sourceSampleKey: `sample-${sample.second}`,
        sampledAt: at(sample.second),
        value: sample.centimetres,
        unit: "cm",
        canonicalValue: sample.centimetres * 10,
        canonicalUnit: "mm",
        sourceSegmentId: evidenceSegmentId,
      }));
      const evidence = {
        locator: { sourceSegmentId: evidenceSegmentId },
        sourceVersion: monitoringDocument.sourceVersionRef.reference,
      };
      const sampleLines = [
        JSON.stringify({
          schemaVersion: "1",
          mediaType: NDJSON_MEDIA_TYPE,
          monitoringSeriesRef: seriesRef,
          projectRevisionRef,
          spatialScopeRef,
          sourceVersionRef: monitoringDocument.sourceVersionRef,
          sourceSegmentSetRef: monitoringDocument.sourceSegmentSetRef,
          productionStrategyRef: ref("c15-monitoring-production"),
          sampleCount: samples.length,
        }),
        ...samples.map((sample) =>
          JSON.stringify({
            sourceSampleKey: sample.sourceSampleKey,
            sampledAt: sample.sampledAt,
            value: sample.value,
            unit: sample.unit,
            evidenceReferences: [evidence],
          }),
        ),
      ].join("\n");
      const batchCommandId = `c15-batch-${suffix}`;
      const batchAuthorization = await authorizeFor(
        uploader,
        batchCommandId,
        "engineering-data.register-monitoring-batch",
        [spatialScopeRef],
        [monitoringDocument.sourceVersionRef],
      );
      const sampleArtifact = await base.artifactStore.put(
        ArtifactPutCommandV1Schema.parse({
          schemaVersion: "1",
          commandId: `c15-samples-put-${suffix}`,
          idempotencyKey: `c15-samples-put-${suffix}`,
          projectId,
          actorId: uploader.accountId,
          issuedAt: now,
          authorization: batchAuthorization,
          requiredCapability: UPLOAD_CAPABILITY,
          artifactId: `c15-samples-${suffix}`,
          artifactKind: "content",
          purposeCode: "engineering-data.register-monitoring-batch",
          mediaType: NDJSON_MEDIA_TYPE,
          parentArtifactRefs: [],
          evidenceReferences: [evidence],
          additionalSpatialScopeRefs: [],
          additionalSourceAccessGrantRefs: [],
        }),
        (async function* () {
          yield new TextEncoder().encode(sampleLines);
        })(),
      );
      const batch = await base.registry.apply({
        commandId: batchCommandId,
        idempotencyKey: batchCommandId,
        projectId,
        actorId: uploader.accountId,
        issuedAt: now,
        authorization: batchAuthorization,
        kind: "register-monitoring-batch",
        payload: {
          monitoringSeriesRef: seriesRef,
          deliveryKey: batchCommandId,
          sampleArtifactRef: sampleArtifact.artifactRef,
          window: { from: at(5), to: at(11) },
          relation: { kind: "original" },
        },
      } satisfies Extract<EngineeringDataCommandV1, { kind: "register-monitoring-batch" }>);
      if (batch.kind !== "succeeded" || batch.result.kind !== "register-monitoring-batch")
        throw new Error(`C15 monitoring batch failed for ${suffix}: ${JSON.stringify(batch)}`);
      monitoring = {
        seriesRef,
        availabilityPolicyRef,
        monitoringBatchRef: batch.result.monitoringBatchRef,
        sourceVersionRef: monitoringDocument.sourceVersionRef,
        sourceSegmentSetRef: monitoringDocument.sourceSegmentSetRef,
        samples,
      };
    }

    const worldPolicy = (overrides: CleaningPolicyOverridesV1 = {}): DataCleaningPolicyV1 =>
      cleaningPolicy({
        monitoring:
          monitoring === undefined
            ? undefined
            : {
                monitoringSeriesRef: monitoring.seriesRef,
                availabilityPolicyRef: monitoring.availabilityPolicyRef,
              },
        ...overrides,
      });

    const world: CleaningWorldV1 = {
      projectId,
      projectRevisionRef,
      spatialScopeRef,
      applicabilitySnapshotRef: snapshotResult.result.snapshot.snapshotRef,
      documents,
      monitoring,
      uploaderId: uploader.accountId,
      freezerId: freezer.accountId,
      pipeline: createPipeline({ policy: worldPolicy() }),
      policy: worldPolicy,
      sourceVersionRefs: () => allSourceVersionRefs,
      authorizeUploader: (invocationId, branch, sourceVersionRefs = []) =>
        authorizeFor(uploader, invocationId, branch, [spatialScopeRef], sourceVersionRefs),
      authorizeFreezer: (invocationId, sourceVersionRefs) =>
        authorizeFor(
          freezer,
          invocationId,
          "engineering-data.identification-preparation",
          [spatialScopeRef],
          sourceVersionRefs ?? allSourceVersionRefs,
        ),
      authorizeBranch: (invocationId, branch, sourceVersionRefs) =>
        authorizeFor(
          uploader,
          invocationId,
          branch,
          [spatialScopeRef],
          sourceVersionRefs ?? allSourceVersionRefs,
        ),
      authorizeEvidenceAccess: (invocationId, sourceVersionRefs) =>
        authorizeFor(
          uploader,
          invocationId,
          "engineering-data.evidence-access",
          [spatialScopeRef],
          sourceVersionRefs ?? allSourceVersionRefs,
        ),
      freezeCommand: async (commandId, overrides = {}) => {
        const actor = overrides.actor ?? "freezer";
        const sourceVersionRefs = overrides.sourceVersionRefs ?? world.sourceVersionRefs();
        const authorization =
          actor === "freezer"
            ? await world.authorizeFreezer(commandId, sourceVersionRefs)
            : await authorizeFor(
                uploader,
                commandId,
                "engineering-data.identification-preparation",
                [spatialScopeRef],
                sourceVersionRefs,
              );
        const monitoringCutoff =
          "monitoringCutoff" in overrides
            ? overrides.monitoringCutoff
            : monitoring === undefined
              ? undefined
              : at(10);
        return {
          commandId,
          idempotencyKey: commandId,
          projectId,
          actorId: actor === "freezer" ? freezer.accountId : uploader.accountId,
          issuedAt: now,
          authorization,
          kind: "identification-preparation",
          payload: {
            projectRevisionRef: overrides.projectRevisionRef ?? projectRevisionRef,
            spatialScopeRefs: [spatialScopeRef],
            sourceVersionRefs: [...sourceVersionRefs],
            dataProcessingPolicyRef: overrides.policyRef ?? worldPolicy().policyRef,
            ...(monitoringCutoff === undefined ? {} : { monitoringCutoff }),
          },
        } satisfies Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>;
      },
    };
    return world;
  };

  const quiesceOtherActiveTasks = async (projectId: string): Promise<void> => {
    await base.postgres.adminPool.query(
      `UPDATE business.agent_tasks
          SET status = 'cancelled', cancel_requested = true, updated_at = clock_timestamp()
        WHERE project_id <> $1 AND status IN ('pending', 'running', 'retryable-failure')`,
      [projectId],
    );
  };

  const duplicateConversionRow = async (
    projectId: string,
    sourceConversionId: string,
    duplicateConversionId: string,
  ): Promise<void> => {
    await base.postgres.adminPool.query(
      `INSERT INTO business.structured_document_conversions (
         schema_version, conversion_id, version_id, project_id, command_kind, source_version_ref,
         source_artifact_ref, input_kind, media_type, conversion_policy_ref, quality_policy_ref,
         converter_deployment_ref, parser_set_version, status, jsonld_artifact_ref,
         source_segment_set_ref, diagnostic_ref, authorization_policy_ref, command_id,
         idempotency_key, actor_id, run_id, thread_id, statistics, started_at, completed_at,
         audit_entry_id, created_at
       )
       SELECT schema_version, $3, version_id, project_id, command_kind, source_version_ref,
         source_artifact_ref, input_kind, media_type, conversion_policy_ref, quality_policy_ref,
         converter_deployment_ref, parser_set_version, status, jsonld_artifact_ref,
         source_segment_set_ref, diagnostic_ref, authorization_policy_ref, command_id, $3, actor_id,
         run_id, thread_id, statistics, started_at, completed_at, audit_entry_id,
         clock_timestamp()
         FROM business.structured_document_conversions
        WHERE project_id = $1 AND conversion_id = $2`,
      [projectId, sourceConversionId, duplicateConversionId],
    );
  };

  const readArtifact = async (
    artifactRef: ArtifactRefV1,
    authorization: AuthorizationContextV1,
    purposeCode: string,
  ): Promise<unknown> => {
    artifactReadSequence += 1;
    const requestKey = `${artifactRef.reference.entityId}:${purposeCode}:test-read-${artifactReadSequence}`;
    const handle = await base.artifactStore.open(
      ArtifactReadRequestV1Schema.parse({
        schemaVersion: "1",
        requestId: requestKey,
        idempotencyKey: requestKey,
        artifactRef,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        requestedAt: authorization.decidedAt,
        purposeCode,
        requiredCapability: authorization.grantedCapabilities[0],
        authorization,
      }),
    );
    const chunks: Uint8Array[] = [];
    for await (const chunk of handle.content) chunks.push(chunk);
    await handle.verified;
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body)) as unknown;
  };

  return {
    ...base,
    administrationContextRef,
    policy,
    store: defaultPipeline.store,
    agentTaskAdapter: defaultPipeline.agentTaskAdapter,
    recordedStartCommands,
    createPipeline,
    createWorld,
    quiesceOtherActiveTasks,
    duplicateConversionRow,
    readArtifact,
    close: base.close,
  };
};

// ------------------------------------------------------------- task driving

export interface CleaningTaskCompletionV1 {
  readonly taskRef: AgentTaskRefV1;
  readonly task: AgentTaskSnapshotV1;
  readonly resultRef: AgentTaskResultRefV1;
  readonly workerId: string;
  readonly leaseToken: string;
}

/**
 * Drives one C08 `data-cleaning` task to `completed` through the real execution store and the
 * real task definition ports, mirroring the accepted C08 adapter recipe and the worker shape:
 * the candidate that reaches `recordCandidate` carries the definition's validation result, so
 * every artifact purpose the C08 port asserts (agent-action-intent, agent-candidate,
 * agent-increment, agent-validation, agent-action-result) is exercised.
 */
export const completeCleaningTask = async (
  pipeline: CleaningPipelineV1,
  fixture: DataCleaningPostgresFixture,
  options: {
    readonly workerId: string;
    readonly projectId: string;
    readonly candidate?: {
      readonly candidateVersion?: number;
      readonly exclusions?: readonly unknown[];
      readonly observations?: readonly { observationCode: string; summaryText: string }[];
    };
    readonly claimAt?: string;
    /**
     * Skips the cleaning definition's `validateCandidate`/`finalizeCandidate` and completes the
     * task with the C08 contract's own completed-result helper, so the preparation tail can be
     * observed without the definition ports. Used to prove the store's bound-result gate.
     */
    readonly withoutDefinitionResult?: boolean;
  },
): Promise<CleaningTaskCompletionV1> => {
  const adapter = pipeline.agentTaskAdapter;
  await fixture.quiesceOtherActiveTasks(options.projectId);
  const claimAt = options.claimAt ?? at(60);
  const claimTime = Date.parse(claimAt);
  const step = (seconds: number): string => new Date(claimTime + seconds * 1_000).toISOString();
  const claim = await adapter.claim({
    workerId: options.workerId,
    leaseDurationMs: 600_000,
    now: claimAt,
  });
  if (claim === undefined) throw new Error("no active C08 data-cleaning task to claim");
  const taskRef = claim.task.envelope.agentTaskRef;
  const authorization = claim.task.envelope.authorization;
  const capability = authorization.grantedCapabilities[0]!;
  const putAgentArtifact = async (
    artifactId: string,
    value: unknown,
    purposeCode: string,
    artifactKind: "content" | "diagnostic",
  ) =>
    fixture.artifactStore.put(
      ArtifactPutCommandV1Schema.parse({
        schemaVersion: "1",
        commandId: `${artifactId}:put`,
        idempotencyKey: `${artifactId}:put`,
        projectId: authorization.projectId,
        actorId: authorization.actorId,
        issuedAt: authorization.decidedAt,
        authorization,
        requiredCapability: capability,
        artifactId,
        artifactKind,
        purposeCode,
        mediaType: "application/json",
        parentArtifactRefs: [],
        evidenceReferences: [],
        additionalSpatialScopeRefs: [],
        additionalSourceAccessGrantRefs: [],
      }),
      (async function* () {
        yield new TextEncoder().encode(JSON.stringify(value));
      })(),
    );

  const intentArtifact = await putAgentArtifact(
    `c15-intent-${taskRef.reference.entityId}`,
    { action: "submit-cleaning-candidate" },
    "agent-action-intent",
    "diagnostic",
  );
  const candidateArtifact = await putAgentArtifact(
    `c15-candidate-${taskRef.reference.entityId}`,
    options.candidate ?? {
      schemaVersion: "1",
      candidateVersion: 1,
      observations: [],
      exclusions: [],
    },
    "agent-candidate",
    "content",
  );
  const incrementArtifact = await putAgentArtifact(
    `c15-increment-${taskRef.reference.entityId}`,
    { schemaVersion: "1", candidateVersion: 1, observations: [], exclusions: [] },
    "agent-increment",
    "diagnostic",
  );
  const actionResultArtifact = await putAgentArtifact(
    `c15-action-result-${taskRef.reference.entityId}`,
    { action: "submit-cleaning-candidate", outcome: "accepted" },
    "agent-action-result",
    "diagnostic",
  );

  const actionId = `${taskRef.reference.entityId}:action`;
  const reserved = await adapter.reserveAction({
    taskRef,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    actionId,
    reservationId: `${actionId}:reservation`,
    actionType: "model-invocation",
    sequence: 1,
    idempotencyKey: `${actionId}:idempotency`,
    intentArtifactRef: intentArtifact.artifactRef,
    now: step(1),
  });
  await adapter.completeAction({
    taskRef,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    actionId,
    resultRef: candidateArtifact.artifactRef,
    resultArtifactRef: actionResultArtifact.artifactRef,
    usage: { ...reserved.reservation.amount, modelInvocations: 1 },
    activeWallClockMs: 1_000,
    now: step(2),
  });

  const definition = pipeline.store.createTaskDefinition();
  if (options.withoutDefinitionResult === true) {
    const resultRef = buildCompletedAgentTaskResult(taskRef, candidateArtifact.artifactRef);
    await adapter.completeTask({
      taskRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
      resultRef,
      now: step(4),
    });
    return {
      taskRef,
      task: claim.task,
      resultRef,
      workerId: claim.workerId,
      leaseToken: claim.leaseToken,
    };
  }
  const candidate = {
    schemaVersion: "1" as const,
    candidateVersion: options.candidate?.candidateVersion ?? 1,
    observations: [...(options.candidate?.observations ?? [])],
    exclusions: [...(options.candidate?.exclusions ?? [])] as never,
  };
  const validation = await definition.validateCandidate(candidate, claim.task);
  const resultRef = await definition.finalizeCandidate(candidate, claim.task);
  await adapter.recordCandidate({
    candidate: {
      schemaVersion: "1",
      taskRef,
      candidateVersion: candidate.candidateVersion,
      parentCandidateVersion: 0,
      candidateArtifactRef: candidateArtifact.artifactRef,
      incrementArtifactRef: incrementArtifact.artifactRef,
      validation,
      resultRef,
      disposition: "accepted",
      createdAt: step(3),
    },
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
  });
  await adapter.completeTask({
    taskRef,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
    resultRef,
    now: step(4),
  });
  return {
    taskRef,
    task: claim.task,
    resultRef,
    workerId: claim.workerId,
    leaseToken: claim.leaseToken,
  };
};

export const freezeIdentificationPreparation = async (
  store: PostgresDataCleaningStore,
  world: CleaningWorldV1,
  options: {
    readonly commandId: string;
    readonly policyRef?: VersionReference;
    readonly sourceVersionRefs?: readonly SourceVersionRefV1[];
    readonly monitoringCutoff?: string | undefined;
    readonly projectRevisionRef?: ProjectRevisionRefV1;
    readonly actor?: "freezer" | "uploader";
  },
): Promise<{
  readonly command: Extract<EngineeringFreezeCommandV1, { kind: "identification-preparation" }>;
  readonly result: EngineeringFreezeResultV1;
}> => {
  const command = await world.freezeCommand(options.commandId, options);
  return { command, result: await store.freezeIdentificationPreparation(command) };
};
