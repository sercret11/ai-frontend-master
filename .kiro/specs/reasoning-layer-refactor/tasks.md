# 实施计划：推理层多智能体架构重构 & 自研 LLM SDK

## 概述

本实施计划将设计文档拆分为增量式编码任务，分为两条主线并行推进：LLM_Client 自研（底层依赖）和三层智能体架构重构（上层架构）。LLM_Client 作为基础设施优先实现，三层架构在其之上构建。每个任务构建在前序任务之上，确保无孤立代码。

## 任务

- [x] 1. 定义核心类型与接口
  - [x] 1.1 创建 LLM_Client 类型定义
    - 创建 `backend/src/llm/types.ts`，定义 `ProviderID`、`LLMRequestParams`、`LLMMessage`、`ContentBlock`、`ToolDefinition`、`LLMResponse`、`ToolCall`、`TokenUsage`、`StreamEvent`、`LLMStreamResult`、`LLMError` 等全部类型
    - _需求: R5.5, R5.6, R12.1, R12.2_

  - [x] 1.2 创建分析层类型定义
    - 创建 `backend/src/analysis/types.ts`，定义 `AnalysisAgentID`、`AnalysisAgent`、`AnalysisContext`、`AnalysisLayerInput`、`AnalysisLayerOutput` 接口
    - 定义 4 种 `SessionDocument` 子类型：`ProductManagerDocument`、`FrontendArchitectDocument`、`UIExpertDocument`、`UXExpertDocument` 及联合类型 `SessionDocument`
    - _需求: R1.1, R1.6, R11.1, R11.2, R11.3, R11.4_

  - [x] 1.3 创建规划层与执行层类型定义
    - 创建 `backend/src/planning/types.ts`，定义 `ExecutionPlanTask`、`ExecutionPlan`、`PlanningLayerInput` 接口
    - 创建 `backend/src/execution/types.ts`，定义 `ExecutionAgentID`、`ExecutionLayerInput`、`ExecutionLayerOutput`、`TaskResult`、`QualityGateState` 接口
    - _需求: R2.2, R2.3, R3.1, R3.6, R4.1_

  - [x] 1.4 扩展 AgentRuntimeID 与 Blackboard 类型
    - 在 `shared-types/types/runtime.ts` 中扩展 `AgentRuntimeID`，新增 `'scaffold-agent'` 和 `'style-agent'`
    - 在 `backend/src/runtime/multi-agent/types.ts` 中新增 `SessionDocument[]` 和 `ExecutionPlan` 相关类型声明
    - _需求: R4.1, R4.2, R10.5_

  - [x] 1.5 编写 SessionDocument 往返一致性属性测试
    - **属性 P1：SessionDocument 往返一致性**
    - 对 4 种 SessionDocument 子类型，验证 `JSON.parse(JSON.stringify(doc))` 与原始文档深度相等
    - **验证: 需求 R11.5**


- [x] 2. 实现 Provider_Adapter 层
  - [x] 2.1 定义 ProviderAdapter 接口
    - 创建 `backend/src/llm/adapters/types.ts`，定义 `ProviderAdapter` 接口（`buildRequest`、`parseResponse`、`parseSSEEvent`、`convertToolDefinition`、`convertError`）
    - _需求: R5.2, R6.4, R6.5, R6.6_

  - [x] 2.2 实现 AnthropicAdapter
    - 创建 `backend/src/llm/adapters/anthropic.ts`，实现 `AnthropicAdapter`
    - 构建 Messages API（`/v1/messages`）请求体，处理 `system` 字段独立于 `messages` 的特殊格式
    - 解析 Anthropic 响应体为统一 `LLMResponse`，处理 `content_block` 中的 `text` 和 `tool_use` 类型
    - 实现 Anthropic SSE 事件解析（`content_block_start`、`content_block_delta`、`content_block_stop`、`message_delta`、`message_stop`）
    - 将统一 `ToolDefinition` 转换为 Anthropic 工具格式（`input_schema`）
    - _需求: R6.1, R6.4, R6.5, R6.6_

  - [x] 2.3 实现 OpenAIAdapter
    - 创建 `backend/src/llm/adapters/openai.ts`，实现 `OpenAIAdapter`
    - **优先支持 Responses API（`/v1/responses`）**：经实测 `.env` 中配置的 `https://vpsairobot.com` 端点仅支持 Responses API，不支持 Chat Completions
    - 构建 Responses API 请求体：`model`、`instructions`（system prompt）、`input`（消息数组）、`tools`
    - 解析 Responses API 响应体为统一 `LLMResponse`，处理 `output[]` 中的 `message` 和 `function_call` 类型
    - 实现 Responses API SSE 事件解析（`response.output_item.added`、`response.content_part.delta`、`response.completed` 等）
    - 同时保留 Chat Completions API（`/v1/chat/completions`）作为备选协议，通过构造函数参数 `protocol: 'responses' | 'chat-completions'` 切换
    - 将统一 `ToolDefinition` 转换为 OpenAI 工具格式（`function.parameters`）
    - _需求: R6.2, R6.4, R6.5, R6.6_

  - [x] 2.4 实现 GoogleAdapter
    - 创建 `backend/src/llm/adapters/google.ts`，实现 `GoogleAdapter`
    - 构建 Gemini API（`generateContent`）请求体，`system` 作为 `systemInstruction`
    - 解析 Google 响应体为统一 `LLMResponse`，处理 `candidates[0].content.parts` 中的 `text` 和 `functionCall`
    - 实现 Google SSE 事件解析
    - 将统一 `ToolDefinition` 转换为 Google `functionDeclarations` 格式
    - _需求: R6.3, R6.4, R6.5, R6.6_

  - [x] 2.5 编写 Provider_Adapter 单元测试
    - 使用真实 LLM 模型调用测试（通过 `.env` 配置的 OpenAI 兼容端点 `OPENAI_BASE_URL` + `AI_DEFAULT_MODEL`）
    - 为 OpenAIAdapter 编写真实请求构建和响应解析测试（使用 Responses API `/v1/responses`）
    - 为 AnthropicAdapter 和 GoogleAdapter 编写请求构建的结构验证测试（若无真实 API Key 则验证请求体格式正确性）
    - 测试工具定义转换的正确性
    - 测试错误响应转换
    - _需求: R6.1, R6.2, R6.3, R6.6_

  - [x] 2.6 编写请求/响应往返一致性属性测试
    - **属性 P2：LLM 请求/响应往返一致性**
    - 使用真实 LLM 端点（`.env` 中 `OPENAI_BASE_URL`）验证 OpenAIAdapter 的 `buildRequest → fetch → parseResponse` 完整往返
    - 对 AnthropicAdapter 和 GoogleAdapter 验证 `buildRequest` 输出格式的结构一致性
    - **验证: 需求 R12.3, R12.4**


- [x] 3. 实现 StreamHandler 与 RetryEngine
  - [x] 3.1 实现 StreamHandler
    - 创建 `backend/src/llm/stream-handler.ts`，实现 `StreamHandler` 类
    - 实现 `parseSSEStream` 异步生成器，从 `Response` 对象读取 SSE 流，按行拆分，调用 `ProviderAdapter.parseSSEEvent` 转换为标准化 `StreamEvent`
    - 处理 SSE 格式：`event:` 行、`data:` 行、空行分隔、`[DONE]` 终止标记
    - _需求: R5.4_

  - [x] 3.2 实现 RetryEngine
    - 创建 `backend/src/llm/retry.ts`，实现 `RetryEngine` 类
    - 实现 `execute<T>` 方法：接受异步函数和 `AbortSignal`，在可重试错误时执行指数退避重试
    - 实现 `calculateDelay`：`baseDelayMs * 2^attempt + random(0, maxJitterMs)`
    - 实现 `isRetryable`：检查 HTTP 状态码是否在 `[429, 500, 502, 503, 504]` 中
    - 默认配置：`maxRetries=3`、`baseDelayMs=2000`、`maxJitterMs=500`
    - 全部重试失败时抛出包含最后一次错误详情的 `LLMError`
    - _需求: R8.1, R8.2, R8.3, R8.5_

  - [x] 3.3 编写 RetryEngine 单元测试
    - 测试指数退避延迟计算
    - 测试可重试状态码判断
    - 测试 AbortSignal 取消行为
    - 测试最大重试次数后抛出异常
    - _需求: R8.1, R8.2, R8.3, R8.5_

  - [x] 3.4 编写重试延迟属性测试
    - **属性 P3：重试延迟单调递增**
    - 验证对于任意 attempt n，`calculateDelay(n+1) >= calculateDelay(n)`（不含抖动部分）
    - **验证: 需求 R8.1**

- [x] 4. 检查点 - 基础设施层验证
  - 确保所有测试通过，如有问题请向用户确认。


- [x] 5. 实现 LLM_Client 核心
  - [x] 5.1 实现 LLMClient 类（非流式调用）
    - 创建 `backend/src/llm/client.ts`，实现 `LLMClient` 类
    - 构造函数接收 `Map<ProviderID, ProviderAdapter>` 和 `RetryEngine`
    - 实现 `complete` 方法：通过适配器构建请求 → `fetch` 发送 → 适配器解析响应 → 返回 `LLMResponse`
    - 集成 `RetryEngine`，对可重试错误自动重试
    - 支持 `AbortSignal` 取消
    - _需求: R5.1, R5.2, R5.5, R5.6, R8.1, R8.5_

  - [x] 5.2 实现 LLMClient 流式调用
    - 在 `LLMClient` 中实现 `stream` 方法
    - 通过适配器构建请求（`stream: true`）→ `fetch` 发送 → `StreamHandler.parseSSEStream` 解析 → 返回 `LLMStreamResult`
    - `LLMStreamResult.events` 为 `AsyncIterable<StreamEvent>`，`response` 为最终聚合的 `Promise<LLMResponse>`
    - 处理流式中途断开的重试逻辑
    - _需求: R5.3, R5.4, R8.4_

  - [x] 5.3 实现 LLMClient 工具调用循环
    - 在 `LLMClient` 中实现 `completeWithTools` 方法
    - 循环逻辑：调用 LLM → 检查 `finishReason` → 若为 `tool_use` 则执行工具 → 将工具结果注入消息 → 再次调用 LLM
    - 支持单次响应中多个工具调用（并行执行工具）
    - 工具执行错误时将错误信息作为 `tool_result`（`isError: true`）返回给 LLM
    - 支持 `maxRounds` 参数防止无限循环，默认 10 轮
    - 空响应（无文本且无工具调用）时自动重试一次
    - _需求: R7.1, R7.2, R7.3, R7.4, R7.5, R8.6_

  - [x] 5.4 编写 LLMClient 单元测试
    - 使用真实 LLM 模型调用测试（通过 `.env` 配置：`OPENAI_BASE_URL` + `AI_DEFAULT_MODEL`，Responses API）
    - 测试 `complete` 方法：发送简单 prompt，验证返回 `LLMResponse` 包含有效 `content` 和 `tokenUsage`
    - 测试 `stream` 方法：验证 `AsyncIterable<StreamEvent>` 能正常迭代并聚合为完整响应
    - 测试 `completeWithTools` 方法：定义简单工具（如 `get_weather`），验证工具调用循环正确执行
    - 测试错误处理：使用无效 API Key 验证 `LLMError` 抛出
    - _需求: R5.1, R5.3, R7.1, R7.5_

  - [x] 5.5 编写工具调用循环终止属性测试
    - **属性 P4：工具调用循环终止性**
    - 使用真实 LLM 调用，定义一个会被反复调用的工具，验证 `completeWithTools` 在 `maxRounds` 轮内必定终止
    - 设置较小的 `maxRounds`（如 3）以控制测试时间和 API 消耗
    - **验证: 需求 R7.5**


- [x] 6. 实现 Analysis_Layer（分析层）
  - [x] 6.1 实现 4 个分析智能体
    - 创建 `backend/src/analysis/agents/` 目录
    - 实现 `ProductManagerAgent`：构建产品需求分析 prompt，解析输出为 `ProductManagerDocument`
    - 实现 `FrontendArchitectAgent`：构建架构设计 prompt（接收 PM 文档作为上下文），解析输出为 `FrontendArchitectDocument`
    - 实现 `UIExpertAgent`：构建 UI 设计 prompt（接收 PM + Architect 文档），解析输出为 `UIExpertDocument`
    - 实现 `UXExpertAgent`：构建 UX 设计 prompt（接收 PM + Architect + UI 文档），解析输出为 `UXExpertDocument`
    - 每个智能体实现 `AnalysisAgent` 接口（`buildPrompt`、`parseOutput`）
    - _需求: R1.1, R1.3, R1.4, R1.5, R11.1, R11.2, R11.3, R11.4_

  - [x] 6.2 实现 AnalysisLayer 串行管线
    - 创建 `backend/src/analysis/analysis-layer.ts`，实现 `AnalysisLayer` 类
    - `run` 方法按固定顺序（PM → Architect → UI → UX）串行执行 4 个智能体
    - 每个智能体执行时，将前序所有智能体的 `SessionDocument` 作为 `AnalysisContext.previousDocuments` 传入
    - 每个智能体完成后通过 `LLMClient` 调用 LLM，将输出存储为 `SessionDocument`
    - 任一智能体失败时中止后续执行，返回 `{ success: false, failedAgentId, error }`
    - 成功时返回 `{ success: true, documents: [4份] }`
    - 通过 `emitRuntimeEvent` 发送每个智能体的开始/完成事件
    - _需求: R1.1, R1.2, R1.6, R1.7_

  - [x] 6.3 编写 AnalysisLayer 单元测试
    - 使用真实 LLM 模型调用测试（通过 `.env` 配置的 OpenAI Responses API 端点）
    - 测试串行执行顺序：验证 4 个智能体按 PM → Architect → UI → UX 顺序执行
    - 测试上下文累积传递：验证第 N 个智能体接收前 N-1 份文档
    - 测试成功时产出恰好 4 份 `SessionDocument`，每份包含有效内容
    - 测试中途失败中止行为（可通过传入无效 prompt 触发）
    - _需求: R1.1, R1.6, R1.7_

  - [x] 6.4 编写分析层上下文累积属性测试
    - **属性 P5：分析层上下文累积**
    - 使用真实 LLM 调用执行完整分析层管线，验证第 N 个智能体（N ∈ {1,2,3,4}）接收到的 `previousDocuments` 长度恰好为 N-1
    - **验证: 需求 R1.3, R1.4, R1.5**


- [x] 7. 实现 Planning_Layer（规划层）
  - [x] 7.1 实现 PlanningLayer 核心逻辑
    - 创建 `backend/src/planning/planning-layer.ts`，实现 `PlanningLayer` 类
    - `run` 方法接收 4 份 `SessionDocument`，构建 prompt 调用 LLM 生成 `ExecutionPlan`
    - 解析 LLM 输出为结构化的 `ExecutionPlan`（任务列表、依赖关系、智能体分配、工具列表）
    - 验证生成的 `ExecutionPlan` 仅引用 7 个合法的 `ExecutionAgentID`
    - 将生成的 `ExecutionPlan` 存储到 `Blackboard`
    - _需求: R2.1, R2.2, R2.3, R2.5_

  - [x] 7.2 实现循环依赖检测
    - 在 `PlanningLayer` 中实现 `detectCycle` 私有方法
    - 使用 Kahn 算法（拓扑排序）检测 `ExecutionPlanTask[]` 中的循环依赖
    - 发现循环时返回错误信息，包含参与循环的任务 ID
    - 在 `run` 方法中，生成计划后调用 `detectCycle` 验证
    - _需求: R2.4_

  - [x] 7.3 编写 PlanningLayer 单元测试
    - 使用真实 LLM 模型调用测试（通过 `.env` 配置的 OpenAI Responses API 端点）
    - 测试正常计划生成流程：传入 4 份 SessionDocument，验证 LLM 返回有效的 `ExecutionPlan`
    - 测试循环依赖检测（有环 / 无环 / 自环）
    - 测试非法智能体 ID 拒绝
    - _需求: R2.1, R2.4_

  - [x] 7.4 编写执行计划 DAG 属性测试
    - **属性 P6：执行计划无环**
    - 验证对于任意合法的 `ExecutionPlan`，`detectCycle` 返回 `false`（即任务依赖图为 DAG）
    - **验证: 需求 R2.4**

- [x] 8. 检查点 - 分析层与规划层验证
  - 确保所有测试通过，如有问题请向用户确认。


- [x] 9. 实现 Execution_Layer（执行层）
  - [x] 9.1 实现执行层智能体注册与定义
    - 创建 `backend/src/execution/agents/` 目录
    - 为 7 个执行层智能体（scaffold、page、interaction、state、style、quality、repair）创建实现文件，每个实现 `RuntimeAgent` 接口
    - 为每个智能体配置可用工具白名单（按需求 R4.1 表格定义）
    - 新增 `scaffold-agent` 和 `style-agent` 的 prompt 模板（在 `backend/prompts/` 下）
    - _需求: R4.1, R4.2, R4.3_

  - [x] 9.2 实现波次调度器（scheduleWaves）
    - 创建 `backend/src/execution/execution-layer.ts`，实现 `ExecutionLayer` 类
    - 实现 `scheduleWaves` 私有方法：根据 `ExecutionPlanTask.dependsOn` 将任务分组为波次
    - 使用拓扑排序确定执行顺序，无依赖任务归入同一波次
    - 典型波次：Wave 1（scaffold）→ Wave 2（page, state, style）→ Wave 3（interaction）→ Wave 4（quality）→ Wave 5（repair，条件触发）
    - _需求: R3.1, R3.2, R4.8, R4.9, R4.10_

  - [x] 9.3 实现波次并行执行（runWave）
    - 实现 `runWave` 私有方法：使用 `Promise.allSettled` 并行执行同一波次内的所有任务
    - 每个任务通过 `LLMClient.completeWithTools` 调用 LLM，使用智能体的工具白名单
    - 收集每个任务产生的 `PatchIntent` 并提交到 `Blackboard`
    - 单个任务失败不阻塞同波次其他任务，失败信息记录到 `Blackboard`
    - _需求: R3.1, R3.3, R3.7_

  - [x] 9.4 实现冲突检测与合并
    - 实现 `detectAndMergeConflicts` 私有方法
    - 检测同一波次内多个智能体修改同一文件的情况
    - 尝试自动合并（基于现有 `patch-crdt.ts` 的 CRDT 合并逻辑）
    - 合并失败时记录冲突详情并标记为待解决
    - _需求: R3.4, R3.5_

  - [x] 9.5 实现质量门与修复循环
    - 实现 `runQualityRepairLoop` 私有方法
    - `quality-agent` 执行后检查结果，失败时触发 `repair-agent`
    - 最多执行 2 轮修复循环
    - 2 轮后仍失败则标记为降级完成，记录未解决问题清单到 `ExecutionLayerOutput.unresolvedIssues`
    - _需求: R4.6, R4.7, R4.11, R4.12_

  - [x] 9.6 实现 ExecutionLayer.run 主流程
    - 串联 `scheduleWaves` → 逐波次 `runWave` → `detectAndMergeConflicts` → `runQualityRepairLoop`
    - 通过 Blackboard 共享组件清单（`addGeneratedComponents` / `getGeneratedComponents`），供 page-agent 和 interaction-agent 协调
    - 汇总所有 `PatchIntent` 生成最终 `ExecutionLayerOutput`
    - 通过 `emitRuntimeEvent` 发送波次进度事件
    - _需求: R3.6, R4.4, R4.5_

  - [x] 9.7 编写 ExecutionLayer 单元测试
    - 使用真实 LLM 模型调用测试（通过 `.env` 配置的 OpenAI Responses API 端点）
    - 测试波次调度正确性（依赖关系 → 波次分组）
    - 测试并行执行与单任务失败隔离
    - 测试质量修复循环（0轮/1轮/2轮/降级）
    - _需求: R3.1, R3.2, R3.7, R4.6, R4.7_

  - [x] 9.8 编写波次调度属性测试
    - **属性 P7：波次调度依赖正确性**
    - 验证对于任意 `ExecutionPlan`，`scheduleWaves` 产出的波次序列中，每个任务的所有依赖任务都在更早的波次中
    - **验证: 需求 R3.1, R3.2**

  - [x] 9.9 编写质量修复循环终止属性测试
    - **属性 P8：质量修复循环有界终止**
    - 验证 `runQualityRepairLoop` 最多执行 `maxRounds + 1` 次（1 次质量检查 + maxRounds 次修复），默认最多 3 次
    - **验证: 需求 R4.6, R4.7**


- [x] 10. 实现 Blackboard 扩展
  - [x] 10.1 扩展 MultiAgentBlackboard
    - 修改 `backend/src/runtime/multi-agent/blackboard.ts`
    - 新增 `setSessionDocuments` / `getSessionDocuments` 方法，存储和读取分析层文档
    - 新增 `setExecutionPlan` / `getExecutionPlan` 方法，存储和读取执行计划
    - 新增 `addGeneratedComponents` / `getGeneratedComponents` 方法，支持组件清单共享
    - _需求: R2.5, R4.5, R10.5_

- [x] 11. 实现 ThreeLayerOrchestrator 并集成
  - [x] 11.1 实现 ThreeLayerOrchestrator
    - 创建 `backend/src/orchestration/three-layer-orchestrator.ts`，实现 `ThreeLayerOrchestrator` 类
    - 构造函数注入 `AnalysisLayer`、`PlanningLayer`、`ExecutionLayer`、`MultiAgentBlackboard`、`MultiAgentEventBus`
    - 实现 `run` 方法：Analysis_Layer.run → 存储文档到 Blackboard → Planning_Layer.run → 存储计划到 Blackboard → Execution_Layer.run
    - 处理各层错误，通过 `RuntimeEvent` 向前端推送进度
    - _需求: R10.1, R10.2, R10.3_

  - [x] 11.2 替换 MultiAgentKernel 调用点
    - 修改 `backend/src/runtime/multi-agent/kernel.ts`，将 `MultiAgentKernel.run()` 内部逻辑替换为调用 `ThreeLayerOrchestrator.run()`
    - 保持 `MultiAgentKernel` 的公开接口不变，确保 API 层和 WebSocket 层无需修改
    - 确保现有的 `RuntimeEvent` 事件推送机制继续工作
    - _需求: R10.1, R10.2, R10.3_

  - [x] 11.3 集成 LLMClient 替换 LLMService
    - 创建 `backend/src/llm/index.ts` 作为 LLMClient 的工厂/入口，初始化 3 个 ProviderAdapter 和 RetryEngine
    - 修改所有引用 `backend/src/llm/service.ts`（`LLMService`）的文件，替换为使用 `LLMClient`
    - 确保 `ToolRegistry`、`PromptBuilder`、`FileStorage`、`SessionManager` 等基础设施保持不变
    - _需求: R5.1, R5.2, R9.3, R9.4, R10.4_

  - [x] 11.4 编写 ThreeLayerOrchestrator 集成测试
    - 使用真实 LLM 模型调用进行端到端集成测试（通过 `.env` 配置的 OpenAI Responses API 端点）
    - 测试三层完整流程：Analysis → Planning → Execution 串联执行
    - 测试分析层失败时的错误传播
    - 测试规划层循环依赖时的错误处理
    - _需求: R10.1, R10.2, R10.3_

- [x] 12. 检查点 - 三层架构集成验证
  - 确保所有测试通过，如有问题请向用户确认。


- [x] 13. 移除 Vercel AI SDK 依赖
  - [x] 13.1 移除 Vercel AI SDK 导入与引用
    - 搜索并移除所有 `import ... from 'ai'`、`import ... from '@ai-sdk/anthropic'`、`import ... from '@ai-sdk/openai'`、`import ... from '@ai-sdk/google'` 导入语句
    - 移除 `backend/src/llm/service.ts` 中的 Vercel AI SDK 相关 workaround 代码（OpenAI responses/chat endpoint 回退、NoOutputGeneratedError 处理等）
    - 确认所有调用点已迁移到 `LLMClient`
    - _需求: R9.1, R9.2, R9.3_

  - [x] 13.2 移除 Vercel AI SDK 包依赖
    - 从 `backend/package.json` 中移除 `ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google` 依赖
    - 从根 `package.json` 中移除相关依赖（如有）
    - 运行 `npm install` 更新 lock 文件
    - 验证编译通过，无遗留的 Vercel AI SDK 引用
    - _需求: R9.1, R9.2_

- [x] 14. 最终检查点 - 全量验证
  - 确保所有测试通过，如有问题请向用户确认。
  - 验证无 Vercel AI SDK 残留引用
  - 验证三层架构端到端流程正常

## 备注

- 所有任务均为必选，包括单元测试和属性测试
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点任务用于增量验证，确保每个阶段的正确性
- 属性测试验证设计文档中定义的正确性属性（P1-P8）
- 单元测试验证具体的边界条件和错误场景
- LLM_Client（任务 1-5）作为基础设施优先实现，三层架构（任务 6-11）在其之上构建
- **测试环境配置**：所有涉及 LLM 调用的测试均使用 `.env` 中配置的真实模型端点，不使用 mock
  - 端点：`OPENAI_BASE_URL=https://vpsairobot.com`，模型：`AI_DEFAULT_MODEL=gpt-5.3-codex`
  - **重要**：该端点仅支持 OpenAI Responses API（`/v1/responses`），不支持 Chat Completions（`/v1/chat/completions`）
  - 纯逻辑测试（如 1.5 SessionDocument 往返、3.3/3.4 RetryEngine、9.8 波次调度）不涉及 LLM 调用，无需真实端点
