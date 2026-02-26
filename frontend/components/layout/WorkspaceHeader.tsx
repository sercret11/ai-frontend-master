import React from 'react';
import { Pencil, Monitor, RefreshCw, Maximize } from 'lucide-react';

interface WorkspaceHeaderProps {
  activeView: 'preview' | 'code';
  setActiveView: (view: 'preview' | 'code') => void;
}

export const WorkspaceHeader: React.FC<WorkspaceHeaderProps> = ({ activeView, setActiveView }) => {
  return (
    <div className="relative h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
      {/* Center - Tabs */}
      <div className="flex-1 flex justify-start">
        {/* View Toggles */}
        <div className="bg-gray-100 p-1 rounded-lg flex items-center">
          <button
            onClick={() => setActiveView('preview')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === 'preview' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className={activeView === 'preview' ? 'text-black' : ''}>●</span> Preview
          </button>
          <button
            onClick={() => setActiveView('code')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-all ${activeView === 'code' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
          >
            <span className={activeView === 'code' ? 'text-black' : ''}>●</span> Code
          </button>
        </div>
      </div>

      {/* Title */}
      <div className="absolute left-1/2 transform -translate-x-1/2 flex items-center gap-2">
        <h1 className="text-sm font-semibold text-gray-900">Qianjing AI</h1>
        <button className="text-gray-400 hover:text-gray-600">
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Right Actions */}
      <div className="flex-1 flex justify-end items-center">
        <div className="flex items-center gap-0.5 bg-white border border-gray-200 p-1 rounded-lg shadow-sm">
          <button className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-all">
            <Monitor className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-all">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-all">
            <Maximize className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
