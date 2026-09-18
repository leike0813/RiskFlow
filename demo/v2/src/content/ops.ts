// 运营设施域（P-OP-01～P-OP-05）fixtures。
// 字段形状以 packages/contracts 与 packages/core 的 access schema 为准：
// - 账号状态 LocalAccountStatusV1（active/disabled）、工程访问状态
//   ProjectAccessStatusV1（active/suspended）、五预设角色 PresetRoleV1：
//   packages/core/src/access/schema.ts:32-48；
// - 系统管理六动作 kind：SYSTEM_ACCESS_ACTIONS_V1
//   （packages/core/src/access/policy.ts:42-49）；命令身份字段
//   commandId / idempotencyKey / expectedVersion / authorizationContextRef
//   见 packages/core/src/access/schema.ts:113-118；
// - 模型部署与提示模板引用为 VersionReference（contracts ports
//   AgentTaskRefV1.modelDeploymentRef / promptTemplateRef）。
// 契约未覆盖的设施域展示字段（连接健康、设施可用率、模型登记、备份恢复点等）
// 已在 docs/gap-inbox/ops.md 登记。跨域标识沿典范追溯链（DOC2026001 →
// DOC2026001-S32-SEG007 → PN-VDS-04 → MEC-VDS-017 → RISK-2026-001 →
// RUN-A-2026-001 / ASSESS-2026-001 → WARN-2026-001 → RESP-2026-001）。

/** 对齐 packages/contracts VersionReferenceSchema。 */
export interface VersionReference {
  readonly entityId: string;
  readonly versionId: string;
}

/** 对齐 contracts common AuditInfoSchema。 */
export interface AuditInfo {
  readonly actorId: string;
  readonly action: string;
  readonly recordedAt: string;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// P-OP-01 账号与工程开通
// ---------------------------------------------------------------------------

/** 账号状态：access/schema.ts LocalAccountStatusV1Schema。 */
export type LocalAccountStatus = 'active' | 'disabled';

export const LOCAL_ACCOUNT_STATUS_LABELS: Readonly<Record<LocalAccountStatus, string>> = {
  active: '正常',
  disabled: '已停用',
};

/** 工程访问状态：access/schema.ts ProjectAccessStatusV1Schema。 */
export type ProjectAccessStatus = 'active' | 'suspended';

export const PROJECT_ACCESS_STATUS_LABELS: Readonly<Record<ProjectAccessStatus, string>> = {
  active: '运行中',
  suspended: '已暂停',
};

/** 系统管理动作中文标签；动作名严格取 contract-mirror SYSTEM_ACCESS_ACTIONS 六项。 */
export const SYSTEM_ACCESS_ACTION_LABELS: Readonly<Record<string, string>> = {
  'create-account': '创建账号',
  'disable-account': '停用账号',
  'reset-password': '重置密码',
  'open-project': '开通工程',
  'suspend-project': '暂停工程',
  'revise-membership': '修订成员',
};

export interface LocalAccountView {
  readonly accountId: string;
  readonly loginName: string;
  readonly displayName: string;
  readonly status: LocalAccountStatus;
  /** 该账号在各工程叠加的预设角色（PresetRoleV1 键，不含 system-administrator 的展示）。 */
  readonly roles: readonly string[];
  readonly audit: AuditInfo;
}

export const LOCAL_ACCOUNTS: readonly LocalAccountView[] = [
  {
    accountId: 'ACCT-000',
    loginName: 'sysadmin',
    displayName: '系统管理员（引导账号）',
    status: 'active',
    roles: ['system-administrator'],
    audit: {
      actorId: 'bootstrap',
      action: 'create-account',
      recordedAt: '2026-02-20T09:00:00+08:00',
      reason: '一次性初始系统管理员引导',
    },
  },
  {
    accountId: 'ACCT-001',
    loginName: 'zhang.gong',
    displayName: '张工',
    status: 'active',
    roles: ['project-risk-manager'],
    audit: {
      actorId: 'ACCT-000',
      action: 'create-account',
      recordedAt: '2026-03-01T09:20:00+08:00',
      reason: '工程开通指定初始风险负责人',
    },
  },
  {
    accountId: 'ACCT-002',
    loginName: 'li.gong',
    displayName: '李工',
    status: 'active',
    roles: ['reviewer'],
    audit: {
      actorId: 'ACCT-000',
      action: 'create-account',
      recordedAt: '2026-04-11T15:00:00+08:00',
      reason: '复核专家入场',
    },
  },
  {
    accountId: 'ACCT-003',
    loginName: 'chen.gong',
    displayName: '陈工',
    status: 'active',
    roles: ['field-responder'],
    audit: {
      actorId: 'ACCT-000',
      action: 'create-account',
      recordedAt: '2026-06-20T08:30:00+08:00',
      reason: '现场处置班组建档',
    },
  },
  {
    accountId: 'ACCT-004',
    loginName: 'liu.gong',
    displayName: '刘工',
    status: 'disabled',
    roles: ['business-viewer'],
    audit: {
      actorId: 'ACCT-000',
      action: 'disable-account',
      recordedAt: '2026-08-05T17:12:00+08:00',
      reason: '岗位调整，账号停用并强制会话失效',
    },
  },
];

export interface ProjectAccessView {
  readonly projectId: string;
  readonly name: string;
  readonly accessStatus: ProjectAccessStatus;
  /** 当前工程业务修订引用（与 project.ts PROJECT_BUSINESS_REVISIONS 对齐）。 */
  readonly currentRevisionRef: VersionReference;
  readonly initialRiskManagerAccountId: string;
  readonly memberCount: number;
  readonly audit: AuditInfo;
}

export const PROJECT_ACCESS_LIST: readonly ProjectAccessView[] = [
  {
    projectId: 'PRJ-001',
    name: '站隧一体化标（变径盾构试验区段）',
    accessStatus: 'active',
    currentRevisionRef: { entityId: 'PRJ-001', versionId: 'rev-2' },
    initialRiskManagerAccountId: 'ACCT-001',
    memberCount: 3,
    audit: {
      actorId: 'ACCT-000',
      action: 'open-project',
      recordedAt: '2026-03-01T09:30:00+08:00',
      reason: '工程开通登记',
    },
  },
  {
    projectId: 'PRJ-002',
    name: '变径盾构区间（筹备）',
    accessStatus: 'suspended',
    currentRevisionRef: { entityId: 'PRJ-002', versionId: 'rev-1' },
    initialRiskManagerAccountId: 'ACCT-001',
    memberCount: 1,
    audit: {
      actorId: 'ACCT-000',
      action: 'suspend-project',
      recordedAt: '2026-08-30T10:15:00+08:00',
      reason: '甲方暂停筹备期接入，待复工通知',
    },
  },
];

/** 访问命令台账条目：命令身份字段对齐 access/schema.ts commandIdentity。 */
export interface AccessCommandLogEntry {
  readonly commandId: string;
  /** 六动作之一（SYSTEM_ACCESS_ACTIONS）。 */
  readonly action: string;
  readonly idempotencyKey: string;
  readonly targetLabel: string;
  readonly actorId: string;
  readonly recordedAt: string;
  readonly result: '已提交' | '已拒绝';
}

export const ACCESS_COMMAND_LOG: readonly AccessCommandLogEntry[] = [
  {
    commandId: 'CMD-ACC-20260830-001',
    action: 'suspend-project',
    idempotencyKey: 'idem-20260830-suspend-prj002',
    targetLabel: '工程 PRJ-002',
    actorId: 'ACCT-000',
    recordedAt: '2026-08-30T10:15:00+08:00',
    result: '已提交',
  },
  {
    commandId: 'CMD-ACC-20260805-001',
    action: 'disable-account',
    idempotencyKey: 'idem-20260805-disable-acct004',
    targetLabel: '账号 ACCT-004',
    actorId: 'ACCT-000',
    recordedAt: '2026-08-05T17:12:00+08:00',
    result: '已提交',
  },
  {
    commandId: 'CMD-ACC-20260805-002',
    action: 'revise-membership',
    idempotencyKey: 'idem-20260805-mbr004',
    targetLabel: '成员 MBR-004（PRJ-001）',
    actorId: 'ACCT-000',
    recordedAt: '2026-08-05T17:10:00+08:00',
    result: '已提交',
  },
  {
    commandId: 'CMD-ACC-20260620-001',
    action: 'create-account',
    idempotencyKey: 'idem-20260620-create-acct003',
    targetLabel: '账号 ACCT-003',
    actorId: 'ACCT-000',
    recordedAt: '2026-06-20T08:30:00+08:00',
    result: '已提交',
  },
  {
    commandId: 'CMD-ACC-20260301-001',
    action: 'open-project',
    idempotencyKey: 'idem-20260301-open-prj001',
    targetLabel: '工程 PRJ-001',
    actorId: 'ACCT-000',
    recordedAt: '2026-03-01T09:30:00+08:00',
    result: '已提交',
  },
];

// ---------------------------------------------------------------------------
// P-OP-02 数据源与适配器连接
// ---------------------------------------------------------------------------

/** 交付通道类型：对齐 project.ts SourceDeliveryKind（契约 SourceItem descriptor）。 */
export type DeliveryKind = 'file-upload' | 'database-snapshot' | 'api-snapshot';

export const DELIVERY_KIND_LABELS: Readonly<Record<DeliveryKind, string>> = {
  'file-upload': '文件上传',
  'database-snapshot': '数据库快照',
  'api-snapshot': '接口快照',
};

export type ConnectionStatus = 'connected' | 'degraded' | 'disconnected';

export const CONNECTION_STATUS_LABELS: Readonly<Record<ConnectionStatus, string>> = {
  connected: '已连接',
  degraded: '连接退化',
  disconnected: '未连接',
};

export interface ConnectionCheckEvent {
  readonly at: string;
  readonly result: string;
  readonly note: string;
}

export interface DataSourceAdapterView {
  readonly adapterId: string;
  readonly name: string;
  /** 接入通路语义；实时监测通路限定为「实时多源监测数据 → 指标实际取值」。 */
  readonly pathway: string;
  readonly deliveryKind: DeliveryKind;
  /** 连接定义引用（契约 connectionDefinitionRef 形状）；未建立连接时为 null。 */
  readonly connectionDefinitionRef: VersionReference | null;
  readonly status: ConnectionStatus;
  readonly lastCheckedAt: string | null;
  readonly serves: readonly string[];
  readonly referencedBy: readonly { readonly label: string; readonly path: string }[];
  readonly checks: readonly ConnectionCheckEvent[];
  readonly audit: AuditInfo;
}

export const DATA_SOURCE_ADAPTERS: readonly DataSourceAdapterView[] = [
  {
    adapterId: 'ADP-RT-MON-01',
    name: '实时监测数据接入',
    pathway: '实时多源监测数据 → 指标实际取值',
    deliveryKind: 'api-snapshot',
    connectionDefinitionRef: { entityId: 'CONN-MON-01', versionId: 'v2026.08' },
    status: 'connected',
    lastCheckedAt: '2026-09-18T08:55:00+08:00',
    serves: ['监测批次登记', '监测快照候选', '指标实际取值供给'],
    referencedBy: [
      { label: '监测序列 MON-001（地表沉降）', path: '/projects/monitoring/MON-001' },
      { label: '接入任务 ING-20260827-002', path: '/projects/ingestion-tasks' },
      { label: '证据追溯 DOC2026003-M001-SEG021', path: '/review-audit/trace' },
    ],
    checks: [
      { at: '2026-09-18T08:55:00+08:00', result: '通过', note: '最近批次 MON-B-20260827-001 接入正常' },
      { at: '2026-09-11T08:55:00+08:00', result: '通过', note: '周期连接检查通过' },
    ],
    audit: {
      actorId: 'ACCT-000',
      action: 'register-connection',
      recordedAt: '2026-06-15T09:00:00+08:00',
      reason: '监测单位接口接入登记',
    },
  },
  {
    adapterId: 'ADP-FILE-01',
    name: '资料文件交付接入',
    pathway: '资料交付 → 资料版本与资料段',
    deliveryKind: 'file-upload',
    connectionDefinitionRef: null,
    status: 'connected',
    lastCheckedAt: '2026-09-18T08:55:00+08:00',
    serves: ['资料交付登记', '资料段结构化转换'],
    referencedBy: [
      { label: '资料 DOC2026001', path: '/projects/sources/DOC2026001' },
      { label: '接入任务 ING-20260827-001', path: '/projects/ingestion-tasks' },
    ],
    checks: [{ at: '2026-09-18T08:55:00+08:00', result: '通过', note: '站内上传通道可用' }],
    audit: {
      actorId: 'ACCT-000',
      action: 'register-connection',
      recordedAt: '2026-03-01T09:05:00+08:00',
      reason: '工程开通默认交付通道',
    },
  },
  {
    adapterId: 'ADP-DB-GEO-01',
    name: '勘察数据库快照接入',
    pathway: '资料交付 → 资料版本与资料段',
    deliveryKind: 'database-snapshot',
    connectionDefinitionRef: { entityId: 'CONN-GEO-01', versionId: 'v2026.03' },
    status: 'degraded',
    lastCheckedAt: '2026-09-17T22:10:00+08:00',
    serves: ['地质资料快照接入'],
    referencedBy: [{ label: '资料 DOC2026002', path: '/projects/sources/DOC2026002' }],
    checks: [
      { at: '2026-09-17T22:10:00+08:00', result: '退化', note: '勘察单位库连接超时一次，已进入重试' },
      { at: '2026-09-10T22:10:00+08:00', result: '通过', note: '周期连接检查通过' },
    ],
    audit: {
      actorId: 'ACCT-000',
      action: 'register-connection',
      recordedAt: '2026-03-14T10:00:00+08:00',
      reason: '勘察报告数据库快照接入登记',
    },
  },
  {
    adapterId: 'ADP-API-EQM-01',
    name: '装备运行接口快照接入',
    pathway: '实时多源监测数据 → 指标实际取值',
    deliveryKind: 'api-snapshot',
    connectionDefinitionRef: null,
    status: 'disconnected',
    lastCheckedAt: null,
    serves: ['装备状态参数接入（待开通）'],
    referencedBy: [],
    checks: [],
    audit: {
      actorId: 'ACCT-000',
      action: 'register-connection',
      recordedAt: '2026-08-28T16:40:00+08:00',
      reason: '装备接口适配器建档，待甲方开放接口',
    },
  },
];

// ---------------------------------------------------------------------------
// P-OP-03 运行与设施健康
// ---------------------------------------------------------------------------

export type FacilityStatus = 'healthy' | 'degraded' | 'down';

export const FACILITY_STATUS_LABELS: Readonly<Record<FacilityStatus, string>> = {
  healthy: '正常',
  degraded: '降级',
  down: '不可用',
};

export type FacilityCategory = '应用服务' | '数据存储' | '模型服务' | '检索索引' | '任务调度';

export interface FacilityHealthView {
  readonly facilityId: string;
  readonly name: string;
  readonly category: FacilityCategory;
  readonly status: FacilityStatus;
  /** 近 30 日可用率（%）；设计样例数据，非真实运行指标。 */
  readonly availabilityPct: number;
  readonly note: string;
  readonly audit: AuditInfo;
}

export const FACILITY_HEALTH: readonly FacilityHealthView[] = [
  {
    facilityId: 'FAC-APP-01',
    name: '应用服务（界面与接口）',
    category: '应用服务',
    status: 'healthy',
    availabilityPct: 99.98,
    note: '无未结事件',
    audit: { actorId: 'system', action: 'facility-check', recordedAt: '2026-09-18T08:55:00+08:00' },
  },
  {
    facilityId: 'FAC-DB-01',
    name: '业务数据库',
    category: '数据存储',
    status: 'healthy',
    availabilityPct: 99.99,
    note: '事务与审计写入正常',
    audit: { actorId: 'system', action: 'facility-check', recordedAt: '2026-09-18T08:55:00+08:00' },
  },
  {
    facilityId: 'FAC-STORE-01',
    name: '工件存储',
    category: '数据存储',
    status: 'healthy',
    availabilityPct: 100,
    note: '原始响应与资料工件写入正常',
    audit: { actorId: 'system', action: 'facility-check', recordedAt: '2026-09-18T08:55:00+08:00' },
  },
  {
    facilityId: 'FAC-MODEL-01',
    name: '模型推理服务',
    category: '模型服务',
    status: 'healthy',
    availabilityPct: 99.9,
    note: '结构化生成与向量化调用正常',
    audit: { actorId: 'system', action: 'facility-check', recordedAt: '2026-09-18T08:55:00+08:00' },
  },
  {
    facilityId: 'FAC-SEARCH-01',
    name: '检索索引（向量与关键词双索引）',
    category: '检索索引',
    status: 'degraded',
    availabilityPct: 99.31,
    note: '一次索引重建导致短时降级，已恢复并复核',
    audit: { actorId: 'system', action: 'facility-check', recordedAt: '2026-09-18T08:55:00+08:00' },
  },
  {
    facilityId: 'FAC-JOB-01',
    name: '任务调度与运行队列',
    category: '任务调度',
    status: 'healthy',
    availabilityPct: 99.95,
    note: '识别 / 评估 / 接入任务调度正常',
    audit: { actorId: 'system', action: 'facility-check', recordedAt: '2026-09-18T08:55:00+08:00' },
  },
];

/** 可用率目标（设计样例阈值，非业务预警阈值）。 */
export const FACILITY_AVAILABILITY_TARGET = 99.5;

export interface RecentRunLink {
  readonly label: string;
  readonly summary: string;
  readonly path: string;
}

/** 近期业务运行入口（深链到运行记录与运行详情）。 */
export const RECENT_RUN_LINKS: readonly RecentRunLink[] = [
  {
    label: 'RUN-20260827-001',
    summary: '风险识别运行 · 已完成',
    path: '/identification/runs/RUN-20260827-001',
  },
  {
    label: 'RUN-A-2026-001',
    summary: '风险评估运行 · 已完成',
    path: '/assessment/runs/RUN-A-2026-001',
  },
  {
    label: 'ING-20260828-001',
    summary: '监测批次订正接入 · 失败待处理',
    path: '/projects/ingestion-tasks',
  },
];

// ---------------------------------------------------------------------------
// P-OP-04 模型与提示模板版本
// ---------------------------------------------------------------------------

/** 治理生命周期（词汇待契约确认，沿用知识域 GAP-020 预设）。 */
export type OpsGovernanceLifecycle = 'draft' | 'in-review' | 'published' | 'deactivated';

export const OPS_LIFECYCLE_LABELS: Readonly<Record<OpsGovernanceLifecycle, string>> = {
  draft: '草稿',
  'in-review': '审核中',
  published: '已发布',
  deactivated: '已停用',
};

export interface FieldDiff {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

export interface OpsObjectVersion {
  readonly versionId: string;
  readonly lifecycle: OpsGovernanceLifecycle;
  readonly recordedAt: string;
  readonly actor: string;
  readonly note: string;
  /** 回退即新版本：本版本内容回退至的历史版本号。 */
  readonly rollbackOf?: string;
  readonly diffs: readonly FieldDiff[];
}

export interface ModelDeploymentObject {
  readonly kind: 'model-deployment';
  readonly objectId: string;
  readonly name: string;
  readonly role: string;
  /** 当前生效版本（不可变快照引用）。 */
  readonly currentVersion: VersionReference;
  /** 基础模型（原始权重）引用；微调权重对象必填。 */
  readonly baseModelRef: VersionReference | null;
  /** 权重加载语义说明（微调权重与原始权重同时可加载、可回退）。 */
  readonly weightLoading: string;
  readonly usedBy: readonly { readonly label: string; readonly path: string }[];
  readonly versions: readonly OpsObjectVersion[];
}

export interface PromptTemplateObject {
  readonly kind: 'prompt-template';
  readonly objectId: string;
  readonly name: string;
  readonly taskScope: string;
  readonly currentVersion: VersionReference;
  readonly usedBy: readonly { readonly label: string; readonly path: string }[];
  readonly versions: readonly OpsObjectVersion[];
}

export type GovernedOpsObject = ModelDeploymentObject | PromptTemplateObject;

export const GOVERNED_OPS_OBJECTS: readonly GovernedOpsObject[] = [
  {
    kind: 'model-deployment',
    objectId: 'MDEP-BASE-001',
    name: '中文工程文本基础模型部署',
    role: '结构化生成与向量化基座（原始权重）',
    currentVersion: { entityId: 'MDEP-BASE-001', versionId: 'v2026.08' },
    baseModelRef: null,
    weightLoading: '原始权重，常时加载',
    usedBy: [
      { label: '识别运行 RUN-20260827-001', path: '/identification/runs/RUN-20260827-001' },
      { label: 'Agent 任务 AT-2026-001', path: '/agent/tasks/AT-2026-001' },
    ],
    versions: [
      {
        versionId: 'v2026.09',
        lifecycle: 'draft',
        recordedAt: '2026-09-12T14:20:00+08:00',
        actor: 'ACCT-000',
        note: '基座升级评估草稿，尚未提请审核',
        diffs: [
          { field: '上下文窗口', before: '32768', after: '65536' },
          { field: '量化档位', before: 'Q4_K_M', after: 'Q5_K_M' },
        ],
      },
      {
        versionId: 'v2026.08',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:00:00+08:00',
        actor: 'ACCT-000',
        note: '识别与评估链路当前生效基座',
        diffs: [],
      },
      {
        versionId: 'v2026.06',
        lifecycle: 'deactivated',
        recordedAt: '2026-06-15T09:00:00+08:00',
        actor: 'ACCT-000',
        note: '首发基座，已被 v2026.08 取代',
        diffs: [],
      },
    ],
  },
  {
    kind: 'model-deployment',
    objectId: 'MDEP-LORA-001',
    name: '风险候选生成微调权重（低秩适应）',
    role: 'RI-S57 风险候选生成专用推理的增量权重',
    currentVersion: { entityId: 'MDEP-LORA-001', versionId: 'v2026.07' },
    baseModelRef: { entityId: 'MDEP-BASE-001', versionId: 'v2026.08' },
    weightLoading: '微调权重与原始权重同时可加载；回退即卸载微调权重、仅加载原始权重',
    usedBy: [
      { label: '识别运行 RUN-20260827-001', path: '/identification/runs/RUN-20260827-001' },
      { label: 'Agent 任务 AT-2026-001', path: '/agent/tasks/AT-2026-001' },
    ],
    versions: [
      {
        versionId: 'v2026.08',
        lifecycle: 'in-review',
        recordedAt: '2026-09-15T11:30:00+08:00',
        actor: 'ACCT-000',
        note: '新增专家复核语料的微调批次，待复核通过后发布',
        diffs: [{ field: '训练语料版本', before: 'CORPUS-2026.06', after: 'CORPUS-2026.09' }],
      },
      {
        versionId: 'v2026.07',
        lifecycle: 'published',
        recordedAt: '2026-07-28T16:00:00+08:00',
        actor: 'ACCT-000',
        note: '当前生效微调权重；与原始权重并存，可按版本回退',
        diffs: [],
      },
      {
        versionId: 'v2026.05',
        lifecycle: 'deactivated',
        recordedAt: '2026-05-19T09:40:00+08:00',
        actor: 'ACCT-000',
        note: '首轮合成样本微调，已停用（可回退重载）',
        diffs: [],
      },
    ],
  },
  {
    kind: 'prompt-template',
    objectId: 'PT-RI57-001',
    name: '风险候选生成提示模板',
    taskScope: '专用 LLM 节点（RI-S57）：候选生成受识别上下文约束，输出直接进入确定性校验',
    currentVersion: { entityId: 'PT-RI57-001', versionId: 'v2026.08' },
    usedBy: [
      { label: '识别运行 RUN-20260827-001', path: '/identification/runs/RUN-20260827-001' },
      { label: 'Agent 任务 AT-2026-001', path: '/agent/tasks/AT-2026-001' },
    ],
    versions: [
      {
        versionId: 'v2026.09',
        lifecycle: 'draft',
        recordedAt: '2026-09-16T10:05:00+08:00',
        actor: 'ACCT-000',
        note: '补充缩径转换工序的候选约束描述',
        diffs: [
          { field: '上下文槽位', before: '工序节点、机理条目、证据段、适用性元数据', after: '增加空间区段覆盖槽位' },
          { field: '候选规模上限', before: '8', after: '12' },
        ],
      },
      {
        versionId: 'v2026.08',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:05:00+08:00',
        actor: 'ACCT-000',
        note: '与基座 v2026.08 配套发布',
        diffs: [],
      },
    ],
  },
  {
    kind: 'prompt-template',
    objectId: 'PT-RESP-001',
    name: '处置建议组合排序提示模板',
    taskScope: '处置建议组合排序（必经 Agent 任务），输出经三项校验后方可成为正式建议',
    currentVersion: { entityId: 'PT-RESP-001', versionId: 'v2026.08' },
    usedBy: [{ label: '处置建议 RESP-2026-001', path: '/response/recommendations/RESP-2026-001' }],
    versions: [
      {
        versionId: 'v2026.08',
        lifecycle: 'published',
        recordedAt: '2026-08-20T10:10:00+08:00',
        actor: 'ACCT-000',
        note: '与基座 v2026.08 配套发布',
        diffs: [],
      },
      {
        versionId: 'v2026.06',
        lifecycle: 'deactivated',
        recordedAt: '2026-06-15T09:10:00+08:00',
        actor: 'ACCT-000',
        note: '初版模板，已停用',
        diffs: [],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// P-OP-05 备份与恢复
// ---------------------------------------------------------------------------

export interface BackupPolicyView {
  readonly policyRef: VersionReference;
  readonly scope: readonly string[];
  readonly scheduleText: string;
  readonly retentionText: string;
  readonly audit: AuditInfo;
}

export const BACKUP_POLICY: BackupPolicyView = {
  policyRef: { entityId: 'BKP-POLICY-001', versionId: 'v2026.08' },
  scope: ['业务数据库（含审计只追加表）', '工件存储', '运行检查点'],
  scheduleText: '每日 02:00 全量 + 每 4 小时增量',
  retentionText: '保留最近 30 个恢复点',
  audit: {
    actorId: 'ACCT-000',
    action: 'publish-backup-policy',
    recordedAt: '2026-08-20T10:20:00+08:00',
    reason: '备份策略随部署基线发布',
  },
};

export type RestorePointStatus = 'verified' | 'verifying';

export const RESTORE_POINT_STATUS_LABELS: Readonly<Record<RestorePointStatus, string>> = {
  verified: '校验通过',
  verifying: '校验中',
};

export interface RestorePointView {
  readonly restorePointId: string;
  readonly kind: '定时' | '手动';
  readonly createdAt: string;
  readonly scope: readonly string[];
  readonly sizeLabel: string;
  readonly status: RestorePointStatus;
  readonly audit: AuditInfo;
}

export const RESTORE_POINTS: readonly RestorePointView[] = [
  {
    restorePointId: 'BKP-20260918-001',
    kind: '定时',
    createdAt: '2026-09-18T02:00:00+08:00',
    scope: ['业务数据库', '工件存储', '运行检查点'],
    sizeLabel: '全量 38.2 GB',
    status: 'verified',
    audit: { actorId: 'system', action: 'create-restore-point', recordedAt: '2026-09-18T02:00:00+08:00' },
  },
  {
    restorePointId: 'BKP-20260917-001',
    kind: '定时',
    createdAt: '2026-09-17T02:00:00+08:00',
    scope: ['业务数据库', '工件存储', '运行检查点'],
    sizeLabel: '全量 37.9 GB',
    status: 'verified',
    audit: { actorId: 'system', action: 'create-restore-point', recordedAt: '2026-09-17T02:00:00+08:00' },
  },
  {
    restorePointId: 'BKP-20260916-001',
    kind: '定时',
    createdAt: '2026-09-16T02:00:00+08:00',
    scope: ['业务数据库', '工件存储', '运行检查点'],
    sizeLabel: '全量 37.4 GB',
    status: 'verifying',
    audit: { actorId: 'system', action: 'create-restore-point', recordedAt: '2026-09-16T02:00:00+08:00' },
  },
  {
    restorePointId: 'BKP-20260912-002',
    kind: '手动',
    createdAt: '2026-09-12T14:05:00+08:00',
    scope: ['业务数据库', '工件存储', '运行检查点'],
    sizeLabel: '全量 36.8 GB',
    status: 'verified',
    audit: {
      actorId: 'ACCT-000',
      action: 'create-restore-point',
      recordedAt: '2026-09-12T14:05:00+08:00',
      reason: '基座升级评估前手动建立恢复点',
    },
  },
];

export interface BackupTimelineEvent {
  readonly at: string;
  readonly actorLabel: string;
  readonly action: string;
}

export const BACKUP_TIMELINE: readonly BackupTimelineEvent[] = [
  { at: '2026-08-20 10:20', actorLabel: '系统管理员', action: '备份策略 BKP-POLICY-001 · v2026.08 发布生效' },
  { at: '2026-09-12 14:05', actorLabel: '系统管理员', action: '手动建立恢复点 BKP-20260912-002（基座升级评估前）' },
  { at: '2026-09-16 02:00', actorLabel: '系统', action: '定时恢复点 BKP-20260916-001 建立，进入校验' },
  { at: '2026-09-17 02:00', actorLabel: '系统', action: '定时恢复点 BKP-20260917-001 建立并校验通过' },
  { at: '2026-09-18 02:00', actorLabel: '系统', action: '定时恢复点 BKP-20260918-001 建立并校验通过' },
];
