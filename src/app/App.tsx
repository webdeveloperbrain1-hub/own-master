import { forwardRef, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Download,
  FileText,
  FileAudio,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Music2,
  PenLine,
  Plus,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { AuthProvider, useAuth } from './auth/AuthContext';
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

const primaryButton =
  'inline-flex items-center justify-center gap-2 border border-primary bg-primary text-primary-foreground px-[15px] py-[11px] rounded-[14px] font-[750] cursor-pointer hover:opacity-90 transition-all hover:scale-[1.02] disabled:opacity-60 disabled:cursor-not-allowed disabled:scale-100';

const ghostButton =
  'inline-flex items-center justify-center gap-2 border border-border bg-muted text-foreground px-[15px] py-[11px] rounded-[14px] font-[700] cursor-pointer hover:bg-accent transition-all';

const panel =
  'border border-border bg-gradient-to-b from-[rgba(255,255,255,.08)] to-[rgba(255,255,255,.04)] rounded-[22px]';

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

type MusicProject = {
  id: string;
  title: string;
  fileName: string;
  fileSize: number;
  lyrics: string;
  comments: {
    id: string;
    body: string;
    createdAt: string;
  }[];
  createdAt: string;
};

type ShareTarget = {
  kind: 'contract' | 'track';
  id: string;
  title: string;
};

type ShareInvite = {
  id: string;
  targetKind: ShareTarget['kind'];
  targetId: string;
  targetTitle: string;
  recipientName: string;
  email: string;
  permission: 'view' | 'comment' | 'edit' | 'signer';
  note: string;
  status: 'invited';
  createdAt: string;
};

function formatFileSize(bytes: number) {
  if (!bytes) {
    return 'File selected';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function musicProjectsKey(userKey?: string | null) {
  return `own_masters_music_projects_${userKey || 'demo'}`;
}

function shareInvitesKey(userKey?: string | null) {
  return `own_masters_share_invites_${userKey || 'demo'}`;
}

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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardHome />} />
        <Route path="contracts" element={<ContractsPage />} />
        <Route path="contract-filler" element={<ContractFillerPage />} />
        <Route path="contracts/:id" element={<ContractDetailPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingScreen label="Opening your workspace" />;
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6">
      <div className={`${panel} p-8 text-center max-w-[360px]`}>
        <img src="/own-masters-logo.png" alt="Own Masters" className="w-20 h-auto mx-auto mb-4" />
        <p className="text-muted-foreground m-0">{label}...</p>
      </div>
    </div>
  );
}

function LandingPage() {
  const { user, loading } = useAuth();

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
            entry.target.querySelectorAll('.stagger-item').forEach((child, index) => {
              window.setTimeout(() => child.classList.add('animate-in'), index * 90);
            });
          }
        });
      },
      { threshold: 0.1 },
    );

    document.querySelectorAll('.fade-in-section').forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <div className="min-h-screen">
      <MotionStyles />
      <div className="max-w-[1120px] mx-auto px-[18px] pb-16">
        <header className="flex justify-between items-center py-[18px] border-b border-border">
          <Link to="/" className="flex items-center justify-center font-[850] tracking-[-0.3px] text-[18px] gap-2">
            <img src="/own-masters-logo.png" alt="Own Masters logo" className="w-16 h-auto" />
            Own Masters
          </Link>
          <div className="flex gap-3 md:gap-6 items-center">
            <button onClick={() => scrollToSection('about')} className="text-foreground cursor-pointer hover:opacity-70 transition-opacity hidden md:block bg-transparent border-0 p-0">
              About
            </button>
            <button onClick={() => scrollToSection('how-it-works')} className="text-foreground cursor-pointer hover:opacity-70 transition-opacity hidden md:block bg-transparent border-0 p-0">
              How it Works
            </button>
            {user ? (
              <Link to="/dashboard" className={primaryButton}>
                Go to Dashboard <ArrowRight className="size-4" />
              </Link>
            ) : (
              <>
                <Link to="/login" className="hidden sm:inline text-foreground hover:opacity-70 transition-opacity">
                  Log In
                </Link>
                <Link to="/signup" className={primaryButton}>
                  Sign Up
                </Link>
              </>
            )}
          </div>
        </header>

        <section id="home" className="py-[72px] md:py-[44px] grid md:grid-cols-1 lg:grid-cols-[1.12fr_0.88fr] gap-7 items-center fade-in-section">
          <div>
            <h1 className="m-0 mb-[14px] text-[clamp(38px,6vw,68px)] leading-[1.02] tracking-[-1.4px]">
              Build your music business before the industry builds it for you.
            </h1>
            <p className="text-muted-foreground text-[18px] leading-[1.5] max-w-[680px] m-0 mb-[22px]">
              Own Masters helps artists, managers, producers, DJs, and writers organize teams, protect songs, manage agreements, and keep the paperwork behind the catalog in one place.
            </p>

            <div className="flex flex-wrap gap-3">
              <Link to={user ? '/dashboard' : '/signup'} className={primaryButton}>
                Start Creating Contracts <ArrowRight className="size-4" />
              </Link>
              {!loading && !user && (
                <Link to="/login" className={ghostButton}>
                  Log In
                </Link>
              )}
            </div>

            <div className="text-[rgba(255,255,255,.50)] text-[13px] mt-3">
              For artists, managers, producers, DJs, writers, and music industry pros.
            </div>

            <div className="flex gap-[10px] flex-wrap mt-4">
              {['Artist', 'Manager', 'Producer', 'Writer', 'DJ', 'Industry Pro'].map((role) => (
                <span key={role} className="px-[13px] py-[10px] rounded-full border border-border bg-muted text-[rgba(255,255,255,.78)] font-[700] text-[14px]">
                  {role}
                </span>
              ))}
            </div>
          </div>

          <div className={`${panel} p-[22px]`}>
            <h3 className="m-0 mb-3 text-[18px]">Your music business command center</h3>
            {[
              ['Contracts Workspace', 'Split sheets, producer agreements, licenses, and deal memos'],
              ['Rights Organization', 'Keep ownership paperwork connected to every project'],
              ['AI Contract Wizard', 'Coming next, built on the dashboard foundation'],
            ].map(([title, description], index) => (
              <div key={title} className="flex justify-between items-center gap-3 p-3 rounded-[16px] border border-border bg-muted mt-[10px]">
                <div>
                  <strong>{title}</strong>
                  <br />
                  <span className="text-muted-foreground text-[13px]">{description}</span>
                </div>
                <div className="px-[9px] py-[6px] rounded-full border border-[rgba(255,255,255,.12)] text-[rgba(255,255,255,.78)] text-[12px] whitespace-nowrap">
                  {index === 0 ? 'Live MVP' : 'Phase 1'}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-[34px] fade-in-section">
          <div className={`${panel} p-[22px]`}>
            <div className="grid lg:grid-cols-[1fr_auto] gap-5 items-center">
              <div>
                <h2 className="m-0 mb-3 text-[30px] tracking-[-0.6px]">Create and manage your music contracts.</h2>
                <p className="text-muted-foreground text-[17px] leading-[1.55] max-w-[720px] m-0">
                  Own Masters helps artists, producers, managers, and rights holders create, organize, and manage essential music business documents without losing the creative pulse.
                </p>
              </div>
              <Link to={user ? '/dashboard' : '/signup'} className={primaryButton}>
                Open Dashboard <LayoutDashboard className="size-4" />
              </Link>
            </div>
          </div>
        </section>

        <LandingSections scrollToSection={scrollToSection} />
      </div>
    </div>
  );
}

function LandingSections({ scrollToSection }: { scrollToSection: (id: string) => void }) {
  return (
    <>
      <section className="py-[50px] fade-in-section">
        <h2 className="m-0 mb-10 text-[32px] tracking-tight text-center">What's coming first</h2>
        <div className="grid md:grid-cols-1 lg:grid-cols-2 gap-[14px]">
          {[
            ['Contract Drafts', 'Start with split sheets, producer agreements, licenses, and deal memos.'],
            ['Catalog Paper Trail', 'Keep your ownership paperwork in one place as projects grow.'],
            ['Team Workspace', 'Add managers, writers, producers, collaborators, and advisors.'],
            ['AI Contract Wizard', 'Turn plain-English deal context into guided contract drafts in the next phase.'],
          ].map(([title, description]) => (
            <div key={title} className={`${card} p-5 hover-lift cursor-pointer stagger-item`}>
              <h3 className="m-0 mb-2 text-[18px] tracking-[-0.3px]">{title}</h3>
              <p className="m-0 text-muted-foreground leading-[1.45] text-[15px]">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="about" className="py-[50px] bg-gradient-to-b from-transparent via-[rgba(255,255,255,.02)] to-transparent fade-in-section">
        <h2 className="m-0 mb-10 text-[32px] tracking-tight text-center">Built for both sides of the music business</h2>
        <div className="grid md:grid-cols-1 lg:grid-cols-3 gap-6">
          {[
            ['For Creators', 'Run your music like a business. Define splits, save agreements, and keep your catalog organized.'],
            ['For Managers', 'Manage artists, teams, agreements, release readiness, and advisor needs from one structured workspace.'],
            ['For Industry Pros', 'Help serious artists, producers, DJs, writers, and managers move with cleaner paperwork.'],
          ].map(([title, description]) => (
            <div key={title} className={`${card} p-6 hover-lift cursor-pointer stagger-item`}>
              <h3 className="m-0 mb-3 text-[19px] tracking-tight">{title}</h3>
              <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">{description}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="py-[50px] fade-in-section">
        <h2 className="m-0 mb-10 text-[32px] tracking-tight text-center">How it works</h2>
        <div className="max-w-[820px] mx-auto space-y-6">
          {[
            ['Create your account', 'Sign up, open your dashboard, and start organizing the documents behind your work.'],
            ['Choose a contract type', 'Pick a split sheet, producer agreement, license, distribution agreement, or performance deal.'],
            ['Save the draft', 'Your first contract draft is saved to your account and ready for the upcoming AI wizard.'],
          ].map(([title, description], index) => (
            <div key={title} className="flex gap-6 items-start group cursor-pointer hover-lift stagger-item">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-b from-[rgba(255,255,255,.15)] to-[rgba(255,255,255,.08)] border border-border flex items-center justify-center font-bold text-[18px] transition-all group-hover:border-primary group-hover:scale-110">
                {index + 1}
              </div>
              <div className="pt-2">
                <h3 className="m-0 mb-2 text-[19px] tracking-tight">{title}</h3>
                <p className="m-0 text-muted-foreground leading-[1.6] text-[15px]">{description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="py-[34px] fade-in-section" id="waitlist">
        <div className={`${panel} p-[22px]`}>
          <h2 className="m-0 mb-4 text-[26px] tracking-[-0.5px]">Still want early access updates?</h2>
          <p className="text-muted-foreground text-[18px] leading-[1.5] max-w-[680px] m-0 mb-[22px]">
            The dashboard foundation is live. Join the list if you want product notes as contract generation, advisor workflows, and catalog tools come online.
          </p>
          <button onClick={() => scrollToSection('home')} className={ghostButton}>
            Back to Top <ArrowLeft className="size-4" />
          </button>
        </div>
      </section>

      <footer className="text-[rgba(255,255,255,.52)] pt-7 border-t border-border mt-9 text-[13px] flex justify-between gap-3 flex-wrap">
        <div>Own Masters. Be the label. Own the masters.</div>
        <div>Terms | Privacy | Contact</div>
      </footer>
    </>
  );
}

function AuthShell({ mode }: { mode: 'login' | 'signup' }) {
  const { user, loading, signIn, signInDemo, signUp } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState(searchParams.get('notice') ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isSignup = mode === 'signup';
  const redirectTo = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  useEffect(() => {
    if (!loading && user) {
      navigate('/dashboard', { replace: true });
    }
  }, [loading, navigate, user]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setIsSubmitting(true);

    try {
      if (isSignup) {
        const result = await signUp({ name: name.trim(), email: email.trim(), password });

        if (result.needsEmailConfirmation) {
          navigate('/login?notice=Check your email to confirm your account, then log in.', { replace: true });
          return;
        }
      } else {
        await signIn({ email: email.trim(), password });
      }

      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDemoLogin() {
    signInDemo();
    navigate('/dashboard', { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-[460px]">
        <Link to="/" className="flex items-center justify-center font-[850] tracking-[-0.3px] text-[18px] gap-2 mb-7">
          <img src="/own-masters-logo.png" alt="Own Masters logo" className="w-16 h-auto" />
          Own Masters
        </Link>
        <div className={`${panel} p-6`}>
          <h1 className="m-0 mb-2 text-[32px] tracking-[-0.8px] leading-tight">
            {isSignup ? 'Create your Own Masters account.' : 'Welcome back.'}
          </h1>
          <p className="m-0 mb-6 text-muted-foreground leading-[1.5]">
            {isSignup
              ? 'Start organizing the contracts behind your catalog.'
              : 'Log in to manage your contracts, rights, and music business documents.'}
          </p>

          {notice && <div className="mb-4 rounded-[14px] border border-border bg-muted p-3 text-[14px] text-muted-foreground">{notice}</div>}
          {error && <div className="mb-4 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-200">{error}</div>}

          <form onSubmit={handleSubmit} className="grid gap-3">
            {isSignup && (
              <label className="grid gap-2 text-[14px]">
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                  required
                  disabled={isSubmitting}
                />
              </label>
            )}
            <label className="grid gap-2 text-[14px]">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                required
                disabled={isSubmitting}
              />
            </label>
            <label className="grid gap-2 text-[14px]">
              Password
              <input
                type="password"
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                required
                disabled={isSubmitting}
              />
            </label>
            <button type="submit" disabled={isSubmitting} className={`${primaryButton} w-full mt-2`}>
              {isSubmitting ? 'Working...' : isSignup ? 'Sign Up' : 'Log In'}
            </button>
          </form>

          {import.meta.env.DEV && (
            <div className="mt-4 rounded-[18px] border border-border bg-muted p-4">
              <div className="text-[13px] text-muted-foreground mb-3">
                Local preview account: admin@ownmasters.local
              </div>
              <button type="button" onClick={handleDemoLogin} className={`${ghostButton} w-full`}>
                Use Demo Admin Account
              </button>
            </div>
          )}

          <p className="text-muted-foreground text-[14px] mt-5 mb-0 text-center">
            {isSignup ? 'Already have an account?' : 'Need an account?'}{' '}
            <Link to={isSignup ? '/login' : '/signup'} className="text-foreground font-[750] hover:opacity-80">
              {isSignup ? 'Log in' : 'Sign up'}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

function LoginPage() {
  return <AuthShell mode="login" />;
}

function SignupPage() {
  return <AuthShell mode="signup" />;
}

function DashboardLayout() {
  const { isDemo, user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const name = userDisplayName(user?.user_metadata?.name, user?.email);

  async function handleLogout() {
    await signOut();
    navigate('/', { replace: true });
  }

  const navItems = [
    ['/dashboard', 'Dashboard', LayoutDashboard],
    ['/dashboard/contracts', 'Contracts', FolderOpen],
    ['/dashboard/contract-filler', 'Contract Filler', PenLine],
  ] as const;

  return (
    <div className="min-h-screen">
      <div className="max-w-[1180px] mx-auto px-[18px] pb-14">
        <header className="flex justify-between items-center py-[18px] border-b border-border">
          <Link to="/dashboard" className="flex items-center justify-center font-[850] tracking-[-0.3px] text-[18px] gap-2">
            <img src="/own-masters-logo.png" alt="Own Masters logo" className="w-16 h-auto" />
            Own Masters
          </Link>
          <div className="flex items-center gap-3">
            <div className="hidden sm:block text-right">
              <div className="text-[13px] text-muted-foreground">Signed in as</div>
              <div className="text-[14px] font-[750]">{name}{isDemo ? ' (demo)' : ''}</div>
            </div>
            <button onClick={handleLogout} className={ghostButton}>
              <LogOut className="size-4" /> Logout
            </button>
          </div>
        </header>

        <nav className="flex gap-2 py-4 overflow-x-auto">
          {navItems.map(([href, label, Icon]) => {
            const isActive = location.pathname === href;
            return (
              <Link
                key={href}
                to={href}
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-[14px] border text-[14px] font-[750] whitespace-nowrap transition-all ${
                  isActive ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-muted text-foreground hover:bg-accent'
                }`}
              >
                <Icon className="size-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        <Outlet />
      </div>
    </div>
  );
}

function useContracts() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    listContracts()
      .then((items) => {
        if (active) {
          setContracts(items);
          setError('');
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
    await deleteContract(id);
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
          {error && <p className="m-0 text-red-100">{error}</p>}
        </section>
      )}

      <section className="grid lg:grid-cols-[360px_1fr] gap-5 items-start">
        <div className={`${panel} p-4`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="m-0 text-[22px] tracking-[-0.3px]">Templates</h2>
            <span className="rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">{templates.length}</span>
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
                    <span key={label} className="rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
                      {label}: {value}
                    </span>
                  ))}
                </div>
                {selectedTemplate.scanError && (
                  <div className="mt-4 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-red-100">
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

function useMusicProjects(userKey?: string | null) {
  const [projects, setProjects] = useState<MusicProject[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(musicProjectsKey(userKey));
      setProjects(stored ? JSON.parse(stored) as MusicProject[] : []);
    } catch {
      setProjects([]);
    }
  }, [userKey]);

  function saveProjects(nextProjects: MusicProject[]) {
    setProjects(nextProjects);
    window.localStorage.setItem(musicProjectsKey(userKey), JSON.stringify(nextProjects));
  }

  function addProject(input: { title: string; fileName: string; fileSize: number; lyrics: string }) {
    const now = new Date().toISOString();
    const project: MusicProject = {
      id: `track-${crypto.randomUUID()}`,
      title: input.title,
      fileName: input.fileName,
      fileSize: input.fileSize,
      lyrics: input.lyrics,
      comments: [],
      createdAt: now,
    };
    saveProjects([project, ...projects]);
  }

  function addComment(projectId: string, body: string) {
    const trimmed = body.trim();

    if (!trimmed) {
      return;
    }

    saveProjects(projects.map((project) => project.id === projectId
      ? {
          ...project,
          comments: [
            ...project.comments,
            {
              id: `comment-${crypto.randomUUID()}`,
              body: trimmed,
              createdAt: new Date().toISOString(),
            },
          ],
        }
      : project));
  }

  return { projects, addProject, addComment };
}

function useShareInvites(userKey?: string | null) {
  const [invites, setInvites] = useState<ShareInvite[]>([]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(shareInvitesKey(userKey));
      setInvites(stored ? JSON.parse(stored) as ShareInvite[] : []);
    } catch {
      setInvites([]);
    }
  }, [userKey]);

  function saveInvite(input: Omit<ShareInvite, 'id' | 'status' | 'createdAt'>) {
    const invite: ShareInvite = {
      ...input,
      id: `invite-${crypto.randomUUID()}`,
      status: 'invited',
      createdAt: new Date().toISOString(),
    };
    const nextInvites = [invite, ...invites];
    setInvites(nextInvites);
    window.localStorage.setItem(shareInvitesKey(userKey), JSON.stringify(nextInvites));
  }

  return { invites, saveInvite };
}

function DashboardHome() {
  const { user } = useAuth();
  const { contracts, loading, error, removeContract } = useContracts();
  const { projects, addProject, addComment } = useMusicProjects(user?.id ?? user?.email);
  const { invites, saveInvite } = useShareInvites(user?.id ?? user?.email);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const draftCount = contracts.filter((contract) => contract.status === 'draft').length;
  const completedCount = contracts.filter((contract) => contract.status === 'completed').length;

  return (
    <main className="grid gap-6">
      <section className={`${panel} p-6 lg:p-8`}>
        <div className="grid lg:grid-cols-[1fr_auto] gap-5 items-center">
          <div>
            <p className="m-0 mb-2 text-[14px] text-muted-foreground">Your music business command center</p>
            <h1 className="m-0 mb-3 text-[clamp(34px,5vw,56px)] leading-[1.04] tracking-[-1.2px]">
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

      <section className="grid md:grid-cols-3 gap-4">
        <SummaryCard icon={FileText} label="Total contracts" value={contracts.length} />
        <SummaryCard icon={PenLine} label="Draft contracts" value={draftCount} />
        <SummaryCard icon={CheckCircle2} label="Completed contracts" value={completedCount} />
      </section>

      <section className={`${panel} p-5`}>
        <div className="flex flex-wrap justify-between gap-3 items-center mb-5">
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
          onShare={(contract) => setShareTarget({ kind: 'contract', id: contract.id, title: contract.title })}
        />
      </section>

      <TrackReviewWorkspace
        projects={projects}
        invites={invites}
        onAddProject={addProject}
        onAddComment={addComment}
        onShareTrack={(project) => setShareTarget({ kind: 'track', id: project.id, title: project.title })}
      />

      {shareTarget && (
        <ShareDialog
          target={shareTarget}
          onClose={() => setShareTarget(null)}
          onSave={(invite) => {
            saveInvite(invite);
            setShareTarget(null);
          }}
        />
      )}
    </main>
  );
}

function SummaryCard({ icon: Icon, label, value }: { icon: typeof FileText; label: string; value: number }) {
  return (
    <div className={`${card} p-5`}>
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

function TrackReviewWorkspace({
  projects,
  invites,
  onAddProject,
  onAddComment,
  onShareTrack,
}: {
  projects: MusicProject[];
  invites: ShareInvite[];
  onAddProject: (input: { title: string; fileName: string; fileSize: number; lyrics: string }) => void;
  onAddComment: (projectId: string, body: string) => void;
  onShareTrack: (project: MusicProject) => void;
}) {
  const [trackTitle, setTrackTitle] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');

  function handleAddProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');

    if (!trackTitle.trim()) {
      setFormError('Add a title for this track.');
      return;
    }

    if (!selectedFile) {
      setFormError('Choose an audio file for this track.');
      return;
    }

    onAddProject({
      title: trackTitle.trim(),
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      lyrics: lyrics.trim(),
    });
    setTrackTitle('');
    setLyrics('');
    setSelectedFile(null);
    event.currentTarget.reset();
  }

  function handleAddComment(projectId: string) {
    onAddComment(projectId, commentDrafts[projectId] ?? '');
    setCommentDrafts({ ...commentDrafts, [projectId]: '' });
  }

  return (
    <section className={`${panel} p-5`}>
      <div className="flex flex-wrap justify-between gap-3 items-start mb-5">
        <div>
          <div className="flex items-center gap-2">
            <FileAudio className="size-5" />
            <h2 className="m-0 text-[24px] tracking-[-0.4px]">Track review workspace</h2>
          </div>
          <p className="m-0 mt-1 text-muted-foreground text-[14px] max-w-[680px]">
            Upload a working track, keep lyrics beside it, and collect notes before attaching the right contract.
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
          {projects.length} tracks
        </span>
      </div>

      <form onSubmit={handleAddProject} className="grid lg:grid-cols-[1fr_1fr] gap-3 mb-5">
        <label className="grid gap-2 text-[14px]">
          Track title
          <input
            value={trackTitle}
            onChange={(event) => setTrackTitle(event.target.value)}
            placeholder="Night Drive demo"
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        <label className="grid gap-2 text-[14px]">
          Music file
          <input
            type="file"
            accept="audio/*"
            onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[11px] rounded-[14px] outline-none file:mr-3 file:rounded-[10px] file:border file:border-border file:bg-card file:px-3 file:py-2 file:text-foreground file:font-[800]"
          />
        </label>
        <label className="grid gap-2 text-[14px] lg:col-span-2">
          Lyrics
          <textarea
            value={lyrics}
            onChange={(event) => setLyrics(event.target.value)}
            placeholder="Paste lyrics, hook ideas, or reference notes..."
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] min-h-[110px] resize-y transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>
        {formError && (
          <div className="lg:col-span-2 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-100">
            {formError}
          </div>
        )}
        <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
          <button type="submit" className={primaryButton}>
            <Upload className="size-4" /> Add Track
          </button>
          <span className="text-[13px] text-muted-foreground">
            Files are staged in this workspace for now. Cloud storage can plug into this flow next.
          </span>
        </div>
      </form>

      {projects.length ? (
        <div className="grid gap-3">
          {projects.map((project) => (
            <div key={project.id} className="rounded-[18px] border border-border bg-muted p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="font-[850] text-[18px]">{project.title}</div>
                  <div className="text-[13px] text-muted-foreground mt-1">
                    {project.fileName} · {formatFileSize(project.fileSize)}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 justify-start sm:justify-end">
                  <span className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground">
                    {project.comments.length} comments
                  </span>
                  <span className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground">
                    {invites.filter((invite) => invite.targetKind === 'track' && invite.targetId === project.id).length} shared
                  </span>
                  <button
                    type="button"
                    onClick={() => onShareTrack(project)}
                    className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-card px-3 py-1 text-[12px] font-[800] hover:bg-background transition-all"
                  >
                    <Share2 className="size-3" /> Share
                  </button>
                </div>
              </div>
              {project.lyrics && (
                <details className="mt-3 rounded-[14px] border border-border bg-card p-3">
                  <summary className="cursor-pointer text-[13px] font-[800]">Lyrics</summary>
                  <p className="mt-3 mb-0 whitespace-pre-wrap text-[14px] leading-[1.6] text-muted-foreground">{project.lyrics}</p>
                </details>
              )}
              <div className="grid gap-2 mt-3">
                {project.comments.map((comment) => (
                  <div key={comment.id} className="rounded-[14px] border border-border bg-card p-3">
                    <div className="flex items-center gap-2 text-[12px] text-muted-foreground mb-1">
                      <MessageSquare className="size-3" /> {formatDate(comment.createdAt)}
                    </div>
                    <p className="m-0 text-[14px] leading-[1.5]">{comment.body}</p>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                <input
                  value={commentDrafts[project.id] ?? ''}
                  onChange={(event) => setCommentDrafts({ ...commentDrafts, [project.id]: event.target.value })}
                  placeholder="Leave a note on the track..."
                  className="flex-1 border border-ring bg-input text-foreground px-[14px] py-[11px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <button type="button" onClick={() => handleAddComment(project.id)} className={ghostButton}>
                  <MessageSquare className="size-4" /> Comment
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-[18px] border border-border bg-muted p-6 text-center">
          <Music2 className="size-6 mx-auto mb-3 text-muted-foreground" />
          <h3 className="m-0 mb-2 text-[20px] tracking-[-0.3px]">No tracks uploaded yet.</h3>
          <p className="m-0 text-muted-foreground text-[14px]">
            Add a track, lyrics, and comments here before sending contracts around the song.
          </p>
        </div>
      )}
    </section>
  );
}

function ShareDialog({
  target,
  onClose,
  onSave,
}: {
  target: ShareTarget;
  onClose: () => void;
  onSave: (invite: Omit<ShareInvite, 'id' | 'status' | 'createdAt'>) => void;
}) {
  const [recipientName, setRecipientName] = useState('');
  const [email, setEmail] = useState('');
  const [permission, setPermission] = useState<ShareInvite['permission']>(target.kind === 'contract' ? 'signer' : 'comment');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!recipientName.trim()) {
      setError('Add the recipient name.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Add a valid recipient email.');
      return;
    }

    onSave({
      targetKind: target.kind,
      targetId: target.id,
      targetTitle: target.title,
      recipientName: recipientName.trim(),
      email: email.trim(),
      permission,
      note: note.trim(),
    });
  }

  const permissionOptions: Array<{ value: ShareInvite['permission']; label: string; description: string }> = [
    { value: 'view', label: 'View only', description: 'Can open and review, but cannot comment or edit.' },
    { value: 'comment', label: 'Comment', description: 'Can leave notes on the track or draft.' },
    { value: 'edit', label: 'Edit details', description: 'Can help fill draft details, but cannot delete.' },
    { value: 'signer', label: 'Signer / recipient', description: 'Receives the contract for review or signing later.' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-[620px] rounded-[22px] border border-border bg-[#111820] p-5 shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <div className="text-[13px] text-muted-foreground mb-1">
              Share {target.kind === 'contract' ? 'contract' : 'track'}
            </div>
            <h2 className="m-0 text-[26px] tracking-[-0.5px]">{target.title}</h2>
          </div>
          <button type="button" onClick={onClose} className={ghostButton}>
            Cancel
          </button>
        </div>

        <label className="grid gap-2 text-[14px] mb-4">
          Recipient name
          <input
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            placeholder="Artist, producer, manager, label, or company"
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>

        <label className="grid gap-2 text-[14px] mb-4">
          Recipient email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="recipient@example.com"
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>

        <div className="grid gap-2 mb-4">
          <div className="text-[14px] font-[800]">Permission</div>
          <div className="grid sm:grid-cols-2 gap-2">
            {permissionOptions.map((option) => {
              const isSelected = permission === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setPermission(option.value)}
                  className={`text-left rounded-[16px] border p-3 transition-all ${
                    isSelected ? 'border-primary bg-primary/15' : 'border-border bg-muted hover:bg-accent'
                  }`}
                >
                  <div className="font-[850]">{option.label}</div>
                  <p className="m-0 mt-1 text-[12px] text-muted-foreground leading-[1.45]">{option.description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <label className="grid gap-2 text-[14px] mb-4">
          Note
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Example: Please review the royalty section and confirm the split."
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] min-h-[92px] resize-y transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </label>

        <div className="rounded-[14px] border border-border bg-muted p-3 text-[13px] text-muted-foreground mb-4">
          This saves the send request in the workspace for now. Real email delivery and backend permission checks can plug into this same flow next.
        </div>

        {error && (
          <div className="rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-100 mb-4">
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-3 justify-end">
          <button type="button" onClick={onClose} className={ghostButton}>
            Close
          </button>
          <button type="submit" className={primaryButton}>
            <Send className="size-4" /> Send
          </button>
        </div>
      </form>
    </div>
  );
}

function ContractsPage() {
  const { contracts, loading, error, removeContract } = useContracts();

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
        <ContractsBlock contracts={contracts} loading={loading} error={error} onDelete={removeContract} />
      </section>
    </main>
  );
}

function ContractsBlock({
  contracts,
  loading,
  error,
  onDelete,
  onShare,
}: {
  contracts: Contract[];
  loading: boolean;
  error: string;
  onDelete?: (id: string) => Promise<void>;
  onShare?: (contract: Contract) => void;
}) {
  const [deletingId, setDeletingId] = useState('');
  const [deleteError, setDeleteError] = useState('');

  async function handleDelete(contract: Contract) {
    if (!onDelete) {
      return;
    }

    const confirmed = window.confirm(`Delete "${contract.title}"? This cannot be undone.`);

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

  if (error) {
    return (
      <div className="rounded-[18px] border border-destructive/50 bg-destructive/10 p-5 text-red-100">
        {error}
      </div>
    );
  }

  if (!contracts.length) {
    return <EmptyContractsState />;
  }

  return (
    <div className="grid gap-3">
      {deleteError && (
        <div className="rounded-[18px] border border-destructive/50 bg-destructive/10 p-4 text-red-100">
          {deleteError}
        </div>
      )}
      {contracts.map((contract) => (
        <div
          key={contract.id}
          className="grid md:grid-cols-[1fr_210px_120px_280px] gap-3 items-center rounded-[18px] border border-border bg-muted p-4 hover:bg-accent transition-all"
        >
          <div>
            <div className="font-[800]">{contract.title}</div>
            <div className="text-[13px] text-muted-foreground mt-1">Updated {formatDate(contract.updatedAt)}</div>
          </div>
          <div className="text-[14px] text-muted-foreground">{contract.contractType}</div>
          <div>
            <span className="inline-flex rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[750] capitalize">
              {contract.status}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
            <Link
              to={`/dashboard/contracts/${contract.id}`}
              className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-card px-3 py-2 text-[13px] font-[800] hover:bg-background transition-all"
            >
              Open <ArrowRight className="size-4" />
            </Link>
            {onShare && (
              <button
                type="button"
                onClick={() => onShare(contract)}
                className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-border bg-card px-3 py-2 text-[13px] font-[800] hover:bg-background transition-all"
              >
                <Share2 className="size-4" /> Share
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={() => handleDelete(contract)}
                disabled={deletingId === contract.id}
                className="inline-flex items-center justify-center gap-2 rounded-[12px] border border-red-400/40 bg-red-500/10 px-3 py-2 text-[13px] font-[800] text-red-100 hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
              >
                <Trash2 className="size-4" /> {deletingId === contract.id ? 'Deleting' : 'Delete'}
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
              <span className="rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
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
                        <span className="rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[800]">
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

        {error && <div className="rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-100">{error}</div>}

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
        <section className="border-b border-border bg-[#0f1118] lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between border-b border-border bg-[#11151f] px-5 py-4">
            <div>
              <div className="text-[11px] font-[800] uppercase tracking-[0.22em] text-muted-foreground">Fill in fields</div>
              <div className="mt-1 max-w-[260px] truncate text-[12px] text-muted-foreground">{template.title}</div>
            </div>
            <div className="rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[800] text-primary">{progress}% complete</div>
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

        <section className="flex min-w-0 flex-col bg-[#0b0d13]">
          <div className="flex items-center justify-between border-b border-border bg-[#11151f] px-5 py-4">
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
              className={`rounded-full border px-3 py-2 text-[13px] font-[800] transition-all ${
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
        <div className="rounded-full border border-[#b8b8b8] bg-white px-3 py-1 text-[12px] font-[800] text-[#333]">
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
  const navigate = useNavigate();
  const { user } = useAuth();
  const { invites, saveInvite } = useShareInvites(user?.id ?? user?.email);
  const [contract, setContract] = useState<Contract | null>(null);
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
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendNotice, setSendNotice] = useState('');
  const [isEditingContract, setIsEditingContract] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editError, setEditError] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    let active = true;

    if (!id) {
      setError('Missing contract id.');
      setLoading(false);
      return;
    }

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
            ['Status', contract.status],
            ['Created', formatDate(contract.createdAt)],
            ['Last updated', formatDate(contract.updatedAt)],
          ]
        : [],
    [contract, resolvedTemplateSourceFile],
  );
  const displayContractText = useMemo(
    () => bestContractDisplayText(contract?.content ?? '', templatePreview),
    [contract?.content, templatePreview],
  );
  const sentInvites = useMemo(
    () => contract ? invites.filter((invite) => invite.targetKind === 'contract' && invite.targetId === contract.id) : [],
    [contract, invites],
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

    const confirmed = window.confirm(`Delete "${contract.title}"? This cannot be undone.`);

    if (!confirmed) {
      return;
    }

    setIsDeleting(true);
    setDeleteError('');

    try {
      await deleteContract(contract.id);
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
              Review the draft first. When it looks right, use Send to add the recipient details.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 justify-start lg:justify-end">
            <span className="inline-flex rounded-full border border-border bg-muted px-4 py-2 text-[13px] font-[800] capitalize">
              {contract.status}
            </span>
            <button type="button" onClick={() => setSendDialogOpen(true)} className={primaryButton}>
              <Send className="size-4" /> Send
            </button>
          </div>
        </div>
      </section>

      <section className="grid md:grid-cols-4 gap-3">
        {metadata.map(([label, value]) => (
          <div key={label} className={`${card} p-4`}>
            <div className="text-[13px] text-muted-foreground">{label}</div>
            <div className="font-[800] mt-2 capitalize">{value}</div>
          </div>
        ))}
      </section>

      {(sendNotice || sentInvites.length > 0) && (
        <section className={`${panel} p-5`}>
          <div className="flex items-center gap-2 mb-4">
            <Send className="size-5" />
            <h2 className="m-0 text-[24px] tracking-[-0.4px]">Send history</h2>
          </div>
          {sendNotice && (
            <div className="rounded-[14px] border border-primary/40 bg-primary/10 p-3 mb-3 text-[14px]">
              {sendNotice}
            </div>
          )}
          <div className="grid gap-3">
            {sentInvites.map((invite) => (
              <div key={invite.id} className={`${card} p-4`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-[850]">{invite.recipientName || invite.email}</div>
                    <div className="text-[13px] text-muted-foreground normal-case">{invite.email}</div>
                  </div>
                  <span className="rounded-full border border-border bg-muted px-3 py-1 text-[12px] font-[800] capitalize">
                    {invite.status}
                  </span>
                </div>
                {invite.note && <p className="m-0 mt-3 text-[14px] text-muted-foreground leading-[1.5]">{invite.note}</p>}
              </div>
            ))}
          </div>
        </section>
      )}

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
            <div className="mt-5 rounded-[16px] border border-destructive/50 bg-destructive/10 p-5 text-red-100">
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
                <span className="rounded-full border border-border bg-card px-3 py-1 text-[12px] text-muted-foreground">
                  {editContent.length.toLocaleString()} characters
                </span>
              </div>
              <textarea
                value={editContent}
                onChange={(event) => setEditContent(event.target.value)}
                spellCheck={false}
                className="min-h-[520px] w-full resize-y rounded-[14px] border border-ring bg-white px-4 py-4 font-['Times_New_Roman',Times,serif] text-[14px] leading-[1.45] text-black outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              />
              {editError && (
                <div className="mt-3 rounded-[14px] border border-destructive/50 bg-destructive/10 p-3 text-[14px] text-red-100">
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
        <div className="grid gap-2 mt-4">
          <label className="text-[14px]">Clause or section to explain</label>
          <textarea
            value={clauseText}
            onChange={(event) => setClauseText(event.target.value)}
            placeholder="Paste a clause here, or leave this blank to explain the draft summary."
            className="w-full border border-ring bg-input text-foreground px-[14px] py-[13px] rounded-[14px] outline-none placeholder:text-[rgba(255,255,255,.42)] min-h-[100px] resize-y transition-all focus:border-primary focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="flex flex-wrap gap-3 mt-5">
          {deleteError && (
            <div className="basis-full rounded-[18px] border border-destructive/50 bg-destructive/10 p-4 text-red-100">
              {deleteError}
            </div>
          )}
          <button type="button" onClick={handleExplainDraft} disabled={Boolean(aiActionLoading)} className={primaryButton}>
            {aiActionLoading === 'explain' ? 'Explaining...' : 'Explain this'} <Sparkles className="size-4" />
          </button>
          <button type="button" onClick={handleRiskReview} disabled={Boolean(aiActionLoading)} className={ghostButton}>
            {aiActionLoading === 'risk' ? 'Reviewing...' : 'Review Risk'} <ShieldCheck className="size-4" />
          </button>
          <button type="button" onClick={startManualEdit} className={ghostButton}>
            Continue Editing <PenLine className="size-4" />
          </button>
          <Link to="/dashboard" className={ghostButton}>
            Back to Dashboard
          </Link>
          <button
            type="button"
            onClick={handleDeleteContract}
            disabled={isDeleting}
            className="inline-flex items-center justify-center gap-2 border border-red-400/40 bg-red-500/10 text-red-100 px-[15px] py-[11px] rounded-[14px] font-[700] cursor-pointer hover:bg-red-500/20 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
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
                  <span key={term} className="rounded-full border border-border bg-muted px-3 py-1 text-[12px] text-muted-foreground">
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
                    <span className="rounded-full border border-border bg-card px-3 py-1 text-[12px] font-[800] capitalize">
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

      {sendDialogOpen && (
        <ShareDialog
          target={{ kind: 'contract', id: contract.id, title: contract.title }}
          onClose={() => setSendDialogOpen(false)}
          onSave={(invite) => {
            saveInvite(invite);
            setSendNotice(`Send request saved for ${invite.recipientName}.`);
            setSendDialogOpen(false);
          }}
        />
      )}
    </main>
  );
}

function MotionStyles() {
  return (
    <style>{`
      .fade-in-section {
        opacity: 0;
        transform: translateY(30px);
        transition: opacity 0.8s ease-out, transform 0.8s ease-out;
      }
      .fade-in-section.animate-in {
        opacity: 1;
        transform: translateY(0);
      }
      .stagger-item {
        opacity: 0;
        transform: translateY(20px);
        transition: opacity 0.5s ease-out, transform 0.5s ease-out;
      }
      .stagger-item.animate-in {
        opacity: 1;
        transform: translateY(0);
      }
      .hover-lift {
        transition: transform 0.2s ease, box-shadow 0.2s ease;
      }
      .hover-lift:hover {
        transform: translateY(-4px);
      }
    `}</style>
  );
}
