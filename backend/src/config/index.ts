/**
 * Configuration Management Module
 *
 * Centralized configuration management with environment variable support
 * and validation
 */

import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// Load environment variables:
// 1) project root .env (if present) for shared local credentials
// 2) backend/.env as fallback template defaults
const rootEnvPath = path.resolve(process.cwd(), '..', '.env');
const localEnvPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
}
dotenv.config({ path: localEnvPath });

/**
 * AI Provider Configuration
 */
export interface ProviderConfig {
  /** Provider ID */
  id: string;
  /** Provider name */
  name: string;
  /** API base URL */
  baseURL: string;
  /** API key environment variable name */
  apiKeyEnv: string;
  /** Available models */
  models: string[];
}

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

/**
 * Supported AI Providers
 *
 * Note: All providers require BOTH API key and Base URL to be configured
 * in the .env file. No default values are used for security reasons.
 */
export const PROVIDERS: Record<string, ProviderConfig> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    baseURL: process.env.ANTHROPIC_BASE_URL || '',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    baseURL: process.env.OPENAI_BASE_URL || '',
    apiKeyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-4', 'gpt-3.5-turbo'],
  },
  google: {
    id: 'google',
    name: 'Google AI',
    baseURL: process.env.GOOGLE_BASE_URL || '',
    apiKeyEnv: 'GOOGLE_API_KEY',
    models: ['gemini-2.0-flash-exp', 'gemini-1.5-pro', 'gemini-1.5-flash'],
  },
  zhipuai: {
    id: 'zhipuai',
    name: 'Zhipu AI',
    baseURL: process.env.ZHIPUAI_BASE_URL || '',
    apiKeyEnv: 'ZHIPUAI_API_KEY',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4-0520', 'glm-3-turbo'],
  },
  dashscope: {
    id: 'dashscope',
    name: 'Alibaba Cloud DashScope',
    baseURL: process.env.DASHSCOPE_BASE_URL || '',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-max-longcontext'],
  },
};

/**
 * Application Configuration
 */
export interface Config {
  /** Server configuration */
  server: {
    /** Server port */
    port: number;
    /** Host */
    host: string;
    /** Node environment */
    env: string;
  };

  /** Database configuration */
  database: {
    /** Database file path */
    path: string;
  };

  /** AI configuration */
  ai: {
    /** Default provider */
    defaultProvider: string;
    /** Default model */
    defaultModel: string;
    /** Maximum tokens */
    maxTokens: number;
    /** Temperature */
    temperature: number;
    /** Top P */
    topP: number;
    /** Reasoning effort profile */
    reasoningEffort: ReasoningEffort;
  };

  /** UI/UX data */
  uiux: {
    /** UI/UX data path */
    dataPath: string;
  };

  /** Frontend configuration */
  frontend: {
    /** Frontend URL (for CORS) */
    url: string;
  };

  /** Session configuration */
  session: {
    /** Session timeout in milliseconds */
    timeoutMs: number;
    /** Maximum sessions */
    maxSessions: number;
  };

  /** Tool execution configuration */
  tools: {
    /** Tool timeout in milliseconds */
    timeoutMs: number;
    /** Maximum tool calls per message */
    maxCallsPerMessage: number;
    /** WebFetch allowed domains (comma-separated env: WEBFETCH_ALLOWED_DOMAINS) */
    webfetchAllowedDomains: string[];
  };

  /** Streaming configuration */
  streaming: {
    /** Chunk size */
    chunkSize: number;
    /** Maximum stream duration in milliseconds */
    maxDurationMs: number;
  };

  /** Self-repair configuration */
  selfRepair: {
    /** Maximum repair attempts */
    maxAttempts: number;
    /** Timeout per attempt in milliseconds */
    timeoutPerAttempt: number;
    /** Enabled tools for repair */
    enabledTools: string[];
    /** Whether dependency caching is enabled */
    enableCache: boolean;
    /** Cache max age in days */
    cacheMaxAgeDays: number;
    /** Search-augmented repair allowed domains */
    searchAllowedDomains: string[];
  };

  /** API authentication configuration */
  auth: {
    /** Whether bearer auth is enforced for /api routes */
    enabled: boolean;
    /** HS256 secret used to verify bearer JWT */
    jwtSecret: string;
    /** Expected audience claim */
    audience?: string;
    /** Expected issuer claim */
    issuer?: string;
  };
}

/**
 * Get environment variable or throw error
 */
function getEnvVar(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Get number from environment variable
 */
function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (value === undefined) {
    return defaultValue;
  }
  const num = parseInt(value, 10);
  if (isNaN(num)) {
    console.warn(`[Config] Invalid number for ${key}, using default: ${defaultValue}`);
    return defaultValue;
  }
  return num;
}

function parseWebFetchAllowedDomains(rawValue: string): string[] {
  const normalizedDomains = rawValue
    .split(',')
    .map(domain => domain.trim().toLowerCase())
    .filter(Boolean)
    .map(domain => (domain.endsWith('.') ? domain.slice(0, -1) : domain))
    .filter(Boolean);

  return Array.from(new Set(normalizedDomains));
}

function normalizeReasoningEffort(value: string): ReasoningEffort {
  const normalized = value.trim().toLowerCase();
  const allowed = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
  if (allowed.has(normalized)) {
    return normalized as ReasoningEffort;
  }
  console.warn(`[Config] Invalid reasoning effort "${value}", using default: medium`);
  return 'medium';
}

/**
 * Load configuration from environment variables
 */
export function loadConfig(): Config {
  const rawReasoningEffort = getEnvVar('AI_REASONING_EFFORT', 'medium');
  const rawWebFetchAllowedDomains = getEnvVar('WEBFETCH_ALLOWED_DOMAINS', '');
  const rawSearchRepairAllowedDomains = getEnvVar(
    'SEARCH_REPAIR_ALLOWED_DOMAINS',
    'github.com,stackoverflow.com,nextjs.org,react.dev,typescriptlang.org,vite.dev,npmjs.com'
  );

  return {
    server: {
      port: getEnvNumber('PORT', 3001),
      host: getEnvVar('HOST', '0.0.0.0'),
      env: getEnvVar('NODE_ENV', 'development'),
    },

    database: {
      path: getEnvVar('DATABASE_PATH', './ai-frontend-master.db'),
    },

    ai: {
      defaultProvider: getEnvVar('AI_DEFAULT_PROVIDER', 'dashscope'),
      defaultModel: getEnvVar('AI_DEFAULT_MODEL', 'qwen-coder-plus'),
      maxTokens: getEnvNumber('AI_MAX_TOKENS', 8192),
      temperature: getEnvNumber('AI_TEMPERATURE', 7) / 10, // Convert to 0.0-1.0
      topP: getEnvNumber('AI_TOP_P', 9) / 10, // Convert to 0.0-1.0
      reasoningEffort: normalizeReasoningEffort(rawReasoningEffort),
    },

    uiux: {
      dataPath: getEnvVar('UI_UX_DATA_PATH', './ui-ux-data'),
    },

    frontend: {
      url: getEnvVar('FRONTEND_URL', 'http://localhost:5173'),
    },

    session: {
      timeoutMs: getEnvNumber('SESSION_TIMEOUT_MS', 86400000), // 24 hours
      maxSessions: getEnvNumber('MAX_SESSIONS', 100),
    },

    tools: {
      timeoutMs: getEnvNumber('TOOL_TIMEOUT_MS', 30000), // 30 seconds
      maxCallsPerMessage: getEnvNumber('MAX_TOOL_CALLS', 10),
      webfetchAllowedDomains: parseWebFetchAllowedDomains(rawWebFetchAllowedDomains),
    },

    streaming: {
      chunkSize: getEnvNumber('STREAM_CHUNK_SIZE', 100),
      maxDurationMs: getEnvNumber('MAX_STREAM_DURATION_MS', 300000), // 5 minutes
    },

    selfRepair: {
      maxAttempts: getEnvNumber('SELF_REPAIR_MAX_ATTEMPTS', 5),
      timeoutPerAttempt: getEnvNumber('SELF_REPAIR_TIMEOUT_MS', 120000), // 2 minutes
      enabledTools: getEnvVar('SELF_REPAIR_TOOLS', 'read,apply_diff,write').split(',').map(s => s.trim()),
      enableCache: getEnvVar('SELF_REPAIR_ENABLE_CACHE', 'true').toLowerCase() === 'true',
      cacheMaxAgeDays: getEnvNumber('SELF_REPAIR_CACHE_MAX_AGE_DAYS', 7),
      searchAllowedDomains: parseWebFetchAllowedDomains(rawSearchRepairAllowedDomains),
    },

    auth: {
      enabled: getEnvVar('AUTH_ENABLED', 'false').toLowerCase() === 'true',
      jwtSecret: getEnvVar('AUTH_JWT_SECRET', ''),
      audience: getEnvVar('AUTH_AUDIENCE', '').trim() || undefined,
      issuer: getEnvVar('AUTH_ISSUER', '').trim() || undefined,
    },
  };
}

/**
 * Global configuration instance
 */
export const config: Config = loadConfig();

/**
 * Get API key for provider
 */
export function getProviderApiKey(providerId: string): string {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }

  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    throw new Error(
      `Missing API key for ${provider.name}. Please set ${provider.apiKeyEnv} in .env file.`
    );
  }

  return apiKey;
}

/**
 * Get provider configuration
 */
export function getProviderConfig(providerId: string): ProviderConfig {
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
}

/**
 * Validate configuration
 */
export function validateConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  // Skip API key validation in Docker production mode.
  const isDocker = process.env.NODE_ENV === 'production';

  if (!isDocker) {
    // Validate required API keys and base URLs for all providers
    for (const [providerId, provider] of Object.entries(PROVIDERS)) {
      const apiKey = process.env[provider.apiKeyEnv];
      if (!apiKey) {
        errors.push(`Missing ${provider.name} API key (${provider.apiKeyEnv})`);
      }

      // Validate base URL is configured
      if (!provider.baseURL) {
        errors.push(
          `Missing ${provider.name} base URL. Please set ${provider.apiKeyEnv.replace('API_KEY', 'BASE_URL')} in .env file.`
        );
      }
    }
  }

  // Validate directories.
  // Validate UI/UX data path in local development only.
  if (!isDocker && !fs.existsSync(config.uiux.dataPath)) {
    console.warn(`[Config] UI/UX data path not found: ${config.uiux.dataPath}`);
  }

  if (config.auth.enabled && !config.auth.jwtSecret) {
    errors.push('AUTH_ENABLED=true but AUTH_JWT_SECRET is empty');
  }

  // Check database directory
  const dbDir = path.dirname(config.database.path);
  if (!fs.existsSync(dbDir)) {
    try {
      fs.mkdirSync(dbDir, { recursive: true });
    } catch (error) {
      errors.push(`Cannot create database directory: ${dbDir}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Print configuration (for debugging)
 */
export function printConfig(): void {
  console.log('\n=== AI Frontend Master Configuration ===\n');

  console.log('Server:');
  console.log(`  Port: ${config.server.port}`);
  console.log(`  Environment: ${config.server.env}\n`);

  console.log('AI:');
  console.log(`  Default Provider: ${config.ai.defaultProvider}`);
  console.log(`  Default Model: ${config.ai.defaultModel}`);
  console.log(`  Max Tokens: ${config.ai.maxTokens}\n`);
  console.log(`  Reasoning Effort: ${config.ai.reasoningEffort}\n`);

  console.log('Self-Repair:');
  console.log(`  Max Attempts: ${config.selfRepair.maxAttempts}`);
  console.log(`  Timeout per Attempt: ${config.selfRepair.timeoutPerAttempt}ms`);
  console.log(`  Enabled Tools: ${config.selfRepair.enabledTools.join(', ')}`);
  console.log(`  Cache Enabled: ${config.selfRepair.enableCache ? 'Yes' : 'No'}`);
  console.log(`  Cache Max Age: ${config.selfRepair.cacheMaxAgeDays} days\n`);
  console.log(
    `  Search Allowed Domains: ${
      config.selfRepair.searchAllowedDomains.length > 0
        ? config.selfRepair.searchAllowedDomains.join(', ')
        : '(none)'
    }\n`
  );

  console.log('Auth:');
  console.log(`  Enabled: ${config.auth.enabled ? 'Yes' : 'No'}`);
  console.log(`  Audience: ${config.auth.audience || '(not set)'}`);
  console.log(`  Issuer: ${config.auth.issuer || '(not set)'}\n`);

  console.log('Providers:');
  for (const [id, provider] of Object.entries(PROVIDERS)) {
    const hasKey = !!process.env[provider.apiKeyEnv];
    console.log(`  ${provider.name}:`);
    console.log(`    Base URL: ${provider.baseURL}`);
    console.log(`    API Key: ${hasKey ? '[OK] Configured' : '[MISSING] Not configured'}`);
  }

  console.log('\n==========================================\n');
}

/**
 * Reload configuration (useful for development)
 */
export function reloadConfig(): Config {
  // Reload environment variables
  dotenv.config({ override: true });

  // Reload config
  const newConfig = loadConfig();

  // Update global config
  Object.assign(config, newConfig);

  console.log('[Config] Configuration reloaded');

  return config;
}

// Export config singleton
export default config;

