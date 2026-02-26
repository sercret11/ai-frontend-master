import type { LucideIcon } from 'lucide-react';
import { Braces, FilePenLine, FolderPlus, Search, TerminalSquare, Wrench } from 'lucide-react';

export interface ToolStyle {
  label: string;
  icon: LucideIcon;
  iconClassName: string;
  badgeClassName: string;
  cardClassName: string;
}

function toTitleCase(input: string): string {
  const normalized = input.replace(/[._-]+/g, ' ').trim();
  if (!normalized) return 'Unknown Tool';
  return normalized
    .split(/\s+/)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

const DEFAULT_STYLE: ToolStyle = {
  label: 'Unknown Tool',
  icon: Wrench,
  iconClassName: 'text-slate-300',
  badgeClassName: 'bg-slate-500/15 text-slate-200 border border-slate-500/30',
  cardClassName: 'border-slate-700/80 bg-slate-900/60',
};

export function resolveToolStyle(toolName: string): ToolStyle {
  const normalized = toolName.trim().toLowerCase();

  if (
    normalized === 'project_scaffold' ||
    normalized.includes('scaffold') ||
    normalized.includes('bootstrap') ||
    normalized.includes('template') ||
    normalized.includes('init')
  ) {
    return {
      label: 'Project Scaffold',
      icon: FolderPlus,
      iconClassName: 'text-cyan-300',
      badgeClassName: 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30',
      cardClassName: 'border-cyan-700/80 bg-cyan-950/35',
    };
  }

  if (
    normalized === 'write' ||
    normalized.includes('write') ||
    normalized.includes('edit') ||
    normalized.includes('patch') ||
    normalized.includes('update') ||
    normalized.includes('file')
  ) {
    return {
      label: 'File Writer',
      icon: FilePenLine,
      iconClassName: 'text-amber-300',
      badgeClassName: 'bg-amber-500/15 text-amber-200 border border-amber-500/30',
      cardClassName: 'border-amber-700/80 bg-amber-950/35',
    };
  }

  if (
    normalized === 'read' ||
    normalized.includes('read') ||
    normalized.includes('search') ||
    normalized.includes('grep') ||
    normalized.includes('find') ||
    normalized.includes('query')
  ) {
    return {
      label: 'Retriever',
      icon: Search,
      iconClassName: 'text-sky-300',
      badgeClassName: 'bg-sky-500/15 text-sky-200 border border-sky-500/30',
      cardClassName: 'border-sky-700/80 bg-sky-950/35',
    };
  }

  if (
    normalized === 'bash' ||
    normalized.includes('shell') ||
    normalized.includes('command') ||
    normalized.includes('exec') ||
    normalized.includes('terminal') ||
    normalized.includes('npm')
  ) {
    return {
      label: 'Command Runner',
      icon: TerminalSquare,
      iconClassName: 'text-emerald-300',
      badgeClassName: 'bg-emerald-500/15 text-emerald-200 border border-emerald-500/30',
      cardClassName: 'border-emerald-700/80 bg-emerald-950/35',
    };
  }

  if (
    normalized.includes('build') ||
    normalized.includes('test') ||
    normalized.includes('render') ||
    normalized.includes('compile')
  ) {
    return {
      label: 'Pipeline',
      icon: Braces,
      iconClassName: 'text-indigo-300',
      badgeClassName: 'bg-indigo-500/15 text-indigo-200 border border-indigo-500/30',
      cardClassName: 'border-indigo-700/80 bg-indigo-950/35',
    };
  }

  return {
    ...DEFAULT_STYLE,
    label: toTitleCase(toolName),
  };
}
