import React from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Loader2, XCircle } from 'lucide-react';
import { resolveToolStyle } from './toolStyles';
import type { ConsoleLevel, ToolCardItem, ToolCardStatus } from './types';

interface ToolEventCardProps {
  card: ToolCardItem;
  expanded: boolean;
  onToggle: (callId: string) => void;
  formatTime: (timestamp: number) => string;
  shortId: (value?: string) => string;
}

function statusLabel(status: ToolCardStatus): string {
  if (status === 'running') return 'running';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

function statusClassName(status: ToolCardStatus): string {
  if (status === 'running') return 'border border-sky-500/30 bg-sky-500/15 text-sky-200';
  if (status === 'completed') return 'border border-emerald-500/30 bg-emerald-500/15 text-emerald-200';
  if (status === 'failed') return 'border border-red-500/30 bg-red-500/15 text-red-200';
  return 'border border-amber-500/30 bg-amber-500/15 text-amber-200';
}

function statusIcon(status: ToolCardStatus): JSX.Element {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-red-300" />;
  return <Loader2 className="h-3.5 w-3.5 text-amber-300" />;
}

function relatedLevelClass(level: ConsoleLevel): string {
  if (level === 'success') return 'bg-emerald-300';
  if (level === 'error') return 'bg-red-300';
  if (level === 'progress') return 'bg-sky-300';
  return 'bg-slate-300';
}

function previewText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

export const ToolEventCard: React.FC<ToolEventCardProps> = ({
  card,
  expanded,
  onToggle,
  formatTime,
  shortId,
}) => {
  const style = resolveToolStyle(card.toolName);
  const hasDetails = Boolean(
    card.progressText ||
      card.output ||
      card.error ||
      card.groupId ||
      card.parentId ||
      card.relatedEvents.length > 0
  );
  const canToggle = hasDetails && card.status !== 'running' && card.status !== 'pending';
  const relatedEvents = card.relatedEvents.slice(-6);
  const outputPreview = card.output ? previewText(card.output, 420) : undefined;

  const header = (
    <div className="flex min-w-0 items-start justify-between gap-2">
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <style.icon className={`h-3.5 w-3.5 shrink-0 ${style.iconClassName}`} />
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase ${style.badgeClassName}`}>
            {style.label}
          </span>
          <span className="truncate text-neutral-300">{card.toolName}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-500">
          <span>#{String(card.sequence).padStart(4, '0')}</span>
          <span>{formatTime(card.updatedAt)}</span>
          {typeof card.durationMs === 'number' && <span>{card.durationMs}ms</span>}
          <span>call:{shortId(card.callId)}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {statusIcon(card.status)}
        <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${statusClassName(card.status)}`}>
          {statusLabel(card.status)}
        </span>
        {canToggle && (
          <span className="text-neutral-500">{expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</span>
        )}
      </div>
    </div>
  );

  return (
    <div className={`rounded-lg border px-3 py-2 font-mono text-[11px] ${style.cardClassName}`}>
      {canToggle ? (
        <button type="button" className="w-full text-left" onClick={() => onToggle(card.callId)}>
          {header}
        </button>
      ) : (
        header
      )}

      {!expanded && hasDetails && (
        <div className="mt-1 truncate text-[10px] text-neutral-500">
          {card.error || card.progressText || (card.output ? 'output available' : `${card.relatedEvents.length} related events`)}
        </div>
      )}

      {expanded && hasDetails && (
        <div className="mt-2 space-y-2 rounded-md border border-neutral-800/70 bg-neutral-950/50 p-2">
          {card.progressText && (
            <div className="text-[10px] text-sky-200">
              progress: <span className="text-neutral-200">{card.progressText}</span>
            </div>
          )}
          {card.error && (
            <div className="rounded border border-red-500/30 bg-red-950/40 px-2 py-1 text-[10px] text-red-200">
              {card.error}
            </div>
          )}
          {outputPreview && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">output</div>
              <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words rounded border border-neutral-800 bg-neutral-900/80 p-2 text-[10px] text-neutral-300">
                {outputPreview}
              </pre>
            </div>
          )}
          {relatedEvents.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">
                related events ({card.relatedEvents.length})
              </div>
              <div className="space-y-1">
                {relatedEvents.map(event => (
                  <div key={event.id} className="flex items-start gap-2 text-[10px]">
                    <span className="w-10 shrink-0 text-right text-neutral-600">{String(event.sequence).padStart(4, '0')}</span>
                    <span className={`mt-[3px] h-1.5 w-1.5 rounded-full ${relatedLevelClass(event.level)}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-neutral-200">{event.text}</div>
                      <div className="flex flex-wrap items-center gap-2 text-neutral-500">
                        <span>{formatTime(event.timestamp)}</span>
                        {typeof event.durationMs === 'number' && <span>{event.durationMs}ms</span>}
                        {event.groupId && <span>group:{shortId(event.groupId)}</span>}
                        {event.parentId && <span>parent:{shortId(event.parentId)}</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
