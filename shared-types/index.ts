/**
 * FrontendMaster AI - 统一类型定义
 *
 * 这个文件包含所有示例代码中使用的统一类型定义
 * 确保跨平台、跨层级的一致性
 */

// ============================================================================
// 导入新的类型定义
// ============================================================================

import type { ReactNode, KeyboardEvent } from 'react';

// Session & Message types
export * from './types/session';

// Tool system types
export * from './types/tool';

// Runtime event types
export * from './types/runtime';
export * from './types/rendering';

// Prompt engineering types
export * from './types/prompt';

// File storage types
export * from './types/files';

// Validation types
export * from './types/validation';

// Repair system types
export * from './types/repair';

// ============================================================================
// 核心 API 类型
// ============================================================================

/**
 * 统一 API 响应类型
 * 用于所有 API 调用的标准化响应格式
 */
export interface ApiResponse<T = unknown> {
  /** 请求是否成功 */
  success: boolean
  /** 响应数据 */
  data?: T
  /** 错误信息 */
  error?: string
  /** 元数据（分页等） */
  meta?: {
    /** 总记录数 */
    total?: number
    /** 当前页码 */
    page?: number
    /** 每页记录数 */
    limit?: number
    /** 总页数 */
    totalPages?: number
  }
}

/**
 * 统一的分页参数
 */
export interface PaginationParams {
  /** 页码（从1开始） */
  page: number
  /** 每页记录数 */
  limit: number
}

/**
 * 排序参数
 */
export interface SortParams {
  /** 排序字段 */
  field: string
  /** 排序方向 */
  order: 'asc' | 'desc'
}

/**
 * 查询过滤器
 */
export interface QueryFilters {
  /** 搜索关键词 */
  search?: string
  /** 状态过滤 */
  status?: string
  /** 日期范围 */
  dateFrom?: string
  dateTo?: string
  /** 其他自定义过滤条件 */
  [key: string]: unknown
}

// ============================================================================
// 用户和认证类型
// ============================================================================

/**
 * 统一用户类型
 * 跨所有平台和层级使用
 */
export interface User {
  /** 用户唯一标识 */
  id: string
  /** 用户名 */
  username: string
  /** 电子邮件 */
  email: string
  /** 显示名称 */
  displayName?: string
  /** 头像 URL */
  avatar?: string
  /** 用户角色 */
  role: UserRole
  /** 账号状态 */
  status: UserStatus
  /** 创建时间 */
  createdAt: Date | string
  /** 最后更新时间 */
  updatedAt: Date | string
}

/**
 * 用户角色
 */
export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'moderator'
  | 'user'
  | 'guest'

/**
 * 用户状态
 */
export type UserStatus =
  | 'active'
  | 'inactive'
  | 'suspended'
  | 'pending'
  | 'deleted'

/**
 * 认证令牌
 */
export interface AuthToken {
  /** 访问令牌 */
  accessToken: string
  /** 刷新令牌 */
  refreshToken: string
  /** 令牌类型 */
  tokenType: 'Bearer'
  /** 过期时间（秒） */
  expiresIn: number
}

/**
 * 登录请求
 */
export interface LoginRequest {
  /** 电子邮件或用户名 */
  emailOrUsername: string
  /** 密码 */
  password: string
  /** 记住我 */
  rememberMe?: boolean
}

/**
 * 注册请求
 */
export interface RegisterRequest {
  /** 用户名 */
  username: string
  /** 电子邮件 */
  email: string
  /** 密码 */
  password: string
  /** 确认密码 */
  confirmPassword: string
}

// ============================================================================
// 平台类型
// ============================================================================

/**
 * 支持的平台类型
 */
export type Platform =
  | 'web'
  | 'mobile'
  | 'miniprogram'
  | 'desktop'
  | 'ios'
  | 'android'

/**
 * 平台特定配置
 */
export interface PlatformConfig {
  /** 平台类型 */
  platform: Platform
  /** 是否支持触摸 */
  touchSupported: boolean
  /** 屏幕尺寸 */
  screenSize: {
    width: number
    height: number
  }
  /** 安全区域 */
  safeArea: {
    top: number
    bottom: number
    left: number
    right: number
  }
}

/**
 * 响应式断点
 */
export type Breakpoint = 'sm' | 'md' | 'lg' | 'xl' | '2xl'

export interface Breakpoints {
  sm: 640
  md: 768
  lg: 1024
  xl: 1280
  '2xl': 1536
}

// ============================================================================
// 表单和验证类型
// ============================================================================

/**
 * 表单字段验证规则
 */
export interface ValidationRule {
  /** 是否必填 */
  required?: boolean
  /** 最小长度 */
  minLength?: number
  /** 最大长度 */
  maxLength?: number
  /** 最小值 */
  min?: number
  /** 最大值 */
  max?: number
  /** 正则表达式 */
  pattern?: RegExp
  /** 自定义验证函数 */
  validate?: (value: unknown) => boolean | string
  /** 错误消息 */
  message?: string
}

/**
 * 表单字段状态
 */
export interface FieldState<T = unknown> {
  /** 字段值 */
  value: T
  /** 是否被触摸过 */
  touched: boolean
  /** 是否脏（被修改过） */
  dirty: boolean
  /** 验证错误 */
  error?: string
}

/**
 * 表单状态
 */
export interface FormState<T extends Record<string, unknown>> {
  /** 表单数据 */
  values: T
  /** 字段状态 */
  fields: {
    [K in keyof T]: FieldState<T[K]>
  }
  /** 表单是否有效 */
  isValid: boolean
  /** 是否正在提交 */
  isSubmitting: boolean
  /** 提交错误 */
  submitError?: string
}

// ============================================================================
// 错误处理类型
// ============================================================================

/**
 * 应用错误类
 */
export class AppError extends Error {
  constructor(
    /** 错误代码 */
    public code: string,
    /** HTTP 状态码 */
    public statusCode: number,
    message: string,
    /** 错误详情 */
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * 验证错误
 */
export class ValidationError extends AppError {
  constructor(message: string, public fieldErrors?: Record<string, string[]>) {
    super('VALIDATION_ERROR', 400, message)
    this.name = 'ValidationError'
  }
}

/**
 * 认证错误
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed') {
    super('AUTHENTICATION_ERROR', 401, message)
    this.name = 'AuthenticationError'
  }
}

/**
 * 权限错误
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Permission denied') {
    super('AUTHORIZATION_ERROR', 403, message)
    this.name = 'AuthorizationError'
  }
}

/**
 * 网络错误
 */
export class NetworkError extends AppError {
  constructor(message: string = 'Network request failed') {
    super('NETWORK_ERROR', 0, message)
    this.name = 'NetworkError'
  }
}

// ============================================================================
// 组件 Props 类型
// ============================================================================

/**
 * 基础按钮 Props
 */
export interface BaseButtonProps {
  /** 按钮内容 */
  children: ReactNode
  /** 是否禁用 */
  disabled?: boolean
  /** 加载状态 */
  loading?: boolean
  /** 点击事件 */
  onClick?: () => void
  /** 按钮类型 */
  type?: 'button' | 'submit' | 'reset'
}

/**
 * 按钮变体
 */
export type ButtonVariant =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'danger'
  | 'ghost'
  | 'outline'

/**
 * 按钮尺寸
 */
export type ButtonSize = 'sm' | 'md' | 'lg'

/**
 * 完整按钮 Props
 */
export interface ButtonProps extends BaseButtonProps {
  /** 按钮变体 */
  variant?: ButtonVariant
  /** 按钮尺寸 */
  size?: ButtonSize
  /** 完整宽度 */
  fullWidth?: boolean
  /** 图标 */
  icon?: ReactNode
  /** 图标位置 */
  iconPosition?: 'left' | 'right'
}

/**
 * 输入框 Props
 */
export interface InputProps {
  /** 输入框名称 */
  name?: string
  /** 输入框值 */
  value?: string
  /** 默认值 */
  defaultValue?: string
  /** 占位符 */
  placeholder?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 是否只读 */
  readOnly?: boolean
  /** 是否必填 */
  required?: boolean
  /** 输入类型 */
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url'
  /** 最大长度 */
  maxLength?: number
  /** 变更事件 */
  onChange?: (value: string) => void
  /** 焦点事件 */
  onFocus?: () => void
  /** 失焦事件 */
  onBlur?: () => void
  /** 键盘事件 */
  onKeyDown?: (event: KeyboardEvent) => void
}

/**
 * 卡片 Props
 */
export interface CardProps {
  /** 卡片内容 */
  children: ReactNode
  /** 卡片标题 */
  title?: string
  /** 卡片副标题 */
  subtitle?: string
  /** 是否可点击 */
  clickable?: boolean
  /** 点击事件 */
  onClick?: () => void
  /** 加载状态 */
  loading?: boolean
  /** 是否显示阴影 */
  shadow?: boolean
}

// ============================================================================
// 数据模型类型
// ============================================================================

/**
 * 分页数据
 */
export interface PaginatedData<T> {
  /** 数据列表 */
  items: T[]
  /** 分页信息 */
  pagination: {
    /** 当前页码 */
    page: number
    /** 每页记录数 */
    limit: number
    /** 总记录数 */
    total: number
    /** 总页数 */
    totalPages: number
    /** 是否有下一页 */
    hasNext: boolean
    /** 是否有上一页 */
    hasPrev: boolean
  }
}

/**
 * 选择器选项
 */
export interface SelectOption<T = string> {
  /** 选项值 */
  value: T
  /** 选项标签 */
  label: string
  /** 是否禁用 */
  disabled?: boolean
  /** 选项图标 */
  icon?: ReactNode
}

/**
 * 标签
 */
export interface Tag {
  /** 标签 ID */
  id: string
  /** 标签名称 */
  name: string
  /** 标签颜色 */
  color?: string
  /** 标签类型 */
  type?: 'default' | 'success' | 'warning' | 'danger' | 'info'
}

// ============================================================================
// 通知和消息类型
// ============================================================================

/**
 * 通知类型
 */
export type NotificationType =
  | 'success'
  | 'error'
  | 'warning'
  | 'info'

/**
 * 通知消息
 */
export interface Notification {
  /** 通知 ID */
  id: string
  /** 通知类型 */
  type: NotificationType
  /** 通知标题 */
  title?: string
  /** 通知内容 */
  message: string
  /** 显示时长（毫秒） */
  duration?: number
  /** 是否可关闭 */
  closable?: boolean
  /** 创建时间 */
  createdAt: Date
}

/**
 * Toast 位置
 */
export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'

// ============================================================================
// 文件类型
// ============================================================================

/**
 * 文件上传状态
 */
export type FileUploadStatus =
  | 'pending'
  | 'uploading'
  | 'success'
  | 'error'

/**
 * 上传的文件
 */
export interface UploadFile {
  /** 文件 ID */
  id: string
  /** 文件名 */
  name: string
  /** 文件大小（字节） */
  size: number
  /** 文件类型 */
  type: string
  /** 上传状态 */
  status: FileUploadStatus
  /** 上传进度（0-100） */
  progress: number
  /** 文件 URL */
  url?: string
  /** 错误消息 */
  error?: string
}

// ============================================================================
// 用户 DTO 类型
// ============================================================================

/**
 * 用户创建 DTO (Data Transfer Object)
 * 用于创建用户时的数据传输
 */
export interface CreateUserDto {
  /** 用户名 (必填, 3-20个字符) */
  username: string
  /** 邮箱地址 (必填, 格式验证) */
  email: string
  /** 密码 (必填, 最少6位) */
  password: string
  /** 用户角色 (可选, 默认为 user) */
  role?: UserRole
}

/**
 * 用户更新 DTO
 * 用于更新用户信息
 */
export interface UpdateUserDto {
  /** 用户名 (可选) */
  username?: string
  /** 邮箱地址 (可选) */
  email?: string
  /** 头像 URL (可选) */
  avatar?: string
  /** 显示名称 (可选) */
  displayName?: string
  /** 用户角色 (可选) */
  role?: UserRole
  /** 用户状态 (可选) */
  status?: UserStatus
}

/**
 * 用户上下文接口
 * 用于在应用中传递当前用户信息
 */
export interface UserContext {
  /** 当前用户 */
  user: User | null
  /** 是否已登录 */
  isAuthenticated: boolean
  /** 是否加载中 */
  isLoading: boolean
  /** 登录方法 */
  login: (email: string, password: string) => Promise<void>
  /** 登出方法 */
  logout: () => Promise<void>
  /** 更新用户信息 */
  updateUser: (data: UpdateUserDto) => Promise<User>
}

// ============================================================================
// 产品类型
// ============================================================================

/**
 * 产品类别
 */
export type ProductCategory =
  | 'electronics'
  | 'clothing'
  | 'food'
  | 'books'
  | 'home'
  | 'other'

/**
 * 产品状态
 */
export type ProductStatus =
  | 'available'
  | 'out_of_stock'
  | 'discontinued'

/**
 * 产品接口
 * 所有平台共享的产品数据结构
 */
export interface Product {
  /** 产品唯一标识 */
  id: string
  /** 产品名称 */
  name: string
  /** 产品描述 */
  description: string
  /** 产品价格 */
  price: number
  /** 产品图片 URL 列表 */
  images: string[]
  /** 产品类别 */
  category: ProductCategory
  /** 库存数量 */
  stock: number
  /** 产品状态 */
  status: ProductStatus
  /** 产品标签 */
  tags: string[]
  /** 创建时间 */
  createdAt: Date | string
  /** 更新时间 */
  updatedAt: Date | string
}

/**
 * 产品创建 DTO
 */
export interface CreateProductDto {
  /** 产品名称 (必填, 1-100个字符) */
  name: string
  /** 产品描述 (必填) */
  description: string
  /** 产品价格 (必填, 大于0) */
  price: number
  /** 产品图片 URL 列表 (可选) */
  images?: string[]
  /** 产品类别 (必填) */
  category: ProductCategory
  /** 库存数量 (必填, 大于等于0) */
  stock: number
  /** 产品标签 (可选) */
  tags?: string[]
}

/**
 * 产品更新 DTO
 */
export interface UpdateProductDto {
  /** 产品名称 (可选) */
  name?: string
  /** 产品描述 (可选) */
  description?: string
  /** 产品价格 (可选) */
  price?: number
  /** 产品图片 URL 列表 (可选) */
  images?: string[]
  /** 产品类别 (可选) */
  category?: ProductCategory
  /** 库存数量 (可选) */
  stock?: number
  /** 产品状态 (可选) */
  status?: ProductStatus
  /** 产品标签 (可选) */
  tags?: string[]
}

/**
 * 产品过滤参数接口
 */
export interface ProductFilters {
  /** 类别过滤 */
  category?: ProductCategory
  /** 状态过滤 */
  status?: ProductStatus
  /** 价格范围 - 最小值 */
  minPrice?: number
  /** 价格范围 - 最大值 */
  maxPrice?: number
  /** 搜索关键词 */
  search?: string
  /** 标签过滤 */
  tags?: string[]
  /** 排序字段 */
  sortBy?: 'name' | 'price' | 'createdAt' | 'stock'
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc'
}

/**
 * 购物车项接口
 */
export interface CartItem {
  /** 产品 */
  product: Product
  /** 数量 */
  quantity: number
}

/**
 * 购物车接口
 */
export interface Cart {
  /** 购物车项列表 */
  items: CartItem[]
  /** 总价 */
  total: number
  /** 添加产品 */
  addItem: (product: Product, quantity?: number) => void
  /** 移除产品 */
  removeItem: (productId: string) => void
  /** 更新数量 */
  updateQuantity: (productId: string, quantity: number) => void
  /** 清空购物车 */
  clear: () => void
}

// ============================================================================
// API 客户端类型
// ============================================================================

/**
 * HTTP 方法类型
 */
export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'

/**
 * API 请求配置接口
 */
export interface ApiRequestConfig {
  /** 请求 URL */
  url: string
  /** HTTP 方法 */
  method: HttpMethod
  /** 请求头 */
  headers?: Record<string, string>
  /** 请求体 */
  body?: unknown
  /** 查询参数 */
  params?: Record<string, string | number>
  /** 超时时间 (毫秒) */
  timeout?: number
  /** 是否携带认证信息 */
  withAuth?: boolean
  /** 请求取消信号 */
  signal?: AbortSignal
}

/**
 * API 客户端接口
 * 定义所有平台必须实现的 API 客户端方法
 */
export interface ApiClient {
  /** GET 请求 */
  get<T>(url: string, config?: Partial<ApiRequestConfig>): Promise<ApiResponse<T>>
  /** POST 请求 */
  post<T>(
    url: string,
    data?: unknown,
    config?: Partial<ApiRequestConfig>
  ): Promise<ApiResponse<T>>
  /** PUT 请求 */
  put<T>(
    url: string,
    data?: unknown,
    config?: Partial<ApiRequestConfig>
  ): Promise<ApiResponse<T>>
  /** PATCH 请求 */
  patch<T>(
    url: string,
    data?: unknown,
    config?: Partial<ApiRequestConfig>
  ): Promise<ApiResponse<T>>
  /** DELETE 请求 */
  delete<T>(url: string, config?: Partial<ApiRequestConfig>): Promise<ApiResponse<T>>
  /** 设置认证令牌 */
  setAuthToken(token: string): void
  /** 清除认证令牌 */
  clearAuthToken(): void
  /** 设置基础 URL */
  setBaseURL(url: string): void
  /** 设置请求拦截器 */
  setRequestInterceptor(
    interceptor: (config: ApiRequestConfig) => ApiRequestConfig
  ): void
  /** 设置响应拦截器 */
  setResponseInterceptor(
    interceptor: (response: ApiResponse) => ApiResponse
  ): void
}

/**
 * 请求日志接口
 */
export interface RequestLog {
  /** 请求 ID */
  id: string
  /** 请求 URL */
  url: string
  /** HTTP 方法 */
  method: HttpMethod
  /** 请求体 */
  body?: unknown
  /** 时间戳 */
  timestamp: string
  /** 响应状态码 */
  statusCode?: number
  /** 响应时间 (毫秒) */
  responseTime?: number
  /** 是否成功 */
  success?: boolean
  /** 错误信息 */
  error?: string
}

/**
 * 缓存配置接口
 */
export interface CacheConfig {
  /** 是否启用缓存 */
  enabled: boolean
  /** 缓存过期时间 (毫秒) */
  ttl: number
  /** 缓存键前缀 */
  prefix?: string
  /** 是否忽略查询参数 */
  ignoreParams?: boolean
}

/**
 * 重试配置接口
 */
export interface RetryConfig {
  /** 最大重试次数 */
  maxAttempts: number
  /** 重试延迟 (毫秒) */
  delay: number
  /** 是否重试的条件函数 */
  shouldRetry?: (error: Error) => boolean
  /** 重试延迟计算函数 */
  retryDelay?: (attemptNumber: number) => number
}

/**
 * HTTP 错误类
 */
export class HttpError extends AppError {
  constructor(
    message: string,
    statusCode: number,
    code?: string,
    details?: Record<string, unknown>
  ) {
    super(code || 'HTTP_ERROR', statusCode, message, details)
    this.name = 'HttpError'
  }
}

/**
 * 超时错误类
 */
export class TimeoutError extends AppError {
  constructor(message: string = '请求超时') {
    super('TIMEOUT_ERROR', 408, message)
    this.name = 'TimeoutError'
  }
}

// ============================================================================
// 扩展分页参数
// ============================================================================

/**
 * 扩展的分页参数接口
 * 包含排序功能
 */
export interface ExtendedPaginationParams extends PaginationParams {
  /** 排序字段 */
  sortBy?: string
  /** 排序方向 */
  sortOrder?: 'asc' | 'desc'
}

// ============================================================================
// 导出所有类型
// ============================================================================
// 注意：所有类型已在前面通过 export interface 定义，此处无需重复导出
