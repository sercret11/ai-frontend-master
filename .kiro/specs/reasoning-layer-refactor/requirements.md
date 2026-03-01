# 需求文档

## 简介

本次重构涉及两个核心方向：

1. **推理层多智能体架构重构**：将现有的波次架构（planner → architect → research/page/interaction/state → quality → repair）替换为三层智能体架构（分析层 → 规划层 → 执行层），以实现更清晰的职责分离和更高质量的代码生成。

2. **替换 Vercel AI SDK**：移除 `ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google` 依赖，自行实现轻量级 LLM SDK，直接调用各提供商原生 API，消除兼容性问题（OpenAI responses/chat endpoint 回退、NoOutputGeneratedError、tool context mismatch 等）。

## 术语表

- **Analysis_Layer**：第一层分析层，由4个串行智能体组成（产品需求经理、前端架构师、UI专家、UX专家），负责需求分析和设计决策
- **Planning_Layer**：第二层规划层，即主Agent，接收分析层输出并生成执行计划
- **Execution_Layer**：第三层执行层，由主Agent指挥的多个执行智能体，负责实际代码生成
- **Session_Document**：分析层智能体输出的文档，存储在会话文件系统中
- **Execution_Plan**：主Agent生成的执行计划，描述执行层智能体的任务分配和依赖关系
- **LLM_Client**：自研的轻量级 LLM 调用客户端，直接对接各提供商原生 API
- **Provider_Adapter**：针对特定 LLM 提供商（Anthropic、OpenAI、Google）的适配器
- **Tool_Schema**：工具定义的 JSON Schema，用于 LLM 工具调用
- **Stream_Handler**：流式响应处理器，负责解析各提供商的 SSE 流
- **Blackboard**：智能体间共享数据的黑板模式存储
- **Patch_Intent**：智能体产生的文件变更意图
- **MultiAgentKernel**：多智能体编排内核，负责调度和协调智能体执行
- **Scaffold_Agent**：脚手架智能体，负责生成项目基础结构（manifest、入口文件、路由配置、基础配置）
- **Page_Agent**：页面智能体，负责实现页面级组件、路由视图和页面布局
- **Interaction_Agent**：交互智能体，负责实现交互逻辑、表单处理、事件绑定和用户反馈
- **State_Agent**：状态智能体，负责实现状态管理、store 定义、数据流和 hooks
- **Style_Agent**：样式智能体，负责实现样式系统、主题配置、响应式布局和组件样式
- **Quality_Agent**：质量智能体，负责验证生成代码的完整性、一致性和可运行性
- **Repair_Agent**：修复智能体，负责修复质量门失败的问题并进行针对性修补

## 需求

### 需求 1：分析层串行智能体管线

**用户故事：** 作为系统开发者，我希望将需求分析拆分为4个专业智能体串行执行，以便每个智能体聚焦于自身专业领域并产出结构化文档。

#### 验收标准

1. WHEN 用户提交一个新请求, THE Analysis_Layer SHALL 按照固定顺序依次执行产品需求经理、前端架构师、UI专家、UX专家四个智能体
2. WHEN 产品需求经理智能体执行完成, THE Analysis_Layer SHALL 将其输出文档存储为 Session_Document 并传递给下一个智能体
3. WHEN 前端架构师智能体执行时, THE Analysis_Layer SHALL 将产品需求经理的 Session_Document 作为输入上下文提供
4. WHEN UI专家智能体执行时, THE Analysis_Layer SHALL 将前两个智能体的 Session_Document 作为输入上下文提供
5. WHEN UX专家智能体执行时, THE Analysis_Layer SHALL 将前三个智能体的 Session_Document 作为输入上下文提供
6. WHEN 分析层全部执行完成, THE Analysis_Layer SHALL 产出恰好4份 Session_Document
7. IF 分析层中任一智能体执行失败, THEN THE Analysis_Layer SHALL 中止后续智能体执行并报告失败的智能体标识和错误信息

### 需求 2：规划层主Agent设计

**用户故事：** 作为系统开发者，我希望有一个主Agent接收分析层的全部输出并生成执行计划，以便协调执行层的多个智能体。

#### 验收标准

1. WHEN 分析层产出4份 Session_Document, THE Planning_Layer SHALL 接收全部4份文档作为输入上下文
2. WHEN Planning_Layer 接收到分析层输出, THE Planning_Layer SHALL 生成一份 Execution_Plan，包含任务列表、任务间依赖关系和执行顺序
3. THE Execution_Plan SHALL 为每个任务指定目标执行智能体、任务目标描述和所需工具列表
4. IF Planning_Layer 生成的 Execution_Plan 包含循环依赖, THEN THE Planning_Layer SHALL 检测到循环并返回错误信息
5. WHEN Execution_Plan 生成完成, THE Planning_Layer SHALL 将计划存储到 Blackboard 供执行层读取

### 需求 3：执行层多智能体协调

**用户故事：** 作为系统开发者，我希望执行层能够根据主Agent的执行计划调度多个智能体并行或串行执行，以便高效完成代码生成任务。

#### 验收标准

1. WHEN Execution_Plan 中存在无依赖关系的任务, THE Execution_Layer SHALL 并行执行这些任务
2. WHEN Execution_Plan 中存在依赖关系的任务, THE Execution_Layer SHALL 等待依赖任务完成后再执行后续任务
3. WHEN 执行智能体完成任务, THE Execution_Layer SHALL 收集该智能体产生的 Patch_Intent 并提交到 Blackboard
4. WHEN 多个执行智能体修改同一文件, THE Execution_Layer SHALL 检测冲突并尝试自动合并
5. IF 自动合并失败, THEN THE Execution_Layer SHALL 记录冲突详情并标记为待解决状态
6. WHEN 全部执行任务完成, THE Execution_Layer SHALL 汇总所有 Patch_Intent 并生成最终文件变更集
7. IF 任一执行智能体执行失败, THEN THE Execution_Layer SHALL 将失败信息记录到 Blackboard 并继续执行其他无依赖的任务

### 需求 4：执行层智能体定义与职责

**用户故事：** 作为系统开发者，我希望执行层包含职责明确的专业智能体，每个智能体聚焦于前端项目生成的特定领域，以便通过分工协作高效产出高质量代码。

#### 4.1 智能体清单与职责

执行层包含以下7个智能体，由 Planning_Layer 根据 Execution_Plan 动态调度：

| 智能体 | ID | 职责 | 可用工具 |
|---|---|---|---|
| 脚手架智能体 | `scaffold-agent` | 生成项目基础结构：package.json、入口文件（main.tsx/App.tsx）、路由配置、tsconfig、vite 配置、基础目录结构 | `write`, `apply_diff`, `read` |
| 页面智能体 | `page-agent` | 实现页面级组件、路由视图、页面布局，确保每个路由有对应的页面壳和基础 UI 结构 | `read`, `grep`, `glob`, `apply_diff`, `write` |
| 交互智能体 | `interaction-agent` | 实现交互逻辑：表单处理、事件绑定、用户操作反馈、模态框/抽屉等交互组件、数据校验 | `read`, `grep`, `glob`, `apply_diff`, `write` |
| 状态智能体 | `state-agent` | 实现状态管理：store 定义（zustand/context）、数据流、自定义 hooks、API 调用层、loading/error/success 状态转换 | `read`, `grep`, `glob`, `apply_diff`, `write` |
| 样式智能体 | `style-agent` | 实现样式系统：主题配置、设计 token、全局样式、组件级样式、响应式布局断点、暗色模式支持 | `read`, `grep`, `glob`, `apply_diff`, `write`, `design_search`, `get_color_palette`, `get_typography_pair` |
| 质量智能体 | `quality-agent` | 验证生成代码：检查文件完整性、import 引用一致性、TypeScript 类型正确性、路由可达性、组件导出完整性 | `read`, `grep`, `glob`, `bash` |
| 修复智能体 | `repair-agent` | 修复质量门失败的问题：针对性修补缺失文件、修正 import 路径、补全类型定义、修复运行时错误 | `read`, `grep`, `glob`, `apply_diff`, `write`, `bash` |

#### 4.2 验收标准

1. THE Execution_Layer SHALL 注册上述7个智能体，每个智能体实现 RuntimeAgent 接口
2. WHEN Planning_Layer 生成 Execution_Plan 时, THE Execution_Plan SHALL 仅引用上述7个智能体 ID 作为任务目标
3. FOR EACH 执行层智能体, THE 智能体 SHALL 仅使用其可用工具列表中定义的工具，不得调用未授权的工具
4. WHEN scaffold-agent 执行完成, THE Execution_Layer SHALL 确保项目基础结构已就绪，后续智能体可在此基础上工作
5. WHEN page-agent 和 interaction-agent 并行执行时, THE Execution_Layer SHALL 通过 Blackboard 共享已生成的组件清单以避免重复创建
6. WHEN quality-agent 检测到问题, THE Execution_Layer SHALL 自动触发 repair-agent 进行修复，最多修复2轮
7. IF repair-agent 修复2轮后质量门仍未通过, THEN THE Execution_Layer SHALL 标记任务为降级完成并记录未解决的问题清单

#### 4.3 典型执行依赖关系

```
scaffold-agent (Wave 1)
    ├── page-agent (Wave 2)
    ├── state-agent (Wave 2)
    └── style-agent (Wave 2)
            ├── interaction-agent (Wave 3, 依赖 page + state)
            └── quality-agent (Wave 4, 依赖全部 Wave 2-3)
                    └── repair-agent (Wave 5, 仅在质量门失败时触发)
```

8. THE scaffold-agent SHALL 在 Wave 1 独立执行，不依赖其他执行层智能体
9. THE page-agent、state-agent 和 style-agent SHALL 在 scaffold-agent 完成后可并行执行（Wave 2）
10. THE interaction-agent SHALL 在 page-agent 和 state-agent 完成后执行（Wave 3），因为交互逻辑依赖页面结构和状态定义
11. THE quality-agent SHALL 在所有代码生成智能体完成后执行（Wave 4）
12. THE repair-agent SHALL 仅在 quality-agent 报告失败时按需触发（Wave 5）

### 需求 5：LLM_Client 核心实现

**用户故事：** 作为系统开发者，我希望用自研的 LLM_Client 替换 Vercel AI SDK，以便直接调用各提供商原生 API 并消除兼容性问题。

#### 验收标准

1. THE LLM_Client SHALL 支持 Anthropic、OpenAI、Google 三个提供商的原生 API 调用
2. THE LLM_Client SHALL 通过 Provider_Adapter 模式隔离各提供商的 API 差异
3. WHEN 调用 LLM 时, THE LLM_Client SHALL 支持流式响应（SSE）和非流式响应两种模式
4. WHEN 收到流式响应, THE Stream_Handler SHALL 逐块解析提供商返回的 SSE 数据并输出标准化的文本增量和工具调用事件
5. THE LLM_Client SHALL 接受统一的请求参数格式，包含 system prompt、消息历史、工具定义、温度、topP 和最大输出 token 数
6. WHEN 调用完成, THE LLM_Client SHALL 返回标准化的响应结构，包含生成文本、工具调用列表、完成原因和 token 用量统计

### 需求 6：Provider_Adapter 实现

**用户故事：** 作为系统开发者，我希望每个 LLM 提供商有独立的适配器，以便隔离 API 差异并简化维护。

#### 验收标准

1. THE Provider_Adapter SHALL 为 Anthropic 提供商实现 Messages API（`/v1/messages`）的请求构建和响应解析
2. THE Provider_Adapter SHALL 为 OpenAI 提供商实现 Chat Completions API（`/v1/chat/completions`）的请求构建和响应解析
3. THE Provider_Adapter SHALL 为 Google 提供商实现 Gemini API（`generateContent`）的请求构建和响应解析
4. WHEN 工具定义传入时, THE Provider_Adapter SHALL 将统一的 Tool_Schema 转换为各提供商要求的工具格式
5. WHEN 流式响应到达时, THE Provider_Adapter SHALL 将各提供商特有的 SSE 事件格式转换为统一的内部事件格式
6. THE Provider_Adapter SHALL 将各提供商的错误响应转换为统一的错误类型，包含 HTTP 状态码、错误消息和提供商标识

### 需求 7：工具调用集成

**用户故事：** 作为系统开发者，我希望 LLM_Client 能够与现有工具系统无缝集成，以便智能体可以通过 LLM 调用工具。

#### 验收标准

1. WHEN LLM 返回工具调用请求, THE LLM_Client SHALL 解析工具名称和参数并通过 ToolRegistry 执行对应工具
2. WHEN 工具执行完成, THE LLM_Client SHALL 将工具结果按照各提供商要求的格式注入到后续消息中
3. THE LLM_Client SHALL 支持单次响应中包含多个工具调用的场景
4. WHEN 工具执行过程中发生错误, THE LLM_Client SHALL 将错误信息作为工具结果返回给 LLM 而非中断整个流程
5. THE LLM_Client SHALL 支持配置最大工具调用轮次，防止无限循环

### 需求 8：重试与错误处理

**用户故事：** 作为系统开发者，我希望 LLM_Client 具备健壮的重试和错误处理机制，以便在网络波动或提供商临时故障时保持服务可用。

#### 验收标准

1. WHEN LLM 调用返回 HTTP 429（速率限制）或 5xx 错误, THE LLM_Client SHALL 使用指数退避策略进行重试，最多重试3次
2. WHEN 重试时, THE LLM_Client SHALL 在基础延迟上添加随机抖动以避免雷群效应
3. IF 全部重试均失败, THEN THE LLM_Client SHALL 抛出包含最后一次错误详情的异常
4. WHEN 流式响应中途断开, THE LLM_Client SHALL 检测到连接中断并触发重试逻辑
5. THE LLM_Client SHALL 支持通过 AbortSignal 取消正在进行的 LLM 调用
6. WHEN LLM 返回空响应（无文本且无工具调用）, THE LLM_Client SHALL 自动重试一次，使用降级的 toolChoice 参数


### 需求 9：Vercel AI SDK 依赖移除

**用户故事：** 作为系统开发者，我希望完全移除 Vercel AI SDK 相关依赖，以便消除兼容性问题并减少外部依赖。

#### 验收标准

1. WHEN 重构完成, THE 系统 SHALL 不再包含 `ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google` 依赖
2. WHEN 重构完成, THE 系统 SHALL 不再引用 Vercel AI SDK 的任何导入语句（`import ... from 'ai'`、`import ... from '@ai-sdk/*'`）
3. THE LLM_Client SHALL 替代原有 LLMService 的全部公开接口功能，包括流式响应、工具调用和错误处理
4. WHEN 重构完成, THE 系统 SHALL 保留现有的 ToolRegistry、PromptBuilder、FileStorage、SessionManager 等基础设施不变

### 需求 10：三层架构与现有基础设施集成

**用户故事：** 作为系统开发者，我希望新的三层架构能够与现有的 API 层、WebSocket 层和会话管理无缝集成。

#### 验收标准

1. WHEN 前端通过 REST API 或 WebSocket 发起请求, THE 系统 SHALL 将请求路由到新的三层架构入口
2. WHEN 智能体执行过程中产生事件, THE 系统 SHALL 通过现有的 RuntimeEvent 机制将事件推送到前端
3. THE MultiAgentKernel SHALL 使用新的三层架构替代原有的波次执行逻辑
4. WHEN 执行层智能体调用工具产生文件变更, THE 系统 SHALL 通过现有的 FileStorage 持久化文件内容
5. THE 系统 SHALL 保留现有的 Blackboard 和 EventBus 机制用于智能体间通信

### 需求 11：分析层智能体 Session_Document 格式

**用户故事：** 作为系统开发者，我希望分析层每个智能体的输出文档有明确的结构定义，以便下游智能体和规划层能够可靠地解析和使用。

#### 验收标准

1. THE 产品需求经理智能体 SHALL 输出包含功能需求列表、用户故事和优先级排序的 Session_Document
2. THE 前端架构师智能体 SHALL 输出包含组件树结构、路由设计和状态管理方案的 Session_Document
3. THE UI专家智能体 SHALL 输出包含视觉规范、组件样式定义和响应式布局方案的 Session_Document
4. THE UX专家智能体 SHALL 输出包含交互流程、用户旅程和可用性建议的 Session_Document
5. FOR ALL Session_Document, 序列化为 JSON 后再解析 SHALL 产出与原始文档等价的对象（往返一致性）

### 需求 12：LLM_Client 请求/响应序列化

**用户故事：** 作为系统开发者，我希望 LLM_Client 的请求和响应格式有明确的序列化/反序列化规范，以便调试和日志记录。

#### 验收标准

1. THE LLM_Client SHALL 提供将内部请求对象序列化为各提供商 HTTP 请求体的方法
2. THE LLM_Client SHALL 提供将各提供商 HTTP 响应体反序列化为内部响应对象的方法
3. FOR ALL 有效的内部请求对象, 序列化为提供商格式后再反序列化 SHALL 产出与原始请求等价的对象（往返一致性）
4. FOR ALL 有效的内部响应对象, 序列化为 JSON 后再反序列化 SHALL 产出与原始响应等价的对象（往返一致性）
