import React from 'react';
import { CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import type { ConsoleLevel, TimelineEventItem } from './types';

interface TimelineEventRowProps {
  item: TimelineEventItem;
  formatTime: (timestamp: number) => string;
  shortId: (value?: string) => string;
}

function levelIcon(level: ConsoleLevel): JSX.Element {
  if (level === 'success') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />;
  if (level === 'error') return <XCircle className="h-3.5 w-3.5 text-red-300" />;
  if (level === 'progress') return <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-300" />;
  return <Info className="h-3.5 w-3.5 text-slate-300" />;
}

export const TimelineEventRow: React.FC<TimelineEventRowProps> = ({ item, formatTime, shortId }) => {
  return (
    <div className="rounded-md border border-neutral-800/80 bg-neutral-900/60 px-2.5 py-2 font-mono text-[11px] text-neutral-200">
      <div className="flex min-w-0 items-start gap-2">
        <span className="w-10 shrink-0 text-right text-neutral-500">{String(item.sequence).padStart(4, '0')}</span>
        <span className="mt-[1px]">{levelIcon(item.level)}</span>
        <span className="truncate">{item.text}</span>
      </div>
      <div className="ml-12 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-500">
        <span>{formatTime(item.timestamp)}</span>
        {typeof item.durationMs === 'number' && <span>{item.durationMs}ms</span>}
        {item.groupId && <span>group:{shortId(item.groupId)}</span>}
        {item.parentId && <span>parent:{shortId(item.parentId)}</span>}
      </div>
    </div>
  );
};
