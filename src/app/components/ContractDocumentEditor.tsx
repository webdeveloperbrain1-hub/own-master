import { useLayoutEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useBilling } from '../billing/BillingContext';
import {
  downloadFilingDraft,
  type FilingDocumentLayout,
} from '../data/contractFilingClient';
const ghostButton =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-[14px] py-[10px] rounded-[14px] font-[700] cursor-pointer hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed';

export function plainEditorHtml(text: string) {
  const escape = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div data-contract-page="1">${text
    .split('\n')
    .map((line) => `<p>${escape(line) || '<br>'}</p>`)
    .join('')}</div>`;
}

export function ContractDocumentEditor({
  initialHtml,
  layout,
  disabled,
  onChange,
}: {
  initialHtml: string;
  layout: FilingDocumentLayout;
  disabled: boolean;
  onChange: (text: string, html: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const [zoom, setZoom] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (editor.current) editor.current.innerHTML = initialHtml;
  }, [initialHtml]);

  useLayoutEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setFitScale(
        Math.min(
          1,
          Math.max(
            0.2,
            (entry.contentRect.width - 32) / ((layout.width * 96) / 72),
          ),
        ),
      );
    });
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [layout.width]);

  const scale = zoom ?? fitScale;

  return (
    <div className="min-w-0">
      <style>{`
        .contract-document { color: #000; font: 12pt 'Times New Roman', Times, serif; }
        .contract-document:not(:has([data-contract-page])) {
          box-sizing: border-box; width: var(--paper-width); min-height: var(--paper-height);
          padding: var(--paper-padding); background: #fff;
        }
        .contract-document [data-contract-page] {
          box-sizing: border-box; width: var(--paper-width); min-height: var(--paper-height);
          padding: var(--paper-padding); background: #fff; margin: 0 auto 18px;
          box-shadow: 0 2px 12px #0003; outline: 1px solid #d4d4d4;
        }
        .contract-document p { margin: 0; white-space: pre-wrap; overflow-wrap: break-word; }
        .contract-document span { white-space: pre-wrap; }
        .contract-document:focus { outline: none; }
        .contract-document:focus [data-contract-page] { outline-color: #a3a3a3; }
      `}</style>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3 text-[12px] text-muted-foreground">
        <span>
          {layout.pageCount} {layout.pageCount === 1 ? 'page' : 'pages'} ·
          Original template layout
        </span>
        <div className="flex items-center gap-1">
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 rounded hover:bg-accent"
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.25, scale - 0.1))}
          >
            −
          </button>
          <span className="min-w-[38px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            className="inline-flex min-h-11 min-w-11 items-center justify-center px-2 py-1 rounded hover:bg-accent"
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(2, scale + 0.1))}
          >
            +
          </button>
          <button
            className="inline-flex min-h-11 items-center justify-center px-3 py-1 rounded hover:bg-accent"
            onClick={() => setZoom(null)}
          >
            Fit width
          </button>
        </div>
      </div>
      <div
        ref={viewport}
        className="min-w-0 bg-slate-200 dark:bg-[#34373d] border border-border rounded-[12px] p-4 overflow-auto overscroll-x-contain max-h-[78dvh]"
      >
        <div
          style={{ zoom: scale, width: `${layout.width}pt`, margin: '0 auto' }}
        >
          <div
            ref={editor}
            role="textbox"
            aria-label="Contract document"
            aria-multiline="true"
            aria-describedby="contract-editor-help"
            aria-readonly={disabled}
            tabIndex={0}
            contentEditable={!disabled}
            suppressContentEditableWarning
            spellCheck
            onInput={(event) =>
              onChange(
                event.currentTarget.innerText.replace(/\r\n/g, '\n'),
                event.currentTarget.innerHTML,
              )
            }
            onPaste={(event) => {
              event.preventDefault();
              document.execCommand(
                'insertText',
                false,
                event.clipboardData.getData('text/plain'),
              );
            }}
            style={
              {
                '--paper-width': `${layout.width}pt`,
                '--paper-height': `${layout.height}pt`,
                '--paper-padding': `${layout.top}pt ${layout.right}pt ${layout.bottom}pt ${layout.left}pt`,
              } as React.CSSProperties
            }
            className="contract-document cursor-text"
          />
        </div>
      </div>
    </div>
  );
}

export function ContractDraftDownloadButton({
  draftId,
  disabled = false,
}: {
  draftId: string;
  disabled?: boolean;
}) {
  const { status, showUpgrade } = useBilling();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function download(format: 'pdf' | 'docx') {
    if (status && !status.canExport) { showUpgrade(); return; }
    setBusy(true); setError('');
    try { await downloadFilingDraft(draftId, format); }
    catch (err) { setError(err instanceof Error ? err.message : 'Download failed.'); }
    finally { setBusy(false); }
  }
  return (
    <div className="document-downloads min-w-0">
      <div className="flex flex-wrap gap-2">
      <button
        className={ghostButton}
        disabled={busy || disabled}
        onClick={() => void download('pdf')}
      >
        <Download className="w-4 h-4" />{' '}
        {busy ? 'Downloading…' : 'Download draft PDF'}
      </button>
      <button className={ghostButton} disabled={busy || disabled} onClick={() => void download('docx')}><Download className="w-4 h-4" />Download Word</button>
      </div>
      {error && (
        <p role="alert" className="text-[12px] text-red-700 dark:text-red-200">
          {error}
        </p>
      )}
    </div>
  );
}
