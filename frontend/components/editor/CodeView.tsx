import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Folder, FileCode, ChevronRight, ChevronDown, Sparkles, AlertCircle } from 'lucide-react';
import { useWorkflowContext } from '../../contexts/WorkflowContext';
import { useProjectStore } from '../../lib/stores/projectStore';
import { useProjectFiles } from '../../hooks/useProjectFiles';
import { withApiAuthHeaders } from '../../utils/api-auth';
import { normalizeApiBaseUrl } from '../../utils/api-base';
import { canonicalizeProjectPath, splitProjectPath } from '../../lib/services/path-utils';

/**
 * Infer a file path from code content and language.
 */
function inferFilePath(
  code: string,
  language: string,
  count: number,
  existingFiles: Map<string, string>
): string {
  void existingFiles;

  const extMap: Record<string, string> = {
    typescript: 'ts',
    tsx: 'tsx',
    javascript: 'js',
    jsx: 'jsx',
    css: 'css',
    scss: 'scss',
    html: 'html',
    json: 'json',
    md: 'md',
    python: 'py',
    go: 'go',
    rust: 'rs',
  };

  const ext = extMap[language] || language;

  const isComponent = /export\s+(default\s+)?(function|const|class)\s+\w+|React\.(FC|Component)/.test(code);
  const isPage = /page\.(tsx?|jsx?)|_app\.(tsx?|jsx?)/.test(code);
  const isHook = /^use[A-Z]/.test(code);

  if (isPage) {
    return `pages/page-${count}.${ext}`;
  }

  if (isComponent) {
    return `components/Component-${count}.${ext}`;
  }

  if (isHook) {
    return `hooks/hook-${count}.${ext}`;
  }

  return `file-${count}.${ext}`;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  status?: 'idle' | 'loading' | 'success' | 'error' | 'normal' | 'created' | 'modified' | 'deleted';
  size?: number;
  children?: FileTreeNode[];
}

class CodeViewErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('CodeView error:', error, errorInfo);
  }

  override render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-gray-50">
          <div className="text-center p-8">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Failed to load file tree</h3>
            <p className="text-sm text-gray-600 mb-4">{this.state.error?.message || 'Unknown error'}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface FileTreeItemProps {
  node: FileTreeNode;
  level?: number;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (path: string) => void;
}

const FileTreeItemComponent: React.FC<FileTreeItemProps> = ({
  node,
  level = 0,
  selectedPath,
  onSelect,
  expandedFolders,
  onToggleFolder,
}) => {
  const isExpanded = expandedFolders.has(node.path);
  const isSelected = selectedPath === node.path;
  const hasChildren = node.children && node.children.length > 0;

  const handleClick = () => {
    if (node.type === 'directory' && hasChildren) {
      onToggleFolder(node.path);
    } else if (node.type === 'file') {
      onSelect?.(node.path);
    }
  };

  const getFileIconColor = () => {
    if (node.status === 'created') return 'text-green-500';
    if (node.status === 'modified') return 'text-yellow-500';
    if (node.status === 'deleted') return 'text-red-500';

    const name = node.name.toLowerCase();
    if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'text-blue-500';
    if (name.endsWith('.json')) return 'text-yellow-500';
    if (name.endsWith('.css')) return 'text-purple-500';
    return 'text-orange-500';
  };

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={isExpanded}
        aria-selected={isSelected}
        className={`flex items-center py-1 px-2 cursor-pointer text-xs ${
          isSelected ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: `${level * 12 + 8}px` }}
        onClick={handleClick}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleClick();
          }
        }}
        tabIndex={0}
      >
        {node.type === 'directory' ? (
          <>
            {hasChildren ? (
              isExpanded ? (
                <ChevronDown className="w-3 h-3 mr-1.5 text-gray-400" />
              ) : (
                <ChevronRight className="w-3 h-3 mr-1.5 text-gray-400" />
              )
            ) : (
              <span className="w-3 h-3 mr-1.5 inline-block" />
            )}
            <Folder className="w-3.5 h-3.5 mr-2 text-blue-400" />
          </>
        ) : (
          <>
            <span className="w-3 h-3 mr-1.5 inline-block" />
            <FileCode className={`w-3.5 h-3.5 mr-2 ${getFileIconColor()}`} />
          </>
        )}

        <span className="truncate flex-1">{node.name}</span>

        {node.status && node.status !== 'normal' && (
          <span className="ml-2 text-xs font-medium" aria-label={`file status: ${node.status}`}>
            {node.status === 'created' && 'N'}
            {node.status === 'modified' && 'M'}
            {node.status === 'deleted' && 'D'}
          </span>
        )}

        {node.size && (
          <span className="ml-2 text-xs text-gray-400">
            {node.size < 1024
              ? `${node.size} B`
              : node.size < 1024 * 1024
                ? `${(node.size / 1024).toFixed(1)} KB`
                : `${(node.size / (1024 * 1024)).toFixed(1)} MB`}
          </span>
        )}
      </div>

      {node.type === 'directory' && isExpanded && hasChildren && (
        <div>
          {node.children!.map(child => (
            <FileTreeItem
              key={child.path}
              node={child}
              level={level + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const POLLING_REQUEST_DEBOUNCE_MS = 500;

const FileTreeItem = React.memo(
  FileTreeItemComponent,
  (prevProps, nextProps) => {
    return (
      prevProps.node.path === nextProps.node.path &&
      prevProps.node.type === nextProps.node.type &&
      prevProps.node.status === nextProps.node.status &&
      prevProps.level === nextProps.level &&
      prevProps.selectedPath === nextProps.selectedPath &&
      prevProps.expandedFolders === nextProps.expandedFolders
    );
  }
);

FileTreeItem.displayName = 'FileTreeItem';

const CodeViewInner: React.FC = () => {
  const [selectedPath, setSelectedPath] = useState<string | undefined>();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(['src', 'todo-app'])
  );
  const [fileContent, setFileContent] = useState<string>('');
  const lastPollingTriggerRef = useRef<string | null>(null);

  const { files: projectFiles, setFiles, setProjectType } = useProjectStore();
  const { backendSessionId, messages } = useWorkflowContext();
  const apiBaseUrl = normalizeApiBaseUrl(import.meta.env['VITE_API_URL'] || 'http://localhost:3001');
  const latestBackendSessionIdRef = useRef<string | null>(backendSessionId);
  const lastPollingRequestRef = useRef<{ key: string; at: number } | null>(null);

  const { startPolling, reset: resetProjectFilePolling } = useProjectFiles({
    apiUrl: apiBaseUrl,
    pollInterval: 2000,
    maxRetries: 180,
    onFilesLoaded: async files => {
      console.log(`[CodeView] Loaded ${files.length} file(s) from backend`);

      const mappedFiles = files.map(file => ({
        path: file.path,
        content: file.content,
      }));

      setFiles(mappedFiles);

      const loadedSessionId = files[0]?.sessionID || latestBackendSessionIdRef.current;

      if (loadedSessionId) {
        try {
          const encodedSessionId = encodeURIComponent(loadedSessionId);
          const response = await fetch(`${apiBaseUrl}/api/sessions/${encodedSessionId}`, {
            headers: withApiAuthHeaders(),
          });
          if (response.ok) {
            const session = await response.json();
            if (session.projectType) {
              console.log('[CodeView] Setting projectType:', session.projectType);
              setProjectType(session.projectType);
            }
          }
        } catch (error) {
          console.error('[CodeView] Failed to fetch session info:', error);
        }
      }
    },
    onError: error => {
      console.error('[CodeView] Failed to load files:', error);
    },
  });

  const requestPolling = useCallback(
    (sessionId: string, trigger: string) => {
      const pollingKey = `${sessionId}:${trigger}`;
      const now = Date.now();
      const lastRequest = lastPollingRequestRef.current;

      if (
        lastRequest &&
        lastRequest.key === pollingKey &&
        now - lastRequest.at < POLLING_REQUEST_DEBOUNCE_MS
      ) {
        console.log('[CodeView] Skip duplicated polling request:', { pollingKey });
        return;
      }

      lastPollingRequestRef.current = { key: pollingKey, at: now };
      startPolling(sessionId);
    },
    [startPolling]
  );

  useEffect(() => {
    latestBackendSessionIdRef.current = backendSessionId;

    if (!backendSessionId) {
      lastPollingRequestRef.current = null;
    }
  }, [backendSessionId]);

  const latestWriteToolCallKey = useMemo(() => {
    const lastAssistantMessage = messages.filter(m => m.role === 'assistant').pop();
    if (!lastAssistantMessage?.toolCalls || lastAssistantMessage.toolCalls.length === 0) {
      return null;
    }

    const writeToolCalls = lastAssistantMessage.toolCalls.filter(
      tool => tool.toolName === 'write' || tool.toolName === 'project_scaffold'
    );

    if (writeToolCalls.length === 0) {
      return null;
    }

    const callIdentity = writeToolCalls.map(tool => tool.callID || tool.toolName).join(',');
    return `${lastAssistantMessage.id}:${callIdentity}`;
  }, [messages]);

  useEffect(() => {
    if (!backendSessionId || !latestWriteToolCallKey) {
      return;
    }

    const pollingTriggerKey = `${backendSessionId}:${latestWriteToolCallKey}`;
    if (lastPollingTriggerRef.current === pollingTriggerKey) {
      return;
    }

    lastPollingTriggerRef.current = pollingTriggerKey;
    console.log('[CodeView] Detected write/project_scaffold call, start polling files');
    requestPolling(backendSessionId, pollingTriggerKey);
  }, [backendSessionId, latestWriteToolCallKey, requestPolling]);

  useEffect(() => {
    const initializeProject = async () => {
      if (backendSessionId) {
        const currentProjectType = useProjectStore.getState().projectType;

        if (!currentProjectType) {
          try {
            const encodedSessionId = encodeURIComponent(backendSessionId);
            const response = await fetch(`${apiBaseUrl}/api/sessions/${encodedSessionId}`, {
              headers: withApiAuthHeaders(),
            });
            if (response.ok) {
              const session = await response.json();
              if (session.projectType) {
                console.log('[CodeView] Setting projectType:', session.projectType);
                setProjectType(session.projectType);
              }
            }
          } catch (error) {
            console.error('[CodeView] Failed to fetch session info:', error);
          }
        }

        const currentFiles = useProjectStore.getState().files;
        if (currentFiles.length === 0) {
          console.log('[CodeView] Session exists but store files empty, auto start polling');
          requestPolling(backendSessionId, `${backendSessionId}:bootstrap-empty-files`);
        }
      }
    };

    initializeProject();
  }, [backendSessionId, setProjectType, requestPolling]);

  useEffect(() => {
    if (!backendSessionId) {
      resetProjectFilePolling();
      lastPollingTriggerRef.current = null;
      lastPollingRequestRef.current = null;
      latestBackendSessionIdRef.current = null;
      setSelectedPath(undefined);
      setFileContent('');
      setExpandedFolders(new Set(['src', 'todo-app']));
    }
  }, [backendSessionId, resetProjectFilePolling]);

  const generatedFiles = useMemo(() => {
    const files = new Map<string, string>();

    if (projectFiles && projectFiles.length > 0) {
      projectFiles.forEach(file => {
        const normalizedPath = canonicalizeProjectPath(file.path);
        if (!normalizedPath) {
          return;
        }
        files.set(normalizedPath, file.content);
      });
      return files;
    }

    return files;
  }, [projectFiles]);

  useEffect(() => {
    if (selectedPath && !generatedFiles.has(selectedPath)) {
      setSelectedPath(undefined);
      setFileContent('');
    }
  }, [generatedFiles, selectedPath]);

  const fileTree = useMemo((): FileTreeNode[] => {
    if (generatedFiles.size === 0) {
      return [];
    }

    const root: FileTreeNode = {
      name: 'project',
      path: '',
      type: 'directory',
      children: [],
    };

    generatedFiles.forEach((_content, filePath) => {
      const parts = splitProjectPath(filePath);
      if (parts.length === 0) {
        return;
      }
      let currentNode = root;

      parts.forEach((part, index) => {
        const isFile = index === parts.length - 1;
        const path = parts.slice(0, index + 1).join('/');

        let existingChild = currentNode.children?.find(child => child.name === part);

        if (!existingChild) {
          existingChild = {
            name: part,
            path,
            type: isFile ? 'file' : 'directory',
            children: isFile ? undefined : [],
          };

          if (!currentNode.children) {
            currentNode.children = [];
          }
          currentNode.children.push(existingChild);
        }

        currentNode = existingChild;
      });
    });

    return root.children || [];
  }, [generatedFiles]);

  const projectSummary = useMemo(() => {
    if (generatedFiles.size === 0) return null;

    const files = Array.from(generatedFiles.keys());
    const fileCount = files.length;
    const directories = new Set<string>();

    files.forEach(file => {
      const parts = splitProjectPath(file);
      parts.slice(0, -1).forEach(dir => {
        directories.add(dir);
      });
    });

    const types = new Map<string, string[]>();
    files.forEach(file => {
      const ext = file.split('.').pop() || 'unknown';
      if (!types.has(ext)) {
        types.set(ext, []);
      }
      types.get(ext)!.push(file);
    });

    return {
      fileCount,
      directoryCount: directories.size,
      types,
      totalSize: Array.from(generatedFiles.values()).reduce((sum, code) => sum + code.length, 0),
    };
  }, [generatedFiles]);

  const handleToggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const newSet = new Set(prev);
      if (newSet.has(path)) {
        newSet.delete(path);
      } else {
        newSet.add(path);
      }
      return newSet;
    });
  };

  const handleSelectFile = (path: string) => {
    const normalizedPath = canonicalizeProjectPath(path);
    if (!normalizedPath) {
      return;
    }
    setSelectedPath(normalizedPath);

    const content = generatedFiles.get(normalizedPath);
    if (content) {
      setFileContent(content);
    }
  };

  return (
    <div className="flex h-full w-full">
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase">Project Files</span>
          {generatedFiles.size > 0 && (
            <span className="text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
              {generatedFiles.size} files
            </span>
          )}
        </div>

        {projectSummary && (
          <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
            <div className="text-xs font-medium text-gray-700 mb-2">Project Summary</div>
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Total files:</span>
                <span className="font-medium">{projectSummary.fileCount}</span>
              </div>
              <div className="flex justify-between">
                <span>Directories:</span>
                <span className="font-medium">{projectSummary.directoryCount}</span>
              </div>
              <div className="mt-2 pt-2 border-t border-gray-200">
                <div className="font-medium mb-1">File types:</div>
                {Array.from(projectSummary.types.entries()).map(([ext, files]) => (
                  <div key={ext} className="text-gray-500">
                    {ext}: {files.length}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto py-2">
          {fileTree.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
              <div className="w-16 h-16 mb-4 text-gray-300">
                <Sparkles className="w-full h-full" />
              </div>
              <p className="text-sm text-gray-600 mb-2">Waiting for generated files</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                Describe your request in the chat.
                <br />
                AI will generate project files here.
              </p>
            </div>
          ) : (
            fileTree.map(node => (
              <FileTreeItem
                key={node.path}
                node={node}
                selectedPath={selectedPath}
                onSelect={handleSelectFile}
                expandedFolders={expandedFolders}
                onToggleFolder={handleToggleFolder}
              />
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white">
        <div className="flex bg-gray-50 border-b border-gray-200">
          {selectedPath ? (
            <div className="px-4 py-2 bg-white border-r border-gray-200 border-t-2 border-t-blue-500 text-xs font-medium text-gray-700 flex items-center gap-2">
              <FileCode className="w-3.5 h-3.5" />
              <span>{selectedPath}</span>
              <span
                className="ml-2 hover:bg-gray-100 rounded p-0.5 cursor-pointer"
                onClick={() => setSelectedPath(undefined)}
              >
                ×
              </span>
            </div>
          ) : (
            <div className="px-4 py-2 text-xs text-gray-400">Select a file to view code</div>
          )}
        </div>

        <div className="flex-1 overflow-auto p-4 font-mono text-sm leading-6">
          {selectedPath ? (
            <div className="flex text-gray-800">
              <pre className="flex-1 whitespace-pre-wrap break-all">{fileContent}</pre>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400">
              <div className="text-center">
                <FileCode className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p className="text-sm">Choose a file from the left panel</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const CodeView: React.FC = () => {
  return (
    <CodeViewErrorBoundary>
      <CodeViewInner />
    </CodeViewErrorBoundary>
  );
};

void inferFilePath;
