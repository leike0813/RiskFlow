/**
 * 工程域的共享标题与二级入口（design D-02）。
 *
 * 本模块只描述本域元数据：工程概览是根摘要，二级入口为资料与监测、工程上下文、
 * 成员与开通。五个工程页面共用同一份入口，不再各自维护重复的页签常量。
 */
export const PROJECT_NAVIGATION_ITEMS_V1 = [
  { to: "/projects/documents", label: "资料与监测" },
  { to: "/projects/spatial-scopes", label: "工程上下文" },
  { to: "/projects/members", label: "成员" },
  { to: "/projects/opening", label: "开通" },
] as const;

/** 接入任务从资料与监测组进入：只列资料目录与接入任务两个入口。 */
export const PROJECT_INGESTION_NAVIGATION_ITEMS_V1 = [
  { to: "/projects/documents", label: "资料与监测" },
  { to: "/projects/ingestion-tasks", label: "接入任务" },
] as const;

/** 工程页面共用的主标题与副标题；标题不含技术标识。 */
export const PROJECT_PAGE_TITLE_V1 = "工程工作区";
export const PROJECT_PAGE_SUBTITLE_V1 = "工程上下文、资料监测、成员访问与接入事实";
