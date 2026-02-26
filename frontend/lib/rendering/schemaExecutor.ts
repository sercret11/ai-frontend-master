import type {
  AppGraph,
  PatchEnvelope,
  RenderArtifact,
  RenderingRequest,
  RenderingResult,
} from '@ai-frontend/shared-types';
import { applyPatchEnvelope } from './jsonPatch';
import { readExecutionMetadata } from './executionMetadata';
import type { RenderingExecutor } from './types';

interface ArtifactWithDiagnostics {
  artifact: RenderArtifact;
  diagnostics: string[];
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? 'unknown' : date.toLocaleString('en-US');
}

function createSchemaPreviewHtml(graph: AppGraph, projectType: string | undefined): string {
  const allNodes = Object.values(graph.nodes);
  const nodeRows = allNodes
    .slice(0, 120)
    .map(node => {
      const childCount = node.children.length;
      const label = node.name || node.id;
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(node.type)}</td><td style="text-align:right">${childCount}</td></tr>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Schema Preview</title>
  <style>
    body { margin: 0; padding: 24px; background: #f8fafc; color: #0f172a; font-family: 'Segoe UI', sans-serif; }
    .panel { max-width: 980px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; box-shadow: 0 10px 24px rgba(15, 23, 42, 0.06); }
    h1 { margin: 0 0 10px; font-size: 22px; }
    .meta { margin-bottom: 14px; color: #475569; line-height: 1.6; }
    .tag { display: inline-block; margin-right: 8px; margin-bottom: 8px; border-radius: 999px; padding: 4px 10px; font-size: 12px; background: #eef2ff; color: #3730a3; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
    th, td { border-bottom: 1px solid #f1f5f9; padding: 8px 6px; text-align: left; }
    th { color: #64748b; font-weight: 600; }
  </style>
</head>
<body>
  <div class="panel">
    <h1>Schema Render Preview</h1>
    <div class="meta">
      <span class="tag">projectType: ${escapeHtml(projectType ?? 'unknown')}</span>
      <span class="tag">graphId: ${escapeHtml(graph.graphId)}</span>
      <span class="tag">version: ${graph.version}</span>
      <span class="tag">nodes: ${allNodes.length}</span>
      <span class="tag">updatedAt: ${escapeHtml(formatDate(graph.updatedAt))}</span>
    </div>
    <table>
      <thead>
        <tr><th>Node</th><th>Type</th><th>Children</th></tr>
      </thead>
      <tbody>${nodeRows}</tbody>
    </table>
  </div>
</body>
</html>`;
}

export class SchemaExecutor implements RenderingExecutor {
  readonly descriptor: RenderingExecutor['descriptor'] = {
    id: 'schema-renderer',
    displayName: 'Schema Renderer',
    mode: 'schema',
    stack: 'schema',
    priority: 120,
    capabilities: ['schema-render', 'hot-patch'],
  };

  private lastPreviewUrl: string | null = null;

  canExecute(): boolean {
    return true;
  }

  async execute(request: RenderingRequest): Promise<RenderingResult> {
    const startedAt = Date.now();
    const diagnostics: string[] = [];
    const metadata = readExecutionMetadata(request);

    const graph = this.resolveGraph(request, diagnostics);
    const artifactResult = this.createArtifact(graph, metadata?.projectType);
    diagnostics.push(...artifactResult.diagnostics);

    return {
      success: true,
      mode: 'schema',
      stack: 'schema',
      graphVersion: graph.version,
      artifact: artifactResult.artifact,
      durationMs: Date.now() - startedAt,
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    };
  }

  async applyPatch(graph: AppGraph, patch: PatchEnvelope): Promise<AppGraph> {
    return applyPatchEnvelope(graph, patch, { strict: false });
  }

  async dispose(): Promise<void> {
    this.releasePreviewUrl();
  }

  private resolveGraph(request: RenderingRequest, diagnostics: string[]): AppGraph {
    if (!request.patch) {
      return request.graph;
    }

    try {
      return applyPatchEnvelope(request.graph, request.patch, { strict: false });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown patch error';
      diagnostics.push(`Schema executor ignored invalid patch: ${errorMessage}`);
      return request.graph;
    }
  }

  private createArtifact(graph: AppGraph, projectType: string | undefined): ArtifactWithDiagnostics {
    const diagnostics: string[] = [];
    const previewHtml = createSchemaPreviewHtml(graph, projectType);

    if (typeof URL === 'undefined') {
      diagnostics.push('URL API is unavailable, using data URL fallback.');
      return {
        artifact: {
          kind: 'url',
          payload: `data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`,
          mimeType: 'text/html',
        },
        diagnostics,
      };
    }

    if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
      diagnostics.push('Blob/createObjectURL is unavailable, using data URL fallback.');
      return {
        artifact: {
          kind: 'url',
          payload: `data:text/html;charset=utf-8,${encodeURIComponent(previewHtml)}`,
          mimeType: 'text/html',
        },
        diagnostics,
      };
    }

    this.releasePreviewUrl();
    const blob = new Blob([previewHtml], { type: 'text/html;charset=utf-8' });
    this.lastPreviewUrl = URL.createObjectURL(blob);

    return {
      artifact: {
        kind: 'url',
        payload: this.lastPreviewUrl,
        mimeType: 'text/html',
      },
      diagnostics,
    };
  }

  private releasePreviewUrl(): void {
    if (!this.lastPreviewUrl) {
      return;
    }

    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(this.lastPreviewUrl);
    }

    this.lastPreviewUrl = null;
  }
}
