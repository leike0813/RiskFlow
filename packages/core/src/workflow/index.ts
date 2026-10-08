/**
 * C30 运行事实模块入口（design D-05/D-06）：只导出登记 Schema、服务规则与类型化端口。
 * 图运行时与投影实现位于各自的 Worker/Adapter 切片，不在此暴露内部节点。
 */
export * from "./report.js";
export * from "./schema.js";
export * from "./service.js";
