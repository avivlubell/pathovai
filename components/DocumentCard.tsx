'use client';

export type DocumentStatus = 'uploading' | 'ready' | 'saved_to_kb';

interface DocumentCardProps {
  filename: string;
  fileSize: number;
  fileType: string;
  status: DocumentStatus;
  docType?: string;
  onRemove?: () => void;
}

const FILE_ICONS: Record<string, string> = {
  'application/pdf': '\ud83d\udcc4',
  'text/plain': '\ud83d\udcdd',
  'text/csv': '\ud83d\udcca',
  'application/json': '\ud83d\udd27',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '\ud83d\udcc3',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '\ud83d\udcca',
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export default function DocumentCard({ filename, fileSize, fileType, status, docType, onRemove }: DocumentCardProps) {
  return (
    <div className="inline-flex items-center gap-3 px-3 py-2 rounded-lg border border-slate-700 bg-slate-800/60 max-w-sm mb-2">
      <span className="text-lg flex-shrink-0">{FILE_ICONS[fileType] || '\ud83d\udcce'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-200 truncate">{filename}</p>
        <p className="text-xs text-slate-400">
          {formatFileSize(fileSize)}
          {docType && status !== 'uploading' && (
            <span className="ml-2 text-slate-500">\u2022 {docType.replace(/_/g, ' ')}</span>
          )}
        </p>
      </div>
      <div className="flex-shrink-0 flex items-center gap-2">
        {status === 'uploading' && (
          <svg className="animate-spin h-4 w-4 text-sky-400" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
        )}
        {status === 'ready' && (
          <svg className="h-4 w-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        {status === 'saved_to_kb' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-900/40 border border-sky-700/50 text-[11px] text-sky-300 font-medium">
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            In knowledge base
          </span>
        )}
        {onRemove && status !== 'saved_to_kb' && (
          <button onClick={onRemove} className="text-slate-500 hover:text-slate-300 p-0.5" title="Remove">
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
