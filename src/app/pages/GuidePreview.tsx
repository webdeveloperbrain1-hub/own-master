import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, BookOpen, ChevronLeft, ChevronRight, Download, Loader2, LockKeyhole } from 'lucide-react';
import { AnnotationMode, getDocument, GlobalWorkerOptions, type PDFDocumentLoadingTask, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { apiFetch } from '../data/apiClient';
import { contractLibraryPath } from '../data/contractLinks';
import { downloadFilingOriginal, fetchFilingGuide, type FilingGuide } from '../data/contractFilingClient';

GlobalWorkerOptions.workerSrc = workerUrl;
const panel = 'min-w-0 rounded-[22px] border border-border bg-card p-4 sm:p-6';
const button = 'micro-interaction inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-muted px-3 py-2.5 text-sm font-semibold hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed';
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'The guide could not be loaded. Please try again.';

export default function GuidePreviewPage() {
  const { guideId = '' } = useParams();
  return <GuidePreview key={guideId} guideId={guideId} />;
}

function GuidePreview({ guideId }: { guideId: string }) {
  const [params] = useSearchParams();
  const [guide, setGuide] = useState<FilingGuide | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    let active = true;
    let task: PDFDocumentLoadingTask | undefined;
    const controller = new AbortController();
    setGuide(null);
    setPdf(null);
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const metadata = await fetchFilingGuide(guideId);
        if (!active) return;
        setGuide(metadata);
        if (metadata.format === 'pdf') {
          const response = await apiFetch(`/api/filing/templates/${encodeURIComponent(guideId)}/original`, { signal: controller.signal });
          const bytes = new Uint8Array(await response.arrayBuffer());
          if (!active) return;
          task = getDocument({ data: bytes, isEvalSupported: false });
          const document = await task.promise;
          if (active) setPdf(document);
        }
      } catch (failure) {
        if (active) setError(errorMessage(failure));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); void task?.destroy(); };
  }, [guideId, retry]);

  async function download() {
    setDownloading(true);
    setDownloadError('');
    try { await downloadFilingOriginal(guideId); }
    catch (failure) { setDownloadError(errorMessage(failure)); }
    finally { setDownloading(false); }
  }

  return (
    <main className="grid min-w-0 gap-5">
      <Link to={contractLibraryPath(params.get('project'))} className="inline-flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to Guides & Resources</Link>
      <header data-reveal className={panel}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground"><BookOpen className="size-4" />Guides & Resources</p>
            <h1 className="mt-2 break-words text-[26px] font-semibold leading-tight sm:text-[32px]">{guide?.title || (loading ? 'Opening guide…' : 'Guide unavailable')}</h1>
            {guide && <p className="mt-2 break-words text-sm text-muted-foreground">{guide.originalName}</p>}
          </div>
          <span className="inline-flex w-max shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-3 py-1 text-xs"><LockKeyhole className="size-3.5" />Read-only</span>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Read this reference guide here. Its contents cannot be edited.</p>
        {guide && <button type="button" className={`${button} mt-4`} disabled={downloading} onClick={() => void download()}>{downloading ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}{downloading ? 'Downloading…' : 'Download original'}</button>}
      </header>
      {downloadError && <p role="alert" className="text-sm text-destructive">{downloadError}</p>}
      {loading && <section className={`${panel} flex items-center gap-2`} role="status"><Loader2 className="size-4 animate-spin" />Loading guide preview…</section>}
      {error && <section className={panel}><p role="alert" className="text-sm text-destructive">{error}</p><button type="button" className={`${button} mt-3`} onClick={() => setRetry((value) => value + 1)}>Try again</button></section>}
      {pdf && !loading && <PdfPreview pdf={pdf} />}
      {guide?.text && !loading && (
        <details className={panel} open={!pdf}>
          <summary className="cursor-pointer font-semibold">Read guide as text</summary>
          <article aria-label="Guide text" className="mt-4 whitespace-pre-wrap break-words text-sm leading-relaxed">{guide.text}</article>
        </details>
      )}
    </main>
  );
}

function PdfPreview({ pdf }: { pdf: PDFDocumentProxy }) {
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState('fit');
  const [rendering, setRendering] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(viewport.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!canvas.current || width <= 0) return;
    let active = true;
    let task: RenderTask | undefined;
    setRendering(true);
    setError('');
    void (async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const target = canvas.current;
        if (!active || !target) return;
        const base = page.getViewport({ scale: 1 });
        const scale = zoom === 'fit' ? Math.max(0.1, width / base.width) : Number(zoom) / 100;
        const pageViewport = page.getViewport({ scale });
        const density = Math.min(window.devicePixelRatio || 1, 2);
        target.width = Math.floor(pageViewport.width * density);
        target.height = Math.floor(pageViewport.height * density);
        target.style.width = `${Math.floor(pageViewport.width)}px`;
        target.style.height = `${Math.floor(pageViewport.height)}px`;
        task = page.render({ canvas: target, viewport: pageViewport, transform: density === 1 ? undefined : [density, 0, 0, density, 0, 0], annotationMode: AnnotationMode.ENABLE, isEditing: false });
        await task.promise;
        if (active) setRendering(false);
      } catch (failure) {
        if (active) { setError(errorMessage(failure)); setRendering(false); }
      }
    })();
    return () => { active = false; task?.cancel(); };
  }, [pdf, pageNumber, width, zoom]);

  function changePage(number: number) {
    setPageNumber(number);
    viewport.current?.scrollTo({ top: 0, left: 0 });
  }

  return (
    <section className={panel} aria-label="Read-only guide preview">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={button} aria-label="Previous page" disabled={pageNumber === 1} onClick={() => changePage(pageNumber - 1)}><ChevronLeft className="size-4" /></button>
          <p aria-live="polite" className="whitespace-nowrap text-sm">Page {pageNumber} of {pdf.numPages}</p>
          <button type="button" className={button} aria-label="Next page" disabled={pageNumber === pdf.numPages} onClick={() => changePage(pageNumber + 1)}><ChevronRight className="size-4" /></button>
        </div>
        <label className="flex items-center gap-2 text-sm">Zoom<select aria-label="Preview zoom" value={zoom} onChange={(event) => setZoom(event.target.value)} className="rounded-lg border border-border bg-input px-3 py-2"><option value="fit">Fit width</option><option value="100">100%</option><option value="125">125%</option><option value="150">150%</option></select></label>
      </div>
      {rendering && <p role="status" className="mb-3 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Rendering page…</p>}
      {error && <p role="alert" className="mb-3 text-sm text-destructive">{error} You can read the text version below.</p>}
      <div ref={viewport} className="max-h-[78vh] min-h-[300px] overflow-auto rounded-[12px] border border-border bg-slate-200 p-3 sm:p-5 dark:bg-[#34373d]" aria-busy={rendering}>
        <canvas ref={canvas} role="img" aria-label={`Guide page ${pageNumber} of ${pdf.numPages}`} className="mx-auto block max-w-none bg-white shadow-sm" />
      </div>
    </section>
  );
}
