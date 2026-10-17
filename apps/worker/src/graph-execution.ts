import {
  getConfig,
  type BaseCheckpointSaver,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";

/** 独立运行隔离 LangGraph 父节点的隐式检查点上下文，执行和回读共用此边界。 */
export const independentGraphConfig = (
  checkpointer: BaseCheckpointSaver,
  config: LangGraphRunnableConfig,
): LangGraphRunnableConfig & { readonly durability: "sync" } => ({
  ...config,
  configurable: {
    ...config.configurable,
    checkpoint_ns: "",
    // LangGraph 按键是否存在判定历史重放；仅在需要屏蔽父标识时显式清空。
    ...(getConfig()?.configurable?.checkpoint_id === undefined ? {} : { checkpoint_id: undefined }),
    checkpoint_map: {},
    __pregel_scratchpad: undefined,
    __pregel_checkpointer: checkpointer,
  },
  durability: "sync",
});
