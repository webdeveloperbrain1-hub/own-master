import { forwardRef, lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  createBrowserRouter,
  RouterProvider,
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSearch,
  FileText,
  Music2,
  PenLine,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { LoginPage, SignupPage, ForgotPasswordPage, ResetPasswordPage, ConfirmEmailPage, ResendConfirmationPage } from './pages/AuthPages';
import { deleteContract, getContract, listContracts, updateContractContent } from './data/contracts';
import {
  explainContractClause,
  approveLocalContractTemplate,
  fetchContractTemplates,
  fetchLocalContractTemplate,
  fetchLocalContractTemplates,
  fetchTemplatePreview,
  fetchTemplateSourceFile,
  fillLocalContractTemplate,
  importLocalContractZip,
  localGeneratedContractDownloadUrl,
  renderTemplateDraft,
  reviewContractRisk,
  scanAllLocalContractTemplates,
  scanLocalContractTemplate,
} from './data/contractAssistantClient';
import type {
  ClauseExplanation,
  Contract,
  ContractTemplateOption,
  ContractWizardAnswers,
  LocalContractField,
  LocalContractTemplate,
  RiskReviewResult,
  TemplateQuestion,
} from './types';
import ContractFillerPage from './pages/ContractFiller';
import SavedContractEditorPage from './pages/SavedContractEditor';
const GuidePreviewPage = lazy(() => import('./pages/GuidePreview'));
import { savedContractEditorPath } from './data/contractLinks';
import DashboardLayout from './components/DashboardLayout';
import ScrollMotion from './components/ScrollMotion';
import LandingNavigation from './components/LandingNavigation';
import SiteFooter from './components/SiteFooter';
import { SiteConfigurationProvider, useSiteConfiguration } from './data/siteConfiguration';
const InformationPage = lazy(() => import('./pages/Information'));
import { UnsavedChangesProvider, useUnsavedChanges } from './components/UnsavedChanges';
import { DraftRecoveryNotice, useDraftRecovery } from './components/DraftRecovery';
import { TrackReviewWorkspace, ProjectDetailPage } from './components/ProjectWorkspace';
import { ContractProgressPanel, ContractStageBadge } from './components/ContractProgress';
import { fetchContractProgressList } from './data/contractProgressClient';
import { contractStageLabel, type ContractProgressStage } from './data/contractProgressTypes';
import { fetchFilingDrafts, deleteFilingDraft, downloadFilingDraft } from './data/contractFilingClient';
import { mergeContractInventory, type ContractListItem } from './data/contractInventory';
import { BillingProvider, ProExportNotice } from './billing/BillingContext';
const PricingPage = lazy(() => import('./pages/Pricing'));
const BillingPage = lazy(() => import('./pages/Billing'));

const primaryButton =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed';

const ghostButton =
  'micro-interaction inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-[15px] py-[11px] rounded-[14px] font-[700] cursor-pointer hover:bg-accent';

const panel =
  'border border-border bg-gradient-to-b from-[var(--panel-top)] to-[var(--panel-bottom)] rounded-[22px]';

const card = 'border border-border bg-card rounded-[22px]';
const legalPageClass =
  "relative aspect-[210/297] w-full max-w-[690px] overflow-hidden border border-[#cfcfcf] bg-white px-[7.3%] pb-[8%] pt-[7%] font-['Times_New_Roman',Times,serif] text-[12px] leading-[1.14] text-black shadow-[0_1px_3px_rgba(0,0,0,.18),0_10px_28px_rgba(0,0,0,.12)]";
const legalPageUnits = 66;

type LiveTemplatePart =
  | { type: 'text'; content: string }
  | { type: 'blank'; label: string; value: string; placeholder: string };

  const createTextPart = (content: string): LiveTemplatePart => ({
  type: 'text',
  content,
});

const defaultWizardQuestions: TemplateQuestion[] = [
  { id: 'partyOneName', label: 'Party 1 name', placeholder: 'Producer legal name', required: true },
  { id: 'partyOneRole', label: 'Party 1 role', placeholder: 'Producer' },
  { id: 'partyTwoName', label: 'Party 2 name', placeholder: 'Artist legal name', required: true },
  { id: 'partyTwoRole', label: 'Party 2 role', placeholder: 'Artist' },
  { id: 'companyName', label: 'Company name', placeholder: 'Label, production company, or payer' },
  { id: 'producerName', label: 'Producer name', placeholder: 'Producer legal name' },
  { id: 'artistName', label: 'Recording artist name', placeholder: 'Artist or group name' },
  { id: 'agreementDate', label: 'Agreement date', placeholder: 'January 1, 2026' },
  { id: 'projectTitle', label: 'Song / project title', placeholder: 'New single title' },
  { id: 'masterCount', label: 'Number of masters', placeholder: '1, 3, or TBD' },
  { id: 'advanceAmount', label: 'Advance amount', placeholder: '$500, $2,500, or TBD' },
  { id: 'compensation', label: 'Compensation', placeholder: 'Advance, fee, royalty, or TBD' },
  { id: 'royaltyPercentage', label: 'Royalty percentage', placeholder: '3%' },
  { id: 'paymentSchedule', label: 'Payment schedule', placeholder: 'Semi-annually, quarterly, monthly' },
  { id: 'accountingPeriod', label: 'Accounting period', placeholder: '45 days after June 30 and December 31' },
  { id: 'term', label: 'Term', placeholder: '1 year, perpetual, or TBD' },
  { id: 'territory', label: 'Territory', placeholder: 'Worldwide' },
  { id: 'ownershipTerms', label: 'Ownership terms', placeholder: 'Who owns the master/publishing?' },
];

function userDisplayName(userName?: string | null, email?: string | null) {
  return userName || email?.split('@')[0] || 'there';
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(date));
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function safeDownloadName(value: string) {
  return value
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'own-masters-contract';
}

function sourceFileName(value?: string | null) {
  return String(value ?? '')
    .split(/[\\/]/)
    .pop()
    ?.toLowerCase() ?? '';
}

function normalizeTemplatePreviewText(text: string) {
  return cleanContractDisplayText(text)
    .replace(/\n(?=\d+\.\s)/g, '\n\n')
    .replace(/\n(?=[a-z]\)\s)/g, '\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanContractDisplayText(text: string) {
  const lines = String(text ?? '')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();

      if (!trimmed) {
        return true;
      }

      if (/^_{8,}\s+_{8,}$/.test(trimmed)) {
        return true;
      }

      if (/^_{8,}$/.test(trimmed)) {
        return true;
      }

      const compacted = trimmed.replace(/[^\w\s]/g, '');
      const hasContractWord = /\b(agreement|accepted|artist|company|producer|by|date|signature|witness|title|name)\b/i.test(trimmed);

      if (/[A-Za-z]/.test(trimmed) && /\d/.test(trimmed) && /^(?:[A-Za-z]*\d+[A-Za-z]*|[A-Za-z]{1,4})(?:\s+(?:[A-Za-z]*\d+[A-Za-z]*|[A-Za-z]{1,4})){1,8},?$/.test(compacted) && trimmed.length <= 48 && !hasContractWord) {
        return false;
      }

      return !/^(times new roman|arial|tahoma|normal|heading|body text|list|caption|index|standard|microsoft word|word\.document|preferred customer|preferred company|forms solutions|proformz,\s*llc|linearized|xref|trailer|endobj|objstm|fontdescriptor|basefont|flatedecode|decodeparms|page\s+\d+|\d+:\s*page\s+\d+)/i.test(trimmed)
        && !/^\d{7,}\s+\d{5}\s+n$/i.test(trimmed)
        && !/^\d+$/.test(trimmed)
        && !/^[;\\*\s]+$/.test(trimmed);
    });

  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isUsableContractText(text: string) {
  const sample = cleanContractDisplayText(text).slice(0, 3000);
  const contractWords = (sample.match(/\b(agreement|contract|artist|producer|company|license|royalty|recording|masters|hereinafter|party|accepted|signature)\b/gi) ?? []).length;
  const pdfInternals = (sample.match(/\b(Linearized|FlateDecode|XRef|FontDescriptor|ObjStm|endobj|trailer|BaseFont|DecodeParms|StructTreeRoot|OCProperties)\b/g) ?? []).length;
  const hashLines = (sample.match(/^[0-9A-F]{20,}$/gim) ?? []).length;

  if (pdfInternals >= 2 || hashLines >= 2) {
    return false;
  }

  const additionalNotesOnly = contractWords < 3 && /^\s*Additional party notes:/i.test(sample);

  return contractWords >= 3 && !additionalNotesOnly;
}

function bestContractDisplayText(primary: string, fallback: string) {
  if (isUsableContractText(primary)) {
    return cleanContractDisplayText(primary);
  }

  if (isUsableContractText(fallback)) {
    return cleanContractDisplayText(fallback);
  }

  return '';
}

function paginateTemplateText(text: string) {
  const cleaned = normalizeTemplatePreviewText(text);
  const lines = cleaned.split('\n');
  const pages: string[] = [];
  let current: string[] = [];
  let currentUnits = 0;
  const maxUnits = legalPageUnits;

  function lineUnits(line: string) {
    if (!line.trim()) {
      return 1;
    }

    return Math.max(1, Math.ceil(line.length / 82));
  }

  function pushPage() {
    const page = current.join('\n').trim();

    if (page) {
      pages.push(page);
    }

    current = [];
    currentUnits = 0;
  }

  for (const line of lines) {
    const units = lineUnits(line);

    if (current.length && currentUnits + units > maxUnits) {
      pushPage();
    }

    current.push(line);
    currentUnits += units;
  }

  pushPage();

  const cleanPages = pages.filter(isContractTextChunk);

  return cleanPages.length
    ? cleanPages
    : ['Template preview unavailable.'];
}

function isContractTextChunk(text: string) {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length;
  const suspicious = (text.match(/[<>@#$^`[\]{}]/g) ?? []).length;
  const contractWords = (text.match(/\b(Agreement|Artist|Producer|contract|Masters|royalty|recording|hereunder|Accepted)\b/gi) ?? []).length;

  if (text.trim().length < 80) {
    return false;
  }

  if (contractWords >= 2) {
    return true;
  }

  return letters > 180 && suspicious / Math.max(letters, 1) < 0.08;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/pricing" element={<Suspense fallback={<LoadingScreen label="Loading plans" />}><PricingPage /></Suspense>} />
      {(['terms', 'privacy', 'contact'] as const).map(page => <Route key={page} path={`/${page}`} element={<Suspense fallback={<LoadingScreen label="Loading information" />}><InformationPage page={page} /></Suspense>} />)}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route path="/auth/confirm" element={<ConfirmEmailPage />} />
      <Route path="/resend-confirmation" element={<ResendConfirmationPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="billing" element={<Suspense fallback={<LoadingScreen label="Loading billing" />}><BillingPage /></Suspense>} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="contract-filler" element={<ContractFillerPage />} />
        <Route path="contract-filler/guides/:guideId" element={<Suspense fallback={<LoadingScreen label="Opening guide" />}><GuidePreviewPage /></Suspense>} />
        <Route path="contracts/drafts/:draftId/edit" element={<SavedContractEditorPage />} />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

const router = createBrowserRouter([
  { path: '*', element: <UnsavedChangesProvider><BillingProvider><AppRoutes /></BillingProvider></UnsavedChangesProvider> },
]);

export default function App() {
  return (
    <SiteConfigurationProvider><AuthProvider>
      <ScrollMotion />
      <RouterProvider router={router} />
    </AuthProvider></SiteConfigurationProvider>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading, sessionError, retrySession } = useAuth();
  const location = useLocation();

  if (loading && !user) {
    return <LoadingScreen label="Opening your workspace" />;
  }

  if (!user) {
    if (sessionError) return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className={`${panel} p-8 max-w-[420px]`}>
          <h1 className="text-2xl mb-3">We couldn’t check your sign-in.</h1>
          <p role="alert" className="text-muted-foreground mb-5">{sessionError}</p>
          <button className={primaryButton} onClick={retrySession}>Try again</button>
        </div>
      </main>
    );
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}${location.hash}` }} />;
  }

  return children;
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className={`${panel} p-8 text-center max-w-[360px]`}>
        <img src="/own-masters-logo.png" alt="Own Masters" className="w-20 h-auto mx-auto mb-4 brightness-0 dark:brightness-100" />
        <p className="text-muted-foreground m-0">{label}...</p>
      </div>
    </div>
  );
}

function LandingPage() {
  const { user, loading } = useAuth();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  };

  return (
    <div className="min-h-screen">
      <div className="max-w-[1120px] mx-auto px-4 sm:px-6 pb-12 sm:pb-16">
        <LandingNavigation onSection={scrollToSection} />

        <section id="home" data-reveal-group className="py-10 sm:py-12 grid grid-cols-1 lg:grid-cols-[minmax(0,1.12fr)_minmax(0,0.88fr)] gap-7 sm:gap-9 items-center">
          <div className="min-w-0">
            <h1 className="m-0 mb-[14px] text-[clamp(32px,5.8vw,68px)] leading-[1.06] tracking-[-0.8px] sm:tracking-[-1.4px]">
              Build your music business before the industry builds it for you.
            </h1>
            <p className="text-muted-foreground text-[16px] sm:text-[18px] leading-[1.55] max-w-[680px] m-0 mb-[22px]">
              Own Masters helps artists, managers, producers, DJs, and writers organize songs, prepare agreements, and keep the paperwork behind the catalog in one place.
            </p>

            <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3">
              {(user || !loading) && <Link to={user ? '/dashboard' : '/signup'} className={primaryButton}>
                {user ? 'Dashboard' : 'Start Creating Contracts'} <ArrowRight className="size-4" />
              </Link>}
              {!loading && !user && (
                <Link to="/login" className={ghostButton}>
                  Log In
                </Link>
              )}
            </div>

            <div className="text-muted-foreground text-[13px] mt-3">
              For artists, managers, producers, DJs, writers, and music industry pros.
            </div>

            <div className="flex gap-2 sm:gap-[10px] flex-wrap mt-4">
              {['Artist', 'Manager', 'Producer', 'Writer', 'DJ', 'Industry Pro'].map((role) => (
                <span key={role} className="px-3 py-2 sm:px-[13px] sm:py-[10px] shrink-0 whitespace-nowrap rounded-full border border-border bg-secondary text-secondary-foreground font-[700] text-[12px] sm:text-[14px]">
                  {role}
                </span>
              ))}
            </div>
          </div>

          <div className={`${panel} min-w-0 p-4 sm:p-[22px]`}>
            <h3 className="m-0 mb-3 text-[18px]">Your music business command center</h3>
            {[
              ['Contracts Workspace', 'Split sheets, producer agreements, licenses, and deal memos'],
              ['Rights Organization', 'Keep ownership paperwork connected to every project'],
              ['Document Exports', 'Download saved drafts as PDF or Word documents'],
            ].map(([title, description]) => (
              <div key={title} className="flex justify-between items-start sm:items-center gap-3 p-3 rounded-[16px] border border-border bg-muted mt-[10px]">
                <div className="min-w-0 flex-1">
                  <strong>{title}</strong>
                  <br />
                  <span className="text-muted-foreground text-[13px]">{description}</span>
                </div>
                <div className="shrink-0 px-[9px] py-[6px] rounded-full border border-border bg-secondary text-secondary-foreground text-[11px] sm:text-[12px] whitespace-nowrap">
                  <CheckCircle2 className="size-4" aria-label="Included" />
                </div>
              </div>
            ))}
          </div>
        </section>

        <LandingSections />
      </div>
    </div>
  );
}

function LandingSections() {
  const { user, loading } = useAuth();
  return (
    <>
      <section className="py-8 sm:py-10 lg:py-[50px]">
        <h2 data-reveal className="m-0 mb-6 sm:mb-10 text-[26px] sm:text-[32px] leading-tight tracking-tight text-center">Your songs. Your agreements. One workspace.</h2>
        <div data-reveal-group className="grid grid-cols-1 md:grid-cols-2 gap-[14px]">
          {[
            ['Contract Drafts', 'Start with split sheets, producer agreements, licenses, and deal memos.'],
            ['Catalog Paper Trail', 'Keep your ownership paperwork in one place as projects grow.'],
            ['Song Projects', 'Keep audio, lyrics, notes, and related contracts together for each song.'],
            ['Contract Progress', 'Track reviews and signing stages, then store the signed PDF with your draft.'],
          ].map(([title, description]) => (
            <div key={title} className={`${card} p-5 motion-card`}>
              <h3 className="m-0 mb-2 text-[18px] tracking-[-0.3px]">{title}</h3>
              <p className="m-0 text-muted-foreground leading-[1.45] text-[15px]">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="about" className="py-8 sm:py-10 lg:py-[50px] bg-gradient-to-b from-transparent via-[rgba(255,255,255,.02)] to-transparent">
        <h2 data-reveal className="m-0 mb-6 sm:mb-10 text-[26px] sm:text-[32px] leading-tight tracking-tight text-center">Built for both sides of the music business</h2>
        <div data-reveal-group className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
          {[
            ['For Creators', 'Run your music like a business. Define splits, save agreements, and keep your catalog organized.'],
            ['For Managers', 'Keep artist projects, notes, and agreements organized in your own workspace.'],
            ['For Industry Pros', 'Help serious artists, producers, DJs, writers, and managers move with cleaner paperwork.'],
          ].map(([title, description]) => (
            <div key={title} className={`${card} p-5 sm:p-6 motion-card last:md:col-span-2 last:lg:col-span-1`}>
              <h3 className="m-0 mb-3 text-[19px] tracking-tight">{title}</h3>
              <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="py-8 sm:py-10 lg:py-[50px]">
        <h2 data-reveal className="m-0 mb-6 sm:mb-10 text-[26px] sm:text-[32px] leading-tight tracking-tight text-center">How it works</h2>
        <div data-reveal-group className="max-w-[820px] mx-auto space-y-6">
          {[
            ['Create your account', 'Sign up, open your dashboard, and start organizing the documents behind your work.'],
            ['Choose a contract type', 'Pick a split sheet, producer agreement, license, distribution agreement, or performance deal.'],
            ['Save the draft', 'Edit and save your agreement, download a copy, and track its progress in your workspace.'],
          ].map(([title, description], index) => (
            <div key={title} className="flex gap-3 sm:gap-6 items-start group motion-card">
              <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-gradient-to-b from-[rgba(255,255,255,.15)] to-[rgba(255,255,255,.08)] border border-border flex items-center justify-center font-bold text-[18px] transition-all group-hover:border-primary group-hover:scale-110">
                {index + 1}
              </div>
              <div className="min-w-0 pt-1.5 sm:pt-2">
                <h3 className="m-0 mb-2 text-[19px] tracking-tight">{title}</h3>
                <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section data-reveal className="py-[34px]" id="get-started" aria-labelledby="get-started-title">
        <div className="rounded-[22px] sm:rounded-[28px] border border-primary bg-primary text-primary-foreground px-5 py-8 sm:px-10 sm:py-12 text-center">
          <p className="m-0 mb-4 text-[12px] font-[800] uppercase tracking-[0.18em] text-primary-foreground/75">Your music. Your business.</p>
          <h2 id="get-started-title" className="m-0 mx-auto max-w-[720px] text-[clamp(30px,4.5vw,46px)] font-[800] leading-[1.1] tracking-[-0.8px]">Make your next move official.</h2>
          <p className="text-primary-foreground/80 text-[17px] leading-[1.6] max-w-[600px] mx-auto mt-5 mb-0">
            Start your first contract and keep your songs, notes, and agreements together in one workspace.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-3 max-w-[500px] mx-auto mt-7">
            {(user || !loading) && <Link to={user ? '/dashboard' : '/signup'} className="micro-interaction inline-flex items-center justify-center gap-2 rounded-[14px] border border-background bg-background text-foreground px-5 py-3.5 font-[800] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground">
              {user ? 'Dashboard' : 'Create free account'} <ArrowRight className="size-4" aria-hidden="true" />
            </Link>}
            <Link to="/pricing" className="micro-interaction inline-flex items-center justify-center rounded-[14px] border border-primary-foreground/30 px-5 py-3.5 font-[700] hover:bg-primary-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-foreground">
              Explore plans
            </Link>
          </div>
          {!loading && !user && <p className="m-0 mt-5 text-[13px] text-primary-foreground/75">Already have an account? <Link to="/login" className="font-[700] text-primary-foreground underline underline-offset-4 hover:opacity-80">Log in</Link></p>}
        </div>
      </section>

      <SiteFooter />
    </>
  );
}

function useContracts() {
  const [contracts, setContracts] = useState<ContractListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    Promise.allSettled([listContracts(), fetchFilingDrafts(), fetchContractProgressList()])
      .then(([accountContracts, templateDrafts, progress]) => {
        if (active) {
          setContracts(mergeContractInventory(
            accountContracts.status === 'fulfilled' ? accountContracts.value : [],
            templateDrafts.status === 'fulfilled' ? templateDrafts.value : [],
            progress.status === 'fulfilled' ? progress.value : [],
          ));
          setError(accountContracts.status === 'rejected' || templateDrafts.status === 'rejected' || progress.status === 'rejected'
            ? 'Some contracts or progress stages could not be loaded. Please refresh to try again.' : '');
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load contracts.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  async function removeContract(id: string) {
    const contract = contracts.find((item) => item.id === id);
    if (contract?.filingDraftId) await deleteFilingDraft(contract.filingDraftId);
    else await deleteContract(id);
    setContracts((current) => current.filter((contract) => contract.id !== id));
  }

  return { contracts, loading, error, removeContract };
}

function LocalTemplateScannerPage() {
  const [templates, setTemplates] = useState<LocalContractTemplate[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<LocalContractTemplate | null>(null);
  const [dealData, setDealData] = useState<Record<string, string>>({});
  const [downloadUrl, setDownloadUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');

  async function refreshTemplates(nextSelectedId = selectedId) {
    const items = await fetchLocalContractTemplates({ includeAll: true });
    setTemplates(items);
    const nextSelected = nextSelectedId || items[0]?.id || '';
    setSelectedId(nextSelected);

    if (nextSelected) {
      setSelectedTemplate(await fetchLocalContractTemplate(nextSelected));
    } else {
      setSelectedTemplate(null);
    }
  }

  useEffect(() => {
    let active = true;

    refreshTemplates()
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load local contract templates.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function selectTemplate(templateId: string) {
    setSelectedId(templateId);
    setDownloadUrl('');
    setError('');
    setNotice('');
    setAction('load');

    try {
      setSelectedTemplate(await fetchLocalContractTemplate(templateId));
      setDealData({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load template details.');
    } finally {
      setAction('');
    }
  }

  async function handleImportZip() {
    setAction('import');
    setError('');
    setNotice('');

    try {
      const result = await importLocalContractZip();
      await refreshTemplates();
      setNotice(`Imported ${result.summary.importedCount} template(s). Skipped ${result.summary.skippedCount}.`);
      if (result.summary.errors.length) {
        setError(`Import completed with ${result.summary.errors.length} error(s). Check the API console for details.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to import the local ZIP.');
    } finally {
      setAction('');
    }
  }

  async function handleScanSelected() {
    if (!selectedId) return;
    setAction('scan');
    setError('');
    setNotice('');

    try {
      const detail = await scanLocalContractTemplate(selectedId);
      setSelectedTemplate(detail);
      await refreshTemplates(selectedId);
      setNotice(`Scanned ${detail.name}. Status: ${detail.aiScanStatus}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to scan this template.');
    } finally {
      setAction('');
    }
  }

  async function handleApproveSelected() {
    if (!selectedTemplate) return;
    setAction('approve');
    setError('');
    setNotice('');

    try {
      const detail = await approveLocalContractTemplate(selectedTemplate.id);
      setSelectedTemplate(detail);
      await refreshTemplates(detail.id);
      setNotice(`${detail.name} is approved and will now appear in New Contract.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to approve this template.');
    } finally {
      setAction('');
    }
  }

  async function handleScanAll() {
    setAction('scanAll');
    setError('');
    setNotice('');

    try {
      const result = await scanAllLocalContractTemplates(false);
      await refreshTemplates(selectedId);
      const failed = result.results.filter((item) => item.status === 'failed').length;
      setNotice(`Scanned ${result.results.length} template(s). Failed: ${failed}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to scan templates.');
    } finally {
      setAction('');
    }
  }

  async function handleGenerate(event: FormEvent) {
    event.preventDefault();
    if (!selectedTemplate) return;
    setAction('fill');
    setError('');
    setNotice('');
    setDownloadUrl('');

    try {
      const result = await fillLocalContractTemplate(selectedTemplate.id, dealData, `${selectedTemplate.name} - Filled`);
      setDownloadUrl(localGeneratedContractDownloadUrl(result.downloadUrl));
      setNotice(result.missingRequiredFields.length
        ? `Generated with ${result.missingRequiredFields.length} missing required field(s).`
        : 'Generated contract is ready.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate the contract.');
    } finally {
      setAction('');
    }
  }

  const fields = selectedTemplate?.fieldSchema?.fields ?? [];
  const sortedFields = [...fields].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const filteredTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();

    if (!query) {
      return templates;
    }

    return templates.filter((template) =>
      [
        template.name,
        template.category,
        template.originalFileName,
        template.fileType,
        template.aiScanStatus,
        template.textQuality,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query),
    );
  }, [templates, templateSearch]);

  if (loading) {
    return <LoadingScreen label="Loading template scanner" />;
  }

  return (
    <main className="grid gap-6">
      <section className={`${panel} p-6`}>
        <div className="grid lg:grid-cols-[1fr_auto] gap-5 items-start">
          <div>
            <h1 className="m-0 mb-3 text-[34px] tracking-[-0.8px] leading-tight">Local contract template scanner</h1>
            <p className="m-0 text-muted-foreground max-w-[760px]">
              Import local templates, scan blanks into a saved schema, and generate a filled DOCX from submitted deal data.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
            <button type="button" onClick={handleImportZip} disabled={Boolean(action)} className={ghostButton}>
              <Upload className="size-4" /> {action === 'import' ? 'Importing...' : 'Import ZIP'}
            </button>
            <button type="button" onClick={handleScanAll} disabled={Boolean(action) || templates.length === 0} className={primaryButton}>
              <Sparkles className="size-4" /> {action === 'scanAll' ? 'Scanning...' : 'Scan All'}
            </button>
          </div>
        </div>
      </section>

      {(notice || error) && (
        <section className={`${notice ? 'border-primary/40 bg-primary/10' : 'border-destructive/50 bg-destructive/10'} rounded-[18px] border p-4`}>
          {notice && <p className="m-0">{notice}</p>}
          {error && <p className="m-0 text-red-700 dark:text-red-100">{error}</p>}
        </section>
      )}

      <section className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
        <div className={`${panel} p-4`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="m-0 text-[22px] tracking-[-0.3px]">Templates</h2>
            <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">{templates.length}</span>
          </div>
          <label className="relative mb-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="Search templates..."
              className="w-full border border-ring bg-input text-foreground pl-10 pr-[14px] py-[12px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>
          {templateSearch.trim() && (
            <div className="mb-3 text-[12px] text-muted-foreground">
              Showing {filteredTemplates.length} of {templates.length}
            </div>
          )}
          <div className="grid gap-2 max-h-[620px] overflow-auto pr-1">
            {filteredTemplates.length ? filteredTemplates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => selectTemplate(template.id)}
                className={`text-left rounded-[14px] border p-3 cursor-pointer transition-all ${
                  selectedId === template.id ? 'border-primary bg-primary/10' : 'border-border bg-card hover:bg-muted'
                }`}
              >
                <div className="font-[850] leading-tight">{template.name}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-muted-foreground">
                  <span>{template.fileType.toUpperCase()}</span>
                  <span className="capitalize">{template.aiScanStatus.replace('_', ' ')}</span>
                  {template.textQuality && <span>{template.textQuality}</span>}
                </div>
              </button>
            )) : (
              <div className={`${card} p-4 text-muted-foreground`}>
                {templates.length
                  ? 'No templates match that search.'
                  : 'No local templates yet. Place a ZIP at storage/contract-zips/all-music-contracts.zip, then import.'}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-5">
          {selectedTemplate ? (
            <>
              <section className={`${panel} p-5`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[13px] text-muted-foreground mb-1">{selectedTemplate.category || 'Music Business Contracts'}</div>
                    <h2 className="m-0 text-[28px] tracking-[-0.5px]">{selectedTemplate.name}</h2>
                    <p className="m-0 mt-2 text-[14px] text-muted-foreground">{selectedTemplate.originalFileName}</p>
                  </div>
                  <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
                    <button type="button" onClick={handleScanSelected} disabled={Boolean(action)} className={ghostButton}>
                      <Sparkles className="size-4" /> {action === 'scan' ? 'Scanning...' : 'Scan Template'}
                    </button>
                    <button
                      type="button"
                      onClick={handleApproveSelected}
                      disabled={Boolean(action) || !sortedFields.length || selectedTemplate.approved}
                      className={primaryButton}
                    >
                      <CheckCircle2 className="size-4" />
                      {action === 'approve' ? 'Approving...' : selectedTemplate.approved ? 'Approved' : 'Approve Template'}
                    </button>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[
                    ['Status', selectedTemplate.aiScanStatus.replace('_', ' ')],
                    ['Approved', selectedTemplate.approved ? 'yes' : 'no'],
                    ['File', selectedTemplate.fileType.toUpperCase()],
                    ['Text', selectedTemplate.textQuality || 'not extracted'],
                    ['Fields', String(fields.length)],
                  ].map(([label, value]) => (
                    <span key={label} className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
                      {label}: {value}
                    </span>
                  ))}
                </div>
                {selectedTemplate.scanError && (
                  <div className="mt-4 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-red-700 dark:text-red-100">
                    {selectedTemplate.scanError}
                  </div>
                )}
              </section>

              <section className={`${panel} p-5`}>
                <h3 className="m-0 mb-4 text-[22px] tracking-[-0.3px]">Static file view</h3>
                <p className="m-0 mb-4 text-[13px] text-muted-foreground">
                  Review the extracted source text here. The detected schema still powers the filler, but this view is closer to the actual contract.
                </p>
                {selectedTemplate.extractedText || selectedTemplate.extractedTextPreview ? (
                  <TemplateDocumentPreview
                    title={selectedTemplate.name}
                    text={selectedTemplate.extractedText || selectedTemplate.extractedTextPreview || ''}
                  />
                ) : (
                  <div className={`${card} p-4 text-muted-foreground`}>Scan this template to create an extracted file preview.</div>
                )}
              </section>
              <section className={`${panel} p-5`}>
                <h3 className="m-0 mb-4 text-[22px] tracking-[-0.3px]">Generate DOCX</h3>
                {sortedFields.length ? (
                  <form onSubmit={handleGenerate} className="grid gap-4">
                    <div className="grid md:grid-cols-2 gap-4">
                      {sortedFields.map((field) => (
                        <LocalContractFieldInput
                          key={field.key}
                          field={field}
                          value={dealData[field.key] ?? ''}
                          onChange={(value) => setDealData((current) => ({ ...current, [field.key]: value }))}
                        />
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="submit" disabled={Boolean(action)} className={primaryButton}>
                        <FileText className="size-4" /> {action === 'fill' ? 'Generating...' : 'Generate Contract'}
                      </button>
                      {downloadUrl && (
                        <a href={downloadUrl} className={ghostButton}>
                          <Download className="size-4" /> Download DOCX
                        </a>
                      )}
                    </div>
                  </form>
                ) : (
                  <div className={`${card} p-4 text-muted-foreground`}>A saved schema is required before generation.</div>
                )}
              </section>
            </>
          ) : (
            <section className={`${panel} p-6 text-muted-foreground`}>Select a local template to inspect its schema and generate a contract.</section>
          )}
        </div>
      </section>
    </main>
  );
}

function LocalContractFieldInput({
  field,
  value,
  onChange,
}: {
  field: LocalContractField;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputClass = 'w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary';

  return (
    <div className="grid gap-2">
      <label htmlFor={`local-field-${field.key}`} className="text-[14px] font-[800]">
        {field.label}
        {field.required && <span className="text-primary"> *</span>}
      </label>
      {field.type === 'textarea' || field.type === 'signature' ? (
        <textarea
          id={`local-field-${field.key}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.label}
          className={`${inputClass} min-h-[104px] resize-y`}
        />
      ) : (
        <input
          id={`local-field-${field.key}`}
          type={field.type === 'date' ? 'date' : field.type === 'number' ? 'number' : 'text'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.type === 'currency' ? '$' : field.type === 'percentage' ? '%' : field.label}
          className={inputClass}
        />
      )}
      <div className="text-[12px] text-muted-foreground capitalize">{field.category.replace('_', ' ')} · {field.type}</div>
    </div>
  );
}

function localTemplatePreviewText(template: LocalContractTemplate) {
  return normalizeTemplatePreviewText(
    template.extractedText
      || template.extractedTextPreview
      || `${template.name}\n\nTemplate preview unavailable. Fill the scanned fields on the left, then generate the DOCX from the original source file.`,
  );
}

function localTemplateToPreviewTemplate(template: LocalContractTemplate): ContractTemplateOption {
  return {
    id: template.id,
    title: template.name,
    description: template.category ?? 'Approved scanned local template',
    category: template.category ?? undefined,
    sourceFile: template.originalFileName,
    extractionQuality: template.textQuality ?? undefined,
    textPreview: template.extractedTextPreview ?? undefined,
  };
}

function localFieldToTemplateQuestion(field: LocalContractField, _index: number, templateText: string): TemplateQuestion {
  const type: TemplateQuestion['type'] =
    field.type === 'signature' || field.type === 'textarea'
      ? 'textarea'
      : field.type === 'date'
        ? 'date'
        : field.type === 'number'
          ? 'number'
          : 'text';

  const lineIndex = findFieldLineIndex(templateText, field);

  return {
    id: field.key,
    label: field.label,
    placeholder: field.sourceText || field.label,
    required: field.required,
    recommended: field.required,
    type,
    section: field.category,
    helpText: field.surroundingContext,
    lineIndex,
    source: 'local_contract_template_field',
  };
}

function findFieldLineIndex(templateText: string, field: LocalContractField) {
  const needles = [
    field.sourceText,
    field.surroundingContext,
    field.label,
  ]
    .map((value) => normalizePreviewLabel(String(value ?? '')))
    .filter(Boolean);

  if (!needles.length) {
    return undefined;
  }

  const index = templateText.split('\n').findIndex((line) => {
    const normalizedLine = normalizePreviewLabel(line);
    return Boolean(normalizedLine) && needles.some((needle) => normalizedLine.includes(needle) || needle.includes(normalizedLine));
  });

  return index >= 0 ? index : undefined;
}

function flattenContractAnswers(answers: ContractWizardAnswers): Record<string, string> {
  return Object.fromEntries(
    Object.entries(answers).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.filter(Boolean).join(', ') : String(value ?? ''),
    ]),
  );
}

function DashboardHome() {
  const { user } = useAuth();
  const { contracts, loading, error, removeContract } = useContracts();
  const draftCount = contracts.filter((contract) => contract.status === 'draft').length;
  const completedCount = contracts.filter((contract) => contract.status === 'completed' || contract.status === 'signed').length;
  const reviewCount = contracts.filter((contract) => contract.status === 'ready_for_review' || contract.status === 'awaiting_signatures').length;

  return (
    <main className="grid gap-6">
      <ProExportNotice />
      <section data-reveal className={`${panel} p-6 lg:p-8`}>
        <div className="grid lg:grid-cols-[1fr_auto] gap-5 items-center">
          <div>
            <p className="m-0 mb-2 text-[14px] text-muted-foreground">Your music business command center</p>
            <h1 className="m-0 mb-3 break-words text-[clamp(28px,5vw,56px)] leading-[1.08] tracking-[-0.8px] sm:tracking-[-1.2px]">
              Welcome back, {userDisplayName(user?.user_metadata?.name, user?.email)}.
            </h1>
            <p className="m-0 text-muted-foreground text-[18px] leading-[1.5] max-w-[720px]">
              Manage your contracts, rights, and music business documents in one place.
            </p>
          </div>
          <Link to="/dashboard/contract-filler" className={primaryButton}>
            <Plus className="size-4" /> Create New Contract
          </Link>
        </div>
      </section>

      <section data-reveal-group className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard icon={FileText} label="Total contracts" value={contracts.length} />
        <SummaryCard icon={PenLine} label="Draft contracts" value={draftCount} />
        <SummaryCard icon={FileSearch} label="In review / signing" value={reviewCount} />
        <SummaryCard icon={CheckCircle2} label="Finished contracts" value={completedCount} />
      </section>

      <section className={`${panel} p-5`}>
        <div data-reveal className="flex flex-wrap justify-between gap-3 items-center mb-5">
          <div>
            <h2 className="m-0 text-[24px] tracking-[-0.4px]">Contracts</h2>
            <p className="m-0 text-muted-foreground text-[14px]">Create, manage, and organize the agreements behind your catalog.</p>
          </div>
          <Link to="/dashboard/contracts" className={ghostButton}>
            View All
          </Link>
        </div>

        <ContractsBlock
          contracts={contracts.slice(0, 4)}
          loading={loading}
          error={error}
          onDelete={removeContract}
        />
      </section>

      <TrackReviewWorkspace />

    </main>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: number }) {
  return (
    <div className={`${card} p-5 motion-card`}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="m-0 text-muted-foreground text-[14px]">{label}</p>
          <div className="text-[34px] leading-none mt-3 font-[850]">{value}</div>
        </div>
        <div className="w-12 h-12 rounded-[16px] border border-border bg-muted flex items-center justify-center">
          <Icon className="size-5" />
        </div>
      </div>
    </div>
  );
}

function ContractsPage() {
  const { contracts, loading, error, removeContract } = useContracts();
  const [stageFilter, setStageFilter] = useState('all');
  const filteredContracts = stageFilter === 'all' ? contracts : contracts.filter((contract) => contract.status === stageFilter);

  return (
    <main className="grid gap-6">
      <section className={`${panel} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="m-0 mb-2 text-[34px] tracking-[-0.8px] leading-tight">Contracts</h1>
            <p className="m-0 text-muted-foreground">Every draft, agreement, license, and deal memo saved to your account.</p>
          </div>
          <Link to="/dashboard/contract-filler" className={primaryButton}>
            <Plus className="size-4" /> Create New Contract
          </Link>
        </div>
      </section>

      <section className={`${panel} p-5`}>
        <label className="grid gap-2 text-[14px] mb-4 max-w-[320px]">Filter by progress<select className="border border-border bg-input text-foreground rounded-[12px] p-3" value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">All stages</option>{['draft', 'ready_for_review', 'awaiting_signatures', 'signed', 'cancelled', 'completed'].map((value) => <option key={value} value={value}>{contractStageLabel(value)}</option>)}</select></label>
        {!loading && contracts.length > 0 && !filteredContracts.length ? <p className="text-muted-foreground p-4">No contracts at this stage.</p> : <ContractsBlock contracts={filteredContracts} loading={loading} error={error} onDelete={removeContract} />}
      </section>
    </main>
  );
}

function ContractsBlock({
  contracts,
  loading,
  error,
  onDelete,
}: {
  contracts: ContractListItem[];
  loading: boolean;
  error: string;
  onDelete?: (id: string) => Promise<void>;
}) {
  const [deletingId, setDeletingId] = useState('');
  const [deleteError, setDeleteError] = useState('');

  async function handleDelete(contract: ContractListItem) {
    if (!onDelete) {
      return;
    }

    const confirmed = window.confirm(`Delete "${contract.title}" and its progress history and signed copies? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    setDeletingId(contract.id);
    setDeleteError('');

    try {
      await onDelete(contract.id);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete this contract.');
    } finally {
      setDeletingId('');
    }
  }

  if (loading) {
    return <div className={`${card} p-6 text-muted-foreground`}>Loading contracts...</div>;
  }

  if (error && !contracts.length) {
    return (
      <div className="rounded-[18px] border border-destructive/50 bg-destructive/10 p-5 text-red-700 dark:text-red-100">
        {error}
      </div>
    );
  }

  if (!contracts.length) {
    return <EmptyContractsState />;
  }

  return (
    <div className="grid gap-3">
      {error && <div role="alert" className="rounded-[18px] border border-border bg-muted p-4 text-muted-foreground">{error}</div>}
      {deleteError && (
        <div className="rounded-[18px] border border-destructive/50 bg-destructive/10 p-4 text-red-700 dark:text-red-100">
          {deleteError}
        </div>
      )}
      {contracts.map((contract) => (
        <div
          data-reveal
          key={contract.id}
          className="motion-card grid sm:grid-cols-[minmax(0,1fr)_minmax(0,190px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,190px)_minmax(145px,max-content)_auto] gap-3 items-center rounded-[18px] border border-border bg-muted p-4 hover:bg-accent"
        >
          <div>
            <div className="font-[800] break-words">{contract.title}</div>
            <div className="text-[13px] text-muted-foreground mt-1">Updated {formatDate(contract.updatedAt)}</div>
          </div>
          <div className="min-w-0 text-[14px] text-muted-foreground sm:text-right lg:text-left">{contract.contractType}</div>
          <div>
            <ContractStageBadge status={contract.status} />
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-start sm:justify-end">
            <Link
              to={contract.filingDraftId ? savedContractEditorPath(contract.filingDraftId) : `/dashboard/contracts/${contract.id}`}
              aria-label={contract.filingDraftId ? 'Edit draft' : 'Open contract'}
              title={contract.filingDraftId ? 'Edit draft' : 'Open contract'}
              className="inline-flex size-11 items-center justify-center rounded-[12px] border border-border bg-card hover:bg-background transition-all"
            >
              {contract.filingDraftId ? <PenLine className="size-4" aria-hidden="true" /> : <ArrowRight className="size-4" aria-hidden="true" />}
            </Link>
            {contract.filingDraftId && (
              <button onClick={() => { setDeleteError(''); void downloadFilingDraft(contract.filingDraftId!).catch((err) => setDeleteError(err instanceof Error ? err.message : 'Download failed.')); }} aria-label="Download PDF" title="Download PDF" className="inline-flex size-11 items-center justify-center rounded-[12px] border border-border bg-card hover:bg-background transition-all">
                <Download className="size-4" aria-hidden="true" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => handleDelete(contract)}
                disabled={deletingId === contract.id}
                aria-label={deletingId === contract.id ? 'Deleting contract' : 'Delete contract'}
                title={deletingId === contract.id ? 'Deleting contract' : 'Delete contract'}
                aria-busy={deletingId === contract.id}
                className="inline-flex size-11 items-center justify-center rounded-[12px] border border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-100 hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyContractsState() {
  return (
    <div className={`${card} p-8 text-center`}>
      <div className="w-14 h-14 mx-auto mb-4 rounded-[18px] bg-muted border border-border flex items-center justify-center">
        <Music2 className="size-6" />
      </div>
      <h3 className="m-0 mb-2 text-[24px] tracking-[-0.4px]">You don't have any contracts yet.</h3>
      <p className="m-0 mx-auto max-w-[560px] text-muted-foreground leading-[1.55]">
        Create your first split sheet, producer agreement, license, or deal memo. Keep your ownership paperwork in one place from day one.
      </p>
      <Link to="/dashboard/contract-filler" className={`${primaryButton} mt-5`}>
        <Plus className="size-4" /> Create New Contract
      </Link>
    </div>
  );
}

function shouldShowTemplateQuestion(question: TemplateQuestion, answers: ContractWizardAnswers) {
  const condition = question.conditional;

  if (!condition) {
    return true;
  }

  const value = String(answers[condition.dependsOn] ?? '').trim().toLowerCase();
  const expected = String(condition.value ?? '').trim().toLowerCase();

  if (condition.operator === 'truthy') {
    return Boolean(value);
  }

  if (condition.operator === 'equals') {
    return value === expected;
  }

  if (condition.operator === 'includes') {
    return value.includes(expected);
  }

  return true;
}

function NewContractPage() {
  const coreDetailsRef = useRef<HTMLDivElement | null>(null);
  const [title, setTitle] = useState('');
  const [templates, setTemplates] = useState<LocalContractTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<LocalContractTemplate | null>(null);
  const [templateQuestions, setTemplateQuestions] = useState<TemplateQuestion[]>([]);
  const [dealData, setDealData] = useState<Record<string, string>>({});
  const [downloadUrl, setDownloadUrl] = useState('');
  const [templateSearch, setTemplateSearch] = useState('');
  const [templateNotice, setTemplateNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingTemplateId, setLoadingTemplateId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    fetchLocalContractTemplates()
      .then((items) => {
        if (active) {
          setTemplates(items);
          setError('');
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load approved templates.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredSourceTemplates = useMemo(() => {
    const query = templateSearch.trim().toLowerCase();

    if (!query) {
      return templates.slice(0, 24);
    }

    return templates
      .filter((template) =>
        [
          template.name,
          template.category,
          template.originalFileName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 24);
  }, [templates, templateSearch]);

  const selectedTemplateText = selectedTemplate ? localTemplatePreviewText(selectedTemplate) : '';
const templateUsesDetectedBlanks = templateQuestions.some((question) =>
  typeof question.blankIndex === 'number'
  || (Array.isArray(question.blankIndexes) && question.blankIndexes.length > 0)
  || typeof question.lineIndex === 'number'
);

  async function selectTemplate(templateId: string) {
    setLoadingTemplateId(templateId);
    setError('');
    setDownloadUrl('');
    setTemplateNotice('');

    try {
      const detail = await fetchLocalContractTemplate(templateId);
      const previewText = localTemplatePreviewText(detail);
      const fields = [...(detail.fieldSchema?.fields ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const questions = fields.map((field, index) => localFieldToTemplateQuestion(field, index, previewText));
      const nextDealData = questions.reduce<Record<string, string>>((next, question) => {
        next[String(question.id)] = '';
        return next;
      }, {});

      setSelectedTemplate(detail);
      setTemplateQuestions(questions);
      setDealData(nextDealData);
      if (!title.trim()) {
        setTitle(`${detail.name} - Filled`);
      }
      setTemplateNotice(`${detail.name} selected. Fill what you know. The preview shows the source text; the completed DOCX is generated from the original contract file.`);
      window.setTimeout(() => {
        coreDetailsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err) {
      setSelectedTemplate(null);
      setTemplateQuestions([]);
      setDealData({});
      setError(err instanceof Error ? err.message : 'Unable to load template details.');
    } finally {
      setLoadingTemplateId('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) {
      setError('Choose an approved template first.');
      return;
    }

    setError('');
    setDownloadUrl('');
    setIsSubmitting(true);

    try {
      const result = await fillLocalContractTemplate(
        selectedTemplate.id,
        dealData,
        title.trim() || `${selectedTemplate.name} - Filled`,
      );
      setDownloadUrl(localGeneratedContractDownloadUrl(result.downloadUrl));
      setTemplateNotice(result.missingRequiredFields.length
        ? `Generated with ${result.missingRequiredFields.length} missing required field(s).`
        : 'Generated contract is ready.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate this DOCX.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return <LoadingScreen label="Loading approved templates" />;
  }

  return (
    <main className="grid gap-6">
      <section className={`${panel} p-6`}>
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="size-4" /> Back to Dashboard
        </Link>
        <p className="m-0 mb-2 text-[13px] uppercase tracking-[0.18em] text-muted-foreground">
          New Contract
        </p>
        <h1 className="m-0 mb-3 text-[clamp(34px,5vw,54px)] tracking-[-1.1px] leading-[1.03]">
          Fill an approved source template.
        </h1>
        <p className="m-0 text-muted-foreground max-w-[780px] leading-[1.55] text-[17px]">
          Choose from scanned and approved templates, fill the saved field schema, preview the source text, then generate a completed DOCX.
        </p>
      </section>

      {templates.length === 0 ? (
        <section className={`${panel} p-6`}>
          <div className="flex items-start gap-3">
            <FileText className="size-5 mt-1 text-muted-foreground" />
            <div>
              <h2 className="m-0 text-[24px] tracking-[-0.4px]">No approved templates yet.</h2>
              <p className="m-0 mt-2 text-muted-foreground">
                Review and approve templates in Template Admin.
              </p>
              <Link to="/dashboard/contract-templates" className={`${ghostButton} mt-4`}>
                Open Template Admin
              </Link>
            </div>
          </div>
        </section>
      ) : (
      <form onSubmit={handleSubmit} className={`${panel} p-5 grid gap-5`}>
        <div className="grid gap-2">
          <label htmlFor="contract-title" className="text-[14px]">Contract title</label>
          <input
            id="contract-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Producer Agreement for New Single"
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
            disabled={isSubmitting}
          />
        </div>

        {selectedTemplate ? (
          <TemplateFillWorkspace
            ref={coreDetailsRef}
            template={localTemplateToPreviewTemplate(selectedTemplate)}
            questions={templateQuestions}
            answers={dealData}
            templateText={selectedTemplateText}
            useDetectedBlankPreview={templateUsesDetectedBlanks}
            notice={templateNotice}
            onAnswersChange={(answers) => setDealData(flattenContractAnswers(answers))}
          />
        ) : (
          <div className="rounded-[20px] border border-border bg-muted p-5">
            <div className="flex items-start gap-3">
              <FileText className="size-5 mt-1" />
              <div>
                <h3 className="m-0 text-[22px] tracking-[-0.4px]">Choose a source template first</h3>
                <p className="m-0 mt-1 text-[14px] text-muted-foreground leading-[1.5]">
                  Pick one of the approved scanned templates below. The field form and live preview will appear here after a template is selected.
                </p>
              </div>
            </div>
          </div>
        )}

        <div>
            <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
              <div>
                <div className="text-[14px] font-[750]">Approved templates</div>
                <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                  This list only includes templates approved and scanned in Template Admin.
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
                {templates.length} templates
              </span>
            </div>
            <input
              value={templateSearch}
              onChange={(event) => setTemplateSearch(event.target.value)}
              placeholder="Search by contract name, source file, or use case..."
              className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
              disabled={isSubmitting || Boolean(loadingTemplateId)}
            />
              <div className="mt-3 max-h-[420px] overflow-y-auto rounded-[18px] border border-border bg-muted">
                {filteredSourceTemplates.length ? (
                  filteredSourceTemplates.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => selectTemplate(template.id)}
                      disabled={Boolean(loadingTemplateId)}
                      className={`w-full text-left border-b border-border last:border-b-0 p-4 disabled:opacity-60 disabled:cursor-not-allowed transition-all ${
                        selectedTemplate?.id === template.id ? 'bg-primary/15' : 'hover:bg-accent'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <FileText className="size-4 shrink-0 text-muted-foreground" />
                            <span className="font-[850] leading-tight">{template.name}</span>
                          </div>
                          {template.originalFileName && (
                            <div className="text-[12px] text-muted-foreground mt-1">
                              Source: {template.originalFileName.split('/').pop()}
                            </div>
                          )}
                        </div>
                        <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[800]">
                          {loadingTemplateId === template.id ? 'Loading...' : selectedTemplate?.id === template.id ? 'Selected' : 'Use template'}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[12px] text-muted-foreground">
                        <span>{template.fileType.toUpperCase()}</span>
                        {template.category && <span>{template.category}</span>}
                        <span className="capitalize">{template.aiScanStatus.replace('_', ' ')}</span>
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="p-4 text-[14px] text-muted-foreground">
                    No approved templates match that search.
                  </div>
                )}
              </div>
          </div>

        {error && <div className="rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-700 dark:text-red-100">{error}</div>}

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={isSubmitting || !selectedTemplate} className={primaryButton}>
            <FileText className="size-4" /> {isSubmitting ? 'Generating...' : 'Generate DOCX'}
          </button>
          {downloadUrl && (
            <a href={downloadUrl} className={ghostButton}>
              <Download className="size-4" /> Download DOCX
            </a>
          )}
          <Link to="/dashboard" className={ghostButton}>
            Cancel
          </Link>
        </div>
      </form>
      )}
    </main>
  );
}

const TemplateFillWorkspace = forwardRef<
  HTMLDivElement,
  {
    template: ContractTemplateOption;
    questions: TemplateQuestion[];
    answers: ContractWizardAnswers;
    templateText: string;
    useDetectedBlankPreview: boolean;
    notice: string;
    onAnswersChange: (answers: ContractWizardAnswers) => void;
  }
>(function TemplateFillWorkspace(
  {
    template,
    questions,
    answers,
    templateText,
    useDetectedBlankPreview,
    notice,
    onAnswersChange,
  },
  ref,
) {
  const orderedQuestions = useMemo(
    () => [...questions].sort((a, b) => {
      if (Number.isInteger(a.charIndex) || Number.isInteger(b.charIndex)) {
        return (Number.isInteger(a.charIndex) ? Number(a.charIndex) : Number.MAX_SAFE_INTEGER)
          - (Number.isInteger(b.charIndex) ? Number(b.charIndex) : Number.MAX_SAFE_INTEGER);
      }

      const aIndex = Number.isInteger(a.blankIndex) ? Number(a.blankIndex) : Number.MAX_SAFE_INTEGER;
      const bIndex = Number.isInteger(b.blankIndex) ? Number(b.blankIndex) : Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    }),
    [questions],
  );
  const filledCount = orderedQuestions.filter((question) => answerIsFilled(answers[question.id])).length;
  const progress = orderedQuestions.length ? Math.round((filledCount / orderedQuestions.length) * 100) : 0;

  function updateAnswer(question: TemplateQuestion, value: string | string[]) {
    const nextAnswers: ContractWizardAnswers = {
      ...answers,
      [question.id]: value,
    };

    if (question.type === 'count' && question.controls) {
      const count = Math.max(1, Math.min(30, Number.parseInt(String(value), 10) || 1));
      const current = answers[question.controls];
      const currentList = Array.isArray(current) ? current : [''];
      nextAnswers[question.controls] = Array.from({ length: count }, (_, index) => currentList[index] ?? '');
    }

    if (question.type === 'list' && Array.isArray(value)) {
      const countQuestion = orderedQuestions.find((item) => item.type === 'count' && item.controls === question.id);

      if (countQuestion) {
        nextAnswers[countQuestion.id] = String(Math.max(1, value.length));
      }
    }

    onAnswersChange(nextAnswers);
  }

  return (
    <div ref={ref} className={`${panel} scroll-mt-5 overflow-hidden`}>
      <div className="grid min-h-[760px] lg:grid-cols-[390px_minmax(0,1fr)]">
        <section className="border-b border-border bg-card lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border bg-muted px-5 py-4">
            <div>
              <div className="text-[11px] font-[800] uppercase tracking-[0.22em] text-muted-foreground">Fill in fields</div>
              <div className="mt-1 max-w-[260px] truncate text-[12px] text-muted-foreground">{template.title}</div>
            </div>
            <div className="shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[800] text-primary">{progress}% complete</div>
          </div>
          <div className="h-[3px] bg-border">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          {notice && (
            <div className="mx-5 mt-4 rounded-[14px] border border-primary/35 bg-primary/10 px-3 py-2 text-[12px] leading-[1.45] text-foreground">
              {notice}
            </div>
          )}
          <div className="max-h-[690px] overflow-y-auto px-5 py-5">
            {orderedQuestions.length ? (
              <div className="grid gap-4">
                {orderedQuestions.map((question, index) => (
                  <LiveWizardInput
                    key={question.id}
                    index={index}
                    question={question}
                    value={answers[question.id]}
                    onChange={(value) => updateAnswer(question, value)}
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-[14px] border border-border bg-muted p-4 text-[13px] text-muted-foreground">
                No fillable blanks were detected in this template.
              </div>
            )}
          </div>
        </section>

        <section className="flex min-w-0 flex-col bg-background">
          <div className="flex items-center justify-between border-b border-border bg-muted px-5 py-4">
            <div>
              <div className="text-[11px] font-[800] uppercase tracking-[0.22em] text-muted-foreground">Live preview</div>
              {template.sourceFile && (
                <div className="mt-1 text-[12px] text-muted-foreground">Source: {template.sourceFile.split('/').pop()}</div>
              )}
            </div>
            <div className="flex items-center gap-3 text-[12px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-primary" /> Filled</span>
              <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-destructive" /> Empty</span>
            </div>
          </div>
          <LiveContractPreview
            title={template.title}
            templateText={templateText}
            questions={orderedQuestions}
            answers={answers}
            useDetectedBlankPreview={useDetectedBlankPreview}
          />
        </section>
      </div>
    </div>
  );
});

function LiveWizardInput({
  index,
  question,
  value,
  onChange,
}: {
  index: number;
  question: TemplateQuestion;
  value?: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const type = question.type ?? 'text';
  const label = question.label.replace(/\?$/, '');
  const inputClass =
    'w-full border border-ring bg-input text-foreground px-[14px] py-[12px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary';

  const header = (
    <div className="mb-2 flex items-center gap-2 text-[11px] font-[900] uppercase tracking-[0.14em]">
      <span className="font-mono text-primary">#{index + 1}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  );

  if (type === 'textarea' || type === 'signature') {
    return (
      <label className="block">
        {header}
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
          className={`${inputClass} min-h-[74px] resize-y`}
        />
      </label>
    );
  }

  if (type === 'list') {
    const entries = Array.isArray(value) ? value : [''];

    return (
      <div className="block">
        {header}
        <div className="grid gap-2">
          {entries.map((entry, entryIndex) => (
            <div key={entryIndex} className="flex items-center gap-2">
              <span className="w-5 text-right font-mono text-[11px] text-muted-foreground">{entryIndex + 1}.</span>
              <input
                value={entry}
                onChange={(event) => {
                  const next = [...entries];
                  next[entryIndex] = event.target.value;
                  onChange(next);
                }}
                placeholder={question.placeholder}
                className={inputClass}
              />
              {entries.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(entries.filter((_, indexToKeep) => indexToKeep !== entryIndex))}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted text-muted-foreground hover:bg-accent"
                  aria-label="Remove list entry"
                >
                  -
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onChange([...entries, ''])}
          className="mt-2 rounded-[10px] border border-dashed border-primary/60 bg-primary/10 px-3 py-2 text-[12px] font-[800] text-primary hover:bg-primary/15"
        >
          + Add another
        </button>
      </div>
    );
  }

  if (type === 'dropdown' || type === 'select' || type === 'radio') {
    return (
      <label className="block">
        {header}
        <select value={typeof value === 'string' ? value : ''} onChange={(event) => onChange(event.target.value)} className={inputClass}>
          <option value="">{question.placeholder}</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
    );
  }

  if (type === 'checkbox' || type === 'boolean') {
    return (
      <label className="block">
        {header}
        <button
          type="button"
          onClick={() => onChange(value === 'Yes' ? '' : 'Yes')}
          className={`w-full rounded-[6px] border px-3 py-3 text-left text-[13px] font-[800] transition-all ${
            value === 'Yes'
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-ring bg-input text-foreground'
          }`}
        >
          {value === 'Yes' ? 'Yes' : question.placeholder}
        </button>
      </label>
    );
  }

  return (
    <label className="block">
      {header}
      <input
        type={type === 'date' ? 'date' : type === 'number' ? 'number' : 'text'}
        inputMode={type === 'number' || type === 'percentage' || type === 'currency' ? 'decimal' : undefined}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={question.placeholder}
        className={inputClass}
      />
    </label>
  );
}

function LiveContractPreview({
  title,
  templateText,
  questions,
  answers,
  useDetectedBlankPreview,
}: {
  title: string;
  templateText: string;
  questions: TemplateQuestion[];
  answers: ContractWizardAnswers;
  useDetectedBlankPreview: boolean;
}) {
  const displayTemplateText = useMemo(
    () => formatLiveTemplatePreviewLayout(title, templateText || title),
    [templateText, title],
  );
  const parts = useMemo(
    () => buildLiveTemplateParts(displayTemplateText, questions, answers, useDetectedBlankPreview),
    [displayTemplateText, questions, answers, useDetectedBlankPreview],
  );
  const pages = useMemo(() => paginateLiveTemplateParts(parts), [parts]);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-[#d8d8d8] px-4 py-8 md:px-8">
      <div className={pages.length > 1 ? 'grid gap-6 xl:grid-cols-2' : 'grid justify-center gap-6'}>
        {pages.map((page, pageIndex) => {
          const { heading, body } = pageIndex === 0 ? splitLivePreviewHeading(page) : { heading: [], body: page };

          return (
            <article key={pageIndex} className={`${legalPageClass} mx-auto`}>
              {heading.length > 0 && (
                <h3 className="mb-8 mt-0 text-center font-['Times_New_Roman',Times,serif] text-[11px] font-bold uppercase tracking-0 text-black">
                  {heading.map((part, index) => (
                    <LivePreviewPart key={`${pageIndex}-heading-${index}`} part={part} />
                  ))}
                </h3>
              )}
              <pre className="m-0 whitespace-pre-wrap break-words font-['Times_New_Roman',Times,serif] text-[12px] leading-[1.14] text-black">
                {body.map((part, index) => (
                  <LivePreviewPart key={`${pageIndex}-${index}`} part={part} />
                ))}
              </pre>
              <div className="absolute bottom-[3.5%] left-0 right-0 text-center font-['Times_New_Roman',Times,serif] text-[10px] text-black/70">
                Page {pageIndex + 1} of {pages.length}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function splitLivePreviewHeading(parts: LiveTemplatePart[]) {
  const heading: LiveTemplatePart[] = [];
  const body: LiveTemplatePart[] = [];
  let foundLineBreak = false;

  for (const part of parts) {
    if (foundLineBreak) {
      body.push(part);
      continue;
    }

    if (part.type !== 'text') {
      heading.push(part);
      continue;
    }

    const lineBreakIndex = part.content.indexOf('\n');

    if (lineBreakIndex === -1) {
      heading.push(part);
      continue;
    }

    if (lineBreakIndex > 0) {
      heading.push({ ...part, content: part.content.slice(0, lineBreakIndex) });
    }

    const remainder = part.content.slice(lineBreakIndex + 1);

    if (remainder) {
      body.push({ ...part, content: remainder });
    }

    foundLineBreak = true;
  }

  return { heading, body };
}

function LivePreviewPart({ part }: { part: LiveTemplatePart }) {
  if (part.type === 'text') {
    return <span>{part.content}</span>;
  }

  if (part.value) {
    return (
      <span className="mx-[1px] border-b border-[#111827] bg-[#e6f2ff] px-[2px] font-bold text-black">
        {part.value}
      </span>
    );
  }

  return (
    <span
      title={part.label}
      className="mx-[1px] border-b border-[#b91c1c] px-[2px] text-[#991b1b]"
    >
      {part.placeholder}
    </span>
  );
}

function paginateLiveTemplateParts(parts: LiveTemplatePart[]) {
  const pages: LiveTemplatePart[][] = [];
  let current: LiveTemplatePart[] = [];
  let currentUnits = 0;
  let lineParts: LiveTemplatePart[] = [];
  let lineText = '';

  function pushPage() {
    if (current.length) {
      pages.push(current);
    }

    current = [];
    currentUnits = 0;
  }

  function addLine(partsForLine: LiveTemplatePart[], units: number) {
    if (current.length && currentUnits + units > legalPageUnits) {
      pushPage();
    }

    current.push(...partsForLine);
    currentUnits += units;
  }

  function flushLine(includeBreak: boolean) {
    if (!lineParts.length && !includeBreak) {
      return;
    }

    const lineWithBreak: LiveTemplatePart[] = includeBreak
      ? [...lineParts, createTextPart('\n')]
      : lineParts;

    const units = lineText.trim()
      ? Math.max(1, Math.ceil(lineText.length / 96))
      : 1;

    addLine(lineWithBreak, units);
    lineParts = [];
    lineText = '';
  }

  for (const part of parts) {
    if (part.type === 'blank') {
      const visibleText = part.value || part.placeholder;
      lineParts.push(part);
      lineText += visibleText;
      continue;
    }

    const chunks = part.content.split(/(\n)/);

    for (const chunk of chunks) {
      if (chunk === '\n') {
        flushLine(true);
      } else if (chunk) {
        lineParts.push(createTextPart(chunk));
        lineText += chunk;
      }
    }
  }

  flushLine(false);
  pushPage();

  return pages.length ? pages : [[createTextPart('Template preview unavailable.')]];
}

// New-contract wizard preview: keep source blanks and let buildLiveTemplateParts overlay answers.
function formatLiveTemplatePreviewLayout(title: string, templateText: string) {
  if (isBookingContractTemplate(title, templateText)) {
    return formatLiveBookingContractPreview(templateText);
  }

  return templateText;
}

// Saved contract preview: render the generated contract content as the document source of truth.
function formatSavedDocumentPreviewLayout(title: string, contractText: string) {
  if (isBookingContractTemplate(title, contractText)) {
    return formatSavedBookingContractPreview(contractText);
  }

  return contractText;
}

function isBookingContractTemplate(title: string, templateText: string) {
  return /\bBOOKING CONTRACT\b/i.test(`${title}\n${templateText}`)
    && /NAME OF MUSICIAN\(S\)|NUMBER OF MUSICIAN\(S\)|PLACE OF PERFORMANCE/i.test(templateText);
}

function textAfter(source: string, pattern: RegExp, fallback = '') {
  const match = source.match(pattern);
  return match?.[1]?.trim() || fallback;
}

function bookingFieldValue(source: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`^\\s*(?:\\d+\\.\\s*)?${escapedLabel}\\s*:?\\s*([^\\n]*)`, 'im'));
  const value = match?.[1]?.trim() ?? '';

  return value && !/^_{3,}$/.test(value) ? value : '';
}

function bookingFieldLine(
  number: number,
  label: string,
  source: string,
  { colon = true, valueSource = 'blank' }: { colon?: boolean; valueSource?: 'blank' | 'contract' } = {},
) {
  const value = valueSource === 'contract' ? bookingFieldValue(source, label) : '';
  const suffix = value ? `${colon ? ': ' : ' '}${value}` : colon ? ':' : '';

  return `${number}.        ${label}${suffix}`;
}

function formatLiveBookingContractPreview(templateText: string) {
  return formatBookingContractPreviewLayout(templateText, 'blank');
}

function formatSavedBookingContractPreview(contractText: string) {
  return formatBookingContractPreviewLayout(contractText, 'contract');
}

function formatBookingContractPreviewLayout(templateText: string, valueSource: 'blank' | 'contract') {
  const normalized = templateText.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const intro = textAfter(
    normalized,
    /BOOKING CONTRACT\s*([\s\S]*?)\nNAME OF MUSICIAN\(S\):/i,
    'THIS CONTRACT, entered into on this ________________ day of ________, 20_____, is for the personal services of the Musician(s) for the performance described below. The undersigned employer and the undersigned musician(s) agree and contract as follows:',
  );
  const balanceLine = textAfter(
    normalized,
    /(PAYMENT OF BALANCE TO\s+_{3,}[\s\S]*?END OF PERFORMANCE\.)/i,
    'PAYMENT OF BALANCE TO _____________________________________________\nMADE IN U.S. CURRENCY OR CERTIFIED CHECK AT THE END OF PERFORMANCE.',
  );
  const additionalTerms = textAfter(
    normalized,
    /ADDITIONAL TERMS:\s*([\s\S]*?)\nThis contract constitutes/i,
  );
  const paragraph10 = textAfter(
    normalized,
    /(This contract constitutes[\s\S]*?musician\(s\)\.)/i,
    'This contract constitutes a complete and binding agreement between the employer and the musician(s). AGENT acts only as agent and assumes no responsibility as between the employer and the musician(s).',
  );
  const paragraph11 = textAfter(
    normalized,
    /(In case of breach[\s\S]*?legal interest\.)/i,
    "In case of breach of this contract by Employer, the Employer agrees to pay the amount stated in Section 6 as mitigated damages, plus reasonable attorney's fees, court costs, and legal interest.",
  );
  const paragraph13 = textAfter(
    normalized,
    /(The Employer agrees[\s\S]*?Section 3 herein\.)/i,
    'The Employer agrees to be responsible for harm, loss, or damage of any kind to musician(s) person or property while located at the place of performance (Section 3 herein).',
  );
  const paragraph14 = textAfter(
    normalized,
    /(The persons signing[\s\S]*?this contract\.)/i,
    'The persons signing for Employer and the Musician(s) agree to be personally, jointly and severally liable for the terms of this contract.',
  );
  const firstBalanceLine = balanceLine.split('\n')[0]?.trim() || 'PAYMENT OF BALANCE TO _____________________________________________';
  const secondBalanceLine = balanceLine.split('\n').slice(1).join('\n').trim() || 'MADE IN U.S. CURRENCY OR CERTIFIED CHECK AT THE END OF PERFORMANCE.';

  return [
    'BOOKING CONTRACT',
    '',
    intro,
    '',
    bookingFieldLine(1, 'NAME OF MUSICIAN(S)', normalized, { valueSource }),
    '',
    bookingFieldLine(2, 'NUMBER OF MUSICIAN(S)', normalized, { valueSource }),
    '',
    bookingFieldLine(3, 'NAME AND ADDRESS OF PLACE OF PERFORMANCE', normalized, { colon: false, valueSource }),
    '',
    bookingFieldLine(4, 'DATE(S) OF PERFORMANCE', normalized, { valueSource }),
    '',
    bookingFieldLine(5, 'TIME(S) OF PERFORMANCE', normalized, { valueSource }),
    '',
    bookingFieldLine(6, 'WAGE AGREED UPON', normalized, { valueSource }),
    '',
    '7.        DEPOSIT:',
    '',
    `8.        ${firstBalanceLine}`,
    secondBalanceLine,
    '',
    '9.        ADDITIONAL TERMS:',
    additionalTerms,
    '',
    `10.       ${paragraph10}`,
    '',
    `11.       ${paragraph11}`,
    '',
    `13.       ${paragraph13}`,
    '',
    `14.       ${paragraph14}`,
    '',
    '',
    '___________________________________        __________________________________',
    'for Employer                         for Musician(s)',
  ].filter((line) => line !== undefined).join('\n');
}

function normalizePreviewLabel(value: string) {
  return String(value)
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/_{3,}/g, ' ')
    .replace(/[:\s]+$/g, '')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase();
}

function buildLiveTemplateParts(
  templateText: string,
  questions: TemplateQuestion[],
  answers: ContractWizardAnswers,
  useDetectedBlankPreview: boolean,
): LiveTemplatePart[] {
  const blankQuestions = questions.flatMap((question) => {
    const blankIndexes: number[] = [
      ...(Array.isArray(question.blankIndexes)
        ? question.blankIndexes.filter((value): value is number => typeof value === 'number')
        : []),
      ...(typeof question.blankIndex === 'number' ? [question.blankIndex] : []),
    ];

    return blankIndexes.map((blankIndex) => ({
      question,
      blankIndex,
    }));
  }).sort((a, b) => a.blankIndex - b.blankIndex);

  const questionsWithBlankIndexes = new Set(
    blankQuestions.map((item) => String(item.question.id)),
  );

  const lineQuestions = questions
    .filter((question) =>
      typeof question.lineIndex === 'number'
      && !questionsWithBlankIndexes.has(String(question.id))
    )
    .sort((a, b) => Number(a.lineIndex) - Number(b.lineIndex));

  if (!useDetectedBlankPreview || (!blankQuestions.length && !lineQuestions.length)) {
    return [createTextPart(templateText)];
  }

  const parts: LiveTemplatePart[] = [];
  const blankRegex = /_{3,}/g;
  let blankIndex = 0;

  const lineQuestionIndexMap = new Map<number, TemplateQuestion[]>();

  for (const question of lineQuestions) {
    const index = Number(question.lineIndex);
    const existing = lineQuestionIndexMap.get(index) ?? [];
    existing.push(question);
    lineQuestionIndexMap.set(index, existing);
  }

  function pushBlank(question: TemplateQuestion | undefined, fallbackLabel: string, placeholder = '____________________') {
    const value = question ? formatAnswerForPreview(answers[question.id]) : '';

    parts.push({
      type: 'blank',
      label: question?.label ?? fallbackLabel,
      value,
      placeholder,
    });
  }

  templateText.split('\n').forEach((line, lineIndex, lines) => {
    blankRegex.lastIndex = 0;

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = blankRegex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        parts.push(createTextPart(line.slice(lastIndex, match.index)));
      }

      const blankEntry = blankQuestions.find((item) => item.blankIndex === blankIndex);
pushBlank(blankEntry?.question, `Blank ${blankIndex + 1}`, match[0]);

      lastIndex = match.index + match[0].length;
      blankIndex += 1;
    }

    if (lastIndex < line.length) {
      parts.push(createTextPart(line.slice(lastIndex)));
    }

    const questionsForLine = lineQuestionIndexMap.get(lineIndex) ?? [];

    if (questionsForLine.length) {
      const trimmed = line.trimEnd();
      const hasVisibleLine = Boolean(trimmed);
      parts.push(createTextPart(hasVisibleLine ? '  ' : ''));

      questionsForLine.forEach((question, questionIndex) => {
        if (questionIndex > 0) {
          parts.push(createTextPart('  '));
        }

        pushBlank(question, question.label, fieldPreviewPlaceholder(question));
      });
    }

    if (lineIndex < lines.length - 1) {
      parts.push(createTextPart('\n'));
    }
  });

  return parts;
}

function answerIsFilled(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.some((item) => item.trim());
  }

  return Boolean(String(value ?? '').trim());
}

function formatAnswerForPreview(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value.map((item) => item.trim()).filter(Boolean).join(', ');
  }

  return String(value ?? '').trim();
}

function fieldPreviewPlaceholder(question: TemplateQuestion) {
  const label = String(question.label || question.placeholder || 'blank')
    .replace(/\s+/g, ' ')
    .trim();

  if (!label) {
    return '____________________';
  }

  return `[${label}]`;
}

function WizardInput({
  question,
  value,
  onChange,
}: {
  question: TemplateQuestion;
  value?: string;
  onChange: (value: string) => void;
}) {
  const type = question.type ?? 'text';
  const inputClass =
    'w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary';

  if (type === 'textarea') {
    return (
      <label className="grid gap-2 text-[14px] md:col-span-2">
        <span className="flex items-center gap-2">
          {question.label}
          <QuestionStatus question={question} />
        </span>
        <textarea
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          placeholder={question.placeholder}
          className={`${inputClass} min-h-[92px] resize-y`}
        />
        {question.helpText && <span className="text-[12px] leading-[1.45] text-muted-foreground">{question.helpText}</span>}
      </label>
    );
  }

  if (type === 'dropdown' || type === 'select') {
    return (
      <label className="grid gap-2 text-[14px]">
        <span className="flex items-center gap-2">
          {question.label}
          <QuestionStatus question={question} />
        </span>
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(event) => onChange(event.target.value)}
          className={inputClass}
        >
          <option value="">{question.placeholder}</option>
          {(question.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
        {question.helpText && <span className="text-[12px] leading-[1.45] text-muted-foreground">{question.helpText}</span>}
      </label>
    );
  }

  if (type === 'radio' || type === 'multiselect') {
    return (
      <fieldset className="grid gap-2 text-[14px]">
        <legend className="flex items-center gap-2">
          {question.label}
          <QuestionStatus question={question} />
        </legend>
        <div className="flex flex-wrap gap-2">
          {(question.options ?? ['Yes', 'No']).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(type === 'multiselect' && value?.split(', ').includes(option)
                ? value.split(', ').filter((item) => item !== option).join(', ')
                : type === 'multiselect' && value
                  ? `${value}, ${option}`
                  : option)}
              className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-[13px] font-[800] transition-all ${
                (type === 'multiselect' ? value?.split(', ').includes(option) : value === option)
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-input text-foreground hover:bg-accent'
              }`}
            >
              {option}
            </button>
          ))}
        </div>
        {question.helpText && <span className="text-[12px] leading-[1.45] text-muted-foreground">{question.helpText}</span>}
      </fieldset>
    );
  }

  if (type === 'checkbox' || type === 'boolean') {
    return (
      <label className="flex items-start gap-3 rounded-[14px] border border-ring bg-input p-4 text-[14px]">
        <input
          type="checkbox"
          checked={value === 'Yes'}
          onChange={(event) => onChange(event.target.checked ? 'Yes' : '')}
          className="mt-1"
        />
        <span>
          <span className="block font-[750]">{question.label}</span>
          <span className="block text-[12px] leading-[1.45] text-muted-foreground">{question.helpText ?? question.placeholder}</span>
        </span>
      </label>
    );
  }

  const htmlType = type === 'date' ? 'date' : 'text';
  const inputMode = type === 'number' || type === 'percentage' || type === 'currency' ? 'decimal' : undefined;

  return (
    <label className="grid gap-2 text-[14px]">
      <span className="flex items-center gap-2">
        {question.label}
        <QuestionStatus question={question} />
      </span>
      <input
        type={htmlType}
        inputMode={inputMode}
        value={typeof value === 'string' ? value : ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={question.placeholder}
        className={inputClass}
      />
      {question.helpText && <span className="text-[12px] leading-[1.45] text-muted-foreground">{question.helpText}</span>}
    </label>
  );
}

function QuestionStatus({ question }: { question: TemplateQuestion }) {
  if (question.recommended) {
    return <span className="text-[11px] text-primary">Recommended</span>;
  }

  return <span className="text-[11px] text-muted-foreground">Optional</span>;
}

function TemplateDocumentPreview({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  const pages = paginateTemplateText(formatSavedDocumentPreviewLayout(title, text));

  return (
    <div className="mt-5 -mx-5 md:-mx-6 bg-[#d6d6d6] px-3 py-8 md:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <div className="text-[11px] uppercase tracking-[0.14em] text-[#4a4a4a]">Word/RTF template preview</div>
          <div className="text-[18px] font-[850] text-[#151515]">{title}</div>
        </div>
        <div className="shrink-0 whitespace-nowrap rounded-full border border-[#b8b8b8] bg-white px-3 py-1 text-[12px] font-[800] text-[#333]">
          {pages.length} {pages.length === 1 ? 'page' : 'pages'}
        </div>
      </div>

      <div className={pages.length > 1 ? 'grid gap-6 xl:grid-cols-2' : 'grid gap-6 justify-center'}>
        {pages.map((page, index) => {
          const lines = page.split('\n');
          const firstLine = index === 0 ? lines[0]?.trim() : '';
          const body = index === 0 ? lines.slice(1).join('\n').trimStart() : page;

          return (
            <article
              key={`${index}-${page.slice(0, 20)}`}
              className={`${pages.length > 1 ? 'mx-auto' : ''} ${legalPageClass}`}
            >
              {index === 0 && firstLine && (
                <h3 className="mb-8 mt-0 text-center font-['Times_New_Roman',Times,serif] text-[11px] font-bold uppercase tracking-0 text-black">
                  {firstLine}
                </h3>
              )}
              <LegalDocumentBody body={body} />
              <div className="absolute bottom-[4.5%] left-0 right-0 text-center font-['Times_New_Roman',Times,serif] text-[10px] text-black/70">
                Page {index + 1} of {pages.length}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function LegalDocumentBody({ body }: { body: string }) {
  const lines = body.split('\n');
  const blocks: ReactNode[] = [];
  const buffer: string[] = [];

  function flushBuffer(key: string) {
    if (!buffer.length) {
      return;
    }

    blocks.push(
      <pre
        key={key}
        className="m-0 whitespace-pre-wrap font-['Times_New_Roman',Times,serif] text-[12px] leading-[1.14] text-black"
        style={{ tabSize: 8 }}
      >
        {buffer.join('\n')}
      </pre>,
    );
    buffer.length = 0;
  }

  lines.forEach((line, index) => {
    const nextLine = lines[index + 1] ?? '';
    const isSignatureLine = /^_{10,}\s+_{10,}$/.test(line.trim());
    const signatureLabels = isSignatureLine ? splitSignatureLabels(nextLine) : null;

    if (signatureLabels) {
      flushBuffer(`text-${index}`);
      blocks.push(<SignatureColumns key={`signature-${index}`} left={signatureLabels[0]} right={signatureLabels[1]} />);
      lines[index + 1] = '';
      return;
    }

    if (line === '' && index > 0 && /^_{10,}\s+_{10,}$/.test(lines[index - 1]?.trim() ?? '')) {
      return;
    }

    buffer.push(line);
  });

  flushBuffer('text-final');

  return <>{blocks}</>;
}

function splitSignatureLabels(line: string) {
  const trimmed = line.trim();
  const labels = trimmed.split(/\s{2,}/).filter(Boolean);

  if (labels.length !== 2) {
    return null;
  }

  return labels as [string, string];
}

function SignatureColumns({ left, right }: { left: string; right: string }) {
  return (
    <div data-signature-block="true" className="my-4 grid grid-cols-2 gap-[8%] font-['Times_New_Roman',Times,serif] text-[12px] leading-[1.14] text-black">
      {[left, right].map((label) => (
        <div key={label} className="min-w-0">
          <div className="h-[1px] w-full bg-black" />
          <div data-signature-name="true" className="pt-[3px]">{label}</div>
        </div>
      ))}
    </div>
  );
}

function escapeRtf(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/{/g, '\\{')
    .replace(/}/g, '\\}')
    .replace(/[^\x00-\x7F]/g, (char) => `\\u${char.charCodeAt(0)}?`);
}

function contractDownloadRtf(title: string, content: string) {
  const lines = cleanContractDisplayText(content).split('\n');
  const firstLine = lines[0]?.trim();
  const bodyLines = firstLine ? lines.slice(1) : lines;
  const blocks: string[] = [];

  if (firstLine) {
    blocks.push(`\\pard\\qc\\b ${escapeRtf(firstLine)}\\b0\\sa360\\par`);
  } else {
    blocks.push(`\\pard\\qc\\b ${escapeRtf(title)}\\b0\\sa360\\par`);
  }

  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index] ?? '';
    const nextLine = bodyLines[index + 1] ?? '';
    const signatureLabels = /^_{10,}\s+_{10,}$/.test(line.trim()) ? splitSignatureLabels(nextLine) : null;

    if (signatureLabels) {
      blocks.push(signatureTableRtf(signatureLabels[0], signatureLabels[1]));
      index += 1;
      continue;
    }

    if (!line.trim()) {
      blocks.push('\\pard\\sa80\\par');
      continue;
    }

    blocks.push(`\\pard\\sa120\\sl276\\slmult1 ${escapeRtf(line.trim())}\\par`);
  }

  return `{\\rtf1\\ansi\\deff0
{\\fonttbl{\\f0 Times New Roman;}}
\\paperw12240\\paperh20160\\margl1123\\margr1123\\margt1224\\margb1238\\portrait
\\widowctrl\\ftnbj\\f0\\fs24
${blocks.join('\n')}
}`;
}

function signatureTableRtf(left: string, right: string) {
  return `\\pard\\sa160\\par
\\trowd\\trgaph0\\trleft0
\\clbrdrt\\brdrs\\brdrw15\\cellx4597
\\cellx5397
\\clbrdrt\\brdrs\\brdrw15\\cellx9994
\\pard\\intbl ${escapeRtf(left)}\\cell
\\pard\\intbl \\cell
\\pard\\intbl ${escapeRtf(right)}\\cell
\\row`;
}

function ContractDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  return <ContractDetail key={`${user?.id}:${id}`} />;
}

function ContractDetail() {
  const { aiEnabled } = useSiteConfiguration();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [contract, setContract] = useState<Contract | null>(null);
  const [progressStage, setProgressStage] = useState<ContractProgressStage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [clauseText, setClauseText] = useState('');
  const [explanation, setExplanation] = useState<ClauseExplanation | null>(null);
  const [riskReview, setRiskReview] = useState<RiskReviewResult | null>(null);
  const [aiActionLoading, setAiActionLoading] = useState<'explain' | 'risk' | null>(null);
  const [sourceFileUrl, setSourceFileUrl] = useState('');
  const [sourceFileType, setSourceFileType] = useState('');
  const [sourceFileError, setSourceFileError] = useState('');
  const [sourceFileLoading, setSourceFileLoading] = useState(false);
  const [templatePreview, setTemplatePreview] = useState('');
  const [resolvedTemplateSourceFile, setResolvedTemplateSourceFile] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [isEditingContract, setIsEditingContract] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editBaseline, setEditBaseline] = useState('');
  const editDirty = isEditingContract && editContent !== editBaseline;
  const recovery = useDraftRecovery(user?.id || '', `account-contract:${id}`, editDirty, {
    templateId: id || '', name: contract?.title || '', text: editContent, html: '', baseUpdatedAt: contract?.updatedAt,
  });
  const markEditClean = useUnsavedChanges(editDirty || Boolean(recovery.copy), isSavingEdit, recovery.clear);

  useEffect(() => {
    let active = true;

    if (!id) {
      setError('Missing contract id.');
      setLoading(false);
      return;
    }

    setProgressStage(null);
    getContract(id)
      .then((item) => {
        if (active) {
          setContract(item);
          setError('');
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Unable to load this contract.');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    let objectUrl = '';
    let active = true;

    if (!contract?.selectedTemplateId) {
      setSourceFileUrl('');
      setSourceFileType('');
      setSourceFileError('');
      setSourceFileLoading(false);
      setResolvedTemplateSourceFile('');
      return;
    }

    setSourceFileLoading(true);
    setSourceFileError('');
    setTemplatePreview('');

    async function resolveTemplateId() {
      const storedSourceFile = sourceFileName(contract?.selectedTemplateSourceFile);

      if (!storedSourceFile) {
        return contract?.selectedTemplateId;
      }

      try {
        const templates = await fetchContractTemplates();
        const sourceMatch = templates.find((template) => sourceFileName(template.sourceFile) === storedSourceFile);
        return sourceMatch?.id ?? contract?.selectedTemplateId;
      } catch {
        return contract?.selectedTemplateId;
      }
    }

    resolveTemplateId().then((templateId) => {
      if (!active || !templateId) {
        return;
      }

      fetchTemplateSourceFile(templateId)
      .then(({ blob, contentType }) => {
        if (!active) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setSourceFileUrl(objectUrl);
        setSourceFileType(contentType);
      })
      .catch((err) => {
        if (active) {
          setSourceFileUrl('');
          setSourceFileType('');
          setSourceFileError(err instanceof Error ? err.message : 'The source file is unavailable right now.');
        }
      })
      .finally(() => {
        if (active) {
          setSourceFileLoading(false);
        }
      });

      fetchTemplatePreview(templateId)
      .then((preview) => {
        if (!active) {
          return;
        }

        setTemplatePreview(preview.templateText);
        setResolvedTemplateSourceFile(preview.sourceFile);
      })
      .catch(() => {
        if (active) {
          setTemplatePreview('');
        }
      });

      if (contract.wizardAnswers?.__manualContent === 'true') {
        return;
      }

      renderTemplateDraft(templateId, contract.wizardAnswers, contract.userRequest ?? '')
      .then((refreshedContent) => {
        if (!active) {
          return;
        }

        setContract((current) => current && current.id === contract.id ? { ...current, content: refreshedContent } : current);
      })
      .catch(() => {
        // Keep showing the saved contract content when a template refresh cannot be generated.
      });
    });

    return () => {
      active = false;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [contract?.id, contract?.selectedTemplateId, contract?.selectedTemplateSourceFile, contract?.userRequest, contract?.wizardAnswers]);

  const metadata = useMemo(
    () =>
      contract
        ? [
            ['Type', contract.contractType],
            ['Source', (resolvedTemplateSourceFile || contract.selectedTemplateSourceFile)?.split('/').pop() ?? 'Own Masters starter template'],
            ['Status', contractStageLabel(progressStage || contract.status)],
            ['Created', formatDate(contract.createdAt)],
            ['Last updated', formatDate(contract.updatedAt)],
          ]
        : [],
    [contract, resolvedTemplateSourceFile, progressStage],
  );
  const displayContractText = useMemo(
    () => bestContractDisplayText(contract?.content ?? '', templatePreview),
    [contract?.content, templatePreview],
  );
  async function handleExplainDraft() {
    if (!contract) {
      return;
    }

    setAiActionLoading('explain');
    setExplanation(null);

    try {
      const textToExplain = clauseText.trim() || contract.content;
      const result = await explainContractClause(contract.id, textToExplain, contract.contractType);
      setExplanation(result);
    } finally {
      setAiActionLoading(null);
    }
  }

  async function handleRiskReview() {
    if (!contract) {
      return;
    }

    setAiActionLoading('risk');
    setRiskReview(null);

    try {
      const result = await reviewContractRisk(contract.id, contract.content, contract.contractType);
      setRiskReview(result);
    } finally {
      setAiActionLoading(null);
    }
  }

  function downloadGeneratedContract() {
  if (!contract || !displayContractText) {
    return;
  }

  const rtf = contractDownloadRtf(contract.title, displayContractText);

    downloadBlob(
      new Blob([rtf], { type: 'application/rtf;charset=utf-8' }),
      `${safeDownloadName(contract.title)}.rtf`,
    );
  }

  function startManualEdit() {
  if (!contract) {
    return;
  }

  setEditContent(displayContractText || contract.content);
    setEditBaseline(displayContractText || contract.content);
    setEditError('');
    setIsEditingContract(true);
    window.setTimeout(() => {
      document.getElementById('manual-contract-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }

  async function saveManualEdit() {
    if (!contract) {
      return;
    }

    setEditError('');

    if (!editContent.trim()) {
      setEditError('Contract content cannot be blank.');
      return;
    }

    setIsSavingEdit(true);

    try {
      const updated = await updateContractContent(contract.id, editContent);
      setContract(updated);
      setTemplatePreview('');
      setIsEditingContract(false);
      recovery.clear();
      markEditClean();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Unable to save your edits.');
    } finally {
      setIsSavingEdit(false);
    }
  }

  async function handleDeleteContract() {
    if (!contract) {
      return;
    }

    const confirmed = window.confirm(`Delete "${contract.title}" and its progress history and signed copies? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setDeleteError('');

    try {
      await deleteContract(contract.id);
      recovery.clear();
      markEditClean();
      navigate('/dashboard/contracts');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Unable to delete this contract.');
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading) {
    return <LoadingScreen label="Loading contract" />;
  }

  if (error || !contract) {
    return (
      <main className={`${panel} p-6`}>
        <h1 className="m-0 mb-2 text-[30px] tracking-[-0.6px]">Contract unavailable</h1>
        <p className="text-muted-foreground">{error || 'This contract could not be found.'}</p>
        <Link to="/dashboard" className={primaryButton}>
          Back to Dashboard
        </Link>
      </main>
    );
  }

  return (
    <main className="grid gap-6">
      <section className={`${panel} p-6`}>
        <Link to="/dashboard" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4">
          <ArrowLeft className="size-4" /> Back to Dashboard
        </Link>
        <div className="grid lg:grid-cols-[1fr_auto] gap-5 items-start">
          <div>
            <h1 className="m-0 mb-3 text-[34px] tracking-[-0.8px] leading-tight">{contract.title}</h1>
            <p className="m-0 text-muted-foreground max-w-[720px]">
              Edit your draft, download a copy, and keep the signed PDF with your contract.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
            <ContractStageBadge status={progressStage || contract.status} />
          </div>
        </div>
      </section>

      {recovery.copy && <DraftRecoveryNotice busy={isSavingEdit} changedOnServer={Boolean(recovery.copy.baseUpdatedAt && recovery.copy.baseUpdatedAt !== contract.updatedAt)} onDiscard={recovery.clear} onRestore={() => {
        setEditBaseline(displayContractText || contract.content);
        setEditContent(recovery.copy!.text);
        setIsEditingContract(true);
        recovery.clear();
      }} />}
      {recovery.unavailable && <p role="alert" className="text-sm text-muted-foreground">This browser cannot keep a recovery copy. Save your edits before leaving.</p>}
      <ContractProgressPanel key={contract.id} source="account" contractId={contract.id} disabled={isSavingEdit || isEditingContract || Boolean(recovery.copy)} onChange={(value) => setProgressStage(value.tracked ? value.status : null)} />
      <section className="grid md:grid-cols-4 gap-3">
        {metadata.map(([label, value]) => (
          <div key={label} className={`${card} p-4`}>
            <div className="text-[13px] text-muted-foreground">{label}</div>
            <div className="font-[800] mt-2 capitalize">{value}</div>
          </div>
        ))}
      </section>

      <section className={`${panel} p-6`}>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <FileText className="size-5" />
            <h2 className="m-0 text-[24px] tracking-[-0.4px]">Source contract file</h2>
          </div>
          {displayContractText && (
            <button type="button" onClick={downloadGeneratedContract} className={primaryButton}>
              <Download className="size-4" /> Download Contract
            </button>
          )}
        </div>
        {contract.userRequest && (
          <div className="rounded-[18px] border border-border bg-muted p-4 mb-4">
            <div className="text-[13px] text-muted-foreground mb-1">Creator notes</div>
            <p className="m-0">{contract.userRequest}</p>
          </div>
        )}
        <div className="bg-transparent">
          <div className="mb-3">
            <div className="text-[13px] text-muted-foreground mb-1">Selected template</div>
            <div className="font-[800]">{contract.contractType}</div>
            <div className="text-[13px] text-muted-foreground mt-1">
              {(resolvedTemplateSourceFile || contract.selectedTemplateSourceFile)?.split('/').pop() ?? 'No original source file is attached to this draft.'}
            </div>
          </div>

          {sourceFileLoading && (
            <div className="mt-5 rounded-[16px] border border-border bg-card p-5 text-muted-foreground">
              Loading original source file...
            </div>
          )}

          {sourceFileError && (
            <div className="mt-5 rounded-[16px] border border-destructive/50 bg-destructive/10 p-5 text-red-700 dark:text-red-100">
              {sourceFileError}
            </div>
          )}

          {isEditingContract && (
            <div id="manual-contract-editor" className="mt-5 rounded-[18px] border border-primary/40 bg-primary/10 p-4 scroll-mt-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="m-0 text-[20px] tracking-[-0.3px]">Manual contract editor</h3>
                  <p className="m-0 mt-1 text-[13px] text-muted-foreground">
                    Edit the contract text directly. Saving updates the paper preview and download.
                  </p>
                </div>
                <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground">
                  {editContent.length.toLocaleString()} characters
                </span>
              </div>
              <textarea
                value={editContent}
                disabled={isSavingEdit || Boolean(recovery.copy)}
                onChange={(event) => setEditContent(event.target.value)}
                spellCheck={false}
                className="min-h-[520px] w-full resize-y rounded-[14px] border border-ring bg-white px-4 py-4 font-['Times_New_Roman',Times,serif] text-[14px] leading-[1.45] text-black outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {editError && (
                <div className="mt-3 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-700 dark:text-red-100">
                  {editError}
                </div>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button type="button" onClick={saveManualEdit} disabled={isSavingEdit} className={primaryButton}>
                  <CheckCircle2 className="size-4" /> {isSavingEdit ? 'Saving...' : 'Save Edits'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (editDirty && !window.confirm('Discard your unsaved contract edits?')) return;
                    recovery.clear();
                    setIsEditingContract(false);
                    setEditError('');
                  }}
                  disabled={isSavingEdit}
                  className={ghostButton}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {sourceFileUrl && (
            displayContractText ? (
              <TemplateDocumentPreview
                title={contract.contractType}
                text={displayContractText}
              />
            ) : (
              <div className="mt-5 rounded-[16px] border border-border bg-card p-5 text-muted-foreground">
                This PDF source does not expose readable contract text yet. Download the original PDF, or choose a matching Word source if one is available.
              </div>
            )
          )}

          {!contract.selectedTemplateId && (
            <div className="mt-5 rounded-[16px] border border-border bg-card p-5 text-muted-foreground">
              This draft was created before source file viewing was added. Create a new draft from the uploaded library to attach an original template file.
            </div>
          )}
        </div>
        {aiEnabled && <div className="grid gap-2 mt-4">
          <label className="text-[14px]" htmlFor="clause-to-explain">Clause or section to explain</label>
          <textarea
            id="clause-to-explain"
            value={clauseText}
            onChange={(event) => setClauseText(event.target.value)}
            placeholder="Paste a clause here, or leave this blank to explain the draft summary."
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] min-h-[100px] resize-y transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>}
        <div className="flex flex-wrap gap-3 mt-5">
          {deleteError && (
            <div className="basis-full rounded-[18px] border border-destructive/50 bg-destructive/10 p-4 text-red-700 dark:text-red-100">
              {deleteError}
            </div>
          )}
          {aiEnabled && <><button type="button" onClick={handleExplainDraft} disabled={Boolean(aiActionLoading)} className={primaryButton}>
            {aiActionLoading === 'explain' ? 'Explaining...' : 'Explain this'} <Sparkles className="size-4" />
          </button>
          <button type="button" onClick={handleRiskReview} disabled={Boolean(aiActionLoading)} className={ghostButton}>
            {aiActionLoading === 'risk' ? 'Reviewing...' : 'Review Risk'} <ShieldCheck className="size-4" />
          </button></>}
          <button type="button" onClick={startManualEdit} disabled={Boolean(recovery.copy) || isSavingEdit} className={ghostButton}>
            Continue Editing <PenLine className="size-4" />
          </button>
          <Link to="/dashboard" className={ghostButton}>
            Back to Dashboard
          </Link>
          <button
            type="button"
            onClick={handleDeleteContract}
            disabled={isDeleting}
            className="inline-flex items-center justify-center gap-2 border border-red-400/40 bg-red-500/10 text-red-700 dark:text-red-100 px-[15px] py-[11px] rounded-[14px] font-[700] cursor-pointer hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            <Trash2 className="size-4" /> {isDeleting ? 'Deleting...' : 'Delete Contract'}
          </button>
        </div>
      </section>

      {explanation && (
        <section className={`${panel} p-6`}>
          <div className="text-[13px] text-muted-foreground mb-2">
            {explanation.source === 'openai' ? 'Explained by Own Masters AI' : 'Rule-based explanation'}
          </div>
          <h2 className="m-0 mb-3 text-[24px] tracking-[-0.4px]">Plain-English explanation</h2>
          <p className="m-0 text-muted-foreground leading-[1.6]">{explanation.plainEnglishExplanation}</p>
          {explanation.termsToReview.length > 0 && (
            <div className="mt-4">
              <div className="text-[13px] font-[800] mb-2">Terms to review</div>
              <div className="flex flex-wrap gap-2">
                {explanation.termsToReview.map((term) => (
                  <span key={term} className="shrink-0 whitespace-nowrap rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
                    {term}
                  </span>
                ))}
              </div>
            </div>
          )}
          <p className="m-0 mt-4 text-[13px] text-muted-foreground">This is not legal advice.</p>
        </section>
      )}

      {riskReview && (
        <section className={`${panel} p-6`}>
          <div className="text-[13px] text-muted-foreground mb-2">
            {riskReview.source === 'openai' ? 'Reviewed by Own Masters AI' : 'Local risk review'}
          </div>
          <h2 className="m-0 mb-3 text-[24px] tracking-[-0.4px]">Risk review</h2>
          <p className="m-0 text-muted-foreground leading-[1.6]">{riskReview.summary}</p>
          <div className="grid gap-3 mt-4">
            {riskReview.riskFlags.length ? (
              riskReview.riskFlags.map((flag) => (
                <div key={flag.id} className="rounded-[18px] border border-border bg-muted p-4">
                  <div className="flex flex-wrap gap-2 items-center justify-between">
                    <h3 className="m-0 text-[17px]">{flag.title}</h3>
                    <span className="shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[800] capitalize">
                      {flag.severity}
                    </span>
                  </div>
                  <p className="m-0 mt-2 text-muted-foreground text-[14px] leading-[1.55]">{flag.explanation}</p>
                  <p className="m-0 mt-2 text-[14px]">{flag.suggestedQuestion}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[18px] border border-border bg-muted p-4 text-muted-foreground">
                No obvious local risk flags were detected. This is not legal advice.
              </div>
            )}
          </div>
          <p className="m-0 mt-4 text-[13px] text-muted-foreground">This is not legal advice. Consider asking an attorney before signing.</p>
        </section>
      )}

    </main>
  );
}
