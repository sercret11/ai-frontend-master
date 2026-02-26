import React from 'react';
import ReactMarkdown from 'react-markdown';

export const MarkdownRenderer: React.FC<{ content: string }> = React.memo(
  ({ content }) => {
    return (
      <ReactMarkdown
        className="prose prose-sm max-w-none dark:prose-invert"
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : '';
            const text = String(children || '');
            const isInline = !className && !text.includes('\n');

            if (isInline) {
              return (
                <code className="bg-gray-100 dark:bg-gray-800 px-1 py-0.5 rounded text-sm" {...props}>
                  {children}
                </code>
              );
            }

            return (
              <div className="my-3 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <div className="flex items-center gap-2 text-gray-700 text-sm">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.707.293H19a2 2 0 012 2z"
                    />
                  </svg>
                  <span className="font-medium">Code generated</span>
                  <span className="text-gray-400">({language})</span>
                </div>
                <p className="text-gray-600 text-xs mt-1">Open the Code view on the right to inspect full content.</p>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  },
  (prevProps, nextProps) => prevProps.content === nextProps.content
);
