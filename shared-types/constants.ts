/**
 * Global Constants
 *
 * Centralized configuration values to avoid magic numbers
 */

// ============================================================================
// API Configuration
// ============================================================================

export const API_CONFIG = {
  TIMEOUT: 30000 as const, // 30 seconds
  RETRY_DELAYS: [1000, 2000, 5000] as const,
  MAX_RETRIES: 3 as const,
  DEFAULT_TIMEOUT: 15000 as const,
} as const;

// ============================================================================
// WebSocket Configuration
// ============================================================================

export const WS_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5 as const,
  RECONNECT_DELAY: 1000 as const,
  MAX_CLIENTS: 1000 as const,
  HEARTBEAT_INTERVAL: 30000 as const, // 30 seconds
  PING_TIMEOUT: 5000 as const,
  POLLING_RATE: 2000 as const, // 2 seconds
} as const;

// ============================================================================
// File Configuration
// ============================================================================

export const FILE_CONFIG = {
  MAX_FILE_SIZE: 1048576 as const, // 1MB
  MAX_CONTENT_LENGTH: 10000 as const,
  MAX_QUEUE_SIZE: 1000 as const,
  MAX_BATCH_SIZE: 100 as const,
  MAX_CONCURRENCY: 10 as const,
} as const;

// ============================================================================
// UI Configuration
// ============================================================================

export const UI_CONFIG = {
  MESSAGE_VIRTUALIZATION_THRESHOLD: 100 as const,
  DEBOUNCE_DELAY: 300 as const,
  THROTTLE_DELAY: 1000 as const,
  TOOLTIP_DELAY: 500 as const,
  NOTIFICATION_DURATION: 5000 as const,
  AUTOSAVE_DELAY: 2000 as const,
} as const;

// ============================================================================
// Cache Configuration
// ============================================================================

export const CACHE_CONFIG = {
  DEFAULT_TTL: 300000 as const, // 5 minutes
  SESSION_TTL: 86400000 as const, // 24 hours
  CLEANUP_INTERVAL: 3600000 as const, // 1 hour
  CACHE_JITTER: 0.1 as const, // 10% jitter
  MAX_CACHE_SIZE: 1000 as const,
} as const;

// ============================================================================
// Stream Configuration
// ============================================================================

export const STREAM_CONFIG = {
  BUFFER_LIMIT: 65536 as const, // 64KB
  BATCH_DELAY: 50 as const, // 50ms
  BATCH_SIZE: 10 as const,
  CHUNK_SIZE: 4096 as const,
} as const;

// ============================================================================
// Database Configuration
// ============================================================================

export const DB_CONFIG = {
  DEFAULT_LIMIT: 100 as const,
  MAX_LIMIT: 1000 as const,
  CHECKPOINT_INTERVAL: 3600000 as const, // 1 hour
  CONNECTION_TIMEOUT: 5000 as const,
} as const;

// ============================================================================
// Validation Configuration
// ============================================================================

export const VALIDATION_CONFIG = {
  MAX_INPUT_LENGTH: 10000 as const,
  MIN_INPUT_LENGTH: 1 as const,
  MAX_TITLE_LENGTH: 200 as const,
  MAX_DESCRIPTION_LENGTH: 5000 as const,
  ALLOWED_FILE_EXTENSIONS: [
    '.ts', '.tsx', '.js', '.jsx',
    '.css', '.scss', '.less',
    '.html', '.htm',
    '.json', '.md'
  ] as const,
} as const;

// ============================================================================
// Rate Limiting Configuration
// ============================================================================

export const RATE_LIMIT_CONFIG = {
  OPENAI: { maxRequests: 10, windowMs: 60000 } as const, // 10/min
  ANTHROPIC: { maxRequests: 50, windowMs: 60000 } as const, // 50/min
  GOOGLE: { maxRequests: 60, windowMs: 60000 } as const, // 60/min
  DEFAULT: { maxRequests: 20, windowMs: 60000 } as const, // 20/min
} as const;

// ============================================================================
// Error Messages
// ============================================================================

export const ERROR_MESSAGES = {
  NETWORK_OFFLINE: '网络离线，请检查网络连接',
  REQUEST_TIMEOUT: '请求超时，请重试',
  RATE_LIMITED: '请求过于频繁，请稍后重试',
  INVALID_INPUT: '输入格式错误，请检查后重试',
  UNAUTHORIZED: '未授权访问，请登录后重试',
  SERVER_ERROR: '服务器错误，请稍后重试',
  NETWORK_ERROR: '网络连接失败',
} as const;

// ============================================================================
// Character Encoding
// ============================================================================

export const ENCODING_CONFIG = {
  DEFAULT_ENCODING: 'utf-8' as const,
  SUPPORTED_ENCODINGS: ['utf-8', 'utf-16le', 'latin1'] as const,
  BOM_SIZE: 3 as const, // UTF-8 BOM size
  MAX_BUFFER_SIZE: 10485760 as const, // 10MB - SSE buffer limit
  ONE_DAY_MS: 86400000 as const, // 24 hours in milliseconds
  FIVE_MINUTES_MS: 300000 as const, // 5 minutes in milliseconds
} as const;

// ============================================================================
// Time Constants
// ============================================================================

export const TIME_CONSTANTS = {
  ONE_SECOND: 1000 as const,
  ONE_MINUTE: 60000 as const,
  FIVE_MINUTES: 300000 as const,
  ONE_HOUR: 3600000 as const,
  ONE_DAY: 86400000 as const,
  ONE_WEEK: 604800000 as const,
} as const;

// ============================================================================
// Size Constants
// ============================================================================

export const SIZE_CONSTANTS = {
  KB: 1024 as const,
  MB: 1048576 as const,
  GB: 1073741824 as const,
  MAX_BUFFER_SIZE: 10485760 as const, // 10MB
} as const;

// ============================================================================
// Polling Configuration
// ============================================================================

export const POLLING_CONFIG = {
  MAX_RECONNECT_ATTEMPTS: 5 as const,
  RECONNECT_DELAY: 1000 as const,
  POLL_TIMEOUT: 10000 as const, // 10 seconds
  ADAPTIVE_RATE_MIN: 1000 as const, // 1 second
  ADAPTIVE_RATE_MAX: 10000 as const, // 10 seconds
  EMPTY_RESPONSE_THRESHOLD: 2 as const,
  EMPTY_RESPONSE_THRESHOLD_HIGH: 5 as const,
} as const;

// ============================================================================
// Lock Configuration
// ============================================================================

export const LOCK_CONFIG = {
  LOCK_TTL: 300000 as const, // 5 minutes
  LOCK_TIMEOUT_DEFAULT: 30000 as const, // 30 seconds
  LOCK_RETRY_DELAY: 100 as const, // 100ms
} as const;

// ============================================================================
// Cache Limits
// ============================================================================

export const CACHE_LIMITS = {
  MAX_FILE_TREE_CACHE_SIZE: 100 as const,
  FILE_TREE_CACHE_TTL: 60000 as const, // 1 minute
  FILE_TREE_CACHE_MAX_AGE_MS: 7776000000 as const, // 90 days
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format bytes to human-readable size
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes'

  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
}

/**
 * Format duration to human-readable time
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

/**
 * Check if running in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV === 'development' ||
         process.env.SERVER_ENV === 'development'
}

/**
 * Check if running in production mode
 */
export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production' ||
         process.env.SERVER_ENV === 'production'
}
