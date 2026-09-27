import React, { useMemo } from 'react';
import { compareText } from '../lib/diff-utils';
import { Change } from 'diff';

interface VisualDiffViewerProps {
  oldContent: string;
  newContent: string;
  title?: string;
}

export const VisualDiffViewer: React.FC<VisualDiffViewerProps> = ({ 
  oldContent, 
  newContent,
  title = "Visual Diff"
}) => {
  const changes = useMemo(() => {
    return compareText(oldContent, newContent);
  }, [oldContent, newContent]);

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 shadow-lg text-white mb-6">
      <h3 className="text-xl font-semibold text-slate-200 mb-4">{title}</h3>
      
      <div className="flex w-full bg-[#090b14] rounded-lg border border-slate-800 font-mono text-sm overflow-hidden">
        {/* Left Side (Old) */}
        <div className="w-1/2 border-r border-slate-700">
          <div className="bg-slate-800 text-slate-400 py-1 px-4 text-xs font-semibold border-b border-slate-700">Old Version</div>
          <div className="flex flex-col">
            {changes.map((part: Change, index: number) => {
              if (part.added) return null; // Skip added on the left
              
              const colorClass = part.removed ? 'bg-red-900/20 text-red-400' : 'text-slate-400';
              const prefix = part.removed ? '- ' : '  ';
              const lines = part.value.split('\n');
              if (lines[lines.length - 1] === '') lines.pop();

              return (
                <div key={index} className={colorClass}>
                  {lines.map((line: string, i: number) => (
                    <div key={i} className="flex px-4 py-1 border-b border-slate-800/30">
                      <span className="opacity-50 select-none mr-4 w-4 text-center shrink-0">{prefix}</span>
                      <span className="whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side (New) */}
        <div className="w-1/2">
          <div className="bg-slate-800 text-slate-400 py-1 px-4 text-xs font-semibold border-b border-slate-700">New Version</div>
          <div className="flex flex-col">
            {changes.map((part: Change, index: number) => {
              if (part.removed) return null; // Skip removed on the right
              
              const colorClass = part.added ? 'bg-green-900/20 text-green-400' : 'text-slate-400';
              const prefix = part.added ? '+ ' : '  ';
              const lines = part.value.split('\n');
              if (lines[lines.length - 1] === '') lines.pop();

              return (
                <div key={index} className={colorClass}>
                  {lines.map((line: string, i: number) => (
                    <div key={i} className="flex px-4 py-1 border-b border-slate-800/30">
                      <span className="opacity-50 select-none mr-4 w-4 text-center shrink-0">{prefix}</span>
                      <span className="whitespace-pre-wrap break-all">{line}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
