# MiniMax 结构化输出（response_format）官方支持情况研究

- 研究日期：2026-10-16（Asia/Shanghai）
- 研究对象：MiniMax 官方 OpenAI 兼容 API，模型 `MiniMax-M3.1-Flash-Preview`，M Plan / Coding Plan 订阅密钥接入
- 方法：只读官方文档与官方 GitHub 仓库；未向模型端点发送任何请求；未读取任何本地凭据或私有配置
- 触发背景：RiskFlow 实机验收中一次真实响应 `finish_reason=stop`、输出 1329 token（预算 32768），content 以 `{` 开头、无代码围栏，`JSON.parse` 在 position 3656 失败；content 末尾为 `"`、`}`、`]`、`}`，结构未闭合。请求侧按 schema-prompt 方式要求 JSON。

## 结论

**当前官方规范未为 OpenAI 兼容端点和 M3.1 声明可用的 `response_format`；官方 M3 测试记录明确表示不支持 `json_object`。本次验收不能依赖该参数保证 JSON。**

规范缺项和 M3 显式测试记录均可核查；将其外推为 M3.1 的绝对不支持仍有下述证据边界。

## 发现

### 1. `/v1/chat/completions` 官方 OpenAPI 不含 `response_format`（决定性）

官方规范文件 `openapi-chat-openai.json`（`servers[0].url = https://api.minimax.io`，路径 `POST /v1/chat/completions`）的请求体属性，经解引用后**仅有 13 个**：

`model`、`messages`、`max_completion_tokens`、`max_tokens`、`stream`、`stream_options`、`temperature`、`top_p`、`tools`、`thinking`、`reasoning_effort`、`reasoning_split`、`service_tier`

其中 `required = ["model", "messages"]`。全文检索 `response_format`、`json_object`、`json_schema` 命中次数均为 **0**。

- 来源：<https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json>（2026-10-16 抓取，HTTP 200）

### 2. OpenAI SDK 官方页对 M3.1 / M3 列出的扩展参数中同样没有 `response_format`

页面为 `MiniMax-M3.1-Flash-Preview` 与 `MiniMax-M3` 单独列出支持的 Chat Completions 参数表：`thinking`、`reasoning_effort`、`stream_options.include_usage`、`max_tokens`、`max_completion_tokens`、`temperature`、`top_p`、`tools`、`reasoning_split`、`service_tier`。对该页全文检索 `response_format`，无匹配。

同页还写明：`MiniMax-M3.1-Flash-Preview` 目前**仅可通过 M Plan 与 MiniMax Code 使用**；`MiniMax-M3.1-Flash-Preview` 始终开启思考，`thinking.type=disabled` 返回 400（错误码 2013）；官方推荐保留 `<think>` / `reasoning_content` 完整内容。

- 来源：<https://platform.minimax.io/docs/api-reference/text-openai-api>

### 3. 原生接口 `/v1/text/chatcompletion_v2` 有 `response_format`，但官方限定为遗留模型且只支持 `json_schema`

原生接口文档明确写道：`response_format` **“only supported by `MiniMax-Text-01`”**，且 `type` 枚举**只有 `json_schema`**，没有 `json_object`；`json_schema` 需提供 `name` 与 `schema`。而官方模型清单中既没有 `MiniMax-Text-01`（可用与已下线两张表均未出现），当前 LLM 可用模型为 M3.1-Flash-Preview、M3、M2.7(-highspeed)、M2.5(-highspeed)。

补充一处官方内部不一致：该接口发布的 OpenAPI 文件 `openapi-chat.json` 中**完全没有** `response_format`（请求体只有 `model`、`messages`、`max_completion_tokens`、`stream`、`temperature`、`top_p`），比同一接口的文档页更窄。以当前 OpenAPI 为准则该端点同样无结构化输出。

- 来源：<https://platform.minimax.io/docs/api-reference/text-post>、<https://platform.minimax.io/docs/api-reference/text/api/openapi-chat.json>、<https://platform.minimax.io/docs/faq/models>

### 4. OpenAI Responses 兼容端点显式关闭结构化输出

`POST /v1/responses` 与 `POST /v1/responses/input_tokens` 的官方 OpenAPI 中存在输出格式控制对象 `text`，但 `text.format.type` 的 `enum` **只有 `"text"`**（默认 `text`，描述为 “Output format type”）。即该端点显式不提供 `json_object` / `json_schema`。

- 来源：<https://platform.minimax.io/docs/api-reference/text/api/openapi-responses.json>

### 5. 官方 Provider 一致性测试仓库明确记录 M3 家族不支持该参数（最强显式表述）

MiniMax 官方组织 `MiniMax-AI/MiniMax-Provider-Verifier` 仓库 `m3_format_check/docs/m3_text_cases.md` 写明：

> 本节全部 case 已 skip：`minimax-M3` 目前不支持 `response_format=json_object` 参数，`TestResponseFormat` 整个 class 在 `m3_text_tests.py` 中加了 `@pytest.mark.skip(...)`；等 M3 支持该参数后移除 skip 标记重新启用；§15_02 原本含 `response_format` 的组合 case 也已移除该字段，只保留 tools + tool_choice 共存校验。

该仓库是 MiniMax 用于验证自家模型在第三方供应商协议下的行为的一致性套件，属于官方一手材料；其结论是对 M3（及同一 M 系列）**不支持 `response_format=json_object`** 的直接陈述。

- 来源：<https://github.com/MiniMax-AI/MiniMax-Provider-Verifier/blob/main/m3_format_check/docs/m3_text_cases.md>

### 6. M Plan / Coding Plan 走的就是同一个 OpenAI 兼容端点

M Plan 官方接入说明：OpenAI 兼容协议 `Base URL = https://api.minimax.io/v1`、`Model ID = MiniMax-M3.1-Flash-Preview`、认证使用 M Plan **Subscription Key**（与按量付费 API Key 不互通）。M Plan 三个档位（Go / Explore / Build）的文本模型均为 M3.1 Flash Preview。M Plan FAQ 说明支持“任何兼容 OpenAI 或 Anthropic 协议的 AI 工具”。

即：RiskFlow 使用的 OpenAI 兼容路径与第 1、2 条的 `/v1/chat/completions` 是同一端点、同一规范，结论直接适用。

- 来源：<https://platform.minimax.io/docs/m-plan/other-tools>、<https://platform.minimax.io/docs/m-plan/intro>、<https://platform.minimax.io/docs/m-plan/quickstart>、<https://platform.minimax.io/docs/m-plan/faq>

### 7. 官方文档未说明未知参数的处理方式

OpenAI SDK 页的注意事项只写明 `presence_penalty`、`frequency_penalty`、`logit_bias` 等部分 OpenAI 参数“会被忽略”，未把 `response_format` 列入；相关 OpenAPI 也未声明 `additionalProperties: false`。因此官方既未承诺会拒绝未知字段，也未承诺会忽略。实测中请求成功（HTTP 200、`finish_reason=stop`）与“静默忽略”一致，但这属于**推断**，不是官方陈述。

- 来源：<https://platform.minimax.io/docs/api-reference/text-openai-api>

### 8. 官方声明工具调用通道（function calling）

`tools` 是正式参数，`function.parameters` 可携 JSON Schema，`tool_calls[].function.arguments` 为字符串。它是可调查的结构化承载通道，但文档并未保证任意返回参数均为合法 JSON 或满足调用方 Schema；本地语法、Schema 与领域校验仍不可省略。

- 来源：<https://platform.minimax.io/docs/guides/text-m3-function-call>、<https://platform.minimax.io/docs/api-reference/text-openai-api>

### 9. 对本次实机失败的解释边界（推断）

官方规范中不存在任何对该模型的 JSON 良构性约束，因此“content 以 `{` 开头却在 position 3656 处未闭合”与“结构化输出开关未生效、仅靠提示词约束”完全一致。`finish_reason=stop` 且 1329 ≪ 32768 表明**不是长度截断**：按官方说明，只有 `max_tokens` / `max_completion_tokens` 过小才会产生 `finish_reason: length` 且 content 为空。属于模型自行提前终止、输出未闭合。

## 适用性

- 端点：`POST https://api.minimax.io/v1/chat/completions`（OpenAI 兼容）、`POST https://api.minimax.io/v1/responses`（Responses 兼容）、`POST https://api.minimax.io/v1/text/chatcompletion_v2`（原生）。Anthropic 兼容端点 `https://api.minimax.io/anthropic` 不在本次研究范围。
- 模型：`MiniMax-M3.1-Flash-Preview`（M Plan / MiniMax Code 专属）、`MiniMax-M3`、`MiniMax-M2.7(-highspeed)`、`MiniMax-M2.5(-highspeed)`。
- 订阅形态：M Plan（Go / Explore / Build，Subscription Key，Base URL `https://api.minimax.io/v1`）。
- 证据时效：全部规范与文档于 2026-10-16 抓取；官方模型与接口清单变动频繁，需在验收取证时复核。

## 最小线协议示例

当前**不受支持**的写法（字段不在官方规范内，行为未定义）：

```json
{
  "model": "MiniMax-M3.1-Flash-Preview",
  "messages": [{"role": "user", "content": "..."}],
  "max_completion_tokens": 4096,
  "response_format": {"type": "json_object"}
}
```

官方规范内的写法（结构化输出走 `tools`，参数 schema 由 `function.parameters` 承载）：

```json
{
  "model": "MiniMax-M3.1-Flash-Preview",
  "reasoning_effort": "max",
  "max_completion_tokens": 4096,
  "messages": [{"role": "user", "content": "..."}],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "emit_result",
        "description": "输出结构化结果",
        "parameters": {
          "type": "object",
          "properties": {
            "riskRecordId": {"type": "string"},
            "candidates": {"type": "array", "items": {"type": "object"}}
          },
          "required": ["riskRecordId", "candidates"]
        }
      }
    }
  ]
}
```

示例仅说明 `tools` 字段，未实机验证。未找到 M3.1 对强制工具选择的完整承诺，不能据此假定服务端强制执行 Schema。

## 冲突与不确定性

1. **官方内部不一致**：原生接口 `/v1/text/chatcompletion_v2` 的文档页记录了 `response_format`（限 `MiniMax-Text-01`、仅 `json_schema`），但其发布的 OpenAPI 文件不含该字段。以 OpenAPI 与模型清单为准，`MiniMax-Text-01` 当前不可用。
2. **未找到的事实**：官方文档中没有任何一处散文式声明“MiniMax-M3.1-Flash-Preview 不支持 `response_format`”。最接近的显式表述来自官方一致性测试仓库，且其对象写作 `minimax-M3`。严格意义上，M3.1 的直接否定证据缺失，本文依据的是“规范中无该字段 + 同系列官方测试记录不支持”。
3. **M Plan 网关无独立规范**：MiniMax 未发布 M Plan 专用 OpenAPI，无法从官方材料排除其网关接受规范外的额外字段。未找到任何官方材料支持 M Plan 支持 `response_format`。
4. **未知字段行为未文档化**：未知字段是报 400 / 2013 还是被忽略，官方未说明。实机 200 响应说明在本次路径上未被拒绝。
5. **无官方路线图**：未找到 MiniMax 关于何时支持 Structured Outputs 的官方时间表或承诺。
6. **次级证据**：`MiniMax-AI/MiniMax-M2.5` 仓库 issue #4（用户 2026-02-18 提交）报告 M2.5 不支持 `response_format`，与官方测试仓库结论一致；该 issue 属于社区报告，仅作旁证。
7. 本研究未发送任何模型请求，未验证 `tools` / `tool_choice` 在 M3.1 上的实际行为；上述协议示例未经实机取证。

## 来源

- MiniMax 官方 OpenAI 兼容 Chat Completions OpenAPI：<https://platform.minimax.io/docs/api-reference/text/api/openapi-chat-openai.json>
- MiniMax 官方 OpenAI SDK 文档：<https://platform.minimax.io/docs/api-reference/text-openai-api>
- MiniMax 官方原生文本生成接口文档（含 `response_format` 限定说明）：<https://platform.minimax.io/docs/api-reference/text-post>
- MiniMax 官方原生接口 OpenAPI：<https://platform.minimax.io/docs/api-reference/text/api/openapi-chat.json>
- MiniMax 官方 Responses 兼容接口 OpenAPI：<https://platform.minimax.io/docs/api-reference/text/api/openapi-responses.json>
- MiniMax 官方模型清单：<https://platform.minimax.io/docs/faq/models>
- MiniMax M Plan 接入说明（Other tools）：<https://platform.minimax.io/docs/m-plan/other-tools>
- MiniMax M Plan 概览：<https://platform.minimax.io/docs/m-plan/intro>
- MiniMax M Plan 快速开始：<https://platform.minimax.io/docs/m-plan/quickstart>
- MiniMax M Plan FAQ：<https://platform.minimax.io/docs/m-plan/faq>
- MiniMax 官方 Provider 一致性测试用例文档：<https://github.com/MiniMax-AI/MiniMax-Provider-Verifier/blob/main/m3_format_check/docs/m3_text_cases.md>
- MiniMax 官方 Tool Use 指南：<https://platform.minimax.io/docs/guides/text-m3-function-call>
- 官方文档索引：<https://platform.minimax.io/docs/llms.txt>
- 旁证（非官方陈述）：<https://github.com/MiniMax-AI/MiniMax-M2.5/issues/4>

## 对验收任务的影响

当前 schema-prompt 不承诺生成成功，非法 JSON 必须按既有规格拒绝并保存响应、用量和失败。工具调用不能视为确定性保证，也不能据一次格式失败擅自切换模型或增加预算。v85 失败保留为真实负例，原父已公共取消；以相同模型、策略和预算只做一次新的独立成功路径复验，若同类失败再出现，再闭合有界修正或协议能力方案，禁止无界重跑。研究结论不替代真实成功路径证据。
