import { useState } from 'react';
import { Sidebar, WorkspaceHeader, CodeView, PreviewView } from './components';
import { WorkflowProvider } from './contexts/WorkflowContext';

export default function App() {
  const [activeView, setActiveView] = useState<'preview' | 'code'>('preview');

  return (
    <WorkflowProvider>
      <div className="flex h-screen w-full bg-white overflow-hidden">
        {/* Left Sidebar - AI Assistant */}
        <Sidebar />

        {/* Right Workspace */}
        <div className="flex-1 flex flex-col h-full min-w-0 border-l border-gray-200 overflow-hidden bg-white">
          <WorkspaceHeader activeView={activeView} setActiveView={setActiveView} />

          <div className="flex-1 min-h-0 w-full relative">
            {activeView === 'code' ? <CodeView /> : <PreviewView />}
          </div>
        </div>
      </div>
    </WorkflowProvider>
  );
}
