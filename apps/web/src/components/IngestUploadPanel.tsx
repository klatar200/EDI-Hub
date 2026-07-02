import { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { IngestUploadResponse } from '@edi/shared';
import { api, ApiCallError } from '../lib/api.ts';
import { useTenantQueryKey } from '../lib/useTenantQuery.ts';
import { Card, StatusPill, rawFileTone } from './ui';

const ACCEPT = '.edi,.x12,.txt';

interface UploadResult {
  filename: string;
  outcome: 'stored' | 'duplicate' | 'error';
  response?: IngestUploadResponse;
  error?: string;
}

export function IngestUploadPanel(): JSX.Element {
  const qc = useQueryClient();
  const ingestPrefix = useTenantQueryKey('ingest');
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<UploadResult[]>([]);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    const batch: UploadResult[] = [];
    for (const file of list) {
      try {
        const response = await api.uploadIngest(file);
        batch.push({
          filename: file.name,
          outcome: response.duplicate ? 'duplicate' : 'stored',
          response,
        });
      } catch (err) {
        const message =
          err instanceof ApiCallError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Upload failed';
        batch.push({ filename: file.name, outcome: 'error', error: message });
      }
    }
    setResults((prev) => [...batch, ...prev].slice(0, 20));
    setUploading(false);
    await qc.invalidateQueries({ queryKey: ingestPrefix });
  }, [qc, ingestPrefix]);

  function onDrop(e: React.DragEvent): void {
    e.preventDefault();
    setDragOver(false);
    if (uploading) return;
    void uploadFiles(e.dataTransfer.files);
  }

  return (
    <Card className="mb-3">
      <div className="p-3 space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">Upload EDI files</h2>
          <p className="text-xs text-[var(--color-fg-muted)]">
            Drop one or more files here or browse. Each file runs through the same pipeline as SFTP drops.
          </p>
        </div>

        <div
          data-testid="ingest-drop-zone"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 transition ${
            dragOver
              ? 'border-[var(--color-brand-500)] bg-[var(--color-brand-50)]/40'
              : 'border-[var(--color-surface-border)] hover:border-[var(--color-brand-400)] hover:bg-[var(--color-surface-muted)]/50'
          } ${uploading ? 'pointer-events-none opacity-60' : ''}`}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            data-testid="ingest-file-input"
            onChange={(e) => {
              if (e.target.files) void uploadFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <p className="text-sm text-[var(--color-fg)]">
            {uploading ? 'Uploading…' : 'Drop EDI files or click to browse'}
          </p>
          <p className="mt-1 text-xs text-[var(--color-fg-muted)]">.edi, .x12, .txt — multiple files supported</p>
        </div>

        {results.length > 0 ? (
          <ul className="space-y-2" data-testid="ingest-upload-results">
            {results.map((r, i) => (
              <li
                key={`${r.filename}-${i}`}
                className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--color-surface-border)] px-3 py-2 text-sm"
              >
                <span className="font-medium text-[var(--color-fg)]">{r.filename}</span>
                {r.outcome === 'error' ? (
                  <StatusPill tone="error" size="sm">{r.error ?? 'Failed'}</StatusPill>
                ) : (
                  <>
                    <StatusPill tone={r.outcome === 'duplicate' ? 'warn' : 'success'} size="sm">
                      {r.outcome === 'duplicate' ? 'Duplicate' : 'Uploaded'}
                    </StatusPill>
                    {r.response?.isaControlNumber ? (
                      <span className="font-mono text-xs text-[var(--color-fg-muted)]">
                        ISA {r.response.isaControlNumber}
                      </span>
                    ) : null}
                    {r.response?.status ? (
                      <StatusPill tone={rawFileTone(r.response.status)} size="sm" withDot>
                        {r.response.status}
                      </StatusPill>
                    ) : null}
                    {r.outcome !== 'duplicate' && r.response?.id ? (
                      <Link
                        to={`/ingestions?highlight=${r.response.id}`}
                        className="text-xs text-[var(--color-brand-600)] hover:text-[var(--color-brand-700)]"
                      >
                        View in list →
                      </Link>
                    ) : null}
                    {r.outcome === 'duplicate' && r.response?.duplicateOf ? (
                      <p className="w-full text-xs text-[var(--color-fg-muted)]" data-testid="duplicate-explanation">
                        Same ISA control number (file ID) as file received{' '}
                        {new Date(r.response.duplicateOf.ingestedAt).toLocaleString()} ({r.response.duplicateOf.source}
                        ).{' '}
                        <Link
                          to={`/ingestions?highlight=${r.response.duplicateOf.id}`}
                          className="text-[var(--color-brand-600)] hover:underline"
                        >
                          View original →
                        </Link>
                      </p>
                    ) : null}
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}
