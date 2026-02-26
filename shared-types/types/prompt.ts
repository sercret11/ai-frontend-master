/**
 * Prompt Types - 提示词工程类型定义
 * 用于提示词加载、组合和管理
 */

// ============================================================================
// 提示词章节
// ============================================================================

/**
 * 提示词章节优先级
 */
export type PromptPriority = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * 提示词章节接口
 */
export interface PromptSection {
  /** 章节 ID */
  id: string;
  /** 章节标题 */
  title: string;
  /** 章节内容 */
  content: string;
  /** 优先级 */
  priority: PromptPriority;
  /** 章节标签 */
  tags?: string[];
  /** 相关章节 ID */
  relatedSections?: string[];
  /** Token 计数 */
  tokens?: number;
}

/**
 * 提示词章节加载选项
 */
export interface PromptSectionLoadOptions {
  /** 是否包含元数据 */
  includeMetadata?: boolean;
  /** 是否解析前置引用 */
  resolveReferences?: boolean;
  /** 是否验证内容 */
  validate?: boolean;
}

// ============================================================================
// 提示词模板
// ============================================================================

/**
 * 模板变量类型
 */
export type TemplateVariable = string | number | boolean | string[];

/**
 * 诊断严重级别
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

/**
 * 通用诊断项
 */
export interface Diagnostic {
  /** 诊断消息 */
  message: string;
  /** 严重级别 */
  severity: DiagnosticSeverity;
  /** 可选来源 */
  source?: string;
  /** 可选诊断码 */
  code?: string;
  /** 可选文件路径 */
  filePath?: string;
  /** 可选行号 */
  line?: number;
  /** 可选列号 */
  column?: number;
  /** 扩展元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 诊断列表
 */
export type Diagnostics = Diagnostic[];

/**
 * 上下文变量来源
 */
export type PromptContextSource = 'request' | 'session' | 'smart-context' | 'default';

/**
 * Prompt 构建诊断信息
 */
export interface PromptBuildDiagnostics {
  /** 输入上下文 */
  input: {
    userQuery?: string;
    mode?: SessionMode;
    platform?: string;
    techStack?: string[];
  };
  /** 归一化后的上下文 */
  resolved: {
    mode: SessionMode;
    platform?: string;
    techStack: string[];
    sources: {
      mode: PromptContextSource;
      platform: PromptContextSource;
      techStack: PromptContextSource;
    };
  };
  /** 章节检索明细 */
  retrieval: {
    selectedIds: string[];
    excludedIds: string[];
    selectionDetails: {
      p0Count: number;
      p1Count: number;
      p2Count: number;
      p3Count: number;
    };
  };
  /** token 统计 */
  tokens: {
    core: number;
    sections: number;
    total: number;
    measuredTotal?: number;
    driftRatio?: number;
  };
  /** 构建耗时（毫秒） */
  buildTimeMs: number;
  /** 路由摘要 */
  routing?: {
    reason: string;
    confidence: number;
    score?: number;
    version?: string;
    language?: InputLanguage;
    techSignals?: string[];
  };
  budget?: PromptBudgetReport;
}

/**
 * 提示词模板接口
 */
export interface PromptTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description?: string;
  /** 模板内容（可能包含变量占位符） */
  content: string;
  /** 变量定义 */
  variables: Record<string, {
    /** 变量类型 */
    type: 'string' | 'number' | 'boolean' | 'array';
    /** 变量描述 */
    description?: string;
    /** 是否必填 */
    required: boolean;
    /** 默认值 */
    default?: TemplateVariable;
  }>;
}

/**
 * 模板渲染结果
 */
export interface PromptRenderResult {
  /** 渲染后的内容 */
  content: string;
  /** 使用的变量 */
  variables: Record<string, TemplateVariable>;
  /** 缺失的必填变量 */
  missingVariables: string[];
  /** 诊断信息 */
  diagnostics?: Diagnostics;
}

// ============================================================================
// 提示词资源
// ============================================================================

/**
 * 设计风格资源
 */
export interface DesignStyle {
  /** 风格名称 */
  name: string;
  /** 风格描述 */
  description: string;
  /** 关键特征 */
  keyFeatures: string[];
  /** Visual characteristics */
  visualCharacteristics: {
    /** 颜色使用 */
    colors?: string[];
    /** 字体特征 */
    typography?: string[];
    /** 间距特征 */
    spacing?: string;
    /** 圆角特征 */
    borderRadius?: string;
    /** 阴影特征 */
    boxShadow?: string;
  };
  /** 使用场景 */
  useCases: string[];
  /** 示例应用 */
  examples: string[];
  /** 相关风格 */
  relatedStyles?: string[];
  /** 标签 */
  tags?: string[];
  /** 特征 */
  characteristics?: string[];
}

/**
 * 色板资源
 */
export interface ColorPalette {
  /** 色板名称 */
  name: string;
  /** 色板描述 */
  description?: string;
  /** 主色调 */
  primary: string;
  /** 辅助色 */
  secondary?: string;
  /** 背景色 */
  background: string;
  /** 文本色 */
  text: string;
  /** 边框色 */
  border?: string;
  /** 语义色 */
  semantic?: {
    /** 成功色 */
    success?: string;
    /** 警告色 */
    warning?: string;
    /** 错误色 */
    error?: string;
    /** 信息色 */
    info?: string;
  };
  /** 颜色映射 */
  colors?: Record<string, string>;
  /** 渐变色 */
  gradients?: string[];
  /** 标签 */
  tags?: string[];
}

/**
 * 字体组合资源
 */
export interface TypographyPair {
  /** 组合名称 */
  name: string;
  /** 组合描述 */
  description?: string;
  /** 标题字体 */
  headingFont: {
    /** 字体名称 */
    family: string;
    /** 字重 */
    weight: number[];
    /** 字体风格 */
    style?: 'normal' | 'italic';
  };
  /** 正文字体 */
  bodyFont: {
    /** 字体名称 */
    family: string;
    /** 字重 */
    weight: number[];
    /** 字体风格 */
    style?: 'normal' | 'italic';
  };
  /** 适用场景 */
  useCases: string[];
  /** 最佳实践 */
  bestPractices?: string[];
  /** 标题字体族名称 */
  heading?: string;
  /** 正文字体族名称 */
  body?: string;
}

/**
 * 设计 Token
 */
export interface DesignTokens {
  /** 技术栈 */
  techStack: {
    /** 目标平台 */
    platform: 'web' | 'mobile' | 'desktop' | 'miniprogram';
    /** 前端框架 */
    framework: string;
    /** UI 库（可选） */
    uiLibrary?: string;
    /** 样式方案 */
    styling: 'css' | 'scss' | 'tailwind' | 'styled-components' | 'emotion';
  };
  /** 颜色系统 */
  colors: {
    /** 主色 */
    primary: string;
    /** 背景色 */
    background: string;
    /** 文本色 */
    text: string;
    /** 边框色 */
    border?: string;
  };
  /** 字体系统 */
  typography: {
    /** 标题字体 */
    headingFont: string;
    /** 正文字体 */
    bodyFont: string;
    /** 字号比例 */
    fontSize?: Record<string, string>;
  };
  /** 间距系统 */
  spacing?: {
    /** 基础间距 */
    base: string;
    /** 间距比例 */
    scale?: number[];
  };
  /** 圆角 */
  borderRadius?: {
    /** 小圆角 */
    sm: string;
    /** 中圆角 */
    md: string;
    /** 大圆角 */
    lg: string;
  };
  /** 阴影 */
  boxShadow?: {
    /** 小阴影 */
    sm: string;
    /** 中阴影 */
    md: string;
    /** 大阴影 */
    lg: string;
  };
}

// ============================================================================
// Agent 配置
// ============================================================================

/**
 * 会话模式
 */
export type SessionMode = 'creator' | 'implementer';

/**
 * Agent 配置接口
 */
export interface AgentConfig {
  /** Agent ID */
  id: string;
  /** Agent 名称 */
  name: string;
  /** Agent 描述 */
  description?: string;
  /** 会话模式 */
  mode: SessionMode;
  /** 系统提示词（可选，覆盖默认） */
  prompt?: string;
  /** 使用的章节 ID 列表 */
  sections?: string[];
  /** 使用的资源 ID 列表 */
  resources?: string[];
  /** 温度参数 */
  temperature?: number;
  /** 顶部 P 采样 */
  topP?: number;
  /** 最大输出 token 数 */
  maxTokens?: number;
  /** 启用的工具 ID 列表 */
  enabledTools?: string[];
  /** 禁用的工具 ID 列表 */
  disabledTools?: string[];
}

/**
 * Agent 检测参数
 */
export interface AgentDetectionParams {
  /** 用户输入 */
  userQuery: string;
  /** 是否有 PRD */
  hasPRD: boolean;
  /** 是否有技术栈 */
  hasTechStack: boolean;
  /** 是否有 Figma */
  hasFigma: boolean;
  /** 是否有详细需求 */
  hasDetailedRequirements: boolean;
  /** 是否有业务上下文 */
  hasBusinessContext: boolean;
  /** 显式指定的框架（可选） */
  preferredFramework?: string;
  /** 显式指定的 UI 库（可选） */
  preferredUiLibrary?: string;
}

export type UiLibrarySelectionSource = 'explicit' | 'inferred' | 'default' | 'none';

export interface UiLibrarySelection {
  /** UI 库名称 */
  library: string | null;
  /** 选择来源 */
  source: UiLibrarySelectionSource;
  /** 关联框架 */
  framework?: string;
  /** 是否与框架兼容 */
  compatible: boolean;
  /** 决策说明 */
  reason: string;
}

export interface RouteDecisionTrace {
  /** 决策步骤 */
  step: string;
  /** 步骤结论 */
  detail: string;
  /** 证据 */
  evidence?: string[];
}

export interface ClarificationTask {
  /** 是否必须澄清 */
  required: boolean;
  /** 澄清消息 */
  message: string;
  /** 冲突上下文 */
  conflict?: {
    framework: string;
    uiLibrary: string;
  };
  /** 可选建议 */
  suggestions?: string[];
}

/**
 * Agent 检测结果
 */
export interface AgentDetectionResult {
  /** 推荐的 Agent ID */
  agentId: string;
  /** 置信度 (0-100) */
  confidence: number;
  /** 检测分数 */
  score: number;
  /** 原因说明 */
  reasons: string[];
  /** 模式 */
  mode?: SessionMode;
  /** 路由版本 */
  version?: string;
  /** 语言分类 */
  language?: InputLanguage;
  /** 技术信号 */
  techSignals?: string[];
  /** 主框架（若可识别） */
  framework?: string;
  /** UI 库选择结果 */
  uiLibrarySelection?: UiLibrarySelection;
  /** 路由证据链 */
  decisionTrace?: RouteDecisionTrace[];
  /** 是否需要澄清后继续 */
  clarificationTask?: ClarificationTask;
  /** 当前路由是否应阻断执行 */
  blocked?: boolean;
}

export type InputLanguage = 'zh' | 'en' | 'mixed' | 'unknown';

export interface RouteInput {
  userMessage: string;
  requestedAgentId?: string;
  sessionAgentId?: string;
  explicitMode?: SessionMode;
  requestedFramework?: string;
  requestedUiLibrary?: string;
}

export interface RouteDecision {
  agentId: string;
  mode: SessionMode;
  source: 'request' | 'auto' | 'session-default' | 'forced-mode';
  confidence: number;
  score?: number;
  reasons: string[];
  version: string;
  language?: InputLanguage;
  techSignals?: string[];
  framework?: string;
  uiLibrarySelection?: UiLibrarySelection;
  decisionTrace?: RouteDecisionTrace[];
  clarificationTask?: ClarificationTask;
  blocked?: boolean;
}

export interface PromptBudgetReport {
  requestedMaxTokens: number;
  estimatedTotal: number;
  measuredTotal: number;
  overflow: boolean;
  selectedSections: string[];
  excludedSections: string[];
  trims: string[];
}

// ============================================================================
// 双模式路由
// ============================================================================

/**
 * 用户输入分析结果
 */
export interface UserInputAnalysis {
  /** 字数统计 */
  wordCount: number;
  /** 是否包含 PRD 关键词 */
  hasPRD: boolean;
  /** 是否包含 Figma 关键词 */
  hasFigma: boolean;
  /** 是否包含技术栈关键词 */
  hasTechStack: boolean;
  /** 是否包含样式参考关键词 */
  hasStyleReference: boolean;
  /** 是否包含详细需求关键词 */
  hasDetailedRequirements: boolean;
  /** 是否包含业务上下文关键词 */
  hasBusinessContext: boolean;
  /** 是否包含实现/修复/测试等工程执行意图 */
  hasImplementationIntent: boolean;
  /** 提取的平台 */
  platforms?: string[];
  /** 提取的框架 */
  frameworks?: string[];
  /** 提取的 UI 库 */
  uiLibraries?: string[];
  /** 提取的样式 */
  styles?: string[];
}

/**
 * 模式路由分析结果
 */
export interface ModeRouterAnalysis {
  /** 总分 */
  score: number;
  /** 推荐模式 */
  mode: SessionMode;
  /** 置信度 */
  confidence: number;
  /** 分数详情 */
  details: {
    /** 字数分数 */
    wordCountScore: number;
    /** PRD 分数 */
    prdScore: number;
    /** Figma 分数 */
    figmaScore: number;
    /** 技术栈分数 */
    techStackScore: number;
    /** 样式参考分数 */
    styleReferenceScore: number;
    /** 详细需求分数 */
    detailedRequirementsScore: number;
    /** 业务上下文分数 */
    businessContextScore: number;
    /** 实现意图分数 */
    implementationIntentScore: number;
  };
}

// ============================================================================
// 提示词构建
// ============================================================================

/**
 * 提示词构建选项
 */
export interface PromptBuildOptions {
  /** Agent 配置 */
  agent?: AgentConfig;
  /** 会话模式 */
  mode?: SessionMode;
  /** 包含的章节 ID */
  sections?: string[];
  /** 排除的章节 ID */
  excludeSections?: string[];
  /** 包含的资源 */
  resources?: string[];
  /** 模板变量 */
  variables?: Record<string, TemplateVariable>;
}

/**
 * 提示词构建结果
 */
export interface PromptBuildResult {
  /** 构建的提示词 */
  prompt: string;
  /** 使用的章节 */
  sections: PromptSection[];
  /** 使用的资源 */
  resources: Array<DesignStyle | ColorPalette | TypographyPair>;
  /** 使用的变量 */
  variables: Record<string, TemplateVariable>;
  /** Token 估算 */
  estimatedTokens: number;
  /** Prompt 构建诊断信息 */
  diagnostics?: PromptBuildDiagnostics;
  /** 诊断信息 */
  issues?: Diagnostics;
}

// ============================================================================
// 搜索参数
// ============================================================================

/**
 * 设计搜索参数
 */
export interface DesignSearchParams {
  /** 搜索查询 */
  query: string;
  /** 搜索域 */
  domain?: 'style' | 'color' | 'typography' | 'chart' | 'product' | 'ux';
  /** 最大结果数 */
  maxResults?: number;
  /** 最小相似度分数 */
  minScore?: number;
  /** 过滤标签 */
  filterTags?: string[];
}

/**
 * 设计搜索结果
 */
export interface DesignSearchResult {
  /** 搜索域 */
  domain: string;
  /** 搜索查询 */
  query: string;
  /** 结果数量 */
  count: number;
  /** 结果列表 */
  results: Array<{
    /** 资源名称 */
    name: string;
    /** 相似度分数 */
    score: number;
    /** 匹配的内容 */
    content: string | DesignStyle | ColorPalette | TypographyPair;
  }>;
}

// ============================================================================
// 导出所有类型
// ============================================================================

// 注意：所有类型已在前面通过 export interface 定义，此处无需重复导出
