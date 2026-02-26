import type {
  ApiSignature,
  ExternalDependencyChecklist,
  MinimalSnippet,
  ResearchDigest,
  SourceRef,
  VersionHint,
} from './types';

type JsonRpcId = number | string;

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcErrorPayload {
  code: number;
  message: string;
  data?: unknown;
}

interface JsonRpcResponsePayload {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorPayload;
}

interface ToolCallResult {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  isError?: boolean;
}

export interface Context7McpOptions {
  mcpUrl?: string;
  mcpApiKey?: string;
  timeoutMs?: number;
}

const DEFAULT_MCP_URL = 'https://mcp.context7.com/mcp';
const DEFAULT_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeUrl(value: string | undefined): string {
  const raw = (value || '').trim();
  return raw || DEFAULT_MCP_URL;
}

function parseLibraryIdFromResolveText(text: string): string | null {
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/Context7-compatible library ID:\s*(\/[^\s]+)/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return null;
}

function parseCodeBlock(text: string): string | null {
  const match = text.match(/```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].trim();
}

function parseSourceRefs(text: string, framework: string): SourceRef[] {
  const refs: SourceRef[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const sourceMatch = line.match(/^Source:\s*(https?:\/\/\S+)/i);
    if (!sourceMatch?.[1]) {
      continue;
    }
    const url = sourceMatch[1].trim();
    refs.push({
      url,
      title: `${framework} docs`,
      sourceType: 'official',
      confidence: 'high',
    });
  }
  return refs;
}

function detectMajorVersionFromText(text: string, framework: string): string {
  const escaped = framework.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escaped}\\s*(?:v|version)?\\s*(\\d+)`, 'i'));
  return match?.[1] || 'latest';
}

function dedupeSourceRefs(items: SourceRef[]): SourceRef[] {
  const seen = new Set<string>();
  const result: SourceRef[] = [];
  for (const item of items) {
    const key = `${item.sourceType}:${item.url}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function postJsonRpc(
  mcpUrl: string,
  request: JsonRpcRequest,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<JsonRpcResponsePayload> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(mcpUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!text.trim()) {
      return {
        jsonrpc: '2.0',
        id: request.id,
      };
    }

    const parsed = JSON.parse(text) as unknown;
    if (!isRecord(parsed) || parsed['jsonrpc'] !== '2.0') {
      throw new Error('Invalid JSON-RPC payload shape');
    }

    return parsed as unknown as JsonRpcResponsePayload;
  } finally {
    clearTimeout(timer);
  }
}

async function initializeContext7Session(
  mcpUrl: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<void> {
  const initResponse = await postJsonRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: {
          name: 'ai-frontend-master',
          version: '1.0.0',
        },
      },
    },
    headers,
    timeoutMs
  );
  if (initResponse.error) {
    throw new Error(`Context7 initialize failed: ${initResponse.error.message}`);
  }

  await postJsonRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    headers,
    timeoutMs
  );
}

async function callContext7Tool(
  mcpUrl: string,
  headers: Record<string, string>,
  timeoutMs: number,
  name: string,
  args: Record<string, unknown>,
  id: number
): Promise<string> {
  const response = await postJsonRpc(
    mcpUrl,
    {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    },
    headers,
    timeoutMs
  );

  if (response.error) {
    throw new Error(`Context7 tool ${name} failed: ${response.error.message}`);
  }

  const result = response.result as ToolCallResult | undefined;
  const text = result?.content?.find(item => item.type === 'text')?.text || '';
  if (result?.isError) {
    throw new Error(`Context7 tool ${name} returned error payload: ${text}`);
  }
  return text;
}

function buildDependencyQuery(item: ExternalDependencyChecklist): string {
  const segments = [item.framework, item.packageName, ...item.topics];
  return segments.filter(Boolean).join(' ').slice(0, 500);
}

function buildResearchSummary(
  dependencies: ExternalDependencyChecklist[],
  apiSignatures: ApiSignature[],
  snippets: MinimalSnippet[],
  versionHints: VersionHint[]
): string {
  return [
    'source=context7-mcp',
    `deps=${dependencies.length}`,
    `apiSignatures=${apiSignatures.length}`,
    `snippets=${snippets.length}`,
    `versionHints=${versionHints.map(item => `${item.framework}@${item.majorVersion}`).join(',')}`,
  ].join('; ');
}

export async function fetchResearchDigestFromContext7Mcp(
  dependencies: ExternalDependencyChecklist[],
  options: Context7McpOptions = {}
): Promise<ResearchDigest | null> {
  if (dependencies.length === 0) {
    return null;
  }

  const mcpUrl = normalizeUrl(options.mcpUrl ?? process.env['CONTEXT7_MCP_URL']);
  const mcpApiKey = ((options.mcpApiKey ?? process.env['CONTEXT7_API_KEY']) || '').trim();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };
  if (mcpApiKey) {
    headers['CONTEXT7_API_KEY'] = mcpApiKey;
  }

  try {
    await initializeContext7Session(mcpUrl, headers, timeoutMs);
  } catch {
    return null;
  }

  const apiSignatures: ApiSignature[] = [];
  const snippets: MinimalSnippet[] = [];
  const versionHints: VersionHint[] = [];
  const sourceRefs: SourceRef[] = [];

  let requestId = 100;

  for (const dependency of dependencies) {
    const query = buildDependencyQuery(dependency);
    const resolveArgs = {
      libraryName: dependency.framework || dependency.packageName,
      query,
    };

    let resolveText = '';
    try {
      resolveText = await callContext7Tool(
        mcpUrl,
        headers,
        timeoutMs,
        'resolve-library-id',
        resolveArgs,
        requestId++
      );
    } catch {
      continue;
    }

    const libraryId = parseLibraryIdFromResolveText(resolveText);
    if (!libraryId) {
      continue;
    }

    let docsText = '';
    try {
      docsText = await callContext7Tool(
        mcpUrl,
        headers,
        timeoutMs,
        'query-docs',
        {
          libraryId,
          query: query || dependency.framework,
        },
        requestId++
      );
    } catch {
      continue;
    }

    const refs = parseSourceRefs(docsText, dependency.framework);
    sourceRefs.push(...refs);

    const primaryRef = refs.slice(0, 1);
    apiSignatures.push({
      library: dependency.framework,
      symbol: dependency.packageName,
      signature: `Context7 library: ${libraryId}`,
      sourceRefs: primaryRef,
    });

    const snippet = parseCodeBlock(docsText);
    if (snippet) {
      snippets.push({
        library: dependency.framework,
        title: `${dependency.framework} context7 snippet`,
        code: snippet,
        sourceRefs: primaryRef,
      });
    }

    versionHints.push({
      framework: dependency.framework,
      majorVersion: detectMajorVersionFromText(docsText, dependency.framework),
      confidence: 'medium',
      sourceRefs: primaryRef,
    });
  }

  const dedupedRefs = dedupeSourceRefs(sourceRefs);

  return {
    generatedAt: Date.now(),
    dependencies,
    apiSignatures,
    snippets,
    versionHints,
    sourceRefs: dedupedRefs,
    summary: buildResearchSummary(dependencies, apiSignatures, snippets, versionHints),
  };
}
