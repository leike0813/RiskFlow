import { StatusTag, type StatusTone } from "../components/StatusTag";

/** 识别域四页共用的区段标签。 */
export const identificationTabs = [
  { to: "/identification", label: "识别任务" },
  { to: "/identification/records", label: "风险记录" },
  { to: "/identification/graph", label: "关联图谱" },
  { to: "/identification/process-model", label: "工序模型" },
];

/**
 * 识别域六条规范地址的业务标题：route seeds 与页面共用同一份名称，
 * 主标题不与导航标题漂移（design D-05）。
 */
export const IDENTIFICATION_ROUTE_TITLES = {
  "/identification": "识别任务",
  "/identification/runs/:runId": "识别任务详情",
  "/identification/records": "风险记录",
  "/identification/records/:recordId": "风险记录详情",
  "/identification/graph": "关联图谱",
  "/identification/process-model": "工序模型",
} as const satisfies Record<string, string>;

/** 识别域主标题：列表页与详情页同源，不另造技术名称。 */
export const IDENTIFICATION_TITLE = IDENTIFICATION_ROUTE_TITLES["/identification"];

/**
 * I0–I9 阶段标签（domain 主规格「识别工作流具有 I0 至 I9 的版本化阶段契约」的闭合语义；
 * 阶段词汇本身由服务端契约给出，这里只做中文呈现，不扩张阶段集合）。
 */
export const STAGE_LABEL: Record<string, string> = {
  I0: "资料准备与输入冻结",
  I1: "知识就绪",
  I2: "工序工作项规划",
  I3: "检索与 Agent 审阅",
  I4: "上下文组装与推理",
  I5: "结构修复与校验",
  I6: "重复检测与合并",
  I7: "置信度与验收路由",
  I8: "业务入库",
  I9: "结果汇总",
};

/** 运行状态固定枚举中文呈现（WorkflowRunStatusV1 七值，UI 不自造词汇）。 */
export const RUN_STATUS_LABEL: Record<string, string> = {
  pending: "待运行",
  running: "运行中",
  waiting: "等待复核",
  "retryable-failure": "可重试失败",
  "terminal-failure": "终止失败",
  completed: "已完成",
  cancelled: "已取消",
};

export const RUN_STATUS_TONE: Record<string, StatusTone> = {
  pending: "neutral",
  running: "running",
  waiting: "review",
  "retryable-failure": "failed",
  "terminal-failure": "failed",
  completed: "success",
  cancelled: "neutral",
};

export const TERMINAL_RUN_STATUSES: readonly string[] = [
  "retryable-failure",
  "terminal-failure",
  "completed",
  "cancelled",
];

/** 运行状态标签：未知取值如实呈现原文（失败闭合，不编造映射）。 */
export function RunStatusTag({ status }: { status: string }) {
  const tone = RUN_STATUS_TONE[status] ?? "neutral";
  return <StatusTag tone={tone}>{RUN_STATUS_LABEL[status] ?? status}</StatusTag>;
}

export const ACCEPTANCE_KIND_LABEL: Record<string, string> = {
  automatic: "自动验收",
  review: "人工复核验收",
};

export const MERGE_GROUP_STATUS_LABEL: Record<string, string> = {
  accepted: "已验收",
  "pending-review": "待复核",
  rejected: "已拒收",
};

export const MERGE_GROUP_STATUS_TONE: Record<string, StatusTone> = {
  accepted: "success",
  "pending-review": "review",
  rejected: "failed",
};
