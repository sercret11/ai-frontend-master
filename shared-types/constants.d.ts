/**
 * Global Constants
 *
 * Centralized configuration values to avoid magic numbers
 */
export declare const API_CONFIG: {
    readonly TIMEOUT: 30000;
    readonly RETRY_DELAYS: readonly [1000, 2000, 5000];
    readonly MAX_RETRIES: 3;
    readonly DEFAULT_TIMEOUT: 15000;
};
export declare const WS_CONFIG: {
    readonly MAX_RECONNECT_ATTEMPTS: 5;
    readonly RECONNECT_DELAY: 1000;
    readonly MAX_CLIENTS: 1000;
    readonly HEARTBEAT_INTERVAL: 30000;
    readonly PING_TIMEOUT: 5000;
    readonly POLLING_RATE: 2000;
};
export declare const FILE_CONFIG: {
    readonly MAX_FILE_SIZE: 1048576;
    readonly MAX_CONTENT_LENGTH: 10000;
    readonly MAX_QUEUE_SIZE: 1000;
    readonly MAX_BATCH_SIZE: 100;
    readonly MAX_CONCURRENCY: 10;
};
export declare const UI_CONFIG: {
    readonly MESSAGE_VIRTUALIZATION_THRESHOLD: 100;
    readonly DEBOUNCE_DELAY: 300;
    readonly THROTTLE_DELAY: 1000;
    readonly TOOLTIP_DELAY: 500;
    readonly NOTIFICATION_DURATION: 5000;
    readonly AUTOSAVE_DELAY: 2000;
};
export declare const CACHE_CONFIG: {
    readonly DEFAULT_TTL: 300000;
    readonly SESSION_TTL: 86400000;
    readonly CLEANUP_INTERVAL: 3600000;
    readonly CACHE_JITTER: 0.1;
    readonly MAX_CACHE_SIZE: 1000;
};
export declare const STREAM_CONFIG: {
    readonly BUFFER_LIMIT: 65536;
    readonly BATCH_DELAY: 50;
    readonly BATCH_SIZE: 10;
    readonly CHUNK_SIZE: 4096;
};
export declare const DB_CONFIG: {
    readonly DEFAULT_LIMIT: 100;
    readonly MAX_LIMIT: 1000;
    readonly CHECKPOINT_INTERVAL: 3600000;
    readonly CONNECTION_TIMEOUT: 5000;
};
export declare const VALIDATION_CONFIG: {
    readonly MAX_INPUT_LENGTH: 10000;
    readonly MIN_INPUT_LENGTH: 1;
    readonly MAX_TITLE_LENGTH: 200;
    readonly MAX_DESCRIPTION_LENGTH: 5000;
    readonly ALLOWED_FILE_EXTENSIONS: readonly [".ts", ".tsx", ".js", ".jsx", ".css", ".scss", ".less", ".html", ".htm", ".json", ".md"];
};
export declare const RATE_LIMIT_CONFIG: {
    readonly OPENAI: {
        readonly maxRequests: 10;
        readonly windowMs: 60000;
    };
    readonly ANTHROPIC: {
        readonly maxRequests: 50;
        readonly windowMs: 60000;
    };
    readonly GOOGLE: {
        readonly maxRequests: 60;
        readonly windowMs: 60000;
    };
    readonly DEFAULT: {
        readonly maxRequests: 20;
        readonly windowMs: 60000;
    };
};
export declare const ERROR_MESSAGES: {
    readonly NETWORK_OFFLINE: "网络离线，请检查网络连接";
    readonly REQUEST_TIMEOUT: "请求超时，请重试";
    readonly RATE_LIMITED: "请求过于频繁，请稍后重试";
    readonly INVALID_INPUT: "输入格式错误，请检查后重试";
    readonly UNAUTHORIZED: "未授权访问，请登录后重试";
    readonly SERVER_ERROR: "服务器错误，请稍后重试";
    readonly NETWORK_ERROR: "网络连接失败";
};
export declare const ENCODING_CONFIG: {
    readonly DEFAULT_ENCODING: "utf-8";
    readonly SUPPORTED_ENCODINGS: readonly ["utf-8", "utf-16le", "latin1"];
    readonly BOM_SIZE: 3;
    readonly MAX_BUFFER_SIZE: 10485760;
    readonly ONE_DAY_MS: 86400000;
    readonly FIVE_MINUTES_MS: 300000;
};
export declare const TIME_CONSTANTS: {
    readonly ONE_SECOND: 1000;
    readonly ONE_MINUTE: 60000;
    readonly FIVE_MINUTES: 300000;
    readonly ONE_HOUR: 3600000;
    readonly ONE_DAY: 86400000;
    readonly ONE_WEEK: 604800000;
};
export declare const SIZE_CONSTANTS: {
    readonly KB: 1024;
    readonly MB: 1048576;
    readonly GB: 1073741824;
    readonly MAX_BUFFER_SIZE: 10485760;
};
export declare const POLLING_CONFIG: {
    readonly MAX_RECONNECT_ATTEMPTS: 5;
    readonly RECONNECT_DELAY: 1000;
    readonly POLL_TIMEOUT: 10000;
    readonly ADAPTIVE_RATE_MIN: 1000;
    readonly ADAPTIVE_RATE_MAX: 10000;
    readonly EMPTY_RESPONSE_THRESHOLD: 2;
    readonly EMPTY_RESPONSE_THRESHOLD_HIGH: 5;
};
export declare const LOCK_CONFIG: {
    readonly LOCK_TTL: 300000;
    readonly LOCK_TIMEOUT_DEFAULT: 30000;
    readonly LOCK_RETRY_DELAY: 100;
};
export declare const CACHE_LIMITS: {
    readonly MAX_FILE_TREE_CACHE_SIZE: 100;
    readonly FILE_TREE_CACHE_TTL: 60000;
    readonly FILE_TREE_CACHE_MAX_AGE_MS: 7776000000;
};
/**
 * Format bytes to human-readable size
 */
export declare function formatBytes(bytes: number): string;
/**
 * Format duration to human-readable time
 */
export declare function formatDuration(ms: number): string;
/**
 * Check if running in development mode
 */
export declare function isDevelopment(): boolean;
/**
 * Check if running in production mode
 */
export declare function isProduction(): boolean;
//# sourceMappingURL=constants.d.ts.map